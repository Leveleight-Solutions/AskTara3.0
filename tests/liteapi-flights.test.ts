import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLiteFlightOffer, searchFlights, searchHotels } from '../server/integrations.ts';
const oldFetch = globalThis.fetch;
const variables = ['LITEAPI_API_KEY', 'LITEAPI_MODE', 'DUFFEL_ACCESS_TOKEN'];
const original = Object.fromEntries(variables.map((name) => [name, process.env[name]]));
afterEach(() => {
  globalThis.fetch = oldFetch;
  for (const name of variables)
    original[name] === undefined ? delete process.env[name] : (process.env[name] = original[name]);
});
const input = {
  origin: 'LHR',
  destination: 'CDG',
  departureDate: '2027-11-18',
  returnDate: '2027-11-22',
  adults: 2,
  cabinClass: 'economy' as const,
};
function fixture() {
  return {
    journeyKey: 'journey-1',
    cheapestOffer: {
      offerId: 'offer-1',
      expiration: '2027-10-01T12:15:00Z',
      pricing: { display: { total: 283.1, currency: 'EUR' } },
      segmentFares: [{ segmentKey: 'out2', cabin: 'Economy' }],
    },
    legDurations: [
      { direction: 'OUTBOUND', duration: { iso8601: 'PT3H25M', minutes: 205 } },
      { direction: 'INBOUND', duration: { iso8601: 'PT1H20M', minutes: 80 } },
    ],
    segments: [
      {
        segmentKey: 'out1',
        originCode: 'LHR',
        destinationCode: 'AMS',
        originName: 'Heathrow',
        destinationName: 'Schiphol',
        departureTime: '2027-11-18T11:45:00+00:00',
        arrivalTime: '2027-11-18T14:05:00+01:00',
        direction: 'OUTBOUND',
        duration: { iso8601: 'PT1H20M', minutes: 80 },
        carrier: {
          marketingName: 'KLM',
          marketingCode: 'KL',
          operatingName: 'KLM',
          operatingCode: 'KL',
        },
        flight: { marketingNumber: '1006', operatingNumber: '1006' },
      },
      {
        segmentKey: 'out2',
        originCode: 'AMS',
        destinationCode: 'CDG',
        departureTime: '2027-11-18T14:50:00+01:00',
        arrivalTime: '2027-11-18T16:10:00+01:00',
        direction: 'OUTBOUND',
        duration: { iso8601: 'PT1H20M', minutes: 80 },
        carrier: {
          marketingName: 'KLM',
          marketingCode: 'KL',
          operatingName: 'Air France',
          operatingCode: 'AF',
        },
        flight: { marketingNumber: '2013', operatingNumber: '1741' },
      },
      {
        segmentKey: 'back',
        originCode: 'CDG',
        destinationCode: 'LHR',
        departureTime: '2027-11-22T18:00:00+01:00',
        arrivalTime: '2027-11-22T18:20:00+00:00',
        direction: 'INBOUND',
        duration: { iso8601: 'PT1H20M', minutes: 80 },
        carrier: {
          marketingName: 'Air France',
          marketingCode: 'AF',
          operatingName: 'Air France',
          operatingCode: 'AF',
        },
        flight: { marketingNumber: '1180', operatingNumber: '1180' },
      },
    ],
  };
}

test('LiteAPI aggregate journey normalization preserves return legs, connections, codeshares, total currency and expiry', () => {
  const result = normalizeLiteFlightOffer(fixture(), input)!;
  assert.ok(result);
  assert.equal(result.price, 283.1);
  assert.equal(result.currency, 'EUR');
  assert.equal(result.passengerCount, 2);
  assert.equal(result.expiresAt, '2027-10-01T12:15:00Z');
  assert.equal(result.journeys?.length, 2);
  assert.equal(result.journeys![0].connections, 1);
  assert.equal(result.journeys![0].duration, 'PT3H25M');
  assert.equal(result.journeys![1].origin.code, 'CDG');
  assert.equal(result.journeys![1].destination.code, 'LHR');
  assert.equal(result.journeys![0].segments[1].operatingCarrier?.code, 'AF');
  assert.equal(result.journeys![0].segments[1].operatingFlightNumber, '1741');
  assert.equal(result.journeys![0].segments[1].passengers?.length, 2);
  assert.equal(result.journeys![0].segments[1].passengers?.[0].baggages, undefined);
  assert.equal(result.departure, '2027-11-18T11:45:00+00:00');
});

test('LiteAPI malformed fare or partial journey is rejected; missing fields never invent currencies, codes or durations', () => {
  const good = fixture();
  assert.equal(
    normalizeLiteFlightOffer(
      { ...good, cheapestOffer: { ...good.cheapestOffer, pricing: { display: { total: 10 } } } },
      input,
    ),
    null,
  );
  assert.equal(
    normalizeLiteFlightOffer({ ...good, segments: good.segments.slice(0, 2) }, input),
    null,
  );
  assert.equal(
    normalizeLiteFlightOffer(
      { ...good, segments: good.segments.map((segment) => ({ ...segment, direction: undefined })) },
      input,
    ),
    null,
  );
  assert.equal(
    normalizeLiteFlightOffer(
      {
        ...good,
        segments: [{ ...good.segments[0], originCode: 'UNKNOWN' }, ...good.segments.slice(1)],
      },
      input,
    ),
    null,
  );
  const missingDuration = normalizeLiteFlightOffer({ ...good, legDurations: [] }, input)!;
  assert.equal(missingDuration.journeys![0].duration, undefined);
  assert.equal(missingDuration.journeys![1].duration, 'PT1H20M');
  const badDuration = normalizeLiteFlightOffer(
    { ...good, legDurations: [{ direction: 'OUTBOUND', duration: { minutes: 11 } }] },
    input,
  )!;
  assert.equal(badDuration.journeys![0].duration, undefined);
});

test('LiteAPI actual data envelope produces test offers and deduplicates supplier results without relying on a sandbox field', async () => {
  delete process.env.DUFFEL_ACCESS_TOKEN;
  process.env.LITEAPI_API_KEY = 'sand_integration_fixture';
  process.env.LITEAPI_MODE = 'live';
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.legs[1].direction, 'INBOUND');
    assert.equal(body.cabinClass, 'ECONOMY');
    assert.equal(body.adults, 2);
    return Response.json({ data: [{ journeys: [fixture(), fixture()] }] });
  };
  const result = await searchFlights(input);
  assert.equal(result.mode, 'test');
  assert.equal(result.source, 'liteapi');
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].liveMode, false);
  assert.equal(result.offers[0].journeys?.length, 2);
});

test('LiteAPI unknown credential environment remains unverified and hotel 204 returns empty availability cleanly', async () => {
  delete process.env.DUFFEL_ACCESS_TOKEN;
  process.env.LITEAPI_API_KEY = 'unclassified_fixture_key';
  delete process.env.LITEAPI_MODE;
  globalThis.fetch = async () => Response.json({ data: [{ journeys: [fixture()] }] });
  const flights = await searchFlights(input);
  assert.equal(flights.mode, 'provider');
  assert.equal(flights.offers[0].liveMode, undefined);
  globalThis.fetch = async () => new Response(null, { status: 204 });
  const hotels = await searchHotels({
    destinationId: 'lisbon',
    checkin: '2027-11-18',
    checkout: '2027-11-21',
    adults: 2,
    guestNationality: 'US',
  });
  assert.deepEqual(hotels.offers, []);
  assert.equal(hotels.mode, 'provider');
});
