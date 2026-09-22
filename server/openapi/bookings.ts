import type * as OpenAPIV3_1 from 'openapi3-ts/oas31';
import { jsonBody, jsonResponse, operation } from './helpers.ts';

type Schema = OpenAPIV3_1.SchemaObject;
const ref = (name: string): OpenAPIV3_1.ReferenceObject => ({
  $ref: `#/components/schemas/${name}`,
});
const text: Schema = { type: 'string' };
const uuid: Schema = { type: 'string', format: 'uuid' };
const timestamp: Schema = { type: 'string', format: 'date-time' };
const calendarDate: Schema = {
  type: 'string',
  format: 'date',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  description: 'A valid calendar date in YYYY-MM-DD format.',
};
const money: Schema = { type: 'number', minimum: 0 };
const currency: Schema = { type: 'string', pattern: '^[A-Z]{3}$' };
const personName: Schema = { type: 'string', minLength: 1, maxLength: 80 };
const email: Schema = { type: 'string', format: 'email', maxLength: 254 };
const countryCode: Schema = { type: 'string', pattern: '^[A-Z]{2}$' };
const requestId: Schema = {
  ...uuid,
  description:
    'Client-generated UUID for idempotency. Reuse it only when retrying the identical operation and payload. Reusing it with different details or for another action returns 409 IDEMPOTENCY_CONFLICT.',
};
const bookingEnvelope: Schema = {
  type: 'object',
  required: ['booking'],
  properties: { booking: ref('Booking') },
};
const bookingId: OpenAPIV3_1.ParameterObject = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Booking UUID owned by the current guest or signed-in account.',
  schema: uuid,
};
const sandboxDescription =
  'Sandbox only: the server requires LITEAPI_API_KEY beginning with sand_ or sandbox_. Live credentials are rejected with 403 SANDBOX_ONLY. No real payment is collected.';
const bookingResultDescription =
  'Current booking. Inspect booking.status, paymentStatus, cancellation and message: HTTP 200 can include failed, expired, pending, checkout or unknown supplier outcomes and does not by itself mean a reservation was confirmed.';
const missingBooking = jsonResponse('Booking is absent or belongs to another owner.', ref('Error'));
const sandboxDenied = jsonResponse(
  'SANDBOX_ONLY: verified sandbox credentials are unavailable, or the request origin is rejected.',
  ref('Error'),
);
const checkoutRateLimit = jsonResponse(
  'Checkout rate limit exceeded: up to 20 requests per minute per client IP, shared across prebook, confirm, refresh and cancel.',
  ref('Error'),
);

export const bookingSchemas: Record<string, Schema> = {
  BookingHolder: {
    type: 'object',
    additionalProperties: false,
    required: ['firstName', 'lastName', 'email'],
    properties: {
      firstName: personName,
      lastName: personName,
      email,
      phone: { type: 'string', minLength: 7, maxLength: 30 },
      phoneCountryCode: { type: 'string', pattern: '^\\+?[0-9]{1,4}$' },
    },
    description:
      'Contact for the reservation. Names, email and phone are trimmed. Supplier-specific rules may require phone and phoneCountryCode for flights.',
  },
  BookingGuest: {
    type: 'object',
    additionalProperties: false,
    required: ['firstName', 'lastName'],
    properties: {
      firstName: personName,
      lastName: personName,
      email,
      dateOfBirth: calendarDate,
      gender: { type: 'string', enum: ['M', 'F'] },
      nationality: countryCode,
      passportNumber: { type: 'string', minLength: 3, maxLength: 30 },
      passportIssueCountry: countryCode,
      passportExpiry: calendarDate,
    },
    description:
      'Traveler details. Supplier rules can require the optional identity fields, especially for flights. Names, email and passport number are trimmed.',
  },
  BookingFlightAirport: {
    type: 'object',
    required: ['code'],
    properties: { code: text, name: text, city: text, timeZone: text },
  },
  BookingFlightCarrier: {
    type: 'object',
    required: ['name'],
    properties: { name: text, code: text },
  },
  BookingFlightSegment: {
    type: 'object',
    required: ['id', 'origin', 'destination', 'departure', 'arrival'],
    properties: {
      id: text,
      origin: ref('BookingFlightAirport'),
      destination: ref('BookingFlightAirport'),
      departure: text,
      arrival: text,
      duration: text,
      originTerminal: text,
      destinationTerminal: text,
      marketingCarrier: ref('BookingFlightCarrier'),
      operatingCarrier: ref('BookingFlightCarrier'),
      marketingFlightNumber: text,
      operatingFlightNumber: text,
      passengers: {
        type: 'array',
        items: {
          type: 'object',
          required: ['passengerId'],
          properties: {
            passengerId: text,
            cabin: text,
            baggages: {
              type: 'array',
              items: {
                type: 'object',
                required: ['type', 'quantity'],
                properties: { type: text, quantity: { type: 'number' } },
              },
            },
          },
        },
      },
      stops: {
        type: 'array',
        items: {
          type: 'object',
          required: ['airport'],
          properties: {
            airport: ref('BookingFlightAirport'),
            arrival: text,
            departure: text,
            duration: text,
          },
        },
      },
    },
  },
  BookingFlightJourney: {
    type: 'object',
    required: [
      'id',
      'origin',
      'destination',
      'departure',
      'arrival',
      'connections',
      'stops',
      'segments',
    ],
    properties: {
      id: text,
      origin: ref('BookingFlightAirport'),
      destination: ref('BookingFlightAirport'),
      departure: text,
      arrival: text,
      duration: text,
      connections: { type: 'integer' },
      stops: { type: 'integer' },
      segments: { type: 'array', items: ref('BookingFlightSegment') },
    },
  },
  BookingOffer: {
    type: 'object',
    required: [
      'id',
      'kind',
      'name',
      'description',
      'price',
      'currency',
      'adults',
      'startDate',
      'location',
      'expiresAt',
      'mode',
    ],
    properties: {
      id: uuid,
      kind: { type: 'string', enum: ['hotel', 'flight'] },
      name: text,
      description: text,
      price: money,
      currency,
      adults: { type: 'integer', minimum: 1 },
      startDate: calendarDate,
      endDate: calendarDate,
      location: text,
      room: text,
      journeys: { type: 'array', items: ref('BookingFlightJourney') },
      expiresAt: timestamp,
      tripId: uuid,
      mode: { type: 'string', const: 'test' },
      confirmationAvailable: { type: 'boolean' },
      unavailableReason: text,
    },
    description:
      'Owner-scoped public offer created by hotel or flight search. Use bookingOfferId from the search result as this ID; provider IDs and credentials remain private. Offers expire within ten minutes.',
  },
  BookingCancellationPolicy: {
    type: 'object',
    required: ['description'],
    properties: {
      from: text,
      until: text,
      amount: money,
      currency: text,
      description: { type: 'string', maxLength: 5000 },
    },
  },
  BookingQuote: {
    type: 'object',
    required: [
      'version',
      'price',
      'currency',
      'originalPrice',
      'priceChanged',
      'expiresAt',
      'terms',
      'cancellationPolicies',
    ],
    properties: {
      version: {
        type: 'string',
        maxLength: 200,
        description:
          'Quote version required for confirmation; empty while a quote has not been prepared successfully.',
      },
      price: money,
      currency,
      originalPrice: money,
      priceChanged: { type: 'boolean' },
      expiresAt: timestamp,
      terms: {
        type: 'array',
        maxItems: 150,
        items: { type: 'string', maxLength: 30000 },
        description: 'Supplier terms. The combined length is limited to 200,000 characters.',
      },
      cancellationPolicies: {
        type: 'array',
        maxItems: 30,
        items: ref('BookingCancellationPolicy'),
      },
    },
  },
  Booking: {
    type: 'object',
    required: [
      'id',
      'kind',
      'mode',
      'status',
      'offer',
      'quote',
      'paymentStatus',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: uuid,
      kind: { type: 'string', enum: ['hotel', 'flight'] },
      mode: { type: 'string', const: 'test' },
      status: {
        type: 'string',
        enum: [
          'checkout',
          'confirming',
          'pending',
          'confirmed',
          'unknown',
          'cancelling',
          'cancelled',
          'failed',
          'expired',
        ],
      },
      offer: ref('BookingOffer'),
      quote: ref('BookingQuote'),
      providerBookingId: text,
      confirmationCode: text,
      ticketNumbers: { type: 'array', items: text },
      paymentStatus: { type: 'string', enum: ['not_charged', 'simulated', 'unknown'] },
      message: text,
      cancellation: {
        type: 'object',
        required: ['status'],
        properties: { status: text, fee: { type: 'number' }, currency: text },
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  },
  PrebookInput: {
    type: 'object',
    additionalProperties: false,
    required: ['offerId', 'requestId'],
    properties: { offerId: uuid, requestId },
  },
  ConfirmBookingInput: {
    type: 'object',
    additionalProperties: false,
    required: [
      'requestId',
      'quoteVersion',
      'acceptedPrice',
      'acceptedCurrency',
      'holder',
      'guests',
      'acceptSandbox',
      'acceptTerms',
    ],
    properties: {
      requestId,
      quoteVersion: { type: 'string', minLength: 1, maxLength: 200 },
      acceptedPrice: money,
      acceptedCurrency: currency,
      holder: ref('BookingHolder'),
      guests: {
        type: 'array',
        minItems: 1,
        maxItems: 9,
        items: ref('BookingGuest'),
        description:
          'Exactly one lead guest for hotels; exactly one guest per offer.adults for flights.',
      },
      acceptSandbox: { type: 'boolean', const: true },
      acceptTerms: { type: 'boolean', const: true },
    },
  },
  CancelBookingInput: {
    type: 'object',
    additionalProperties: false,
    required: ['requestId', 'acceptCancellation'],
    properties: { requestId, acceptCancellation: { type: 'boolean', const: true } },
  },
};

export const bookingPaths: OpenAPIV3_1.PathsObject = {
  '/api/bookings/offers/{id}': {
    get: operation('Bookings', 'Read a checkout offer', {
      description:
        'Returns an offer owned by the current guest or account. Reading an expired offer does not refresh its price or availability.',
      parameters: [
        {
          ...bookingId,
          description: 'Owner-scoped bookingOfferId UUID returned by a hotel or flight search.',
        },
      ],
      responses: {
        '200': jsonResponse('Public checkout offer.', {
          type: 'object',
          required: ['offer'],
          properties: { offer: ref('BookingOffer') },
        }),
        '404': jsonResponse(
          'OFFER_NOT_FOUND: offer is absent or belongs to another owner.',
          ref('Error'),
        ),
        '409': jsonResponse('The session changed while the request was running.', ref('Error')),
      },
    }),
  },
  '/api/bookings': {
    get: operation('Bookings', 'List saved bookings', {
      description:
        'Returns the current owner’s most recently updated 250 bookings. If tripId is supplied, this recent set is filtered to that trip; the trip must belong to the same owner.',
      parameters: [
        {
          name: 'tripId',
          in: 'query',
          required: false,
          schema: uuid,
          description: 'Filter by an owned trip UUID. Unknown query parameters are rejected.',
        },
      ],
      responses: {
        '200': jsonResponse('Bookings in descending updatedAt order.', {
          type: 'object',
          required: ['bookings'],
          properties: { bookings: { type: 'array', maxItems: 250, items: ref('Booking') } },
        }),
        '404': jsonResponse(
          'The requested trip does not exist or belongs to another owner.',
          ref('Error'),
        ),
        '409': jsonResponse('The session changed while the request was running.', ref('Error')),
      },
    }),
  },
  '/api/bookings/{id}': {
    get: operation('Bookings', 'Read a saved booking', {
      description:
        'Returns locally saved reservation details without contacting the supplier. Use refresh to retrieve a current supplier status.',
      parameters: [bookingId],
      responses: {
        '200': jsonResponse('Saved booking.', bookingEnvelope),
        '404': missingBooking,
        '409': jsonResponse('The session changed while the request was running.', ref('Error')),
      },
    }),
  },
  '/api/bookings/prebook': {
    post: operation('Bookings', 'Prepare a sandbox checkout quote', {
      description: `${sandboxDescription} Revalidates a current offer and saves a quote; it does not confirm a reservation. The quote expires within ten minutes. Repeating an identical requestId returns the existing booking; an offer can create only one booking. Supplier quote failures return HTTP 200 with booking.status=failed. Read the returned total and terms before separately confirming.`,
      requestBody: jsonBody(ref('PrebookInput')),
      responses: {
        '200': jsonResponse(bookingResultDescription, bookingEnvelope),
        '403': sandboxDenied,
        '404': jsonResponse(
          'OFFER_NOT_FOUND: the offer is absent or belongs to another owner.',
          ref('Error'),
        ),
        '409': jsonResponse(
          'QUOTE_EXPIRED, IDEMPOTENCY_CONFLICT, or the session changed.',
          ref('Error'),
        ),
        '429': checkoutRateLimit,
      },
    }),
  },
  '/api/bookings/{id}/confirm': {
    post: operation('Bookings', 'Confirm a sandbox reservation', {
      description: `${sandboxDescription} This explicitly submits a sandbox reservation. Only execute after reviewing the quote and agreeing to its terms. The booking must be in checkout; quoteVersion, acceptedPrice and acceptedCurrency must exactly match the unexpired saved quote. Both acceptance flags must be true. Flight confirmation additionally requires LITEAPI_FLIGHT_BOOKING_ENABLED=true and valid supplier traveler/contact details. A missing flight capability can leave the booking in checkout with HTTP 200; inspect status and message. Idempotent retries do not resubmit the reservation. An unknown outcome must be checked with refresh before another action.`,
      parameters: [bookingId],
      requestBody: jsonBody(ref('ConfirmBookingInput')),
      responses: {
        '200': jsonResponse(bookingResultDescription, bookingEnvelope),
        '400': jsonResponse(
          'INVALID_INPUT or INVALID_GUESTS: invalid fields or incorrect guest count.',
          ref('Error'),
        ),
        '403': sandboxDenied,
        '404': missingBooking,
        '409': jsonResponse(
          'BOOKING_IN_PROGRESS, INVALID_BOOKING_STATE, QUOTE_EXPIRED, QUOTE_CHANGED, IDEMPOTENCY_CONFLICT, or the session changed.',
          ref('Error'),
        ),
        '429': checkoutRateLimit,
      },
    }),
  },
  '/api/bookings/{id}/refresh': {
    post: operation('Bookings', 'Refresh a booking status from the supplier', {
      description:
        'Accepts an empty JSON object or no body. Returns immediately when an operation is active or the booking is in checkout, expired, failed or cancelled; an expired checkout is marked expired. Other states retrieve supplier status and require sandbox credentials. Retrieval failures preserve the prior booking details and return HTTP 200 with an explanatory message. Does not submit another reservation.',
      parameters: [bookingId],
      requestBody: {
        ...jsonBody({ type: 'object', additionalProperties: false }),
        required: false,
      },
      responses: {
        '200': jsonResponse(bookingResultDescription, bookingEnvelope),
        '403': sandboxDenied,
        '404': missingBooking,
        '409': jsonResponse('BOOKING_IN_PROGRESS or the session changed.', ref('Error')),
        '429': checkoutRateLimit,
      },
    }),
  },
  '/api/bookings/{id}/cancel': {
    post: operation('Bookings', 'Request cancellation of a sandbox reservation', {
      description: `${sandboxDescription} This explicitly requests supplier cancellation after acceptCancellation=true. Review the saved cancellation conditions first. Requires a confirmed or pending booking with a provider booking ID; already-cancelled bookings return unchanged. Repeating an identical requestId returns the existing result. The returned booking can remain active, cancelling or unknown; inspect cancellation.status and refresh when needed. A rejected cancellation preserves the prior reservation.`,
      parameters: [bookingId],
      requestBody: jsonBody(ref('CancelBookingInput')),
      responses: {
        '200': jsonResponse(bookingResultDescription, bookingEnvelope),
        '403': sandboxDenied,
        '404': missingBooking,
        '409': jsonResponse(
          'INVALID_BOOKING_STATE, BOOKING_IN_PROGRESS, IDEMPOTENCY_CONFLICT, or the session changed.',
          ref('Error'),
        ),
        '429': checkoutRateLimit,
      },
    }),
  },
};
