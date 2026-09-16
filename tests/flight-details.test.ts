import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFlightOffer, searchFlights } from '../server/integrations.ts';
import {
  flightDate,
  flightDuration,
  flightExpiry,
  flightPrice,
  flightTime,
} from '../shared/flights.ts';

const originalFetch = globalThis.fetch;
const originalToken = process.env.DUFFEL_ACCESS_TOKEN;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.DUFFEL_ACCESS_TOKEN;
  else process.env.DUFFEL_ACCESS_TOKEN = originalToken;
});
const input = {
  origin: 'LHR',
  destination: 'HND',
  departureDate: '2027-04-12',
  returnDate: '2027-04-19',
  adults: 2,
  cabinClass: 'economy' as const,
};
function segment(origin: string, destination: string, departure: string, arrival: string) {
  return {
    id: `${origin}-${destination}`,
    origin: { iata_code: origin, name: `${origin} Airport`, time_zone: 'Europe/London' },
    destination: { iata_code: destination, name: `${destination} Airport` },
    departing_at: departure,
    arriving_at: arrival,
    duration: 'PT6H30M',
    origin_terminal: '5',
    destination_terminal: 'B',
    marketing_carrier: { name: 'British Airways', iata_code: 'BA' },
    marketing_carrier_flight_number: '6324',
    operating_carrier: { name: 'Qatar Airways', iata_code: 'QR' },
    operating_carrier_flight_number: '8',
    passengers: [
      {
        passenger_id: 'pas_1',
        cabin_class: 'economy',
        cabin_class_marketing_name: 'Economy Classic',
        baggages: [
          { type: 'checked', quantity: 1 },
          { type: 'carry_on', quantity: 1 },
        ],
      },
      {
        passenger_id: 'pas_2',
        cabin_class: 'economy',
        baggages: [{ type: 'checked', quantity: 0 }],
      },
    ],
  };
}
function quote() {
  return {
    id: 'off_complete',
    owner: { name: 'British Airways', iata_code: 'BA' },
    total_amount: '1845.75',
    total_currency: 'GBP',
    expires_at: '2027-03-01T10:30:00Z',
    live_mode: true,
    slices: [
      {
        id: 'sli_out',
        duration: 'PT19H30M',
        segments: [
          segment('LHR', 'DOH', '2027-04-12T09:00:00+01:00', '2027-04-12T17:30:00+03:00'),
          {
            ...segment('DOH', 'HND', '2027-04-12T20:00:00+03:00', '2027-04-13T12:30:00+09:00'),
            operating_carrier: { name: 'Japan Airlines', iata_code: 'JL' },
            operating_carrier_flight_number: '50',
          },
        ],
      },
      {
        id: 'sli_back',
        duration: 'PT15H',
        segments: [segment('HND', 'LHR', '2027-04-19T10:15:00+09:00', '2027-04-19T17:15:00+01:00')],
      },
    ],
  };
}

test('round-trip offers preserve every requested slice and connected segment with local offsets', () => {
  const normalized = normalizeFlightOffer(quote(), input)!;
  assert.equal(normalized.journeys?.length, 2);
  assert.deepEqual(
    normalized.journeys?.map((journey) => [
      journey.origin.code,
      journey.destination.code,
      journey.connections,
    ]),
    [
      ['LHR', 'HND', 1],
      ['HND', 'LHR', 0],
    ],
  );
  assert.equal(normalized.journeys?.[0].segments[0].departure, '2027-04-12T09:00:00+01:00');
  assert.equal(normalized.journeys?.[0].segments[1].arrival, '2027-04-13T12:30:00+09:00');
  assert.equal(normalized.journeys?.[1].departure, '2027-04-19T10:15:00+09:00');
  assert.equal(normalized.price, 1845.75);
  assert.equal(normalized.currency, 'GBP');
  assert.equal(normalized.passengerCount, 2);
  assert.equal(normalized.priceScope, 'all_passengers_complete_journey');
  assert.equal(normalized.requestedJourneyCount, 2);
  assert.equal(normalized.expiresAt, '2027-03-01T10:30:00Z');
  assert.equal(normalized.departure, normalized.journeys?.[0].departure);
  assert.equal(normalized.arrival, normalized.journeys?.[0].arrival);
  assert.equal(normalized.stops, 1);
});

test('codeshares, passenger-specific bags and terminals are retained without flattening carriers', () => {
  const normalized = normalizeFlightOffer(quote(), input)!;
  const first = normalized.journeys![0].segments[0];
  assert.deepEqual(first.marketingCarrier, { name: 'British Airways', code: 'BA' });
  assert.deepEqual(first.operatingCarrier, { name: 'Qatar Airways', code: 'QR' });
  assert.equal(first.marketingFlightNumber, '6324');
  assert.equal(first.operatingFlightNumber, '8');
  assert.equal(normalized.journeys![0].segments[1].operatingCarrier?.code, 'JL');
  assert.equal(first.originTerminal, '5');
  assert.equal(first.destinationTerminal, 'B');
  assert.equal(first.passengers?.[0].cabin, 'Economy Classic');
  assert.deepEqual(first.passengers?.[0].baggages, [
    { type: 'checked', quantity: 1 },
    { type: 'carry_on', quantity: 1 },
  ]);
  assert.deepEqual(first.passengers?.[1].baggages, [{ type: 'checked', quantity: 0 }]);
});

test('minimal supplier data stays missing and malformed journeys never silently lose a segment', () => {
  const minimal = {
    id: 'off_minimal',
    total_amount: '0',
    total_currency: 'JPY',
    slices: [
      {
        segments: [
          {
            origin: { iata_code: 'LHR' },
            destination: { iata_code: 'HND' },
            departing_at: '2027-04-12T09:00:00',
            arriving_at: '2027-04-13T07:00:00',
          },
        ],
      },
    ],
  };
  const normalized = normalizeFlightOffer(minimal, { adults: 1 })!;
  assert.ok(normalized);
  assert.equal(normalized.expiresAt, undefined);
  assert.equal(normalized.liveMode, undefined);
  assert.equal(normalized.journeys![0].segments[0].passengers, undefined);
  assert.equal(normalized.journeys![0].segments[0].marketingCarrier, undefined);
  assert.equal(normalized.journeys![0].segments[0].duration, undefined);
  assert.equal(normalized.journeys![0].segments[0].origin.name, undefined);
  assert.equal(normalized.price, 0);
  assert.equal(normalizeFlightOffer({ ...minimal, total_amount: '' }, input), null);
  assert.equal(normalizeFlightOffer({ ...minimal, total_amount: '-10' }, input), null);
  assert.equal(
    normalizeFlightOffer(
      { ...minimal, slices: [...minimal.slices, { segments: [{ origin: null }] }] },
      input,
    ),
    null,
  );
  assert.equal(normalizeFlightOffer(null, input), null);
  assert.equal(
    normalizeFlightOffer({ ...minimal, expires_at: '2027-04-01T12:00:00' }, input)?.expiresAt,
    undefined,
  );
});

test('technical stops are counted separately from plane connections', () => {
  const original = quote();
  const withStop = {
    ...original,
    slices: [
      {
        ...original.slices[1],
        segments: [
          {
            ...original.slices[1].segments[0],
            stops: [{ airport: { iata_code: 'HEL', name: 'Helsinki Airport' }, duration: 'PT45M' }],
          },
        ],
      },
    ],
  };
  const normalized = normalizeFlightOffer(withStop, { adults: 2 })!;
  assert.equal(normalized.journeys![0].connections, 0);
  assert.equal(normalized.journeys![0].stops, 1);
  assert.equal(normalized.stops, 1);
  assert.equal(normalized.journeys![0].segments[0].stops![0].airport.code, 'HEL');
});

test('flight formatting preserves local airport times and original currency; expiry handles unsafe or absent dates', () => {
  assert.equal(flightTime('2027-04-12T09:00:00+01:00'), '09:00');
  assert.equal(flightTime('2027-04-13T12:30:00+09:00'), '12:30');
  assert.equal(flightDate('2027-04-13T00:30:00+09:00'), 'Apr 13, 2027');
  assert.equal(flightTime('bad'), '—');
  assert.equal(flightDuration('PT13H30M'), '13h 30m');
  assert.equal(flightDuration(undefined), 'Duration unavailable');
  assert.equal(flightPrice({ price: 1845.75, currency: 'GBP' }), '£1,845.75');
  assert.equal(flightExpiry(undefined).state, 'unknown');
  assert.equal(flightExpiry('not-a-date').state, 'unknown');
  assert.equal(flightExpiry('2027-04-01T00:00:00').state, 'unknown');
  assert.equal(
    flightExpiry('2027-03-01T10:30:00Z', Date.parse('2027-03-01T10:29:59Z')).state,
    'active',
  );
  assert.equal(
    flightExpiry('2027-03-01T10:30:00Z', Date.parse('2027-03-01T10:30:00Z')).state,
    'expired',
  );
});

test('adapter sends both journey slices and marks provider-declared test offers as simulated even with a non-test token', async () => {
  process.env.DUFFEL_ACCESS_TOKEN = 'provider-token';
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.data.slices, [
      { origin: 'LHR', destination: 'HND', departure_date: '2027-04-12' },
      { origin: 'HND', destination: 'LHR', departure_date: '2027-04-19' },
    ]);
    assert.equal(body.data.passengers.length, 2);
    return Response.json({ data: { offers: [{ ...quote(), live_mode: false }] } });
  };
  const result = await searchFlights(input);
  assert.equal(result.mode, 'test');
  assert.equal(result.roundTrip, true);
  assert.equal(result.offers[0].liveMode, false);
  assert.equal(result.offers[0].journeys?.length, 2);
});
