import { createHash, randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { StudioItem, StudioWorkspace } from '../shared/studio.ts';
import { searchFlights, searchHotels } from './integrations.ts';
import { studioHotelDestination } from './studio-models.ts';
import { StudioError, type StudioStore } from './studio-store.ts';
import { applyStudioPatch, structureFingerprint } from './studio-domain.ts';
import { flightSearchSchema, studioHotelSearchSchema } from './validation.ts';
import { buildStudioFlightQuote } from './studio-flight-planning.ts';
import { publicHotelQuote, recommendStudioHotels } from './studio-hotels.ts';
import { studioClientTravelHistory } from './studio-clients.ts';
import { normalizeStudioCountry } from '../shared/studio-travel-research.ts';
import type { FlightOffer } from '../shared/types.ts';
import {
  studioFlightLocalDate,
  studioJourneyDatePatch,
  studioJourneyFlightDates,
  type StudioJourneyDirection,
} from './studio-journey-flight-dates.ts';

const revisionSchema = z.number().int().positive();
const hotelRequest = z
  .object({
    revision: revisionSchema,
    stopId: z.string().min(1).max(150),
    offset: z.number().int().min(0).max(5000).optional(),
    guestNationality: z
      .string()
      .regex(/^[A-Za-z]{2}$/, 'Enter the guest nationality as a two-letter country code.'),
  })
  .strict();
const selectRequest = z.object({ revision: revisionSchema }).strict();
const journeySelectRequest = z
  .object({ revision: revisionSchema, direction: z.enum(['outbound', 'return']) })
  .strict();
const journeySearchRequest = z
  .object({
    revision: revisionSchema,
    stopId: z.string().min(1).max(150),
    direction: z.enum(['outbound', 'return']),
  })
  .passthrough();
type JourneyQuoteScope = {
  scope: 'journey';
  direction: StudioJourneyDirection;
  stopId: string;
  input: z.infer<typeof flightSearchSchema>;
};
type StoredQuoteScope = { fingerprint: string; expiresAt: string } & Partial<JourneyQuoteScope>;
const quoteLifetimeMs = 30 * 60 * 1000;
type SupplierDependencies = {
  flights?: typeof searchFlights;
  hotels?: typeof searchHotels;
  hotelDestination?: typeof studioHotelDestination;
  hotelRecommendations?: typeof recommendStudioHotels;
};

export function studioQuoteFingerprint(workspace: StudioWorkspace) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        structure: structureFingerprint(workspace),
        adults: workspace.brief.adults,
        children: workspace.brief.children,
        childAges: workspace.brief.childAges,
        passportNationality: workspace.brief.passportNationality,
        currency: workspace.brief.currency,
        pricingCurrency: workspace.pricing.currency,
        hotelStandard: workspace.brief.hotelStandard,
        hotelLocation: workspace.brief.hotelLocation,
        cabin: workspace.brief.cabin,
        origin: workspace.brief.origin,
        departureDate: workspace.brief.departureDate || '',
        returnDepartureDate: workspace.brief.returnDepartureDate || '',
        tripDays: workspace.brief.tripDays ?? null,
        outboundTransport: workspace.brief.outboundTransport || 'undecided',
        returnTransport: workspace.brief.returnTransport || 'undecided',
      }),
    )
    .digest('hex');
}

function requireSearchableParty(workspace: StudioWorkspace, hotels = false, planning = false) {
  if ((!planning && !workspace.structureAccepted) || !workspace.stops.length)
    throw new StudioError(400, 'Accept the trip structure before searching for services.');
  if (
    workspace.brief.adults === null ||
    workspace.brief.adults < 1 ||
    workspace.brief.children === null
  )
    throw new StudioError(400, 'Confirm the adults and children for this trip before searching.');
  if (
    hotels &&
    workspace.brief.children > 0 &&
    (workspace.brief.childAges.length !== workspace.brief.children ||
      workspace.brief.childAges.some((age) => !Number.isInteger(age) || age < 0 || age > 17))
  )
    throw new StudioError(
      400,
      'Confirm the age of every child (0–17) before searching hotel availability.',
      'STUDIO_CHILD_AGES_REQUIRED',
    );
  if (!hotels && workspace.brief.children > 0)
    throw new StudioError(
      400,
      'Automatic supplier search currently supports adults only. Add a reviewed family quote from your supplier manually; adult-only prices are not valid for this party.',
      'STUDIO_FAMILY_SEARCH_UNSUPPORTED',
    );
}

function requireJourneyStop(
  workspace: StudioWorkspace,
  stopId: string,
  direction: StudioJourneyDirection,
) {
  const stop = direction === 'outbound' ? workspace.stops[0] : workspace.stops.at(-1);
  if (!stop || stop.id !== stopId || !stop.name.trim() || !normalizeStudioCountry(stop.country))
    throw new StudioError(
      400,
      'Choose a known first destination for outbound flights or a known last destination for return flights.',
    );
  return stop;
}

/** Only an offer covering the requested airport legs can change the trip schedule. */
function matchingJourneyOffer(
  offer: FlightOffer,
  input: z.infer<typeof flightSearchSchema>,
  country: string,
  direction: StudioJourneyDirection,
) {
  if (offer.origin !== input.origin || offer.destination !== input.destination) return false;
  const journeys = offer.journeys || [];
  if (input.returnDate && journeys.length !== 2) return false;
  if (!input.returnDate && journeys.length > 1) return false;
  if (journeys.length) {
    for (const journey of journeys) {
      if (
        journey.segments.length &&
        (journey.segments[0].origin.code !== journey.origin.code ||
          journey.segments.at(-1)!.destination.code !== journey.destination.code)
      )
        return false;
    }
    const first = journeys[0];
    if (first.origin.code !== input.origin || first.destination.code !== input.destination)
      return false;
    const departureAirport = first.origin.timeZone ? first.origin : first.segments[0]?.origin;
    const firstDate = studioFlightLocalDate(first.departure, departureAirport);
    if (firstDate && firstDate !== input.departureDate) return false;
    const boundaries =
      direction === 'outbound'
        ? [first.destination, first.segments.at(-1)?.destination]
        : [first.origin, first.segments[0]?.origin];
    if (
      boundaries.some(
        (airport) => airport?.countryCode && airport.countryCode.toUpperCase() !== country,
      )
    )
      return false;
    if (input.returnDate) {
      const inbound = journeys[1];
      if (inbound.origin.code !== input.destination || inbound.destination.code !== input.origin)
        return false;
      if (
        [inbound.origin, inbound.segments[0]?.origin].some(
          (airport) => airport?.countryCode && airport.countryCode.toUpperCase() !== country,
        )
      )
        return false;
      const airport = inbound.origin.timeZone ? inbound.origin : inbound.segments[0]?.origin;
      const date = studioFlightLocalDate(inbound.departure, airport);
      if (date && date !== input.returnDate) return false;
    }
  } else {
    const departure = studioFlightLocalDate(offer.departure);
    if (departure && departure !== input.departureDate) return false;
  }
  return true;
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
    hotelRecommendations: options.providers?.hotelRecommendations || recommendStudioHotels,
  };
  function remember(
    ownerId: string,
    workspace: StudioWorkspace,
    quotes: { item: StudioItem; expiresAt?: string }[],
    append = false,
    journeyScope?: JourneyQuoteScope,
  ) {
    const now = Date.now();
    const valid = quotes.filter((quote) => !quote.expiresAt || Date.parse(quote.expiresAt) > now);
    db.exec('BEGIN IMMEDIATE');
    try {
      // New search results replace only this owner's old, unselected quote list.
      if (journeyScope) {
        const old = db
          .prepare('SELECT id,structure FROM studio_quotes WHERE owner_id=? AND workspace_id=?')
          .all(ownerId, workspace.id);
        const remove = db.prepare(
          'DELETE FROM studio_quotes WHERE id=? AND owner_id=? AND workspace_id=?',
        );
        for (const row of old) {
          const scope = JSON.parse(String(row.structure)) as StoredQuoteScope;
          if (scope.scope === 'journey' && scope.direction === journeyScope.direction)
            remove.run(String(row.id), ownerId, workspace.id);
        }
      } else if (!append)
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
            ...journeyScope,
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
  app.post('/api/studio/workspaces/:id/journey/flights/search', async (req, res) => {
    const { revision, stopId, direction, ...fields } = journeySearchRequest.parse(req.body);
    if (!Object.hasOwn(fields, 'adults') || !Object.hasOwn(fields, 'cabinClass'))
      throw new StudioError(400, 'Confirm the adult count and cabin class for this flight search.');
    const input = flightSearchSchema.parse(fields);
    const ownerId = session(res).owner_id;
    const workspace = store.require(ownerId, String(req.params.id), revision);
    requireSearchableParty(workspace, false, true);
    const stop = requireJourneyStop(workspace, stopId, direction);
    if (workspace.brief.adults !== input.adults)
      throw new StudioError(400, 'The flight passenger count must match the confirmed trip party.');
    if (input.returnDate && (direction === 'return' || workspace.stops.length > 1))
      throw new StudioError(
        400,
        'Choose a one-way return from the last destination. For a multi-stop trip, search the outbound and return separately.',
      );
    const requestScope = abortOnDisconnect(req, res);
    try {
      const result = await providers.flights(input, requestScope.signal);
      requestScope.signal.throwIfAborted();
      requireActiveSession(res);
      const current = store.require(ownerId, workspace.id, revision);
      requireSearchableParty(current, false, true);
      requireJourneyStop(current, stopId, direction);
      const now = new Date().toISOString();
      const mode = result.mode === 'test' || result.mode === 'live' ? result.mode : 'provider';
      const country = normalizeStudioCountry(stop.country)!.code;
      const matching = result.offers.filter((offer) =>
        matchingJourneyOffer(offer, input, country, direction),
      );
      if (result.offers.length && !matching.length)
        throw new StudioError(
          502,
          'The supplier did not return a complete schedule matching these airports and journey. Search again or review an external quote.',
          'STUDIO_FLIGHT_SCHEDULE_UNVERIFIED',
        );
      const quotes = remember(
        ownerId,
        current,
        matching.slice(0, 30).map((offer) => {
          const item: StudioItem = {
            ...baseItem('flight', result.mode, now),
            supplier: result.source === 'duffel' ? 'Duffel' : 'LiteAPI',
            source: result.source === 'duffel' ? 'manual' : 'liteapi',
            title: `${offer.airline} · ${input.origin} to ${input.destination}${input.returnDate ? ' return' : ''}`,
            description: [
              `${direction === 'outbound' ? 'Outbound' : 'Return'} journey · ${input.adults} adults · ${input.cabinClass.replaceAll('_', ' ')}.`,
              offer.priceScope === 'all_passengers_complete_journey' &&
              offer.passengerCount === input.adults
                ? 'Supplier total for all confirmed adults and the complete requested journey.'
                : 'Quoted total; passenger coverage must be confirmed with the supplier.',
              'Use flight dates applies only dates supplied in the selected schedule. Hotel check-in, checkout, transit eligibility, baggage and fare conditions still need confirmation.',
            ].join('\n'),
            stopId,
            startDate: input.departureDate,
            endDate: input.returnDate || '',
            price: offer.price,
            currency: offer.currency,
          };
          const flight = buildStudioFlightQuote(offer, item.id, current, mode, now);
          // A return-only offer must not be described as arrival at the first destination.
          if (direction === 'return')
            flight.advisories = flight.advisories.filter(
              (advice) => advice.kind !== 'gap' && advice.kind !== 'hotel_timing',
            );
          item.imageUrl = flight.airlineLogoUrl;
          item.presentation = { kind: 'flight', flight };
          return { item, expiresAt: offer.expiresAt };
        }),
        true,
        { scope: 'journey', direction, stopId, input },
      );
      res.json({
        quotes,
        flights: quotes.flatMap((quote) =>
          quote.presentation?.kind === 'flight' ? [quote.presentation.flight] : [],
        ),
        mode: result.mode,
        warning: `${result.warning} Using flight dates adds this quote and its supplied schedule to the proposal. It does not hold a fare, issue a ticket, reserve a hotel or establish entry eligibility.`,
      });
    } finally {
      requestScope.clean();
    }
  });
  app.post('/api/studio/workspaces/:id/journey/quotes/:quoteId', (req, res) => {
    const { revision, direction } = journeySelectRequest.parse(req.body);
    const ownerId = session(res).owner_id;
    const workspace = store.require(ownerId, String(req.params.id), revision);
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
    const scope = JSON.parse(String(row.structure)) as StoredQuoteScope;
    const item = JSON.parse(String(row.data)) as StudioItem;
    if (
      scope.scope !== 'journey' ||
      scope.direction !== direction ||
      !scope.stopId ||
      item.presentation?.kind !== 'flight'
    )
      throw new StudioError(
        409,
        'This quote belongs to a different journey. Search for the required outbound or return flight.',
        'STUDIO_QUOTE_SCOPE_MISMATCH',
      );
    if (!Number.isFinite(Date.parse(scope.expiresAt)) || Date.parse(scope.expiresAt) <= Date.now())
      throw new StudioError(409, 'This quote expired. Search again for a current price.');
    requireSearchableParty(workspace, false, true);
    requireJourneyStop(workspace, scope.stopId, direction);
    if (workspace.items.some((selected) => selected.id === quoteId)) {
      res.json({
        workspace,
        dateResolution: studioJourneyFlightDates(
          item.presentation.flight,
          direction,
          workspace.stops.find((stop) => stop.id === scope.stopId),
        ),
      });
      return;
    }
    if (scope.fingerprint !== studioQuoteFingerprint(workspace))
      throw new StudioError(
        409,
        'The route, party or journey preferences changed. Search again for a matching quote.',
      );
    if (workspace.items.length >= 100)
      throw new StudioError(
        400,
        'This proposal already has 100 services. Remove an item before adding another.',
      );
    const patch = studioJourneyDatePatch(
      workspace,
      item.presentation.flight,
      direction,
      scope.stopId,
    );
    requireActiveSession(res);
    const updated = applyStudioPatch(
      workspace,
      { revision, brief: patch.brief, stops: patch.stops },
      store.getAgency(ownerId),
    );
    updated.items.push({
      ...item,
      included: true,
      needsReview: item.needsReview || patch.needsDateReview,
    });
    if (!updated.itineraryManual) updated.itinerary = null;
    else if (updated.itinerary)
      updated.itinerary.notes = [
        ...new Set([
          ...updated.itinerary.notes,
          'A transport service changed. Review the daily plan against its schedule.',
        ]),
      ].slice(-20);
    res.json({
      workspace: store.save(ownerId, updated, revision),
      dateResolution: patch.dateResolution,
    });
  });
  app.post('/api/studio/workspaces/:id/hotels/search', async (req, res) => {
    const input = hotelRequest.parse(req.body),
      ownerId = session(res).owner_id;
    const workspace = store.require(ownerId, String(req.params.id), input.revision);
    requireSearchableParty(workspace, true);
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
      const validated = studioHotelSearchSchema.parse({
        destinationId: stop.id,
        checkin: stop.arrivalDate,
        checkout: stop.departureDate,
        adults: workspace.brief.adults,
        ...(workspace.brief.children ? { childAges: workspace.brief.childAges } : {}),
        currency: workspace.brief.currency,
        guestNationality: input.guestNationality,
      });
      const destination = await providers.hotelDestination(stop, requestScope.signal);
      requestScope.signal.throwIfAborted();
      const result = await providers.hotels(
        { ...validated, destinationId: destination.id },
        requestScope.signal,
        destination,
        { expanded: true, offset: input.offset || 0 },
      );
      requestScope.signal.throwIfAborted();
      requireActiveSession(res);
      const current = store.require(ownerId, workspace.id, input.revision);
      requireSearchableParty(current, true);
      const now = new Date().toISOString();
      const quotes: StudioItem[] = result.offers.map((offer) => ({
        ...baseItem('hotel', result.mode, now),
        title: offer.name,
        description: [
          offer.address,
          offer.room,
          offer.board,
          `Full stay for ${validated.adults} adults${validated.childAges?.length ? ` and ${validated.childAges.length} children (ages ${validated.childAges.join(', ')})` : ''} in one room. Hotel star category, precise location, accessibility, taxes and cancellation terms need agent verification.`,
        ]
          .filter(Boolean)
          .join('\n'),
        stopId: stop.id,
        startDate: validated.checkin,
        endDate: validated.checkout,
        price: offer.price,
        currency: offer.currency,
      }));
      const hotels = quotes.map((quote, index) =>
        publicHotelQuote(
          result.offers[index],
          quote.id,
          now,
          result.mode,
          validated.adults,
          validated.childAges || [],
        ),
      );
      quotes.forEach((quote, index) => {
        const hotel = hotels[index];
        quote.imageUrl = hotel.roomPhotos[0]?.url || hotel.photos[0]?.url;
        quote.presentation = { kind: 'hotel', hotel };
      });
      const recommendations = input.offset
        ? {
            status: 'unavailable' as const,
            picks: [],
            message:
              'Additional supplier inventory; the original AI shortlist covers the first batch.',
          }
        : await providers.hotelRecommendations(
            current,
            hotels,
            requestScope.signal,
            studioClientTravelHistory(db, store, ownerId, current.brief.clientId || '', current.id),
          );
      requestScope.signal.throwIfAborted();
      requireActiveSession(res);
      store.require(ownerId, workspace.id, input.revision);
      remember(
        ownerId,
        current,
        quotes.map((item) => ({ item })),
        Boolean(input.offset),
      );
      res.json({
        quotes,
        hotels,
        recommendations,
        inventory: result.inventory || {
          returnedHotels: new Set(hotels.map((hotel) => hotel.hotelKey)).size,
          returnedQuotes: quotes.length,
          limit: quotes.length,
          hasMore: true,
          searchRadiusKm: 15,
          pagesSearched: 1,
          incomplete: false,
          nextOffset: (input.offset || 0) + 150 <= 5000 ? (input.offset || 0) + 150 : null,
          searchLimitReached: (input.offset || 0) + 150 > 5000,
        },
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
      const mode = result.mode === 'test' || result.mode === 'live' ? result.mode : 'provider';
      const quotes = remember(
        ownerId,
        current,
        result.offers.slice(0, 30).map((offer) => {
          const item: StudioItem = {
            ...baseItem('flight', result.mode, now),
            supplier: result.source === 'duffel' ? 'Duffel' : 'LiteAPI',
            source: result.source === 'duffel' ? ('manual' as const) : ('liteapi' as const),
            title: `${offer.airline} · ${input.origin} to ${input.destination}${input.returnDate ? ' return' : ''}`,
            description: [
              offer.priceScope === 'all_passengers_complete_journey' &&
              offer.passengerCount === input.adults
                ? `${offer.passengerCount} adults · ${input.cabinClass.replaceAll('_', ' ')} · supplier total for the complete requested journey.`
                : `Requested ${input.adults} adults · ${input.cabinClass.replaceAll('_', ' ')}. Quoted total; passenger coverage was not supplied and must be confirmed.`,
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
          };
          const flight = buildStudioFlightQuote(offer, item.id, current, mode, now);
          item.imageUrl = flight.airlineLogoUrl;
          item.presentation = { kind: 'flight', flight };
          return { expiresAt: offer.expiresAt, item };
        }),
      );
      res.json({
        quotes,
        flights: quotes.flatMap((quote) =>
          quote.presentation?.kind === 'flight' ? [quote.presentation.flight] : [],
        ),
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
    const item = JSON.parse(String(row.data)) as StudioItem;
    requireSearchableParty(workspace, item.kind === 'hotel');
    const scope = JSON.parse(String(row.structure)) as StoredQuoteScope;
    if (scope.scope === 'journey')
      throw new StudioError(
        409,
        'Use the journey flight-date selection for this quote.',
        'STUDIO_QUOTE_SCOPE_MISMATCH',
      );
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
    requireActiveSession(res);
    workspace.items.push({ ...item, included: true });
    if (item.kind !== 'hotel') {
      if (!workspace.itineraryManual) workspace.itinerary = null;
      else if (workspace.itinerary)
        workspace.itinerary.notes = [
          ...new Set([
            ...workspace.itinerary.notes,
            'A transport service changed. Review the daily plan against its schedule.',
          ]),
        ].slice(-20);
    }
    res.json({ workspace: store.save(ownerId, workspace, revision) });
  });
}
