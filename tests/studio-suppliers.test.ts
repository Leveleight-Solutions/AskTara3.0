import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { destinations } from '../shared/catalog.ts';
import {
  initializeStudioStorage,
  newStudioWorkspace,
  StudioError,
  StudioStore,
} from '../server/studio-store.ts';
import { installStudioSupplierRoutes } from '../server/studio-suppliers.ts';
import type { searchFlights, searchHotels } from '../server/integrations.ts';

const databases: DatabaseSync[] = [];
after(() => {
  for (const db of databases) db.close();
});
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const flightFields = () => ({
  origin: 'SYD',
  destination: 'LHR',
  departureDate: future(100),
  returnDate: future(110),
  adults: 2,
  cabinClass: 'business',
});
function setup(
  overrides: {
    hotels?: typeof searchHotels;
    flights?: typeof searchFlights;
    active?: () => void;
  } = {},
) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec('PRAGMA foreign_keys=ON');
  initializeStudioStorage(db);
  const store = new StudioStore(db),
    app = express();
  app.use(express.json());
  const workspace = newStudioWorkspace();
  workspace.structureAccepted = true;
  workspace.brief = {
    ...workspace.brief,
    adults: 2,
    children: 0,
    hotelStandard: 'Four stars',
    hotelLocation: 'Near the train station',
    cabin: 'Business',
    startDate: future(101),
    endDate: future(106),
  };
  workspace.stops = [
    {
      id: 'london',
      name: 'London',
      country: 'United Kingdom',
      nights: 5,
      arrivalDate: future(101),
      departureDate: future(106),
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
  store.create('alice', workspace);
  const calls = {
    hotels: 0,
    flights: 0,
    destination: 0,
    hotelInput: {} as unknown,
    flightInput: {} as unknown,
  };
  app.use((req, res, next) => {
    res.locals.owner = req.get('x-owner') || 'alice';
    next();
  });
  installStudioSupplierRoutes(app, {
    db,
    store,
    session: (res) => ({ owner_id: res.locals.owner }),
    requireActiveSession: overrides.active || (() => {}),
    providers: {
      hotelDestination: async (stop) => {
        calls.destination++;
        return { ...destinations[0], id: stop.id, name: stop.name, country: stop.country };
      },
      hotels:
        overrides.hotels ||
        (async (input) => {
          calls.hotels++;
          calls.hotelInput = input;
          return {
            offers: [
              {
                id: 'PRIVATE_PROVIDER_ID',
                hotelId: 'PRIVATE_HOTEL_ID',
                offerId: 'PRIVATE_OFFER_TOKEN',
                name: 'A London hotel',
                image: '',
                address: 'Example Road',
                room: 'Standard double',
                board: 'Breakfast',
                price: 1234.56,
                currency: 'USD',
                checkin: input.checkin,
                checkout: input.checkout,
              },
            ],
            mode: 'test',
            warning: 'Sandbox test rates.',
          };
        }),
      flights:
        overrides.flights ||
        (async (input) => {
          calls.flights++;
          calls.flightInput = input;
          return {
            offers: [
              {
                id: 'PRIVATE_FLIGHT_OFFER',
                airline: 'Example airline',
                origin: input.origin,
                destination: input.destination,
                departure: `${input.departureDate}T12:00:00`,
                arrival: `${input.departureDate}T22:00:00`,
                duration: '10h',
                stops: 0,
                price: 2345.67,
                currency: 'USD',
                expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
              },
            ],
            mode: 'test',
            warning: 'Sandbox test rates.',
            roundTrip: true,
            source: 'liteapi',
          };
        }),
    },
  });
  app.use((error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) =>
    res.status(error.status || 400).json({ error: error.message }),
  );
  return { app, db, store, workspace, calls, path: `/api/studio/workspaces/${workspace.id}` };
}

test('hotel search needs confirmed adults, no children, accepted structure, dates, nationality and preferences before any provider request', async () => {
  const { app, store, workspace, path, calls } = setup();
  const query = () => ({ revision: workspace.revision, stopId: 'london', guestNationality: 'AU' });
  workspace.structureAccepted = false;
  store.save('alice', workspace, workspace.revision);
  await request(app).post(`${path}/hotels/search`).send(query()).expect(400);
  workspace.structureAccepted = true;
  workspace.brief.children = null;
  store.save('alice', workspace, workspace.revision);
  await request(app).post(`${path}/hotels/search`).send(query()).expect(400);
  workspace.brief.children = 1;
  store.save('alice', workspace, workspace.revision);
  const family = await request(app).post(`${path}/hotels/search`).send(query()).expect(400);
  assert.match(family.body.error, /adults only/);
  workspace.brief.children = 0;
  workspace.brief.hotelStandard = '';
  store.save('alice', workspace, workspace.revision);
  await request(app).post(`${path}/hotels/search`).send(query()).expect(400);
  workspace.brief.hotelStandard = 'Four stars';
  workspace.stops[0].departureDate = '';
  store.save('alice', workspace, workspace.revision);
  await request(app).post(`${path}/hotels/search`).send(query()).expect(400);
  workspace.stops[0].departureDate = future(106);
  store.save('alice', workspace, workspace.revision);
  await request(app)
    .post(`${path}/hotels/search`)
    .send({ ...query(), guestNationality: '' })
    .expect(400);
  assert.deepEqual([calls.hotels, calls.flights, calls.destination], [0, 0, 0]);
});

test('hotel quote selection uses the stored supplier price, retains sandbox labels and never creates a reservation', async () => {
  const { app, store, workspace, path, calls, db } = setup();
  const searched = await request(app)
    .post(`${path}/hotels/search`)
    .send({ revision: workspace.revision, stopId: 'london', guestNationality: 'au' })
    .expect(200);
  const quote = searched.body.quotes[0];
  assert.equal(quote.price, 1234.56);
  assert.equal(quote.priceStatus, 'sandbox');
  assert.equal(quote.included, false);
  assert.match(quote.id, /^[a-f0-9-]{36}$/);
  assert.doesNotMatch(JSON.stringify(searched.body), /PRIVATE_/);
  assert.match(searched.body.warning, /standard and neighbourhood are not verified/);
  assert.equal(store.require('alice', workspace.id).items.length, 0);
  assert.deepEqual(calls.hotelInput, {
    destinationId: 'london',
    checkin: future(101),
    checkout: future(106),
    adults: 2,
    guestNationality: 'AU',
  });
  await request(app)
    .post(`${path}/quotes/${quote.id}`)
    .send({ revision: workspace.revision, price: 0.01 })
    .expect(400);
  await request(app)
    .post(`${path}/quotes/${quote.id}`)
    .set('x-owner', 'bob')
    .send({ revision: workspace.revision })
    .expect(404);
  const selected = await request(app)
    .post(`${path}/quotes/${quote.id}`)
    .send({ revision: workspace.revision })
    .expect(200);
  assert.equal(selected.body.workspace.items[0].price, 1234.56);
  assert.equal(selected.body.workspace.items[0].included, true);
  const repeated = await request(app)
    .post(`${path}/quotes/${quote.id}`)
    .send({ revision: selected.body.workspace.revision })
    .expect(200);
  assert.equal(repeated.body.workspace.items.length, 1);
  assert.equal(calls.hotels, 1);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='bookings'").get(), undefined);
});

test('quotes are scoped to a workspace and invalidated by changed route or party preferences and expiry', async () => {
  const { app, store, workspace, path, db } = setup();
  const searched = await request(app)
    .post(`${path}/hotels/search`)
    .send({ revision: workspace.revision, stopId: 'london', guestNationality: 'AU' })
    .expect(200);
  const quote = searched.body.quotes[0],
    second = store.create('alice');
  second.structureAccepted = true;
  second.stops = workspace.stops;
  second.brief = workspace.brief;
  store.save('alice', second, second.revision);
  await request(app)
    .post(`/api/studio/workspaces/${second.id}/quotes/${quote.id}`)
    .send({ revision: second.revision })
    .expect(404);
  workspace.brief.hotelLocation = 'Near the airport';
  store.save('alice', workspace, workspace.revision);
  await request(app)
    .post(`${path}/quotes/${quote.id}`)
    .send({ revision: workspace.revision })
    .expect(409);
  const refreshed = await request(app)
    .post(`${path}/hotels/search`)
    .send({ revision: workspace.revision, stopId: 'london', guestNationality: 'AU' })
    .expect(200);
  const freshId = refreshed.body.quotes[0].id;
  const scope = JSON.parse(
    String(db.prepare('SELECT structure FROM studio_quotes WHERE id=?').get(freshId)?.structure),
  );
  db.prepare('UPDATE studio_quotes SET structure=? WHERE id=?').run(
    JSON.stringify({ ...scope, expiresAt: new Date(Date.now() - 1000).toISOString() }),
    freshId,
  );
  const expired = await request(app)
    .post(`${path}/quotes/${freshId}`)
    .send({ revision: workspace.revision })
    .expect(409);
  assert.match(expired.body.error, /expired/);
  assert.equal(store.require('alice', workspace.id).items.length, 0);
});

test('flight dates and cabin come from explicit search fields, not the holiday dates or defaults', async () => {
  const { app, workspace, path, calls } = setup();
  await request(app)
    .post(`${path}/flights/search`)
    .send({ revision: workspace.revision, ...flightFields(), adults: undefined })
    .expect(400);
  await request(app)
    .post(`${path}/flights/search`)
    .send({ revision: workspace.revision, ...flightFields(), cabinClass: undefined })
    .expect(400);
  await request(app)
    .post(`${path}/flights/search`)
    .send({ revision: workspace.revision, ...flightFields(), adults: 1 })
    .expect(400);
  assert.equal(calls.flights, 0);
  const response = await request(app)
    .post(`${path}/flights/search`)
    .send({ revision: workspace.revision, ...flightFields() })
    .expect(200);
  assert.deepEqual(calls.flightInput, flightFields());
  assert.equal(response.body.quotes[0].startDate, future(100));
  assert.equal(response.body.quotes[0].endDate, future(110));
  assert.equal(response.body.quotes[0].priceStatus, 'sandbox');
  assert.doesNotMatch(JSON.stringify(response.body), /PRIVATE_/);
  assert.match(response.body.warning, /does not hold a fare/);
});

test('in-flight workspace edits reject stale results before storing supplier quotes', async () => {
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen = new Promise<void>((resolve) => {
    started = resolve;
  });
  const { app, store, workspace, path, db } = setup({
    hotels: async () => {
      started();
      await gate;
      return { offers: [], mode: 'test', warning: '' };
    },
  });
  const pending = request(app)
    .post(`${path}/hotels/search`)
    .send({ revision: workspace.revision, stopId: 'london', guestNationality: 'AU' })
    .then((result) => result);
  await seen;
  workspace.brief.adults = 3;
  store.save('alice', workspace, workspace.revision);
  release();
  assert.equal((await pending).status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM studio_quotes').get()?.n, 0);
});

test('session invalidation after a provider response prevents quote persistence', async () => {
  const { app, workspace, path, db } = setup({
    active: () => {
      throw new StudioError(409, 'Session changed');
    },
  });
  await request(app)
    .post(`${path}/hotels/search`)
    .send({ revision: workspace.revision, stopId: 'london', guestNationality: 'AU' })
    .expect(409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM studio_quotes').get()?.n, 0);
});

test('unknown provider environment is an estimate and never promoted to a production supplier quote', async () => {
  const { app, workspace, path } = setup({
    hotels: async (input) => ({
      offers: [
        {
          id: 'provider-id',
          offerId: undefined,
          hotelId: 'hotel-id',
          name: 'Example hotel',
          image: '',
          address: '',
          room: '',
          board: '',
          price: 100,
          currency: 'EUR',
          checkin: input.checkin,
          checkout: input.checkout,
        },
      ],
      mode: 'provider',
      warning: 'Provider environment is unverified.',
    }),
  });
  const response = await request(app)
    .post(`${path}/hotels/search`)
    .send({ revision: workspace.revision, stopId: 'london', guestNationality: 'AU' })
    .expect(200);
  assert.equal(response.body.quotes[0].priceStatus, 'agent_estimate');
  assert.equal(response.body.quotes[0].currency, 'EUR');
});
