import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Destination } from '../shared/types.ts';
import { ProviderError, searchHotels } from '../server/integrations.ts';
import { hotelSearchSchema, travelBriefSchema } from '../server/validation.ts';

const originalFetch = globalThis.fetch;
const variables = ['LITEAPI_API_KEY', 'LITEAPI_MODE'];
const originalEnvironment = Object.fromEntries(variables.map((name) => [name, process.env[name]]));
beforeEach(() => {
  process.env.LITEAPI_API_KEY = 'sand_hotel_fixture';
  delete process.env.LITEAPI_MODE;
  globalThis.fetch = async () => {
    throw new Error('Unexpected supplier call');
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnvironment))
    value === undefined ? delete process.env[name] : (process.env[name] = value);
});

const destination: Destination = {
  id: 'reykjavik-is',
  name: 'Reykjavik',
  country: 'Iceland',
  region: 'Europe',
  description: 'Resolved destination test fixture',
  longDescription: '',
  image: '',
  tags: [],
  vibe: 'City escapes',
  bestTime: '',
  dailyBudget: 0,
  coordinates: [64.1466, -21.9426],
  highlights: [],
};
const input = {
  destinationId: destination.id,
  checkin: '2027-11-18',
  checkout: '2027-11-22',
  adults: 2,
  guestNationality: 'PK',
};
const hotelRate = (amount: unknown = '456.70', currency: unknown = 'EUR') => ({
  hotelId: 'supplier-hotel-1',
  roomTypes: [
    {
      offerId: 'supplier-offer-1',
      rates: [
        {
          name: 'Supplier double room',
          boardName: 'Room Only',
          retailRate: { total: [{ amount, currency }] },
        },
      ],
    },
  ],
});

test('global hotel search uses only the trusted destination coordinates and preserves full-stay supplier pricing', async () => {
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.liteapi.travel/v3.0/hotels/rates');
    assert.equal(options?.method, 'POST');
    assert.ok(options?.signal);
    assert.deepEqual(JSON.parse(String(options?.body)), {
      checkin: input.checkin,
      checkout: input.checkout,
      currency: 'USD',
      guestNationality: 'PK',
      occupancies: [{ adults: 2 }],
      latitude: destination.coordinates[0],
      longitude: destination.coordinates[1],
      radius: 15000,
      includeHotelData: true,
      maxRatesPerHotel: 1,
      limit: 12,
      timeout: 10,
    });
    return Response.json({
      data: [hotelRate()],
      hotels: [{ id: 'supplier-hotel-1', name: 'Supplier Hotel', address: 'Supplier address' }],
      sandbox: false,
    });
  };
  process.env.LITEAPI_MODE = 'live';
  const result = await searchHotels(input, undefined, destination);
  assert.equal(calls, 1);
  assert.equal(result.mode, 'test', 'A sandbox key must override conflicting live indicators');
  assert.match(result.warning, /test mode/);
  assert.match(result.warning, /full stay/);
  assert.match(result.warning, /No reservation/);
  assert.deepEqual(result.offers, [
    {
      id: 'supplier-offer-1',
      offerId: 'supplier-offer-1',
      hotelId: 'supplier-hotel-1',
      name: 'Supplier Hotel',
      image: '',
      address: 'Supplier address',
      room: 'Supplier double room',
      board: 'Room Only',
      price: 456.7,
      currency: 'EUR',
      checkin: input.checkin,
      checkout: input.checkout,
    },
  ]);
});

test('global hotel search rejects mismatched, unresolved and invalid coordinates before contacting the supplier', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ data: [] });
  };
  const invalidDestinations = [
    undefined,
    { ...destination, id: 'another-city' },
    ...[
      [91, 0],
      [0, -181],
      [Number.NaN, 0],
      [0, Number.POSITIVE_INFINITY],
      [null, 0],
      ['64.1466', -21.9426],
      [64.1466],
    ].map((coordinates) => ({ ...destination, coordinates }) as Destination),
  ];
  for (const value of invalidDestinations)
    await assert.rejects(searchHotels(input, undefined, value), (error: unknown) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'INVALID_DESTINATION');
      return true;
    });
  assert.equal(calls, 0);
});

test('hotel request schemas allow bounded resolved IDs but reject arbitrary destination snapshots', () => {
  assert.equal(hotelSearchSchema.parse(input).destinationId, destination.id);
  assert.deepEqual(
    travelBriefSchema
      .partial()
      .parse({ destinationStops: [{ destinationId: destination.id, days: 4 }] }),
    { destinationStops: [{ destinationId: destination.id, days: 4 }] },
  );
  assert.equal(hotelSearchSchema.safeParse({ ...input, destination }).success, false);
  for (const destinationId of ['https://example.com', '../paris', 'city_unsafe', 'a'.repeat(61)]) {
    assert.equal(hotelSearchSchema.safeParse({ ...input, destinationId }).success, false);
    assert.equal(
      travelBriefSchema.partial().safeParse({ destinationStops: [{ destinationId, days: 4 }] })
        .success,
      false,
    );
  }
  assert.equal(
    travelBriefSchema.partial().safeParse({
      destinationStops: [
        { destinationId: destination.id, days: 4 },
        { destinationId: destination.id, days: 4 },
      ],
    }).success,
    false,
  );
});

test('supplier sandbox flags and explicit test configuration remain authoritative for global hotels', async () => {
  for (const scenario of [
    { token: 'prod_fixture', configuredMode: 'live', sandbox: true, expected: 'test' },
    { token: 'prod_fixture', configuredMode: 'test', sandbox: false, expected: 'test' },
    {
      token: 'unclassified_fixture',
      configuredMode: undefined,
      sandbox: undefined,
      expected: 'provider',
    },
  ]) {
    process.env.LITEAPI_API_KEY = scenario.token;
    if (scenario.configuredMode) process.env.LITEAPI_MODE = scenario.configuredMode;
    else delete process.env.LITEAPI_MODE;
    globalThis.fetch = async () =>
      Response.json({ data: [hotelRate()], sandbox: scenario.sandbox });
    const result = await searchHotels(input, undefined, destination);
    assert.equal(result.mode, scenario.expected);
    assert.match(
      result.warning,
      scenario.expected === 'test' ? /test mode/ : /not been marked as production/,
    );
  }
});

test('empty global hotel availability retains environment labels for both 204 and empty rate envelopes', async () => {
  for (const status of [204, 200]) {
    globalThis.fetch = async () =>
      status === 204 ? new Response(null, { status }) : Response.json({ data: [] });
    const result = await searchHotels(input, undefined, destination);
    assert.deepEqual(result.offers, []);
    assert.equal(result.mode, 'test');
    assert.match(result.warning, /test mode/);
    assert.match(result.warning, /No reservation/);
  }
});

test('malformed supplier money is never coerced into a free or invented-currency hotel offer', async () => {
  for (const rate of [
    hotelRate(null),
    hotelRate(''),
    hotelRate(-1),
    hotelRate('Infinity'),
    hotelRate(10, null),
    hotelRate(10, 'not-a-currency'),
  ]) {
    globalThis.fetch = async () => Response.json({ data: [rate] });
    await assert.rejects(searchHotels(input, undefined, destination), /no valid rates/);
  }
  globalThis.fetch = async () => Response.json({ data: [hotelRate(null), hotelRate()] });
  const partial = await searchHotels(input, undefined, destination);
  assert.equal(partial.offers.length, 1);
  assert.equal(partial.offers[0].price, 456.7);
});

test('hotel provider errors and cancellation remain failures rather than empty successful searches', async () => {
  globalThis.fetch = async () => new Response('not-json');
  await assert.rejects(searchHotels(input, undefined, destination), /unreadable response/);
  globalThis.fetch = async () => Response.json({ error: { message: 'Supplier rejected search' } });
  await assert.rejects(searchHotels(input, undefined, destination), /unexpected response/);
  const controller = new AbortController();
  globalThis.fetch = async () => {
    controller.abort();
    return new Response(null, { status: 204 });
  };
  await assert.rejects(searchHotels(input, controller.signal, destination), { name: 'AbortError' });
});
