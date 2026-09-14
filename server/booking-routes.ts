import type { Express, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { BookingKind, BookingQuote } from '../shared/bookings.ts';
import type { BookingProvider, ProviderBookingResult } from './booking-provider-types.ts';
import { hotelBookingProvider } from './hotel-booking.ts';
import { flightBookingProvider } from './flight-booking.ts';
import {
  BookingError,
  BookingStore,
  bookingFingerprint,
  requireSandboxBookings,
  type StoredBooking,
} from './booking-store.ts';

type Session = { owner_id: string; user_id: string | null; id: string };
const requestId = z.string().uuid();
const holder = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().min(7).max(30).optional(),
    phoneCountryCode: z
      .string()
      .trim()
      .regex(/^\+?[0-9]{1,4}$/)
      .optional(),
  })
  .strict();
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Use a valid calendar date',
  );
const guest = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(254).optional(),
    dateOfBirth: date.optional(),
    gender: z.enum(['M', 'F']).optional(),
    nationality: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    passportNumber: z.string().trim().min(3).max(30).optional(),
    passportIssueCountry: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    passportExpiry: date.optional(),
  })
  .strict();
const confirmSchema = z
  .object({
    requestId,
    quoteVersion: z.string().min(1).max(200),
    acceptedPrice: z.number().finite().nonnegative(),
    acceptedCurrency: z.string().regex(/^[A-Z]{3}$/),
    holder,
    guests: z.array(guest).min(1).max(9),
    acceptSandbox: z.literal(true),
    acceptTerms: z.literal(true),
  })
  .strict();
const quoteSchema = z
  .object({
    version: z.string().min(1).max(200),
    price: z.number().finite().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    originalPrice: z.number().finite().nonnegative(),
    priceChanged: z.boolean(),
    expiresAt: z
      .string()
      .refine((v) => Number.isFinite(Date.parse(v)) && Date.parse(v) > Date.now()),
    terms: z
      .array(z.string().max(30000))
      .max(150)
      .refine(
        (terms) => terms.join('').length <= 200000,
        'Supplier terms exceed the supported size',
      ),
    cancellationPolicies: z
      .array(
        z
          .object({
            from: z.string().optional(),
            until: z.string().optional(),
            amount: z.number().finite().nonnegative().optional(),
            currency: z.string().optional(),
            description: z.string().max(5000),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
function applyResult(
  saved: StoredBooking,
  result: ProviderBookingResult,
  action: 'confirm' | 'refresh' | 'cancel',
) {
  const booking = saved.booking;
  if (result.providerPrebookId) saved.providerPrebookId = result.providerPrebookId;
  if (!['confirmed', 'pending', 'cancelled', 'unknown', 'failed'].includes(result.status))
    throw new Error('Invalid supplier state');
  if (result.status === 'confirmed' && !result.providerBookingId && !booking.providerBookingId)
    throw new Error('The supplier returned confirmation without a reservation identifier');
  booking.status = result.status;
  if (result.providerBookingId) booking.providerBookingId = result.providerBookingId;
  if (result.confirmationCode) booking.confirmationCode = result.confirmationCode;
  if (result.ticketNumbers) booking.ticketNumbers = result.ticketNumbers;
  booking.paymentStatus = result.paymentStatus;
  booking.message = result.message;
  if (result.cancellation) booking.cancellation = result.cancellation;
  if (
    result.status === 'confirmed' &&
    (result.cancellation?.status === 'pending' ||
      (action === 'refresh' && saved.cancelRequestedAt && !result.cancellation))
  ) {
    booking.status = 'cancelling';
    booking.cancellation = { ...booking.cancellation, status: 'pending' };
  }
  if (action === 'cancel' && result.status === 'failed') {
    // A rejected cancellation does not erase the existing reservation.
    booking.status = saved.beforeCancellation || 'confirmed';
    booking.cancellation = { ...result.cancellation, status: 'failed' };
    booking.message =
      result.message || 'Cancellation was not accepted. Your existing reservation remains active.';
  }
  if (booking.cancellation?.status === 'failed' || booking.status === 'cancelled') {
    delete saved.cancelRequestedAt;
    delete saved.beforeCancellation;
  }
}

export function installBookingRoutes(
  app: Express,
  db: DatabaseSync,
  dependencies: {
    session: (res: Response) => Session;
    requireActiveSession: (res: Response) => void;
    providers?: Partial<Record<BookingKind, BookingProvider>>;
  },
) {
  const store = new BookingStore(db);
  const providers = {
    hotel: hotelBookingProvider,
    flight: flightBookingProvider,
    ...dependencies.providers,
  };
  const { session, requireActiveSession } = dependencies;
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many checkout requests. Please wait a minute.' },
  });
  const current = (res: Response) => {
    requireActiveSession(res);
    return session(res).owner_id;
  };
  const publicBooking = (res: Response, id: string) => {
    requireActiveSession(res);
    return store.owned(session(res).owner_id, id).booking;
  };
  const id = (value: unknown) => z.string().uuid().parse(value);
  app.get('/api/bookings/offers/:id', (req, res) => {
    const offer = store.offer(current(res), id(req.params.id));
    res.json({ offer: offer.view });
  });
  app.get('/api/bookings', (req, res) => {
    const ownerId = current(res);
    const query = z.object({ tripId: z.string().uuid().optional() }).strict().parse(req.query);
    if (
      query.tripId &&
      !db.prepare('SELECT id FROM trips WHERE id = ? AND owner_id = ?').get(query.tripId, ownerId)
    )
      throw new BookingError(404, 'Trip not found.');
    res.json({ bookings: store.list(ownerId, query.tripId) });
  });
  app.get('/api/bookings/:id', (req, res) =>
    res.json({ booking: store.owned(current(res), id(req.params.id)).booking }),
  );
  app.post('/api/bookings/prebook', limiter, async (req, res) => {
    const ownerId = current(res);
    requireSandboxBookings();
    const input = z.object({ offerId: z.string().uuid(), requestId }).strict().parse(req.body);
    const fingerprint = bookingFingerprint({ offerId: input.offerId });
    const previous = store.operation(ownerId, input.requestId, 'prebook', fingerprint);
    if (previous) return res.json({ booking: store.owned(ownerId, previous.booking_id).booking });
    const offer = store.offer(ownerId, input.offerId);
    if (Date.parse(offer.view.expiresAt) <= Date.now())
      throw new BookingError(
        409,
        'This offer expired. Search again for current rates.',
        'QUOTE_EXPIRED',
      );
    const { saved, operationId } = store.create(ownerId, offer, input.requestId, fingerprint);
    if (!operationId) return res.json({ booking: saved.booking });
    try {
      const result = await providers[offer.view.kind].prebook(offer);
      const quote = quoteSchema.parse(result.quote) as BookingQuote;
      if (!result.prebookId) throw new Error('Missing quote reference');
      saved.prebookId = result.prebookId;
      saved.booking.quote = {
        ...quote,
        expiresAt: new Date(
          Math.min(Date.parse(quote.expiresAt), Date.now() + 10 * 60_000),
        ).toISOString(),
      };
      saved.booking.status = 'checkout';
      saved.booking.message =
        'Review the current total and terms before confirming this sandbox reservation. No real payment will be collected.';
      store.complete(operationId, saved);
    } catch {
      saved.booking.status = 'failed';
      saved.booking.message =
        'The provider could not prepare this quote. Search again for a fresh offer; no booking was submitted.';
      store.complete(operationId, saved);
    }
    res.json({ booking: publicBooking(res, saved.booking.id) });
  });
  app.post('/api/bookings/:id/confirm', limiter, async (req, res) => {
    const ownerId = current(res);
    requireSandboxBookings();
    const bookingId = id(req.params.id),
      input = confirmSchema.parse(req.body);
    const { requestId: operationKey, ...details } = input;
    const fingerprint = bookingFingerprint({ bookingId, ...details });
    const previous = store.operation(ownerId, operationKey, 'confirm', fingerprint);
    if (previous) return res.json({ booking: store.owned(ownerId, previous.booking_id).booking });
    const saved = store.owned(ownerId, bookingId),
      booking = saved.booking;
    if (store.active(bookingId))
      throw new BookingError(
        409,
        'A request is already in progress. Check its status.',
        'BOOKING_IN_PROGRESS',
      );
    if (booking.status !== 'checkout' || !saved.prebookId || !booking.quote.version)
      throw new BookingError(
        409,
        'This booking cannot be confirmed again. Check its current status.',
        'INVALID_BOOKING_STATE',
      );
    if (Date.parse(booking.quote.expiresAt) <= Date.now()) {
      booking.status = 'expired';
      store.write(saved);
      throw new BookingError(
        409,
        'This quote expired. Search again for current rates.',
        'QUOTE_EXPIRED',
      );
    }
    if (
      input.quoteVersion !== booking.quote.version ||
      input.acceptedPrice !== booking.quote.price ||
      input.acceptedCurrency !== booking.quote.currency
    )
      throw new BookingError(
        409,
        'The quote differs from the details you accepted. Review the current total and terms.',
        'QUOTE_CHANGED',
      );
    const requiredGuests = booking.kind === 'hotel' ? 1 : booking.offer.adults;
    if (input.guests.length !== requiredGuests)
      throw new BookingError(
        400,
        booking.kind === 'hotel'
          ? 'Provide one lead guest for this room.'
          : 'Provide one guest for every adult on this flight.',
        'INVALID_GUESTS',
      );
    const operationId = store.begin(
      ownerId,
      operationKey,
      'confirm',
      fingerprint,
      saved,
      'confirming',
    );
    try {
      const result = await providers[booking.kind].confirm({
        offer: saved.offer,
        prebookId: saved.prebookId,
        quote: booking.quote,
        clientReference: bookingId,
        holder: input.holder,
        guests: input.guests,
        checkpoint: (state) => {
          saved.providerPrebookId = state.providerPrebookId;
          store.write(saved);
        },
      });
      applyResult(saved, result, 'confirm');
      store.complete(operationId, saved);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (
        !saved.providerPrebookId &&
        [
          'BOOKING_NOT_CONFIGURED',
          'INVALID_GUESTS',
          'SANDBOX_REQUIRED',
          'FLIGHT_PAYMENT_NOT_CONFIGURED',
          'INVALID_BOOKING_GUESTS',
          'SANDBOX_BOOKING_REQUIRED',
          'INVALID_BOOKING_OFFER',
          'INVALID_BOOKING_REFERENCE',
          'FLIGHT_PROVIDER_UNAVAILABLE',
          'FLIGHT_PROVIDER_REJECTED',
          'FLIGHT_RESPONSE_INVALID',
          'SANDBOX_RESPONSE_MISMATCH',
        ].includes(code)
      ) {
        booking.status = 'checkout';
        booking.message =
          'Confirmation was not submitted. Check the required traveler details and sandbox connection before trying again.';
      } else if (
        !saved.providerPrebookId &&
        ['FLIGHT_OFFER_CHANGED', 'FLIGHT_OFFER_EXPIRED'].includes(code)
      ) {
        booking.status = 'expired';
        booking.message =
          'The flight price, conditions or expiry changed before reservation. Search again and review a fresh quote; no booking was submitted.';
      } else if (!saved.providerPrebookId && code === 'BOOKING_REJECTED') {
        booking.status = 'failed';
        booking.message =
          'The supplier rejected this reservation. No confirmed booking was returned.';
      } else {
        booking.status = 'unknown';
        booking.paymentStatus = 'unknown';
        booking.message =
          'The supplier outcome is not yet known. Check status before making another reservation; this request will not be submitted again.';
      }
      store.complete(operationId, saved);
    }
    res.json({ booking: publicBooking(res, bookingId) });
  });
  app.post('/api/bookings/:id/refresh', limiter, async (req, res) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    const ownerId = current(res),
      bookingId = id(req.params.id),
      saved = store.owned(ownerId, bookingId),
      booking = saved.booking;
    if (store.active(bookingId)) return res.json({ booking });
    if (
      booking.status === 'checkout' &&
      booking.quote.version &&
      Date.parse(booking.quote.expiresAt) <= Date.now()
    ) {
      booking.status = 'expired';
      store.write(saved);
    }
    if (['checkout', 'expired', 'failed', 'cancelled'].includes(booking.status))
      return res.json({ booking });
    requireSandboxBookings();
    const operationId = store.begin(
      ownerId,
      randomUUID(),
      'refresh',
      bookingFingerprint({ bookingId }),
      saved,
      booking.status,
    );
    try {
      const result = await providers[booking.kind].retrieve({
        providerBookingId: booking.providerBookingId,
        providerPrebookId: saved.providerPrebookId,
        clientReference: bookingId,
        cancelIntentAt: saved.cancelRequestedAt,
      });
      applyResult(saved, result, 'refresh');
      store.complete(operationId, saved);
    } catch {
      booking.message =
        'The provider status could not be refreshed. Your previous reservation details remain saved. Check again shortly.';
      store.complete(operationId, saved);
    }
    res.json({ booking: publicBooking(res, bookingId) });
  });
  app.post('/api/bookings/:id/cancel', limiter, async (req, res) => {
    const ownerId = current(res);
    requireSandboxBookings();
    const bookingId = id(req.params.id),
      input = z
        .object({ requestId, acceptCancellation: z.literal(true) })
        .strict()
        .parse(req.body);
    const fingerprint = bookingFingerprint({ bookingId, acceptCancellation: true });
    const previous = store.operation(ownerId, input.requestId, 'cancel', fingerprint);
    if (previous) return res.json({ booking: store.owned(ownerId, previous.booking_id).booking });
    const saved = store.owned(ownerId, bookingId),
      booking = saved.booking;
    if (booking.status === 'cancelled') return res.json({ booking });
    if (!['confirmed', 'pending'].includes(booking.status) || !booking.providerBookingId)
      throw new BookingError(
        409,
        'Check the supplier booking status before requesting cancellation.',
        'INVALID_BOOKING_STATE',
      );
    saved.beforeCancellation = booking.status as 'confirmed' | 'pending';
    saved.cancelRequestedAt = new Date().toISOString();
    const operationId = store.begin(
      ownerId,
      input.requestId,
      'cancel',
      fingerprint,
      saved,
      'cancelling',
    );
    try {
      const result = await providers[booking.kind].cancel({
        providerBookingId: booking.providerBookingId,
        clientReference: bookingId,
      });
      applyResult(saved, result, 'cancel');
      store.complete(operationId, saved);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (
        [
          'FLIGHT_CANCELLATION_REVIEW_REQUIRED',
          'INVALID_BOOKING_REFERENCE',
          'SANDBOX_BOOKING_REQUIRED',
          'FLIGHT_PROVIDER_UNAVAILABLE',
          'FLIGHT_PROVIDER_REJECTED',
        ].includes(code)
      ) {
        booking.status = saved.beforeCancellation || 'confirmed';
        booking.cancellation = { status: 'review_required' };
        booking.message =
          'Cancellation was not submitted. Review the supplier conditions or connection before continuing. Your previous reservation remains saved.';
        delete saved.cancelRequestedAt;
        delete saved.beforeCancellation;
      } else {
        booking.status = 'unknown';
        booking.cancellation = { status: 'unknown' };
        booking.message =
          'Cancellation has not been confirmed. Your saved confirmation remains available; check the supplier status before another action.';
      }
      store.complete(operationId, saved);
    }
    res.json({ booking: publicBooking(res, bookingId) });
  });
  return store;
}
