import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hotelBookingProvider,
  normalizeHotelPrebook,
  normalizeHotelBooking,
} from '../server/hotel-booking.ts';
import type { StoredBookingOffer } from '../server/booking-provider-types.ts';

const savedFetch = globalThis.fetch;
const savedKey = process.env.LITEAPI_API_KEY;
const savedMode = process.env.LITEAPI_MODE;
afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedKey === undefined) delete process.env.LITEAPI_API_KEY;
  else process.env.LITEAPI_API_KEY = savedKey;
  if (savedMode === undefined) delete process.env.LITEAPI_MODE;
  else process.env.LITEAPI_MODE = savedMode;
});
const offer: StoredBookingOffer = {
  view: {
    id: 'quote-1',
    kind: 'hotel',
    name: 'Example Hotel',
    description: 'Two nights',
    price: 100.25,
    currency: 'USD',
    adults: 2,
    startDate: '2026-11-18',
    endDate: '2026-11-20',
    location: 'Lisbon',
    expiresAt: '2026-11-01T12:00:00Z',
    mode: 'test',
  },
  provider: 'liteapi',
  providerOfferId: 'rate-from-provider',
  hotelId: 'lp-example',
  guestNationality: 'US',
};
function prebook() {
  return {
    sandbox: true,
    data: {
      prebookId: 'prebook-1',
      hotelId: 'lp-example',
      checkin: '2026-11-18',
      checkout: '2026-11-20',
      price: 120.35,
      currency: 'USD',
      cancellationChanged: true,
      boardChanged: false,
      termsAndConditions: 'Bring ID.<br/>Check-in after 15:00.',
      roomTypes: [
        {
          rates: [
            {
              adultCount: 2,
              childCount: 0,
              occupancyNumber: 1,
              name: 'Double',
              boardName: 'Breakfast',
              remarks: 'No smoking',
              retailRate: {
                taxesAndFees: [
                  { amount: 10, currency: 'USD', included: false, description: 'City tax' },
                ],
              },
              cancellationPolicies: {
                refundableTag: 'RFN',
                cancelPolicyInfos: [
                  {
                    amount: 60,
                    currency: 'USD',
                    type: 'amount',
                    cancelTime: '2026-11-16 10:00:00',
                    timezone: 'GMT',
                  },
                ],
                hotelRemarks: [],
              },
            },
          ],
        },
      ],
    },
  };
}

test('hotel prebook preserves changed total, taxes excluded from total, exact policy deadline and complete plain terms', () => {
  const result = normalizeHotelPrebook(prebook(), offer);
  assert.equal(result.prebookId, 'prebook-1');
  assert.equal(result.quote.price, 120.35);
  assert.equal(result.quote.priceChanged, true);
  assert.equal(result.quote.originalPrice, 100.25);
  assert.match(result.quote.terms.join('\n'), /payable separately/);
  assert.match(result.quote.terms.join('\n'), /Cancellation terms changed/);
  assert.match(result.quote.terms.join('\n'), /Bring ID\.\nCheck-in/);
  assert.equal(result.quote.cancellationPolicies[0].amount, 60);
  assert.match(result.quote.cancellationPolicies[0].description, /2026-11-16 10:00:00 GMT/);
  assert.ok(Date.parse(result.quote.expiresAt) > Date.now());
});

test('hotel prebook rejects changed identity, stay dates, occupancy and invalid monetary values', () => {
  for (const change of [
    (p: ReturnType<typeof prebook>) => {
      p.data.hotelId = 'other-hotel';
    },
    (p: ReturnType<typeof prebook>) => {
      p.data.checkout = '2026-11-21';
    },
    (p: ReturnType<typeof prebook>) => {
      p.data.roomTypes[0].rates[0].adultCount = 1;
    },
    (p: ReturnType<typeof prebook>) => {
      p.data.roomTypes[0].rates[0].childCount = 1;
    },
    (p: ReturnType<typeof prebook>) => {
      p.data.price = NaN;
    },
    (p: ReturnType<typeof prebook>) => {
      p.data.price = null as unknown as number;
    },
    (p: ReturnType<typeof prebook>) => {
      p.data.currency = '';
    },
    (p: ReturnType<typeof prebook>) => {
      p.sandbox = false;
    },
  ]) {
    const data = prebook();
    change(data);
    assert.throws(() => normalizeHotelPrebook(data, offer));
  }
});

test('hotel missing cancellation schedule is uncertainty, not a free cancellation promise', () => {
  const data = prebook();
  data.data.roomTypes[0].rates[0].cancellationPolicies.cancelPolicyInfos = [];
  const result = normalizeHotelPrebook(data, offer);
  assert.deepEqual(result.quote.cancellationPolicies, []);
  assert.match(result.quote.terms.join(' '), /Refund eligibility is unverified/);
});

test('actual production key is blocked before any request even when MODE says test', async () => {
  process.env.LITEAPI_API_KEY = 'prod_fake';
  process.env.LITEAPI_MODE = 'test';
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw Error('Must not fetch');
  };
  await assert.rejects(hotelBookingProvider.prebook(offer), { code: 'SANDBOX_REQUIRED' });
  assert.equal(called, false);
});

test('sandbox hotel confirmation uses server prebook and stable client reference with one primary guest, no card data', async () => {
  process.env.LITEAPI_API_KEY = 'sand_fake';
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://book.liteapi.travel/v3.0/rates/book?timeout=120');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.payment, { method: 'ACC_CREDIT_CARD' });
    assert.equal(body.prebookId, 'private-prebook');
    assert.equal(body.clientReference, 'stable-reference');
    assert.deepEqual(body.guests, [
      { occupancyNumber: 1, firstName: 'Test', lastName: 'Guest', email: 'qa@example.invalid' },
    ]);
    assert.equal(body.holder.phone, '+12025550123');
    return Response.json({
      sandbox: true,
      data: {
        bookingId: 'booking-1',
        clientReference: 'stable-reference',
        status: 'CONFIRMED',
        hotelConfirmationCode: 'hotel-code',
      },
    });
  };
  const result = await hotelBookingProvider.confirm({
    offer,
    prebookId: 'private-prebook',
    quote: normalizeHotelPrebook(prebook(), offer).quote,
    clientReference: 'stable-reference',
    holder: {
      firstName: 'Test',
      lastName: 'Guest',
      email: 'qa@example.invalid',
      phone: '+12025550123',
    },
    guests: [{ firstName: 'Test', lastName: 'Guest' }],
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'confirmed');
  assert.equal(result.paymentStatus, 'simulated');
  assert.equal(result.confirmationCode, 'hotel-code');
  assert.equal(result.ticketNumbers, undefined);
});

test('unexpected supplier identity or status never claims confirmation or ticketing', () => {
  assert.throws(() =>
    normalizeHotelBooking(
      { data: { bookingId: 'wrong', status: 'CONFIRMED' } },
      { providerBookingId: 'right', clientReference: 'ref' },
    ),
  );
  assert.throws(() =>
    normalizeHotelBooking(
      { data: { bookingId: 'right', status: 'CONFIRMED', clientReference: 'other' } },
      { clientReference: 'ref' },
    ),
  );
  const result = normalizeHotelBooking(
    { data: { bookingId: 'right', status: 'PROCESSING' } },
    { clientReference: 'ref' },
  );
  assert.equal(result.status, 'unknown');
  assert.equal(result.paymentStatus, 'unknown');
});

test('cancellation keeps supplier charges and ambiguous network outcome cannot be retried as a fresh booking', async () => {
  const cancelled = normalizeHotelBooking(
    {
      sandbox: true,
      data: {
        bookingId: 'b-1',
        status: 'CANCELLED_WITH_CHARGES',
        cancellation_fee: 35.25,
        currency: 'USD',
      },
    },
    { clientReference: 'ref', providerBookingId: 'b-1' },
  );
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancellation?.fee, 35.25);
  process.env.LITEAPI_API_KEY = 'sand_fake';
  globalThis.fetch = async () => {
    throw Error('Connection reset after supplier commit');
  };
  await assert.rejects(
    hotelBookingProvider.cancel({ providerBookingId: 'b-1', clientReference: 'ref' }),
    { code: 'BOOKING_UNKNOWN' },
  );
  const unknown = await hotelBookingProvider.retrieve({ clientReference: 'ref' });
  assert.equal(unknown.status, 'unknown');
});
