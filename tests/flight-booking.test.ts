import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { flightBookingProvider } from '../server/flight-booking.ts';
import { ProviderError } from '../server/integrations.ts';
import type { StoredBookingOffer } from '../server/booking-provider-types.ts';

const originalFetch = globalThis.fetch;
const originalKey = process.env.LITEAPI_API_KEY;
const originalFlag = process.env.LITEAPI_FLIGHT_BOOKING_ENABLED;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.LITEAPI_API_KEY;
  else process.env.LITEAPI_API_KEY = originalKey;
  if (originalFlag === undefined) delete process.env.LITEAPI_FLIGHT_BOOKING_ENABLED;
  else process.env.LITEAPI_FLIGHT_BOOKING_ENABLED = originalFlag;
});

function fixtures() {
  process.env.LITEAPI_API_KEY = 'sand_test_fixture_only';
  delete process.env.LITEAPI_FLIGHT_BOOKING_ENABLED;
  const segments = [
    {
      originCode: 'LHR',
      destinationCode: 'JFK',
      departureTime: '2027-11-18T10:30:00+00:00',
      arrivalTime: '2027-11-18T14:00:00-05:00',
    },
    {
      originCode: 'JFK',
      destinationCode: 'LHR',
      departureTime: '2027-11-22T19:00:00-05:00',
      arrivalTime: '2027-11-23T07:00:00+00:00',
    },
  ];
  const journey = {
    expiration: new Date(Date.now() + 600_000).toISOString(),
    pricing: { display: { total: 740.27, currency: 'USD' } },
    passengers: { adults: 1, children: 0, infants: 0 },
    segments,
    terms: {
      refundable: false,
      changeable: true,
      hasRefundFee: true,
      refundFee: null,
      hasChangeFee: true,
      summary: [{ message: 'Changes allowed subject to fare rules.' }],
    },
    baggage: { included: [{ description: 'One cabin bag up to 8 kg.' }] },
  };
  const offer: StoredBookingOffer = {
    provider: 'liteapi',
    providerOfferId: 'opaque+/offer==',
    view: {
      id: 'owned_offer',
      kind: 'flight',
      name: 'London to New York',
      description: 'Round trip',
      price: 740.27,
      currency: 'USD',
      adults: 1,
      startDate: '2027-11-18',
      endDate: '2027-11-22',
      location: 'JFK',
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
      mode: 'test',
      journeys: segments.map((segment, index) => ({
        id: `leg_${index}`,
        origin: { code: segment.originCode },
        destination: { code: segment.destinationCode },
        departure: segment.departureTime,
        arrival: segment.arrivalTime,
        connections: 0,
        stops: 0,
        segments: [
          {
            id: `seg_${index}`,
            origin: { code: segment.originCode },
            destination: { code: segment.destinationCode },
            departure: segment.departureTime,
            arrival: segment.arrivalTime,
          },
        ],
      })),
    },
  };
  const verified = { data: [{ journey }] };
  const reserved = {
    data: [
      {
        prebookId: 'prebook_123',
        offerId: offer.providerOfferId,
        price: 740.27,
        currency: 'USD',
        paymentTypes: ['CREDIT'],
        booking: { journey },
      },
    ],
  };
  const booked = {
    data: [
      {
        booking: {
          bookingId: 'booking_123',
          bookingRef: 'FH-TEST-123',
          status: 'CONFIRMED',
          providerEnvironment: 'sandbox',
          paymentStatus: 'completed',
          airlineLocators: [{ airlineCode: 'BA', airlinePnr: 'ABC123' }],
          ticketData: {
            confirmationId: 'not-a-ticket-number',
            ticketedAt: new Date().toISOString(),
          },
        },
      },
    ],
  };
  const holder = {
    firstName: 'Sandbox',
    lastName: 'Tester',
    email: 'test@example.invalid',
    phoneCountryCode: '1',
    phone: '2025550143',
  };
  const guests = [
    {
      firstName: 'Sandbox',
      lastName: 'Tester',
      dateOfBirth: '1990-01-01',
      gender: 'M' as const,
      nationality: 'US',
      passportIssueCountry: 'CA',
      passportNumber: 'TEST123456',
      passportExpiry: '2030-01-01',
    },
  ];
  return { offer, verified, reserved, booked, holder, guests };
}

function mock(responses: (unknown | Error | Response)[]) {
  const requests: { path: string; method: string; body: Record<string, unknown> | undefined }[] =
    [];
  globalThis.fetch = async (url, init) => {
    requests.push({
      path: new URL(String(url)).pathname,
      method: init?.method || 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    assert.equal(new Headers(init?.headers).get('X-API-Key'), 'sand_test_fixture_only');
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (response instanceof Response) return response;
    assert.notEqual(response, undefined, 'Unexpected supplier request');
    return Response.json(response);
  };
  return requests;
}

async function prepare() {
  const f = fixtures();
  mock([f.verified]);
  const { quote } = await flightBookingProvider.prebook(f.offer);
  return { ...f, quote };
}
function confirm(
  f: Awaited<ReturnType<typeof prepare>>,
  checkpoint: (value: { providerPrebookId: string }) => void = () => {},
) {
  return flightBookingProvider.confirm({
    offer: f.offer,
    prebookId: f.offer.providerOfferId,
    quote: f.quote,
    clientReference: 'checkout_123',
    holder: f.holder,
    guests: f.guests,
    checkpoint,
  });
}

test('verification preserves total, currency, expiry and unpublished fees without making a reservation', async () => {
  const f = fixtures();
  f.verified.data[0].journey.pricing.display.total = 810.5;
  const calls = mock([f.verified]);
  const result = await flightBookingProvider.prebook(f.offer);
  assert.deepEqual(calls, [
    { path: '/v3.0/flights/verify', method: 'POST', body: { offerId: 'opaque+/offer==' } },
  ]);
  assert.equal(result.prebookId, f.offer.providerOfferId);
  assert.equal(result.quote.price, 810.5);
  assert.equal(result.quote.priceChanged, true);
  assert.equal(result.quote.currency, 'USD');
  assert.equal(result.quote.expiresAt, f.verified.data[0].journey.expiration);
  assert.match(result.quote.cancellationPolicies[0].description, /not published/);
  assert.equal(result.quote.cancellationPolicies[0].amount, undefined);
  assert.match(result.quote.terms.join(' '), /no ticket has been issued/i);
});

test('expired, malformed-money, wrong-currency and changed-itinerary quotes fail closed', async () => {
  for (const mutate of [
    (value: ReturnType<typeof fixtures>) => {
      value.verified.data[0].journey.expiration = '2020-01-01T00:00:00Z';
    },
    (value: ReturnType<typeof fixtures>) => {
      (value.verified.data[0].journey.pricing.display as { total: unknown }).total = null;
    },
    (value: ReturnType<typeof fixtures>) => {
      value.verified.data[0].journey.pricing.display.currency = 'EUR';
    },
    (value: ReturnType<typeof fixtures>) => {
      value.verified.data[0].journey.segments[1].destinationCode = 'CDG';
    },
  ]) {
    const f = fixtures();
    mutate(f);
    const calls = mock([f.verified]);
    await assert.rejects(flightBookingProvider.prebook(f.offer), ProviderError);
    assert.equal(calls.length, 1);
  }
});

test('a production key cannot be enabled by the flight flag or test offer label', async () => {
  const f = fixtures();
  process.env.LITEAPI_API_KEY = 'prod_do_not_dispatch';
  process.env.LITEAPI_FLIGHT_BOOKING_ENABLED = 'true';
  const calls = mock([]);
  await assert.rejects(flightBookingProvider.prebook(f.offer), /sandbox key/i);
  assert.equal(calls.length, 0);
});

test('flight confirmation is disabled by default and sends no passenger data or requests', async () => {
  const f = await prepare();
  const calls = mock([]);
  await assert.rejects(
    confirm(f),
    (error: unknown) =>
      error instanceof ProviderError && error.code === 'FLIGHT_PAYMENT_NOT_CONFIGURED',
  );
  assert.equal(calls.length, 0);
});

test('enabled sandbox credit flow checkpoints the real prebook before booking and maps only supplier confirmation', async () => {
  const f = await prepare();
  process.env.LITEAPI_FLIGHT_BOOKING_ENABLED = 'true';
  const calls = mock([f.verified, f.reserved, f.booked]);
  let checkpoint = false;
  const result = await confirm(f, (state) => {
    assert.equal(state.providerPrebookId, 'prebook_123');
    assert.equal(calls.length, 2, 'Final booking must not precede durable checkpoint');
    checkpoint = true;
  });
  assert.equal(checkpoint, true);
  assert.equal(result.status, 'confirmed');
  assert.equal(result.providerPrebookId, 'prebook_123');
  assert.equal(result.providerBookingId, 'booking_123');
  assert.equal(result.confirmationCode, 'ABC123');
  assert.equal(result.ticketNumbers, undefined, 'Ticket confirmation ID is not a ticket number');
  assert.equal(result.paymentStatus, 'simulated');
  assert.deepEqual(
    calls.map((row) => row.path),
    ['/v3.0/flights/verify', '/v3.0/flights/prebooks', '/v3.0/flights/bookings'],
  );
  assert.deepEqual(calls[1].body?.contact, {
    firstName: 'Sandbox',
    lastName: 'Tester',
    email: 'test@example.invalid',
    phoneCountryCode: '1',
    phoneNumber: '2025550143',
  });
  assert.equal(
    (calls[1].body?.passengers as { documentIssueCountry: string }[])[0].documentIssueCountry,
    'CA',
  );
  assert.equal(calls[1].body?.usePaymentSdk, false);
  assert.deepEqual(calls[2].body, {
    prebookId: 'prebook_123',
    payment: { method: 'CREDIT' },
    customTags: { ASKTARA: 'checkout_123' },
  });
});

test('documents, separate phone country and adult ages are validated before reservation', async () => {
  const f = await prepare();
  process.env.LITEAPI_FLIGHT_BOOKING_ENABLED = 'true';
  f.guests[0].passportIssueCountry = '';
  const calls = mock([]);
  await assert.rejects(
    confirm(f),
    (error: unknown) => error instanceof ProviderError && error.code === 'INVALID_BOOKING_GUESTS',
  );
  assert.equal(calls.length, 0);
});

test('a new price before prebook requires fresh consent and does not reserve', async () => {
  const f = await prepare();
  process.env.LITEAPI_FLIGHT_BOOKING_ENABLED = 'true';
  f.verified.data[0].journey.pricing.display.total = 900;
  const calls = mock([f.verified]);
  await assert.rejects(
    confirm(f),
    (error: unknown) => error instanceof ProviderError && error.code === 'FLIGHT_OFFER_CHANGED',
  );
  assert.equal(calls.length, 1);
});

test('missing credit eligibility or changed post-prebook price preserves the reservation without payment', async () => {
  for (const changedPrice of [false, true]) {
    const f = await prepare();
    process.env.LITEAPI_FLIGHT_BOOKING_ENABLED = 'true';
    if (changedPrice) f.reserved.data[0].price = 950;
    else f.reserved.data[0].paymentTypes = ['TRANSACTION_ID'];
    const calls = mock([f.verified, f.reserved]);
    const result = await confirm(f);
    assert.equal(result.status, 'unknown');
    assert.equal(result.providerPrebookId, 'prebook_123');
    assert.equal(result.paymentStatus, 'not_charged');
    assert.equal(calls.length, 2);
    assert.match(result.message!, /No final booking or payment was submitted/);
  }
});

test('book timeout retains checkpoint and remains unknown without automatic booking retry', async () => {
  const f = await prepare();
  process.env.LITEAPI_FLIGHT_BOOKING_ENABLED = 'true';
  const calls = mock([f.verified, f.reserved, new Error('private provider timeout detail')]);
  const result = await confirm(f);
  assert.equal(result.status, 'unknown');
  assert.equal(result.providerPrebookId, 'prebook_123');
  assert.equal(result.paymentStatus, 'unknown');
  assert.equal(calls.length, 3);
  assert.doesNotMatch(JSON.stringify(result), /private provider/);
});

test('failed checkpoint never dispatches final booking and preserves the prebook reference', async () => {
  const f = await prepare();
  process.env.LITEAPI_FLIGHT_BOOKING_ENABLED = 'true';
  const calls = mock([f.verified, f.reserved]);
  const result = await confirm(f, () => {
    throw new Error('disk unavailable');
  });
  assert.equal(result.status, 'unknown');
  assert.equal(result.providerPrebookId, 'prebook_123');
  assert.equal(calls.length, 2);
});

test('provider pending and mismatched production results are never reported as confirmed', async () => {
  for (const production of [false, true]) {
    const f = fixtures();
    if (production) f.booked.data[0].booking.providerEnvironment = 'production';
    else f.booked.data[0].booking.status = 'PENDING_CONFIRMATION';
    mock([f.booked]);
    const query = flightBookingProvider.retrieve({
      providerBookingId: 'booking_123',
      clientReference: 'checkout_123',
    });
    if (production) await assert.rejects(query, /production data/);
    else assert.equal((await query).status, 'pending');
  }
});

test('GET prebook cannot resolve an ambiguous booking and does not replay payment', async () => {
  const f = fixtures();
  const calls = mock([f.reserved]);
  const result = await flightBookingProvider.retrieve({
    providerPrebookId: 'prebook_123',
    clientReference: 'checkout_123',
  });
  assert.equal(result.status, 'unknown');
  assert.equal(result.providerPrebookId, 'prebook_123');
  assert.deepEqual(
    calls.map((row) => [row.method, row.path]),
    [['GET', '/v3.0/flights/prebooks/prebook_123']],
  );
});

test('cancellation only submits after an explicit zero-fee quote and HTTP202 remains pending', async () => {
  fixtures();
  const calls = mock([
    { data: [{ confidence: 'confirmed', penalty: { display: { amount: 0, currency: 'USD' } } }] },
    Response.json(
      {
        data: {
          bookingId: 'booking_123',
          status: 'CONFIRMED',
          cancellation_fee: 0,
          currency: 'USD',
        },
      },
      { status: 202 },
    ),
  ]);
  const result = await flightBookingProvider.cancel({
    providerBookingId: 'booking_123',
    clientReference: 'checkout_123',
  });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.cancellation?.status, 'pending');
  assert.deepEqual(
    calls.map((row) => [row.method, row.path]),
    [
      ['GET', '/v3.0/flights/bookings/booking_123/cancellations'],
      ['POST', '/v3.0/flights/bookings/booking_123/cancellations'],
    ],
  );
});

test('unknown or nonzero cancellation fees never cause a cancellation mutation', async () => {
  for (const penalty of [undefined, { display: { amount: 35, currency: 'USD' } }]) {
    fixtures();
    const calls = mock([{ data: [{ confidence: 'confirmed', penalty }] }]);
    await assert.rejects(
      flightBookingProvider.cancel({
        providerBookingId: 'booking_123',
        clientReference: 'checkout_123',
      }),
      /Review the airline cancellation charges/,
    );
    assert.equal(calls.length, 1);
  }
});

test('refresh preserves pending cancellation intent when the provider has not finalized it', async () => {
  const f = fixtures();
  mock([f.booked]);
  const result = await flightBookingProvider.retrieve({
    providerBookingId: 'booking_123',
    clientReference: 'checkout_123',
    cancelIntentAt: '2026-09-13T10:00:00Z',
  });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.cancellation?.status, 'pending');
});

test('production response flags block verification and preserve a prebook reference without final booking', async () => {
  const f = await prepare();
  let calls = mock([{ ...f.verified, sandbox: false }]);
  await assert.rejects(flightBookingProvider.prebook(f.offer), /production data/);
  assert.equal(calls.length, 1);
  process.env.LITEAPI_FLIGHT_BOOKING_ENABLED = 'true';
  calls = mock([f.verified, { ...f.reserved, sandbox: false }]);
  let checkpoint = '';
  const result = await confirm(f, (state) => {
    checkpoint = state.providerPrebookId;
  });
  assert.equal(result.status, 'unknown');
  assert.equal(result.providerPrebookId, 'prebook_123');
  assert.equal(checkpoint, 'prebook_123');
  assert.equal(calls.length, 2);
});

test('an incomplete final booking response retains the supplier booking ID for reconciliation', async () => {
  const f = await prepare();
  process.env.LITEAPI_FLIGHT_BOOKING_ENABLED = 'true';
  mock([f.verified, f.reserved, { data: [{ booking: { bookingId: 'booking_123' } }] }]);
  const result = await confirm(f);
  assert.equal(result.status, 'unknown');
  assert.equal(result.providerBookingId, 'booking_123');
  assert.equal(result.providerPrebookId, 'prebook_123');
});
