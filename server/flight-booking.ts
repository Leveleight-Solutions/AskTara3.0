import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ProviderError } from './integrations.ts';
import type {
  BookingProvider,
  ProviderBookingResult,
  StoredBookingOffer,
} from './booking-provider-types.ts';
import type { BookingQuote } from '../shared/bookings.ts';

// Official contract: https://docs.liteapi.travel/openapi/openapiflights.json
// Flight prebooks reserve provider inventory and require passenger documents.
// The common prebook operation below is deliberately a nonreserving verification.
const base = 'https://api.liteapi.travel/v3.0';
const text = z.string().trim().min(1).max(2000);
const currency = z.string().regex(/^[A-Z]{3}$/);
const money = z.number().finite().nonnegative();
const fee = z
  .object({
    label: text.optional(),
    applicability: text.optional(),
    percent: money.nullish(),
    pricing: z.object({ display: z.object({ amount: money, currency }) }).nullish(),
  })
  .nullish();
const termsSchema = z
  .object({
    refundable: z.boolean().optional(),
    changeable: z.boolean().optional(),
    hasRefundFee: z.boolean().optional(),
    hasChangeFee: z.boolean().optional(),
    refundFee: fee,
    changeFee: fee,
    summary: z
      .array(z.object({ message: text }))
      .max(100)
      .optional(),
  })
  .nullish();
const verifySchema = z.object({
  data: z
    .array(
      z.object({
        journey: z.object({
          expiration: text.optional(),
          pricing: z.object({ display: z.object({ total: money, currency }) }),
          terms: termsSchema,
          passengers: z
            .object({
              adults: z.number().int(),
              children: z.number().int().optional(),
              infants: z.number().int().optional(),
            })
            .optional(),
          segments: z
            .array(
              z.object({
                originCode: text,
                destinationCode: text,
                departureTime: text,
                arrivalTime: text,
              }),
            )
            .min(1),
          baggage: z
            .object({ included: z.array(z.object({ description: text.optional() })).optional() })
            .optional(),
        }),
        changes: z
          .object({ cabinChanged: z.boolean().optional(), fareChanged: z.boolean().optional() })
          .nullish(),
      }),
    )
    .length(1),
});

function sandboxKey() {
  const token = process.env.LITEAPI_API_KEY;
  // An environment label alone cannot turn a production credential into a test key.
  if (!token || !/^(sand_|sandbox_)/.test(token))
    throw new ProviderError(
      'Flight checkout requires a LiteAPI sandbox key. Production booking is not enabled.',
      503,
      'SANDBOX_BOOKING_REQUIRED',
    );
  return token;
}

function bookingPath(id: string) {
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(id))
    throw new ProviderError(
      'The flight booking reference is invalid.',
      400,
      'INVALID_BOOKING_REFERENCE',
    );
  return `/flights/bookings/${encodeURIComponent(id)}`;
}

async function request(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
  mutation = false,
  checkpointPayload?: (payload: unknown) => Promise<void>,
) {
  const token = sandboxKey();
  let response: Response;
  let payload: unknown;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'X-API-Key': token,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(60_000),
    });
    payload = await response.json();
  } catch {
    throw new ProviderError(
      mutation
        ? 'The flight provider has not confirmed the outcome. Refresh this reservation before retrying.'
        : 'The flight provider could not be reached. Please try again.',
      502,
      mutation ? 'BOOKING_OUTCOME_UNKNOWN' : 'FLIGHT_PROVIDER_UNAVAILABLE',
    );
  }
  // Recovery identifiers must survive even a malformed or inconsistent response.
  if (checkpointPayload) await checkpointPayload(payload);
  const envelope = payload as {
    sandbox?: unknown;
    providerEnvironment?: unknown;
    data?: {
      providerEnvironment?: unknown;
      journey?: { providerEnvironment?: unknown };
      booking?: { providerEnvironment?: unknown };
    }[];
  } | null;
  if (
    envelope?.sandbox === false ||
    envelope?.providerEnvironment === 'production' ||
    (Array.isArray(envelope?.data) &&
      envelope.data.some(
        (entry) =>
          entry?.providerEnvironment === 'production' ||
          entry?.journey?.providerEnvironment === 'production' ||
          entry?.booking?.providerEnvironment === 'production',
      ))
  )
    throw new ProviderError(
      'The provider returned production data to a sandbox request. No further booking action was submitted.',
      502,
      'SANDBOX_RESPONSE_MISMATCH',
    );
  if (!response.ok || (payload && typeof payload === 'object' && 'error' in payload)) {
    // Never return the upstream body, which can echo credentials/passenger data.
    if (mutation && (response.status >= 500 || response.status === 408 || response.status === 409))
      throw new ProviderError(
        'The flight provider has not confirmed the outcome. Refresh this reservation before retrying.',
        502,
        'BOOKING_OUTCOME_UNKNOWN',
      );
    throw new ProviderError(
      response.status === 404
        ? 'The flight offer or reservation is no longer available. Search again or refresh the reservation.'
        : 'The flight provider could not complete this request.',
      response.status === 404 ? 409 : 502,
      response.status === 404 ? 'FLIGHT_OFFER_EXPIRED' : 'FLIGHT_PROVIDER_REJECTED',
    );
  }
  return { payload, httpStatus: response.status };
}

function feeDescription(name: string, value: z.infer<typeof fee>) {
  if (!value) return `${name} amount was not published by the airline.`;
  const amount = value.pricing?.display;
  return [
    value.label || name,
    amount ? `${amount.amount} ${amount.currency}` : undefined,
    value.percent !== null && value.percent !== undefined
      ? `${value.percent}% of the applicable fare`
      : undefined,
    value.applicability,
    !amount && value.percent == null ? 'Amount was not published by the airline.' : undefined,
  ]
    .filter(Boolean)
    .join(' — ');
}

function termsFor(
  journey: z.infer<typeof verifySchema>['data'][number]['journey'],
): Pick<BookingQuote, 'terms' | 'cancellationPolicies'> {
  const rule = journey.terms;
  const terms = [
    'Sandbox quote only. No seat has been reserved, no payment has been taken, and no ticket has been issued.',
    ...(rule?.summary?.map((row) => row.message) || []),
  ];
  if (rule?.refundable === false) terms.push('This fare is non-refundable.');
  if (rule?.refundable === true)
    terms.push('Refunds are subject to the airline fare rules and any applicable fees.');
  if (rule?.changeable === false) terms.push('This fare does not allow changes.');
  if (rule?.changeable === true)
    terms.push(
      'Changes are subject to airline availability, fare differences, and applicable fees.',
    );
  if (rule?.changeFee || rule?.hasChangeFee)
    terms.push(feeDescription('Change fee', rule.changeFee));
  const cancellationPolicies: BookingQuote['cancellationPolicies'] = [];
  if (rule?.refundFee || rule?.hasRefundFee) {
    const charge = rule.refundFee?.pricing?.display;
    cancellationPolicies.push({
      description: feeDescription('Cancellation fee', rule.refundFee),
      ...(charge ? { amount: charge.amount, currency: charge.currency } : {}),
    });
  } else if (rule?.refundable === false)
    cancellationPolicies.push({
      description:
        'Non-refundable fare. Any cancellation outcome must be confirmed by the airline.',
    });
  else
    cancellationPolicies.push({
      description:
        'Cancellation fees were not published. Missing fees do not mean free cancellation.',
    });
  terms.push(
    ...(journey.baggage?.included?.flatMap((row) => (row.description ? [row.description] : [])) ||
      []),
  );
  return { terms: [...new Set(terms)], cancellationPolicies };
}

const bookingSchema = z.object({
  bookingId: text,
  status: text,
  providerEnvironment: z.enum(['sandbox', 'production']).optional(),
  paymentStatus: text.optional(),
  cancelIntentAt: text.nullish(),
  order: z
    .object({
      reference: z
        .object({
          orderId: text.optional(),
          airlineBookings: z
            .array(z.object({ airlinePnr: text.optional(), pnr: text.optional() }))
            .optional(),
        })
        .optional(),
    })
    .optional(),
  airlineLocators: z.array(z.object({ airlinePnr: text.optional() })).optional(),
});

function bookingResult(payload: unknown, expectedId?: string): ProviderBookingResult {
  const parsed = z
    .object({ data: z.array(z.object({ booking: bookingSchema })).length(1) })
    .safeParse(payload);
  if (!parsed.success || (expectedId && parsed.data.data[0].booking.bookingId !== expectedId))
    throw new ProviderError(
      'The flight provider returned an invalid reservation response.',
      502,
      'FLIGHT_RESPONSE_INVALID',
    );
  const booking = parsed.data.data[0].booking;
  if (booking.providerEnvironment === 'production')
    throw new ProviderError(
      'The provider returned a production reservation to a sandbox request. No further changes were made.',
      502,
      'SANDBOX_RESPONSE_MISMATCH',
    );
  const status: ProviderBookingResult['status'] =
    booking.status === 'CONFIRMED'
      ? 'confirmed'
      : ['CREATED', 'PENDING_CONFIRMATION'].includes(booking.status)
        ? 'pending'
        : ['CANCELLED', 'CANCELLED_WITH_CHARGES'].includes(booking.status)
          ? 'cancelled'
          : 'unknown';
  const reference = booking.order?.reference;
  const confirmationCode =
    booking.airlineLocators?.find((row) => row.airlinePnr)?.airlinePnr ||
    reference?.airlineBookings?.find((row) => row.airlinePnr || row.pnr)?.airlinePnr ||
    reference?.airlineBookings?.find((row) => row.pnr)?.pnr ||
    reference?.orderId;
  return {
    status,
    providerBookingId: booking.bookingId,
    ...(confirmationCode ? { confirmationCode } : {}),
    paymentStatus:
      booking.paymentStatus === 'completed'
        ? 'simulated'
        : ['pending', 'failed', 'not_required'].includes(booking.paymentStatus || '')
          ? 'not_charged'
          : 'unknown',
    ...(booking.cancelIntentAt && status !== 'cancelled'
      ? {
          cancellation: { status: 'pending' },
          message: 'Cancellation requested; awaiting airline confirmation.',
        }
      : status === 'cancelled'
        ? { cancellation: { status: 'cancelled' } }
        : {}),
  };
}

export const flightBookingProvider: BookingProvider = {
  async prebook(offer: StoredBookingOffer) {
    sandboxKey();
    if (offer.provider !== 'liteapi' || offer.view.kind !== 'flight' || offer.view.mode !== 'test')
      throw new ProviderError(
        'This offer is not available for sandbox flight checkout.',
        409,
        'INVALID_BOOKING_OFFER',
      );
    const selectedExpiry = Date.parse(offer.view.expiresAt);
    if (!Number.isFinite(selectedExpiry) || selectedExpiry <= Date.now())
      throw new ProviderError(
        'This flight offer has expired. Search again for an updated quote.',
        409,
        'FLIGHT_OFFER_EXPIRED',
      );
    const { payload } = await request('/flights/verify', 'POST', {
      offerId: offer.providerOfferId,
    });
    const parsed = verifySchema.safeParse(payload);
    if (!parsed.success)
      throw new ProviderError(
        'The flight provider returned an incomplete quote. Search again.',
        502,
        'FLIGHT_RESPONSE_INVALID',
      );
    const { journey, changes } = parsed.data.data[0];
    const selectedSegments = offer.view.journeys?.flatMap((row) => row.segments);
    // A changed itinerary must be selected afresh, never hidden behind a price update.
    if (
      !selectedSegments?.length ||
      selectedSegments.length !== journey.segments.length ||
      selectedSegments.some((segment, index) => {
        const next = journey.segments[index];
        return (
          segment.origin.code !== next.originCode ||
          segment.destination.code !== next.destinationCode ||
          segment.departure !== next.departureTime ||
          segment.arrival !== next.arrivalTime
        );
      }) ||
      changes?.cabinChanged ||
      changes?.fareChanged ||
      (journey.passengers &&
        (journey.passengers.adults !== offer.view.adults ||
          journey.passengers.children ||
          journey.passengers.infants))
    )
      throw new ProviderError(
        'The flight itinerary or fare conditions changed. Search again and select the updated offer.',
        409,
        'FLIGHT_OFFER_CHANGED',
      );
    const display = journey.pricing.display;
    if (display.currency !== offer.view.currency)
      throw new ProviderError(
        'The flight quote currency changed. Search again before continuing.',
        409,
        'FLIGHT_OFFER_CHANGED',
      );
    const verifiedExpiry = journey.expiration ? Date.parse(journey.expiration) : selectedExpiry;
    if (!Number.isFinite(verifiedExpiry) || verifiedExpiry <= Date.now())
      throw new ProviderError(
        'This flight quote has expired. Search again.',
        409,
        'FLIGHT_OFFER_EXPIRED',
      );
    return {
      // Internal token only: verify omits offerId, and does not create a prebook.
      prebookId: offer.providerOfferId,
      quote: {
        version: randomUUID(),
        price: display.total,
        currency: display.currency,
        originalPrice: offer.view.price,
        priceChanged: display.total !== offer.view.price,
        expiresAt: new Date(Math.min(selectedExpiry, verifiedExpiry)).toISOString(),
        ...termsFor(journey),
      },
    };
  },
  async confirm(input) {
    sandboxKey();
    // Enable only after explicit test authorization and account capability checks.
    // No account-card, wallet, live key, or payment-SDK fallback is permitted.
    if (process.env.LITEAPI_FLIGHT_BOOKING_ENABLED !== 'true')
      throw new ProviderError(
        'Flight payment setup is not verified for this sandbox account. No seat was reserved, no payment was taken, and no ticket was issued.',
        503,
        'FLIGHT_PAYMENT_NOT_CONFIGURED',
      );
    if (!input.checkpoint)
      throw new ProviderError(
        'Flight reservation recovery is not configured. No reservation was created.',
        503,
        'FLIGHT_PAYMENT_NOT_CONFIGURED',
      );
    if (input.prebookId !== input.offer.providerOfferId)
      throw new ProviderError(
        'The flight quote does not match the selected offer.',
        409,
        'FLIGHT_OFFER_CHANGED',
      );
    const holder = z
      .object({
        firstName: text,
        lastName: text,
        email: z.email().max(254),
        phoneCountryCode: z.string().regex(/^[1-9][0-9]{0,3}$/),
        phone: z.string().regex(/^[0-9][0-9 ()-]{3,25}$/),
      })
      .safeParse(input.holder);
    const guests = z
      .array(
        z.object({
          firstName: text,
          lastName: text,
          dateOfBirth: z.iso.date(),
          gender: z.enum(['M', 'F']),
          nationality: z.string().regex(/^[A-Z]{2}$/),
          passportNumber: z
            .string()
            .trim()
            .regex(/^[A-Za-z0-9-]{3,30}$/),
          passportExpiry: z.iso.date(),
          passportIssueCountry: z.string().regex(/^[A-Z]{2}$/),
        }),
      )
      .length(input.offer.view.adults)
      .safeParse(input.guests);
    if (
      !holder.success ||
      !guests.success ||
      guests.data.some(
        (guest) =>
          guest.dateOfBirth >= input.offer.view.startDate ||
          guest.passportExpiry <= (input.offer.view.endDate || input.offer.view.startDate) ||
          Number(input.offer.view.startDate.slice(0, 4)) -
            Number(guest.dateOfBirth.slice(0, 4)) -
            (input.offer.view.startDate.slice(5) < guest.dateOfBirth.slice(5) ? 1 : 0) <
            12,
      )
    )
      throw new ProviderError(
        'Enter valid adult passenger names, birth dates, passport details, nationality, and a contact phone with its country code.',
        400,
        'INVALID_BOOKING_GUESTS',
      );
    if (
      !Number.isFinite(Date.parse(input.quote.expiresAt)) ||
      Date.parse(input.quote.expiresAt) <= Date.now()
    )
      throw new ProviderError(
        'The accepted flight quote expired. Review a fresh quote before continuing.',
        409,
        'FLIGHT_OFFER_EXPIRED',
      );

    // Verify again before creating a reservation. A new price needs new consent.
    const latest = await flightBookingProvider.prebook(input.offer);
    if (
      latest.quote.price !== input.quote.price ||
      latest.quote.currency !== input.quote.currency ||
      JSON.stringify(latest.quote.terms) !== JSON.stringify(input.quote.terms) ||
      JSON.stringify(latest.quote.cancellationPolicies) !==
        JSON.stringify(input.quote.cancellationPolicies)
    )
      throw new ProviderError(
        'The flight price or fare conditions changed. Review an updated quote before continuing.',
        409,
        'FLIGHT_OFFER_CHANGED',
      );
    let providerPrebookId: string | undefined;
    let providerBookingId: string | undefined;
    try {
      const created = await request(
        '/flights/prebooks',
        'POST',
        {
          offerId: input.offer.providerOfferId,
          usePaymentSdk: false,
          includeCreditBalance: true,
          contact: {
            firstName: holder.data.firstName,
            lastName: holder.data.lastName,
            email: holder.data.email,
            phoneCountryCode: holder.data.phoneCountryCode,
            phoneNumber: holder.data.phone,
          },
          passengers: guests.data.map((guest) => ({
            firstName: guest.firstName,
            lastName: guest.lastName,
            birthday: guest.dateOfBirth,
            gender: guest.gender,
            nationality: guest.nationality,
            documentType: 'passport',
            documentNumber: guest.passportNumber,
            documentIssueCountry: guest.passportIssueCountry,
            documentExpiry: guest.passportExpiry,
            passengerType: 0,
          })),
        },
        true,
        async (payload) => {
          const reference = z
            .object({
              data: z
                .array(z.object({ prebookId: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/) }))
                .length(1),
            })
            .safeParse(payload);
          if (reference.success) {
            providerPrebookId = reference.data.data[0].prebookId;
            await input.checkpoint!({ providerPrebookId });
          }
        },
      );
      const prebook = z
        .object({
          data: z
            .array(
              z.object({
                prebookId: text,
                offerId: text.optional(),
                price: money,
                currency,
                paymentTypes: z.array(text),
                booking: z.object({ journey: verifySchema.shape.data.element.shape.journey }),
              }),
            )
            .length(1),
        })
        .safeParse(created.payload);
      if (!prebook.success || !providerPrebookId)
        throw new Error('Incomplete reservation response');
      const reserved = prebook.data.data[0];
      const reservedTerms = termsFor(reserved.booking.journey);
      if (
        (reserved.offerId && reserved.offerId !== input.offer.providerOfferId) ||
        reserved.price !== input.quote.price ||
        reserved.currency !== input.quote.currency ||
        reserved.booking.journey.pricing.display.total !== input.quote.price ||
        reserved.booking.journey.pricing.display.currency !== input.quote.currency ||
        JSON.stringify(reservedTerms.terms) !== JSON.stringify(input.quote.terms) ||
        JSON.stringify(reservedTerms.cancellationPolicies) !==
          JSON.stringify(input.quote.cancellationPolicies)
      )
        return {
          status: 'unknown',
          providerPrebookId,
          paymentStatus: 'not_charged',
          message:
            'The provider created a sandbox reservation but changed its price or terms. No final booking or payment was submitted. Keep this reference and contact support; do not create a duplicate reservation.',
        };
      const selected = input.offer.view.journeys!.flatMap((row) => row.segments);
      if (
        reserved.booking.journey.segments.length !== selected.length ||
        reserved.booking.journey.segments.some(
          (segment, index) =>
            segment.originCode !== selected[index].origin.code ||
            segment.destinationCode !== selected[index].destination.code ||
            segment.departureTime !== selected[index].departure ||
            segment.arrivalTime !== selected[index].arrival,
        )
      )
        throw new Error('Reservation itinerary changed');
      if (!reserved.paymentTypes.includes('CREDIT'))
        return {
          status: 'unknown',
          providerPrebookId,
          paymentStatus: 'not_charged',
          message:
            'The provider created a sandbox reservation but did not offer credit payment. No final booking or payment was submitted. Keep this reference and contact support; do not create a duplicate reservation.',
        };
      const completed = await request(
        '/flights/bookings',
        'POST',
        {
          prebookId: providerPrebookId,
          payment: { method: 'CREDIT' },
          customTags: { ASKTARA: input.clientReference },
        },
        true,
        async (payload) => {
          const reference = z
            .object({
              data: z
                .array(
                  z.object({
                    booking: z.object({ bookingId: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/) }),
                  }),
                )
                .length(1),
            })
            .safeParse(payload);
          if (reference.success) providerBookingId = reference.data.data[0].booking.bookingId;
        },
      );
      return { ...bookingResult(completed.payload), providerPrebookId };
    } catch {
      return {
        status: 'unknown',
        ...(providerPrebookId ? { providerPrebookId } : {}),
        ...(providerBookingId ? { providerBookingId } : {}),
        paymentStatus: 'unknown',
        message:
          'The supplier has not confirmed the flight booking outcome. Refresh this reservation or contact support before taking further action; do not create a duplicate booking.',
      };
    }
  },
  async retrieve({ providerBookingId, providerPrebookId, cancelIntentAt }) {
    if (!providerBookingId) {
      // Prebook GET deliberately omits booking lifecycle status, so its existence
      // cannot establish that final ticketing succeeded after a timeout.
      if (providerPrebookId) {
        bookingPath(providerPrebookId);
        await request(`/flights/prebooks/${encodeURIComponent(providerPrebookId)}`, 'GET');
      }
      return {
        status: 'unknown',
        ...(providerPrebookId ? { providerPrebookId } : {}),
        paymentStatus: 'unknown',
        message:
          'No final provider booking reference is available. The saved prebook reference needs supplier reconciliation; do not create a duplicate reservation.',
      };
    }
    const { payload } = await request(bookingPath(providerBookingId), 'GET');
    const result = bookingResult(payload, providerBookingId);
    if (cancelIntentAt && result.status !== 'cancelled') {
      result.cancellation = { status: 'pending' };
      result.message = 'Cancellation requested; awaiting airline confirmation.';
    }
    return result;
  },
  async cancel({ providerBookingId }) {
    const path = `${bookingPath(providerBookingId)}/cancellations`;
    const preview = await request(path, 'GET');
    const quote = z
      .object({
        data: z
          .array(
            z.object({
              confidence: text,
              penalty: z.object({ display: z.object({ amount: money, currency }) }).nullish(),
            }),
          )
          .length(1),
      })
      .safeParse(preview.payload);
    const penalty = quote.success ? quote.data.data[0].penalty?.display : undefined;
    // The shared cancellation contract cannot accept an additional fee. Never
    // interpret an omitted/estimated penalty as zero, even in the sandbox.
    if (!quote.success || quote.data.data[0].confidence !== 'confirmed' || penalty?.amount !== 0)
      throw new ProviderError(
        'Review the airline cancellation charges before proceeding. This cancellation cannot be completed automatically.',
        409,
        'FLIGHT_CANCELLATION_REVIEW_REQUIRED',
      );
    const { payload, httpStatus } = await request(path, 'POST', undefined, true);
    const result = z
      .object({
        data: z.object({
          bookingId: text,
          status: text,
          cancellation_fee: money.optional(),
          currency: currency.optional(),
        }),
      })
      .safeParse(payload);
    if (!result.success || result.data.data.bookingId !== providerBookingId)
      throw new ProviderError(
        'The airline has not confirmed the cancellation outcome. Refresh this reservation.',
        502,
        'BOOKING_OUTCOME_UNKNOWN',
      );
    const data = result.data.data;
    const cancelled =
      httpStatus === 200 && ['CANCELLED', 'CANCELLED_WITH_CHARGES'].includes(data.status);
    return {
      providerBookingId,
      status: cancelled ? 'cancelled' : data.status === 'CONFIRMED' ? 'confirmed' : 'unknown',
      paymentStatus: 'unknown',
      cancellation: {
        status: cancelled ? 'cancelled' : 'pending',
        ...(data.cancellation_fee === undefined ? {} : { fee: data.cancellation_fee }),
        ...(data.currency ? { currency: data.currency } : {}),
      },
      message: cancelled
        ? 'The airline confirmed cancellation of this sandbox reservation.'
        : 'Cancellation requested; awaiting airline confirmation.',
    };
  },
};
