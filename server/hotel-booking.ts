import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  BookingProvider,
  ProviderBookingResult,
  StoredBookingOffer,
} from './booking-provider-types.ts';
import type { CancellationPolicy } from '../shared/bookings.ts';
import { ProviderError } from './integrations.ts';

const id = z.string().min(1).max(500);
const amount = z
  .union([z.number().finite().nonnegative(), z.string().regex(/^\d+(?:\.\d+)?$/)])
  .transform(Number)
  .pipe(z.number().finite().nonnegative());
const currency = z.string().regex(/^[A-Z]{3}$/);
const money = z.object({ amount, currency });
const text = z.string().max(30_000);
const policy = z.object({
  cancelTime: z.string().max(100).optional(),
  amount: amount.optional(),
  currency: currency.optional(),
  type: z.string().max(100).optional(),
  timezone: z.string().max(100).optional(),
});
const prebookSchema = z.object({
  sandbox: z.boolean().optional(),
  data: z.object({
    prebookId: id,
    hotelId: id,
    checkin: z.string(),
    checkout: z.string(),
    price: amount,
    currency,
    termsAndConditions: text.nullish(),
    cancellationChanged: z.boolean().optional(),
    boardChanged: z.boolean().optional(),
    roomTypes: z
      .array(
        z.object({
          rates: z
            .array(
              z.object({
                name: text.optional(),
                boardName: text.optional(),
                adultCount: z.number().int().optional(),
                childCount: z.number().int().optional(),
                occupancyNumber: z.number().int().optional(),
                remarks: text.nullish(),
                retailRate: z
                  .object({
                    taxesAndFees: z
                      .array(
                        money.extend({
                          included: z.boolean(),
                          description: text,
                        }),
                      )
                      .nullish(),
                  })
                  .optional(),
                cancellationPolicies: z
                  .object({
                    cancelPolicyInfos: z.array(policy).max(30).nullish(),
                    refundableTag: z.string().max(100).nullish(),
                    hotelRemarks: z.array(text).nullish(),
                  })
                  .nullish(),
              }),
            )
            .length(1),
        }),
      )
      .length(1),
  }),
});

/** This adapter cannot spend money even if an environment mode is mislabeled. */
export function requireSandboxBookingKey() {
  const key = process.env.LITEAPI_API_KEY || '';
  if (!/^(sand_|sandbox_)/.test(key))
    throw new ProviderError(
      'Sandbox booking requires a LiteAPI sandbox key. Production booking is not enabled.',
      503,
      'SANDBOX_REQUIRED',
    );
  return key;
}

async function request(
  path: string,
  method: 'GET' | 'POST' | 'PUT',
  body?: unknown,
  mutating = false,
): Promise<unknown> {
  const key = requireSandboxBookingKey();
  let response: Response;
  try {
    response = await fetch(`https://book.liteapi.travel/v3.0${path}`, {
      method,
      headers: {
        'X-API-Key': key,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(mutating ? 125_000 : 40_000),
    });
  } catch {
    throw new ProviderError(
      mutating
        ? 'The supplier has not returned a final booking result. Refresh the saved booking status before taking further action.'
        : 'The hotel provider did not respond. Please try again.',
      502,
      mutating ? 'BOOKING_UNKNOWN' : 'PREBOOK_FAILED',
    );
  }
  if (!response.ok) {
    throw new ProviderError(
      mutating
        ? 'The supplier could not confirm the outcome. Check the saved booking status; do not make a duplicate reservation.'
        : 'This hotel offer could not be revalidated. Search again for a current rate.',
      502,
      mutating ? 'BOOKING_UNKNOWN' : 'PREBOOK_FAILED',
    );
  }
  try {
    const payload = await response.json();
    if (payload?.error || payload?.sandbox === false) throw Error('Unverified response');
    return payload;
  } catch {
    throw new ProviderError(
      'The hotel provider returned an unverified result. Check the saved booking status before retrying.',
      502,
      mutating ? 'BOOKING_UNKNOWN' : 'PREBOOK_FAILED',
    );
  }
}

// Supplier text is displayed as plain text, never HTML. Preserve the full bounded terms.
const plain = (value: string) =>
  value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();

export function normalizeHotelPrebook(payload: unknown, offer: StoredBookingOffer) {
  const parsed = prebookSchema.safeParse(payload);
  if (!parsed.success || parsed.data.sandbox === false)
    throw new ProviderError(
      'The supplier returned incomplete hotel pricing or terms. Search again before booking.',
      502,
      'PREBOOK_FAILED',
    );
  const data = parsed.data.data;
  const rate = data.roomTypes[0].rates[0];
  if (
    data.hotelId !== offer.hotelId ||
    data.checkin !== offer.view.startDate ||
    data.checkout !== offer.view.endDate ||
    (rate.adultCount !== undefined && rate.adultCount !== offer.view.adults) ||
    (rate.childCount !== undefined && rate.childCount !== 0) ||
    (rate.occupancyNumber !== undefined && rate.occupancyNumber !== 1)
  )
    throw new ProviderError(
      'The hotel offer no longer matches the requested stay or guests. Please search again.',
      409,
      'PREBOOK_FAILED',
    );
  const terms = [
    'Sandbox reservation: no real accommodation is reserved and no card is charged.',
    ...(data.termsAndConditions ? [plain(data.termsAndConditions)] : []),
    ...(rate.name ? [`Room: ${plain(rate.name)}.`] : []),
    ...(rate.boardName ? [`Meal plan: ${plain(rate.boardName)}.`] : []),
    ...(rate.remarks ? [plain(rate.remarks)] : []),
    ...(data.cancellationChanged
      ? ['Cancellation terms changed since the search. Review the current terms below.']
      : []),
    ...(data.boardChanged
      ? ['The meal plan changed since the search. Review the current meal plan above.']
      : []),
    ...(rate.retailRate?.taxesAndFees || []).map(
      (fee) =>
        `${plain(fee.description)}: ${fee.currency} ${fee.amount.toFixed(2)} (${fee.included ? 'included in the quoted total' : 'payable separately at the property; excluded from this total'}).`,
    ),
    ...(rate.cancellationPolicies?.hotelRemarks || []).map(plain),
  ].filter(Boolean);
  const cancellationPolicies: CancellationPolicy[] = (
    rate.cancellationPolicies?.cancelPolicyInfos || []
  ).map((entry) => ({
    from: entry.cancelTime,
    ...(entry.type === 'amount' && entry.amount !== undefined && entry.currency
      ? { amount: entry.amount, currency: entry.currency }
      : {}),
    description: `${entry.type === 'amount' && entry.amount !== undefined && entry.currency ? `${entry.currency} ${entry.amount.toFixed(2)} cancellation fee` : entry.amount !== undefined ? `Cancellation policy: ${entry.amount} ${entry.type || '(unit unspecified)'}` : 'Cancellation conditions apply'}${entry.cancelTime ? ` from ${entry.cancelTime}${entry.timezone ? ` ${entry.timezone}` : ' (timezone not supplied)'}` : ''}.`,
  }));
  if (rate.cancellationPolicies?.refundableTag)
    terms.push(
      `Supplier refundability classification: ${rate.cancellationPolicies.refundableTag}. The dated cancellation terms determine any charges.`,
    );
  if (!cancellationPolicies.length)
    terms.push(
      'The supplier did not return a cancellation schedule. Refund eligibility is unverified.',
    );
  return {
    prebookId: data.prebookId,
    quote: {
      version: randomUUID(),
      price: data.price,
      currency: data.currency,
      originalPrice: offer.view.price,
      priceChanged: data.price !== offer.view.price || data.currency !== offer.view.currency,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      terms,
      cancellationPolicies,
    },
  };
}

const bookingResponse = z.object({
  sandbox: z.boolean().optional(),
  data: z.object({
    bookingId: id,
    status: z.string().min(1),
    clientReference: z.string().optional(),
    hotelConfirmationCode: z.string().max(500).nullish(),
    cancellation_fee: amount.optional(),
    currency: currency.optional(),
  }),
});
export function normalizeHotelBooking(
  payload: unknown,
  expected: { providerBookingId?: string; clientReference: string },
): ProviderBookingResult {
  const parsed = bookingResponse.safeParse(payload);
  if (!parsed.success || parsed.data.sandbox === false)
    throw new ProviderError(
      'The hotel supplier returned an incomplete booking result. Refresh status to reconcile it.',
      502,
      'BOOKING_UNKNOWN',
    );
  const data = parsed.data.data;
  if (
    (expected.providerBookingId && data.bookingId !== expected.providerBookingId) ||
    (data.clientReference && data.clientReference !== expected.clientReference)
  )
    throw new ProviderError(
      'The supplier booking reference did not match this checkout.',
      502,
      'BOOKING_UNKNOWN',
    );
  const status = data.status.toUpperCase();
  const cancelled = [
    'CANCELLED',
    'CANCELED',
    'CANCELLED_WITH_CHARGES',
    'CANCELED_WITH_CHARGES',
  ].includes(status);
  return {
    status:
      status === 'CONFIRMED'
        ? 'confirmed'
        : cancelled
          ? 'cancelled'
          : status === 'PENDING'
            ? 'pending'
            : 'unknown',
    providerBookingId: data.bookingId,
    ...(data.hotelConfirmationCode ? { confirmationCode: data.hotelConfirmationCode } : {}),
    paymentStatus: status === 'CONFIRMED' || cancelled ? 'simulated' : 'unknown',
    message: cancelled
      ? 'The supplier cancelled this sandbox reservation. No real card was charged.'
      : status === 'CONFIRMED'
        ? 'The supplier confirmed this sandbox reservation. It is not a real hotel reservation.'
        : 'The supplier has not confirmed a final outcome. Refresh status before taking further action.',
    ...(cancelled
      ? {
          cancellation: {
            status,
            ...(data.cancellation_fee !== undefined && data.currency
              ? { fee: data.cancellation_fee, currency: data.currency }
              : {}),
          },
        }
      : {}),
  };
}

export const hotelBookingProvider: BookingProvider = {
  async prebook(offer) {
    if (offer.view.kind !== 'hotel' || !offer.hotelId || !offer.providerOfferId)
      throw new ProviderError(
        'Choose a current hotel rate before checkout.',
        400,
        'PREBOOK_FAILED',
      );
    return normalizeHotelPrebook(
      await request('/rates/prebook?timeout=30', 'POST', {
        offerId: offer.providerOfferId,
        usePaymentSdk: false,
      }),
      offer,
    );
  },
  async confirm(input) {
    requireSandboxBookingKey();
    if (input.guests.length !== 1 || !input.holder.phone)
      throw new ProviderError(
        'Provide the lead guest for this room and a contact phone number.',
        400,
        'INVALID_GUESTS',
      );
    const guest = input.guests[0];
    const payload = await request(
      '/rates/book?timeout=120',
      'POST',
      {
        prebookId: input.prebookId,
        clientReference: input.clientReference,
        holder: {
          firstName: input.holder.firstName,
          lastName: input.holder.lastName,
          email: input.holder.email,
          phone: `${input.holder.phoneCountryCode || ''}${input.holder.phone}`,
        },
        guests: [
          {
            occupancyNumber: 1,
            firstName: guest.firstName,
            lastName: guest.lastName,
            email: guest.email || input.holder.email,
          },
        ],
        payment: { method: 'ACC_CREDIT_CARD' },
      },
      true,
    );
    return normalizeHotelBooking(payload, input);
  },
  async retrieve(input) {
    if (!input.providerBookingId)
      return {
        status: 'unknown',
        paymentStatus: 'unknown',
        message:
          'The supplier did not return a booking ID. This attempt is saved for support reconciliation; do not make a duplicate reservation.',
      };
    return normalizeHotelBooking(
      await request(`/bookings/${encodeURIComponent(input.providerBookingId)}?timeout=30`, 'GET'),
      input,
    );
  },
  async cancel(input) {
    return normalizeHotelBooking(
      await request(
        `/bookings/${encodeURIComponent(input.providerBookingId)}?timeout=120`,
        'PUT',
        undefined,
        true,
      ),
      input,
    );
  },
};
