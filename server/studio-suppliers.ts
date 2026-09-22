import { createHash, randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { StudioItem, StudioWorkspace } from '../shared/studio.ts';
import { searchFlights, searchHotels } from './integrations.ts';
import { studioHotelDestination } from './studio-models.ts';
import { StudioError, type StudioStore } from './studio-store.ts';
import { structureFingerprint } from './studio-domain.ts';
import { flightSearchSchema, hotelSearchSchema } from './validation.ts';

const revisionSchema = z.number().int().positive();
const hotelRequest = z
  .object({
    revision: revisionSchema,
    stopId: z.string().min(1).max(150),
    guestNationality: z
      .string()
      .regex(/^[A-Za-z]{2}$/, 'Enter the guest nationality as a two-letter country code.'),
  })
  .strict();
const selectRequest = z.object({ revision: revisionSchema }).strict();
const quoteLifetimeMs = 30 * 60 * 1000;
type SupplierDependencies = {
  flights?: typeof searchFlights;
  hotels?: typeof searchHotels;
  hotelDestination?: typeof studioHotelDestination;
};

export function studioQuoteFingerprint(workspace: StudioWorkspace) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        structure: structureFingerprint(workspace),
        adults: workspace.brief.adults,
        children: workspace.brief.children,
        childAges: workspace.brief.childAges,
        currency: workspace.brief.currency,
        pricingCurrency: workspace.pricing.currency,
        hotelStandard: workspace.brief.hotelStandard,
        hotelLocation: workspace.brief.hotelLocation,
        cabin: workspace.brief.cabin,
        origin: workspace.brief.origin,
      }),
    )
    .digest('hex');
}

function requireSearchableParty(workspace: StudioWorkspace) {
  if (!workspace.structureAccepted || !workspace.stops.length)
    throw new StudioError(400, 'Accept the trip structure before searching for services.');
  if (
    workspace.brief.adults === null ||
    workspace.brief.adults < 1 ||
    workspace.brief.children === null
  )
    throw new StudioError(400, 'Confirm the adults and children for this trip before searching.');
  if (workspace.brief.children > 0)
    throw new StudioError(
      400,
      'Automatic supplier search currently supports adults only. Add a reviewed family quote from your supplier manually; adult-only prices are not valid for this party.',
      'STUDIO_FAMILY_SEARCH_UNSUPPORTED',
    );
}

function abortOnDisconnect(req: Request, res: Response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once('aborted', abort);
  res.once('close', close);
  return {
    signal: controller.signal,
    clean: () => {
      req.off('aborted', abort);
      res.off('close', close);
    },
  };
}

function baseItem(kind: StudioItem['kind'], mode: string, quotedAt: string): StudioItem {
  return {
    id: randomUUID(),
    kind,
    title: '',
    description: '',
    stopId: '',
    startDate: '',
    endDate: '',
    status: 'suggested',
    source: 'liteapi',
    sourceUrl: '',
    supplier: 'LiteAPI',
    privateReference: '',
    price: null,
    currency: 'USD',
    priceStatus:
      mode === 'test' ? 'sandbox' : mode === 'live' ? 'supplier_quote' : 'agent_estimate',
    quotedAt,
    included: false,
    needsReview: false,
    cost: null,
  };
}

export function installStudioSupplierRoutes(
  app: Express,
  options: {
    db: DatabaseSync;
    store: StudioStore;
    session: (res: Response) => { owner_id: string };
    requireActiveSession: (res: Response) => void;
    providers?: SupplierDependencies;
  },
) {
  const { db, store, session, requireActiveSession } = options;
  const providers = {
    flights: options.providers?.flights || searchFlights,
    hotels: options.providers?.hotels || searchHotels,
    hotelDestination: options.providers?.hotelDestination || studioHotelDestination,
  };
  function remember(
    ownerId: string,
    workspace: StudioWorkspace,
    quotes: { item: StudioItem; expiresAt?: string }[],
  ) {
    const now = Date.now();
    const valid = quotes.filter((quote) => !quote.expiresAt || Date.parse(quote.expiresAt) > now);
    db.exec('BEGIN IMMEDIATE');
    try {
      // New search results replace only this owner's old, unselected quote list.
      db.prepare('DELETE FROM studio_quotes WHERE owner_id=? AND workspace_id=?').run(
        ownerId,
        workspace.id,
      );
      const insert = db.prepare(
        'INSERT INTO studio_quotes(id,owner_id,workspace_id,structure,data,created_at) VALUES(?,?,?,?,?,?)',
      );
      for (const quote of valid) {
        const expiry = quote.expiresAt
          ? Math.min(Date.parse(quote.expiresAt), now + quoteLifetimeMs)
          : now + quoteLifetimeMs;
        insert.run(
          quote.item.id,
          ownerId,
          workspace.id,
          JSON.stringify({
            fingerprint: studioQuoteFingerprint(workspace),
            expiresAt: new Date(expiry).toISOString(),
          }),
          JSON.stringify(quote.item),
          new Date(now).toISOString(),
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return valid.map((quote) => quote.item);
  }
  app.post('/api/studio/workspaces/:id/hotels/search', async (req, res) => {
    const input = hotelRequest.parse(req.body),
      ownerId = session(res).owner_id;
    const workspace = store.require(ownerId, String(req.params.id), input.revision);
    requireSearchableParty(workspace);
    if (!workspace.brief.hotelStandard.trim() || !workspace.brief.hotelLocation.trim())
      throw new StudioError(
        400,
        'Confirm the preferred hotel standard and location before searching.',
      );
    const stop = workspace.stops.find((entry) => entry.id === input.stopId);
    if (!stop) throw new StudioError(400, 'Choose a stop from the accepted trip structure.');
    if (!stop.country.trim())
      throw new StudioError(400, 'Confirm the destination country before searching hotels.');
    const requestScope = abortOnDisconnect(req, res);
    try {
      // Validate dates and party before spending a destination-research request.
      const validated = hotelSearchSchema.parse({
        destinationId: stop.id,
        checkin: stop.arrivalDate,
        checkout: stop.departureDate,
        adults: workspace.brief.adults,
        guestNationality: input.guestNationality,
      });
      const destination = await providers.hotelDestination(stop, requestScope.signal);
      requestScope.signal.throwIfAborted();
      const result = await providers.hotels(
        { ...validated, destinationId: destination.id },
        requestScope.signal,
        destination,
      );
      requestScope.signal.throwIfAborted();
      requireActiveSession(res);
      const current = store.require(ownerId, workspace.id, input.revision);
      requireSearchableParty(current);
      const now = new Date().toISOString();
      const quotes = remember(
        ownerId,
        current,
        result.offers.slice(0, 12).map((offer) => ({
          item: {
            ...baseItem('hotel', result.mode, now),
            title: offer.name,
            description: [
              offer.address,
              offer.room,
              offer.board,
              `Full stay for ${validated.adults} adults. Hotel star category, precise location, accessibility, taxes and cancellation terms need agent verification.`,
            ]
              .filter(Boolean)
              .join('\n'),
            stopId: stop.id,
            startDate: validated.checkin,
            endDate: validated.checkout,
            price: offer.price,
            currency: offer.currency,
          },
        })),
      );
      res.json({
        quotes,
        mode: result.mode,
        warning: `${result.warning} Requested hotel standard and neighbourhood are not verified by this rate feed. Review each property's location, room and terms. Selecting a quote only adds it to the proposal; it does not reserve a room.`,
      });
    } finally {
      requestScope.clean();
    }
  });
  app.post('/api/studio/workspaces/:id/flights/search', async (req, res) => {
    const { revision, ...fields } = z
      .object({ revision: revisionSchema })
      .passthrough()
      .parse(req.body);
    if (!Object.hasOwn(fields, 'adults') || !Object.hasOwn(fields, 'cabinClass'))
      throw new StudioError(400, 'Confirm the adult count and cabin class for this flight search.');
    const input = flightSearchSchema.parse(fields),
      ownerId = session(res).owner_id;
    const workspace = store.require(ownerId, String(req.params.id), revision);
    requireSearchableParty(workspace);
    if (workspace.brief.adults !== input.adults)
      throw new StudioError(400, 'The flight passenger count must match the confirmed trip party.');
    const requestScope = abortOnDisconnect(req, res);
    try {
      const result = await providers.flights(input, requestScope.signal);
      requestScope.signal.throwIfAborted();
      requireActiveSession(res);
      const current = store.require(ownerId, workspace.id, revision);
      requireSearchableParty(current);
      const now = new Date().toISOString();
      const quotes = remember(
        ownerId,
        current,
        result.offers.slice(0, 30).map((offer) => ({
          expiresAt: offer.expiresAt,
          item: {
            ...baseItem('flight', result.mode, now),
            supplier: result.source === 'duffel' ? 'Duffel' : 'LiteAPI',
            source: result.source === 'duffel' ? ('manual' as const) : ('liteapi' as const),
            title: `${offer.airline} · ${input.origin} to ${input.destination}${input.returnDate ? ' return' : ''}`,
            description: [
              `${input.adults} adults · ${input.cabinClass.replaceAll('_', ' ')} · price for the complete requested journey.`,
              ...(offer.journeys?.map(
                (journey) =>
                  `${journey.origin.code} → ${journey.destination.code}: ${journey.departure} – ${journey.arrival}; ${journey.connections} connections${journey.duration ? `; ${journey.duration}` : ''}`,
              ) || [`${offer.departure} – ${offer.arrival}; ${offer.stops} stops`]),
              'Check baggage, terminals, ticketing deadlines and fare conditions with the supplier before booking.',
            ].join('\n'),
            startDate: input.departureDate,
            endDate: input.returnDate || '',
            price: offer.price,
            currency: offer.currency,
          },
        })),
      );
      res.json({
        quotes,
        mode: result.mode,
        warning: `${result.warning} Selecting a quote only adds it to the proposal. It does not hold a fare, issue a ticket or create a reservation.`,
      });
    } finally {
      requestScope.clean();
    }
  });
  app.post('/api/studio/workspaces/:id/quotes/:quoteId', (req, res) => {
    const { revision } = selectRequest.parse(req.body),
      ownerId = session(res).owner_id;
    const workspace = store.require(ownerId, String(req.params.id), revision);
    requireSearchableParty(workspace);
    const quoteId = z.string().uuid().parse(req.params.quoteId);
    const row = db
      .prepare(
        'SELECT data,structure FROM studio_quotes WHERE id=? AND owner_id=? AND workspace_id=?',
      )
      .get(quoteId, ownerId, workspace.id);
    if (!row)
      throw new StudioError(
        404,
        'This quote is unavailable. Search again for current suggestions.',
      );
    const scope = JSON.parse(String(row.structure)) as { fingerprint: string; expiresAt: string };
    if (scope.fingerprint !== studioQuoteFingerprint(workspace))
      throw new StudioError(
        409,
        'The route, party or search preferences changed. Search again for a matching quote.',
      );
    if (!Number.isFinite(Date.parse(scope.expiresAt)) || Date.parse(scope.expiresAt) <= Date.now())
      throw new StudioError(409, 'This quote expired. Search again for a current price.');
    if (workspace.items.some((item) => item.id === quoteId)) {
      res.json({ workspace });
      return;
    }
    if (workspace.items.length >= 100)
      throw new StudioError(
        400,
        'This proposal already has 100 services. Remove an item before adding another.',
      );
    const item = JSON.parse(String(row.data)) as StudioItem;
    requireActiveSession(res);
    workspace.items.push({ ...item, included: true });
    workspace.itinerary = null;
    res.json({ workspace: store.save(ownerId, workspace, revision) });
  });
}
