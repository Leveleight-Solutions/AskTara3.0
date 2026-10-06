import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import type { FlightAirport, FlightOffer, FlightJourney } from '../shared/types.ts';
import {
  initializeStudioStorage,
  newStudioWorkspace,
  StudioStore,
} from '../server/studio-store.ts';
import { installStudioSupplierRoutes, studioQuoteFingerprint } from '../server/studio-suppliers.ts';
import {
  studioFlightLocalDate,
  studioJourneyDatePatch,
  studioJourneyFlightDates,
} from '../server/studio-journey-flight-dates.ts';
import type { searchFlights } from '../server/integrations.ts';
import { studioTripBriefingInputKey } from '../shared/studio-trip-briefing.ts';

const databases: DatabaseSync[] = [];
after(() => {
  for (const db of databases) db.close();
});
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const fields = (direction: 'outbound' | 'return' = 'outbound') => ({
  stopId: 'london',
  direction,
  origin: direction === 'outbound' ? 'SYD' : 'LHR',
  destination: direction === 'outbound' ? 'LHR' : 'SYD',
  departureDate: direction === 'outbound' ? future(100) : future(105),
  adults: 2,
  cabinClass: 'business',
});
function journey(
  origin: string,
  destination: string,
  departure: string,
  arrival: string,
): FlightJourney {
  const airport = (code: string): FlightAirport => ({
    code,
    countryCode: code === 'SYD' ? 'AU' : code === 'LHR' ? 'GB' : 'FR',
  });
  return {
    id: 'PRIVATE_JOURNEY',
    origin: airport(origin),
    destination: airport(destination),
    departure,
    arrival,
    connections: 0,
    stops: 0,
    segments: [
      {
        id: 'PRIVATE_SEGMENT',
        origin: airport(origin),
        destination: airport(destination),
        departure,
        arrival,
      },
    ],
  };
}
function offer(input: Parameters<typeof searchFlights>[0]): FlightOffer {
  const outward = journey(
    input.origin,
    input.destination,
    `${input.departureDate}T12:00:00`,
    `${input.origin === 'SYD' ? future(101) : future(106)}T06:30:00`,
  );
  const inbound = input.returnDate
    ? journey(
        input.destination,
        input.origin,
        `${input.returnDate}T19:00:00`,
        `${future(107)}T21:00:00`,
      )
    : null;
  return {
    id: 'PRIVATE_OFFER',
    bookingOfferId: 'PRIVATE_BOOKING',
    airline: 'Fictional carrier',
    origin: input.origin,
    destination: input.destination,
    departure: outward.departure,
    arrival: outward.arrival,
    duration: '24h',
    stops: 0,
    price: 2345.67,
    currency: 'AUD',
    journeys: inbound ? [outward, inbound] : [outward],
    requestedJourneyCount: inbound ? 2 : 1,
    passengerCount: input.adults,
    priceScope: 'all_passengers_complete_journey',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
}
function setup(provider?: typeof searchFlights) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  initializeStudioStorage(db);
  const store = new StudioStore(db),
    app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.owner = req.get('x-owner') || 'alice';
    next();
  });
  const workspace = newStudioWorkspace();
  workspace.brief = {
    ...workspace.brief,
    origin: 'Sydney, Australia',
    adults: 2,
    children: 0,
    cabin: 'Business',
    tripDays: 4,
    departureDate: future(100),
    returnDepartureDate: '',
    startDate: '',
    endDate: '',
  };
  workspace.stops = [
    {
      id: 'london',
      name: 'London',
      country: 'United Kingdom',
      nights: null,
      arrivalDate: '',
      departureDate: '',
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
  store.create('alice', workspace);
  const calls = { count: 0, inputs: [] as Parameters<typeof searchFlights>[0][] };
  installStudioSupplierRoutes(app, {
    db,
    store,
    session: (res) => ({ owner_id: res.locals.owner }),
    requireActiveSession: () => {},
    providers: {
      flights: async (input, signal) => {
        calls.count++;
        calls.inputs.push(input);
        return provider
          ? provider(input, signal)
          : {
              offers: [offer(input)],
              mode: 'test',
              warning: 'Sandbox rates.',
              roundTrip: Boolean(input.returnDate),
              source: 'liteapi',
            };
      },
    },
  });
  app.use(
    (
      error: Error & { status?: number; code?: string },
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => res.status(error.status || 400).json({ error: error.message, code: error.code }),
  );
  return { app, db, store, workspace, calls, path: `/api/studio/workspaces/${workspace.id}` };
}

test('unapproved destination can search dated flights and use actual arrival without inventing nights from trip days', async () => {
  const { app, store, workspace, calls, path } = setup();
  const searched = await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields() })
    .expect(200);
  assert.equal(searched.body.quotes.length, 1);
  assert.doesNotMatch(JSON.stringify(searched.body), /PRIVATE_/);
  assert.equal(store.require('alice', workspace.id).items.length, 0);
  const selected = await request(app)
    .post(`${path}/journey/quotes/${searched.body.quotes[0].id}`)
    .send({ revision: workspace.revision, direction: 'outbound' })
    .expect(200);
  const current = selected.body.workspace;
  assert.equal(current.brief.origin, 'Sydney, Australia');
  assert.equal(current.brief.departureDate, future(100));
  assert.equal(current.brief.startDate, future(101));
  assert.equal(current.brief.tripDays, 4);
  assert.equal(current.stops[0].nights, null);
  assert.equal(current.stops[0].departureDate, '');
  assert.equal(current.structureAccepted, false);
  assert.equal(current.items[0].price, 2345.67);
  assert.equal(current.items[0].included, true);
  assert.equal(current.items[0].priceStatus, 'sandbox');
  assert.equal(selected.body.dateResolution.nights, null);
  assert.match(selected.body.dateResolution.notes.join(' '), /check-in.*need confirmation/);
  assert.equal(calls.count, 1, 'selection makes no supplier or reservation request');
  await request(app)
    .post(`${path}/journey/quotes/${searched.body.quotes[0].id}`)
    .send({ revision: current.revision, direction: 'outbound' })
    .expect(200);
  assert.equal(
    store.require('alice', workspace.id).items.length,
    1,
    'retry is idempotent despite date fingerprint changing',
  );
});

test('normal service search remains gated and explicit party and cabin cannot be defaulted', async () => {
  const { app, store, workspace, calls, path } = setup();
  const { stopId: _stop, direction: _direction, ...normal } = fields();
  await request(app)
    .post(`${path}/flights/search`)
    .send({ revision: workspace.revision, ...normal })
    .expect(400);
  const { adults: _adults, ...noAdults } = fields();
  await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...noAdults })
    .expect(400);
  const { cabinClass: _cabin, ...noCabin } = fields();
  await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...noCabin })
    .expect(400);
  await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields(), adults: 1 })
    .expect(400);
  workspace.brief.children = null;
  store.save('alice', workspace, workspace.revision);
  await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields() })
    .expect(400);
  workspace.brief.children = 1;
  workspace.brief.childAges = [8];
  store.save('alice', workspace, workspace.revision);
  const family = await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields() })
    .expect(400);
  assert.equal(family.body.code, 'STUDIO_FAMILY_SEARCH_UNSUPPORTED');
  assert.equal(calls.count, 0);
});

test('roundtrip applies supplied arrival and return departure, exact nights, and replaces claimed dates explicitly', async () => {
  const { app, store, workspace, path } = setup();
  workspace.brief.startDate = future(100);
  workspace.brief.endDate = future(106);
  workspace.stops[0] = {
    ...workspace.stops[0],
    arrivalDate: future(100),
    arrivalFixed: true,
    nights: 6,
    departureDate: future(106),
  };
  workspace.structureAccepted = true;
  store.save('alice', workspace, workspace.revision);
  const searched = await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields(), returnDate: future(104) })
    .expect(200);
  const selected = await request(app)
    .post(`${path}/journey/quotes/${searched.body.quotes[0].id}`)
    .send({ revision: workspace.revision, direction: 'outbound' })
    .expect(200);
  assert.equal(selected.body.workspace.brief.startDate, future(101));
  assert.equal(selected.body.workspace.brief.returnDepartureDate, future(104));
  assert.equal(selected.body.workspace.brief.endDate, future(104));
  assert.equal(selected.body.workspace.stops[0].nights, 3);
  assert.equal(selected.body.workspace.stops[0].departureDate, future(104));
  assert.equal(selected.body.workspace.structureAccepted, false);
  assert.match(
    selected.body.dateResolution.notes.join(' '),
    /replaces the previously recorded arrival/,
  );
  assert.equal(selected.body.workspace.brief.tripDays, 4);
});

test('a real return-only quote applies departure from the destination without assuming a hotel checkout hour', async () => {
  const { app, store, workspace, path, calls } = setup();
  workspace.brief.startDate = future(101);
  workspace.brief.returnDepartureDate = future(105);
  workspace.stops[0].arrivalDate = future(101);
  workspace.stops[0].arrivalFixed = true;
  store.save('alice', workspace, workspace.revision);
  const searched = await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields('return') })
    .expect(200);
  assert.equal(
    searched.body.flights[0].advisories.some((a: { kind: string }) => a.kind === 'gap'),
    false,
  );
  const selected = await request(app)
    .post(`${path}/journey/quotes/${searched.body.quotes[0].id}`)
    .send({ revision: workspace.revision, direction: 'return' })
    .expect(200);
  assert.equal(selected.body.workspace.brief.startDate, future(101));
  assert.equal(selected.body.workspace.brief.returnDepartureDate, future(105));
  assert.equal(selected.body.workspace.brief.endDate, future(105));
  assert.equal(selected.body.workspace.stops[0].nights, 4);
  assert.match(selected.body.dateResolution.notes.join(' '), /no hotel checkout time is assumed/);
  assert.equal(calls.count, 1);
});

function gatewayProvider(code: string, city: string, countryCode: string): typeof searchFlights {
  return async (input) => {
    const flight = offer(input);
    for (const leg of flight.journeys || []) {
      for (const airport of [
        leg.origin,
        leg.destination,
        ...leg.segments.flatMap((segment) => [segment.origin, segment.destination]),
      ])
        if (airport.code === code) Object.assign(airport, { city, countryCode });
    }
    return {
      offers: [flight],
      mode: 'test',
      warning: '',
      roundTrip: Boolean(input.returnDate),
      source: 'liteapi',
    };
  };
}

for (const gateway of [
  {
    code: 'KIX',
    city: 'Osaka',
    country: 'Japan',
    countryCode: 'JP',
    destination: 'Kyoto',
    recorded: true,
  },
  {
    code: 'DPS',
    city: 'Denpasar',
    country: 'Indonesia',
    countryCode: 'ID',
    destination: 'Ubud',
    recorded: false,
  },
]) {
  test(`${gateway.code} landing in ${gateway.city} cannot become confirmed ${gateway.destination} city arrival, including selection replay`, async () => {
    const { app, store, workspace, path, calls } = setup(
      gatewayProvider(gateway.code, gateway.city, gateway.countryCode),
    );
    Object.assign(workspace.stops[0], { name: gateway.destination, country: gateway.country });
    if (gateway.recorded) {
      workspace.brief.startDate = future(102);
      workspace.brief.endDate = future(105);
      workspace.brief.returnDepartureDate = future(105);
      Object.assign(workspace.stops[0], {
        arrivalDate: future(102),
        arrivalFixed: true,
        departureDate: future(105),
        nights: 3,
      });
    }
    store.save('alice', workspace, workspace.revision);
    const before = structuredClone(workspace);
    const searched = await request(app)
      .post(`${path}/journey/flights/search`)
      .send({ revision: workspace.revision, ...fields(), destination: gateway.code })
      .expect(200);
    const id = searched.body.quotes[0].id;
    const selected = await request(app)
      .post(`${path}/journey/quotes/${id}`)
      .send({ revision: workspace.revision, direction: 'outbound' })
      .expect(200);
    assert.equal(selected.body.dateResolution.arrivalDate, null);
    assert.equal(selected.body.dateResolution.nights, null);
    const current = selected.body.workspace;
    assert.equal(current.brief.startDate, before.brief.startDate);
    assert.equal(current.brief.endDate, before.brief.endDate);
    assert.equal(current.brief.returnDepartureDate, before.brief.returnDepartureDate);
    assert.deepEqual(current.stops, before.stops);
    assert.equal(current.items[0].needsReview, true);
    assert.equal(
      current.items[0].presentation.flight.journeys[0].arrival,
      `${future(101)}T06:30:00`,
    );
    assert.equal(current.items[0].price, 2345.67);
    assert.match(
      selected.body.dateResolution.notes.join(' '),
      new RegExp(`${gateway.code}.*${gateway.city}.*${gateway.destination}.*airport transfer`),
    );
    if (gateway.recorded)
      assert.match(
        selected.body.dateResolution.notes.join(' '),
        /recorded arrival.*retained for review/,
      );
    const replay = await request(app)
      .post(`${path}/journey/quotes/${id}`)
      .send({ revision: current.revision, direction: 'outbound' })
      .expect(200);
    assert.equal(replay.body.dateResolution.arrivalDate, null);
    assert.deepEqual(replay.body.workspace.stops, before.stops);
    assert.equal(replay.body.workspace.items.length, 1);
    assert.equal(calls.count, 1, 'selection and replay do not make reservation/provider requests');
  });
}

test('return departure from Osaka airport preserves requested return intent and Kyoto checkout until transfer is reviewed', async () => {
  const { app, store, workspace, path } = setup(gatewayProvider('KIX', 'Osaka', 'JP'));
  Object.assign(workspace.stops[0], {
    name: 'Kyoto',
    country: 'Japan',
    arrivalDate: future(101),
    arrivalFixed: true,
    departureDate: future(104),
    nights: 3,
  });
  Object.assign(workspace.brief, {
    startDate: future(101),
    endDate: future(104),
    returnDepartureDate: future(104),
  });
  store.save('alice', workspace, workspace.revision);
  const before = structuredClone(workspace);
  const searched = await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields('return'), origin: 'KIX' })
    .expect(200);
  const selected = await request(app)
    .post(`${path}/journey/quotes/${searched.body.quotes[0].id}`)
    .send({ revision: workspace.revision, direction: 'return' })
    .expect(200);
  assert.equal(selected.body.dateResolution.returnDepartureDate, future(105));
  assert.equal(selected.body.dateResolution.nights, null);
  assert.equal(selected.body.workspace.brief.returnDepartureDate, future(104));
  assert.equal(selected.body.workspace.brief.endDate, future(104));
  assert.deepEqual(selected.body.workspace.stops, before.stops);
  assert.equal(selected.body.workspace.items[0].needsReview, true);
  assert.match(
    selected.body.dateResolution.notes.join(' '),
    /KIX in Osaka.*Kyoto.*airport transfer.*does not establish hotel checkout/,
  );
});

test('an explicit four-day request remains unchanged and flagged for review when selected flights span five destination days', async () => {
  const { app, workspace, path } = setup();
  const searched = await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields(), returnDate: future(105) })
    .expect(200);
  const selected = await request(app)
    .post(`${path}/journey/quotes/${searched.body.quotes[0].id}`)
    .send({ revision: workspace.revision, direction: 'outbound' })
    .expect(200);
  assert.equal(selected.body.workspace.brief.tripDays, 4);
  assert.equal(selected.body.workspace.brief.startDate, future(101));
  assert.equal(selected.body.workspace.brief.endDate, future(105));
  assert.equal(selected.body.workspace.stops[0].nights, 4);
  assert.equal(selected.body.dateResolution.nights, 4);
  assert.match(
    selected.body.dateResolution.notes.join(' '),
    /5 destination calendar days.*requested 4 trip days.*scope.*not been assumed/,
  );
  assert.equal(selected.body.workspace.items[0].needsReview, true);
});

test('only explicit same-endpoint city metadata triggers gateway review; matching qualified city and unknown city preserve date handling', () => {
  const value = newStudioWorkspace();
  value.stops = [
    {
      id: 'london',
      name: '  london, UNITED KINGDOM  ',
      country: 'United Kingdom',
      nights: null,
      arrivalDate: '',
      departureDate: '',
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
  const flight = offer({ ...fields(), cabinClass: 'business' });
  flight.journeys![0].destination.city = 'LONDON';
  assert.equal(
    studioJourneyDatePatch(value, flight, 'outbound', 'london').dateResolution.arrivalDate,
    future(101),
  );
  value.stops[0].name = 'Kyoto (Japan)';
  delete flight.journeys![0].destination.city;
  flight.journeys![0].segments[0].destination.city = 'Osaka';
  assert.equal(
    studioJourneyDatePatch(value, flight, 'outbound', 'london').dateResolution.arrivalDate,
    null,
  );
  flight.journeys![0].segments[0].destination.code = 'KIX';
  assert.equal(
    studioJourneyDatePatch(value, flight, 'outbound', 'london').dateResolution.arrivalDate,
    future(101),
    'another airport cannot lend its city metadata',
  );
  flight.journeys![0].destination.city = 'unknown';
  assert.equal(
    studioJourneyDatePatch(value, flight, 'outbound', 'london').dateResolution.arrivalDate,
    future(101),
    'unknown supplier city does not imply a known gateway mismatch',
  );
});

test('owner, direction, strict selection and quote-scope boundaries prevent selection bypass', async () => {
  const { app, store, workspace, path } = setup();
  const searched = await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields() })
    .expect(200);
  const id = searched.body.quotes[0].id;
  await request(app)
    .post(`${path}/journey/quotes/${id}`)
    .set('x-owner', 'bob')
    .send({ revision: workspace.revision, direction: 'outbound' })
    .expect(404);
  await request(app)
    .post(`${path}/journey/quotes/${id}`)
    .send({ revision: workspace.revision, direction: 'return' })
    .expect(409);
  await request(app)
    .post(`${path}/journey/quotes/${id}`)
    .send({
      revision: workspace.revision,
      direction: 'outbound',
      arrivalDate: future(100),
      price: 1,
    })
    .expect(400);
  workspace.structureAccepted = true;
  store.save('alice', workspace, workspace.revision);
  const normalBypass = await request(app)
    .post(`${path}/quotes/${id}`)
    .send({ revision: workspace.revision })
    .expect(409);
  assert.equal(normalBypass.body.code, 'STUDIO_QUOTE_SCOPE_MISMATCH');
  const { stopId: _stop, direction: _direction, ...normal } = fields();
  const service = await request(app)
    .post(`${path}/flights/search`)
    .send({ revision: workspace.revision, ...normal })
    .expect(200);
  await request(app)
    .post(`${path}/journey/quotes/${service.body.quotes[0].id}`)
    .send({ revision: workspace.revision, direction: 'outbound' })
    .expect(409);
  assert.equal(store.require('alice', workspace.id).items.length, 0);
});

test('new trip-day or return-date preferences invalidate a quote and expiry is checked before applying anything', async () => {
  for (const change of ['tripDays', 'returnDepartureDate', 'expiry'] as const) {
    const { app, db, store, workspace, path } = setup();
    const searched = await request(app)
      .post(`${path}/journey/flights/search`)
      .send({ revision: workspace.revision, ...fields() })
      .expect(200);
    const id = searched.body.quotes[0].id;
    if (change === 'expiry') {
      const row = db.prepare('SELECT structure FROM studio_quotes WHERE id=?').get(id)!;
      db.prepare('UPDATE studio_quotes SET structure=? WHERE id=?').run(
        JSON.stringify({
          ...JSON.parse(String(row.structure)),
          expiresAt: new Date(Date.now() - 1).toISOString(),
        }),
        id,
      );
    } else {
      const oldFingerprint = studioQuoteFingerprint(workspace);
      if (change === 'tripDays') workspace.brief.tripDays = 8;
      else workspace.brief.returnDepartureDate = future(108);
      assert.notEqual(studioQuoteFingerprint(workspace), oldFingerprint);
      store.save('alice', workspace, workspace.revision);
    }
    await request(app)
      .post(`${path}/journey/quotes/${id}`)
      .send({ revision: workspace.revision, direction: 'outbound' })
      .expect(409);
    assert.equal(store.require('alice', workspace.id).items.length, 0);
    assert.equal(store.require('alice', workspace.id).brief.startDate, '');
  }
});

test('late provider responses cannot persist quotes after a workspace revision changes', async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { app, db, store, workspace, path } = setup(async (input) => {
    entered();
    await waiting;
    return {
      offers: [offer(input)],
      mode: 'test',
      warning: '',
      roundTrip: false,
      source: 'liteapi',
    };
  });
  const pending = request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields() })
    .then((response) => response);
  await started;
  workspace.brief.tripDays = 9;
  store.save('alice', workspace, workspace.revision);
  release();
  const result = await pending;
  assert.equal(result.status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM studio_quotes').get()!.count, 0);
});

test(
  'disconnect cancels the flight provider and prevents any quote persistence',
  { timeout: 3000 },
  async () => {
    let entered!: () => void, cancelled!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    const { app, db, workspace, path } = setup(async (input, signal) => {
      entered();
      await new Promise<void>((resolve) =>
        signal!.addEventListener(
          'abort',
          () => {
            cancelled();
            resolve();
          },
          { once: true },
        ),
      );
      // Even a provider that returns after cancellation cannot persist its response.
      return {
        offers: [offer(input)],
        mode: 'test',
        warning: '',
        roundTrip: false,
        source: 'liteapi',
      };
    });
    const server = createServer(app);
    const pending = request(server)
      .post(`${path}/journey/flights/search`)
      .send({ revision: workspace.revision, ...fields() });
    const completion = pending.then(
      () => null,
      (error: Error) => error,
    );
    try {
      await started;
      pending.abort();
      await aborted;
      assert.match((await completion)!.message, /aborted/i);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM studio_quotes').get()!.count, 0);
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test('other direction quotes survive a new search but unmatched legs/country or missing roundtrip are rejected', async () => {
  const { app, db, workspace, path } = setup();
  await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields('return') })
    .expect(200);
  await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields() })
    .expect(200);
  await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields() })
    .expect(200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM studio_quotes').get()!.count, 2);
  for (const defect of [
    'airport',
    'country',
    'roundtrip',
    'date',
    'segment_boundary',
    'segment_country',
  ] as const) {
    const env = setup(async (input) => {
      const flight = offer(input);
      if (defect === 'airport') flight.destination = 'CDG';
      if (defect === 'country') flight.journeys![0].destination.countryCode = 'FR';
      if (defect === 'roundtrip') flight.journeys = [flight.journeys![0]];
      if (defect === 'date') flight.journeys![0].departure = `${future(99)}T12:00:00`;
      if (defect === 'segment_boundary')
        flight.journeys![0].segments[0].destination = {
          code: 'NRT',
          countryCode: 'JP',
          timeZone: 'Asia/Tokyo',
        };
      if (defect === 'segment_country') {
        flight.journeys![0].destination = { code: 'LHR' };
        flight.journeys![0].segments[0].destination = { code: 'LHR', countryCode: 'JP' };
      }
      return {
        offers: [flight],
        mode: 'test',
        warning: '',
        roundTrip: Boolean(input.returnDate),
        source: 'liteapi',
      };
    });
    const rejected = await request(env.app)
      .post(`${env.path}/journey/flights/search`)
      .send({
        revision: env.workspace.revision,
        ...fields(),
        ...(defect === 'roundtrip' ? { returnDate: future(104) } : {}),
      })
      .expect(502);
    assert.equal(rejected.body.code, 'STUDIO_FLIGHT_SCHEDULE_UNVERIFIED');
    assert.equal(env.db.prepare('SELECT COUNT(*) AS count FROM studio_quotes').get()!.count, 0);
  }
});

test('UTC timestamps need supplied timezones while local/offset dates and exact calendar nights remain literal', () => {
  assert.equal(studioFlightLocalDate('2027-01-01T23:30:00Z'), null);
  assert.equal(
    studioFlightLocalDate('2027-01-01T23:30:00Z', { code: 'SYD', timeZone: 'Australia/Sydney' }),
    '2027-01-02',
  );
  assert.equal(
    studioFlightLocalDate('2027-01-01T23:30:00Z', { code: 'SYD', timeZone: 'Not/AZone' }),
    null,
  );
  assert.equal(studioFlightLocalDate('2027-01-01T23:30:00-08:00'), '2027-01-01');
  assert.equal(studioFlightLocalDate('2027-01-01T23:30:00'), '2027-01-01');
  for (const invalid of [
    '2027-02-29T12:00:00',
    '2027-01-01T25:00:00',
    '2027-01-01T23:60:00',
    '2027-01-01T23:00:00+14:30',
    '2027-01-01',
  ])
    assert.equal(studioFlightLocalDate(invalid), null);
  const flight = offer({ ...fields(), returnDate: future(104), cabinClass: 'business' });
  flight.journeys![0].arrival = '2027-01-01T23:30:00Z';
  flight.journeys![0].segments[0].destination.timeZone = 'Asia/Tokyo';
  flight.journeys![1].departure = '2027-01-02T10:00:00+09:00';
  const workspace = newStudioWorkspace();
  workspace.brief.tripDays = 4;
  workspace.stops = [
    {
      id: 'london',
      name: 'London',
      country: 'GB',
      nights: null,
      arrivalDate: '',
      departureDate: '',
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
  const resolved = studioJourneyDatePatch(workspace, flight, 'outbound', 'london');
  assert.equal(resolved.dateResolution.arrivalDate, '2027-01-02');
  assert.equal(resolved.dateResolution.nights, 0);
  assert.equal(resolved.stops[0].nights, 0);
  assert.equal(workspace.brief.tripDays, 4);
  flight.journeys![0].segments[0].destination.code = 'NRT';
  assert.equal(
    studioJourneyFlightDates(flight, 'outbound').arrivalDate,
    null,
    'a different airport cannot lend its timezone to the journey destination',
  );
});

test('UTC schedules lacking supplier timezone add quote without replacing unknown arrival or inventing hotel nights', async () => {
  const { app, workspace, path } = setup(async (input) => {
    const flight = offer(input);
    flight.journeys![0].arrival += 'Z';
    return { offers: [flight], mode: 'test', warning: '', roundTrip: false, source: 'liteapi' };
  });
  const searched = await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields() })
    .expect(200);
  const selected = await request(app)
    .post(`${path}/journey/quotes/${searched.body.quotes[0].id}`)
    .send({ revision: workspace.revision, direction: 'outbound' })
    .expect(200);
  assert.equal(selected.body.workspace.brief.startDate, '');
  assert.equal(selected.body.workspace.stops[0].nights, null);
  assert.equal(selected.body.dateResolution.arrivalDate, null);
  assert.match(selected.body.dateResolution.notes.join(' '), /unambiguous local arrival/);
});

test('multi-stop dates preserve fixed other stays, separate return supports last stop, and conflicts are atomic', async () => {
  const { app, store, workspace, path, calls } = setup();
  workspace.brief.startDate = future(100);
  workspace.brief.endDate = future(106);
  workspace.stops[0] = {
    ...workspace.stops[0],
    arrivalDate: future(100),
    nights: 2,
    departureDate: future(102),
    arrivalFixed: true,
  };
  workspace.stops.push({
    id: 'paris',
    name: 'Paris',
    country: 'France',
    nights: 4,
    arrivalDate: future(102),
    arrivalFixed: true,
    departureDate: future(106),
    onwardTransport: 'undecided',
    neighbourhood: '',
    notes: '',
  });
  store.save('alice', workspace, workspace.revision);
  await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields(), returnDate: future(105) })
    .expect(400);
  await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields(), stopId: 'paris' })
    .expect(400);
  assert.equal(calls.count, 0);
  const out = await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields() })
    .expect(200);
  const selected = await request(app)
    .post(`${path}/journey/quotes/${out.body.quotes[0].id}`)
    .send({ revision: workspace.revision, direction: 'outbound' })
    .expect(200);
  assert.equal(selected.body.workspace.stops[0].nights, 1);
  assert.deepEqual(selected.body.workspace.stops[1], workspace.stops[1]);
  const current = selected.body.workspace;
  const ret = await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: current.revision, ...fields('return'), origin: 'CDG', stopId: 'paris' })
    .expect(200);
  const returned = await request(app)
    .post(`${path}/journey/quotes/${ret.body.quotes[0].id}`)
    .send({ revision: current.revision, direction: 'return' })
    .expect(200);
  assert.equal(returned.body.workspace.stops[1].departureDate, future(105));
  assert.equal(returned.body.workspace.stops[1].nights, 3);
  assert.deepEqual(returned.body.workspace.stops[0], current.stops[0]);
  const invalid = setup(async (input) => {
    const flight = offer(input);
    flight.journeys![0].arrival = `${future(103)}T12:00:00`;
    return { offers: [flight], mode: 'test', warning: '', roundTrip: false, source: 'liteapi' };
  });
  invalid.workspace.brief = { ...workspace.brief };
  invalid.workspace.stops = workspace.stops.map((stop) => ({ ...stop }));
  invalid.store.save('alice', invalid.workspace, invalid.workspace.revision);
  const bad = await request(invalid.app)
    .post(`${invalid.path}/journey/flights/search`)
    .send({ revision: invalid.workspace.revision, ...fields() })
    .expect(200);
  const failure = await request(invalid.app)
    .post(`${invalid.path}/journey/quotes/${bad.body.quotes[0].id}`)
    .send({ revision: invalid.workspace.revision, direction: 'outbound' })
    .expect(409);
  assert.equal(failure.body.code, 'STUDIO_FLIGHT_DATES_CONFLICT');
  assert.equal(invalid.store.require('alice', invalid.workspace.id).items.length, 0);
  assert.deepEqual(
    invalid.store.require('alice', invalid.workspace.id).stops,
    invalid.workspace.stops,
  );
});

test('manual itinerary is retained and review annotated while dated AI caches are invalidated', async () => {
  const { app, store, workspace, path } = setup();
  workspace.itineraryManual = true;
  workspace.itinerary = {
    generatedAt: new Date().toISOString(),
    notes: [],
    days: [
      {
        day: 1,
        date: '',
        stopIds: ['london'],
        title: 'Agent-written plan',
        summary: 'Keep this plan',
        activities: [
          {
            period: 'flexible',
            title: 'Client meeting',
            description: 'Keep the meeting notes',
            sources: [],
          },
        ],
      },
    ],
  };
  const checkedAt = new Date().toISOString();
  workspace.tripBriefing = {
    inputKey: studioTripBriefingInputKey(workspace),
    checkedAt,
    status: 'partial',
    notes: [],
    stops: [
      {
        stopId: 'london',
        destination: 'London',
        country: 'United Kingdom',
        countryCode: 'GB',
        startDate: '',
        endDate: '',
        entryRequirements: null,
        entryError: '',
        weather: {
          kind: 'unavailable',
          checkedAt,
          summary: 'Previous research unavailable',
          days: [],
          sources: [],
        },
      },
    ],
  };
  store.save('alice', workspace, workspace.revision);
  assert.ok(
    store.require('alice', workspace.id).tripBriefing,
    'old briefing exists before flight dates change',
  );
  const searched = await request(app)
    .post(`${path}/journey/flights/search`)
    .send({ revision: workspace.revision, ...fields(), returnDate: future(104) })
    .expect(200);
  const selected = await request(app)
    .post(`${path}/journey/quotes/${searched.body.quotes[0].id}`)
    .send({ revision: workspace.revision, direction: 'outbound' })
    .expect(200);
  assert.equal(selected.body.workspace.itinerary.days[0].summary, 'Keep this plan');
  assert.equal(
    selected.body.workspace.itinerary.days[0].activities[0].description,
    'Keep the meeting notes',
  );
  assert.match(selected.body.workspace.itinerary.notes.join(' '), /Review the daily plan/);
  assert.equal(selected.body.workspace.tripBriefing, null);
  assert.deepEqual(selected.body.workspace.entryRequirements, []);
});
