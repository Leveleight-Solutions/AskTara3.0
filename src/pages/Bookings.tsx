import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BedDouble,
  Check,
  Clock3,
  LoaderCircle,
  Plane,
  RefreshCw,
  X,
} from 'lucide-react';
import type {
  Booking,
  BookingGuest,
  BookingHolder,
  BookingOfferView,
  BookingQuote,
  BookingStatus,
  ConfirmBookingInput,
} from '../../shared/bookings';
import { api, ApiError, readableDate } from '../api';
import { useApp } from '../context';
import { EmptyState, Modal, Spinner } from '../components/ui';
import {
  BookingError,
  BookingPage,
  BookingSteps,
  SandboxNotice,
  bookingPrice,
} from '../components/BookingUI';
import MarkdownText from '../components/MarkdownText';
import { flightDate, flightTime, flightDuration } from '../../shared/flights';
import './bookings.css';

const statusLabels: Record<BookingStatus, string> = {
  checkout: 'Quote ready',
  confirming: 'Confirmation in progress',
  pending: 'Awaiting provider confirmation',
  confirmed: 'Sandbox confirmed',
  unknown: 'Status needs checking',
  cancelling: 'Cancellation in progress',
  cancelled: 'Sandbox cancelled',
  failed: 'Booking unsuccessful',
  expired: 'Quote expired',
};
const dateTime = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Unavailable';
// Supplier cancellation timestamps can be local wall time. Do not silently
// reinterpret a timezone-free deadline in the traveler's browser timezone.
const policyDateTime = (value: string) =>
  /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? dateTime(value) : `${value} (provider local time)`;
const expiredAt = (value: string, now = Date.now()) =>
  !Number.isFinite(Date.parse(value)) || Date.parse(value) <= now;
const operationId = (key: string) => {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored && /^[a-f0-9-]{36}$/i.test(stored)) return stored;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
};

function useMounted() {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
function BookingBadge({ booking }: { booking: Booking }) {
  return (
    <span className={`booking-status status-${booking.status}`}>
      {booking.status === 'confirmed' ? (
        <Check size={12} />
      ) : booking.status === 'cancelled' ? (
        <X size={12} />
      ) : (
        <Clock3 size={12} />
      )}{' '}
      {booking.status === 'checkout' && !booking.quote.version
        ? 'Preparing quote'
        : booking.status === 'checkout' && expiredAt(booking.quote.expiresAt)
          ? 'Quote expired'
          : statusLabels[booking.status]}
    </span>
  );
}
function OfferSummary({ offer, quote }: { offer: BookingOfferView; quote?: BookingQuote }) {
  return (
    <aside className="booking-summary" aria-label="Booking summary">
      <span className="eyebrow">
        {offer.kind === 'hotel' ? <BedDouble size={16} /> : <Plane size={16} />}{' '}
        {offer.kind === 'hotel' ? 'YOUR STAY' : 'YOUR FLIGHT'}
      </span>
      <h2>{offer.name}</h2>
      <p className="booking-muted">{offer.location}</p>
      {offer.room && <p className="booking-muted">{offer.room}</p>}
      <dl className="booking-facts">
        <div>
          <dt>{offer.kind === 'hotel' ? 'Check-in' : 'Departure'}</dt>
          <dd>{readableDate(offer.startDate.slice(0, 10))}</dd>
        </div>
        {offer.endDate && (
          <div>
            <dt>{offer.kind === 'hotel' ? 'Check-out' : 'Return'}</dt>
            <dd>{readableDate(offer.endDate.slice(0, 10))}</dd>
          </div>
        )}
        <div>
          <dt>Travelers</dt>
          <dd>
            {offer.adults} adult{offer.adults === 1 ? '' : 's'}
          </dd>
        </div>
      </dl>
      <div className="booking-total">
        <span>{quote?.version ? 'Current quote' : 'Search price'}</span>
        <strong>
          {bookingPrice(
            quote?.version ? quote.price : offer.price,
            quote?.version ? quote.currency : offer.currency,
          )}
        </strong>
      </div>
      <small>
        {quote?.version
          ? `${quote.currency} · total for this ${offer.kind === 'hotel' ? 'stay' : 'journey'}`
          : 'The provider will recheck the price and terms before confirmation.'}
      </small>
      {!!offer.journeys?.length && (
        <details className="booking-saved-terms">
          <summary>Review all flight segments</summary>
          <p className="booking-muted">Times are local to each airport.</p>
          {offer.journeys.map((journey, index) => (
            <section
              key={journey.id}
              className="booking-journey"
              aria-label={
                index === 0
                  ? 'Outbound journey'
                  : index === 1
                    ? 'Return journey'
                    : `Journey ${index + 1}`
              }
            >
              <h3>
                {index === 0 ? 'Outbound' : index === 1 ? 'Return' : `Journey ${index + 1}`}:{' '}
                {journey.origin.code} → {journey.destination.code}
              </h3>
              <p>
                {flightDuration(journey.duration)} ·{' '}
                {journey.stops === 0
                  ? 'Nonstop'
                  : `${journey.stops} stop${journey.stops === 1 ? '' : 's'}`}
              </p>
              {journey.segments.map((segment) => (
                <div key={segment.id}>
                  <strong>
                    {segment.marketingCarrier?.name || segment.operatingCarrier?.name || 'Airline'}{' '}
                    {segment.marketingCarrier?.code}
                    {segment.marketingFlightNumber}
                  </strong>
                  <p>
                    {segment.origin.code} · {flightDate(segment.departure)}{' '}
                    {flightTime(segment.departure)}
                    <br />
                    {segment.destination.code} · {flightDate(segment.arrival)}{' '}
                    {flightTime(segment.arrival)}
                  </p>
                  {segment.operatingCarrier && (
                    <p>
                      Operated by {segment.operatingCarrier.name} {segment.operatingFlightNumber}
                    </p>
                  )}
                </div>
              ))}
            </section>
          ))}
        </details>
      )}
      {offer.tripId && (
        <Link className="text-link" to={`/chat/${offer.tripId}`}>
          View your itinerary <ArrowRight size={12} />
        </Link>
      )}
    </aside>
  );
}
function QuoteTerms({ quote }: { quote: BookingQuote }) {
  return (
    <>
      <h3>What your quote includes</h3>
      {quote.terms.length ? (
        <ul className="booking-terms">
          {quote.terms.map((term, index) => (
            <li key={index}>
              <MarkdownText text={term} />
            </li>
          ))}
        </ul>
      ) : (
        <p>The provider has not supplied additional rate terms.</p>
      )}
      <h3>Cancellation terms</h3>
      {quote.cancellationPolicies.length ? (
        <ul className="booking-terms">
          {quote.cancellationPolicies.map((policy, index) => (
            <li key={index}>
              <MarkdownText text={policy.description} />
              {policy.from && <span>From {policyDateTime(policy.from)}. </span>}
              {policy.until && <span>Until {policyDateTime(policy.until)}. </span>}
              {policy.amount !== undefined && (
                <span>Fee: {bookingPrice(policy.amount, policy.currency || quote.currency)}.</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          Cancellation fees have not been supplied. Check the booking status before requesting a
          cancellation.
        </p>
      )}
    </>
  );
}

export function NewBooking() {
  const [params] = useSearchParams();
  const { ownerVersion } = useApp();
  return (
    <NewBookingContent
      key={`${ownerVersion}:${params.get('offer')}`}
      offerId={params.get('offer') || ''}
    />
  );
}
function NewBookingContent({ offerId }: { offerId: string }) {
  const [offer, setOffer] = useState<BookingOfferView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useMounted();
  const navigate = useNavigate();
  const now = useNow();
  const [requestId] = useState(() => operationId(`asktara-prebook-${offerId}`));
  useEffect(() => {
    const controller = new AbortController();
    if (!offerId) {
      setError('Choose a sandbox offer from hotel or flight search first.');
      setLoading(false);
      return;
    }
    api<{ offer: BookingOfferView }>(`/bookings/offers/${encodeURIComponent(offerId)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setOffer(result.offer);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [offerId]);
  async function prepare() {
    if (pending.current || !offer || expiredAt(offer.expiresAt)) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const { booking } = await api<{ booking: Booking }>('/bookings/prebook', {
        method: 'POST',
        body: JSON.stringify({ offerId, requestId }),
      });
      if (mounted.current) navigate(`/bookings/${booking.id}`, { replace: true });
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <BookingPage
      title="Let’s check the details."
      description="Review a fresh provider quote before creating a sandbox reservation."
      back={offer?.kind === 'flight' ? '/flights' : '/stays'}
      backLabel="Back to search"
    >
      <SandboxNotice />
      <BookingSteps current={0} />
      {loading ? (
        <Spinner label="Finding your selected offer…" />
      ) : (
        <>
          {error && <BookingError message={error} />}{' '}
          {offer && (
            <div className="booking-layout">
              <div className="booking-main">
                <section className="booking-panel">
                  <h2>Your selected {offer.kind === 'hotel' ? 'stay' : 'flight'}</h2>
                  <p>{offer.description}</p>
                  <p>We’ll check the current total and cancellation terms before you continue.</p>
                  {offer.confirmationAvailable === false && (
                    <p>
                      {offer.unavailableReason ||
                        'Sandbox confirmation is not enabled for this offer. You can still review its price and terms.'}
                    </p>
                  )}
                  {expiredAt(offer.expiresAt, now) ? (
                    <BookingError message="This search offer has expired. Search again for a current offer.">
                      <Link to={offer.kind === 'flight' ? '/flights' : '/stays'}>
                        Find another offer
                      </Link>
                    </BookingError>
                  ) : (
                    <p className="booking-muted">
                      Search offer valid until {dateTime(offer.expiresAt)}.
                    </p>
                  )}
                  <div className="booking-actions">
                    <button
                      className="button button-primary"
                      disabled={busy || expiredAt(offer.expiresAt, now) || offer.mode !== 'test'}
                      onClick={() => void prepare()}
                    >
                      {busy ? (
                        <LoaderCircle size={16} className="spinning" />
                      ) : (
                        <ArrowRight size={16} />
                      )}{' '}
                      {busy ? 'Checking price & terms…' : 'Check price & terms'}
                    </button>
                  </div>
                </section>
              </div>
              <OfferSummary offer={offer} />
            </div>
          )}
        </>
      )}
    </BookingPage>
  );
}

export function BookingDetail() {
  const { id } = useParams();
  const { ownerVersion } = useApp();
  return <BookingDetailContent key={`${ownerVersion}:${id}`} id={id || ''} />;
}
function BookingDetailContent({ id }: { id: string }) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [acceptCancel, setAcceptCancel] = useState(false);
  const [terms, setTerms] = useState(false);
  const [sandbox, setSandbox] = useState(false);
  const [holder, setHolder] = useState<BookingHolder>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  });
  const [guests, setGuests] = useState<BookingGuest[]>([]);
  const mutation = useRef(false);
  const request = useRef<{ signature: string; requestId: string } | null>(null);
  const cancelRequest = useRef<string | null>(null);
  const quoteVersion = useRef<string | null>(null);
  const mounted = useMounted();
  const now = useNow();
  const acceptBooking = useCallback((next: Booking) => {
    if (quoteVersion.current !== null && quoteVersion.current !== next.quote.version) {
      setTerms(false);
      setSandbox(false);
      request.current = null;
    }
    quoteVersion.current = next.quote.version;
    if (['failed', 'review_required'].includes(next.cancellation?.status || ''))
      cancelRequest.current = null;
    setBooking(next);
    setGuests((previous) =>
      next.kind === 'flight' && previous.length !== next.offer.adults
        ? Array.from({ length: next.offer.adults }, () => ({
            firstName: '',
            lastName: '',
            dateOfBirth: '',
            gender: undefined,
            nationality: '',
            passportNumber: '',
            passportExpiry: '',
            passportIssueCountry: '',
          }))
        : previous,
    );
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<{ booking: Booking }>(`/bookings/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) acceptBooking(result.booking);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, acceptBooking]);
  async function refresh() {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ booking: Booking }>(`/bookings/${id}/refresh`, {
        method: 'POST',
        body: '{}',
      });
      if (mounted.current) {
        acceptBooking(result.booking);
        setUncertain(false);
      }
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (
      mutation.current ||
      !booking ||
      booking.status !== 'checkout' ||
      booking.mode !== 'test' ||
      booking.offer.confirmationAvailable === false ||
      !booking.quote.version ||
      expiredAt(booking.quote.expiresAt) ||
      !terms ||
      !sandbox ||
      uncertain
    )
      return;
    const body: Omit<ConfirmBookingInput, 'requestId'> = {
      quoteVersion: booking.quote.version,
      acceptedPrice: booking.quote.price,
      acceptedCurrency: booking.quote.currency,
      holder: {
        ...holder,
        firstName: holder.firstName.trim(),
        lastName: holder.lastName.trim(),
        email: holder.email.trim(),
        phone: holder.phone?.trim(),
        ...(booking.kind === 'flight' ? { phoneCountryCode: holder.phoneCountryCode?.trim() } : {}),
      },
      guests:
        booking.kind === 'hotel'
          ? [
              {
                firstName: holder.firstName.trim(),
                lastName: holder.lastName.trim(),
                email: holder.email.trim(),
              },
            ]
          : guests,
      acceptSandbox: true,
      acceptTerms: true,
    };
    const signature = JSON.stringify(body);
    if (!request.current || request.current.signature !== signature)
      request.current = { signature, requestId: crypto.randomUUID() };
    mutation.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ booking: Booking }>(`/bookings/${id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ ...body, requestId: request.current.requestId }),
      });
      if (mounted.current) {
        acceptBooking(result.booking);
        // A returned checkout is an explicit safe pre-dispatch rejection. The
        // next attempt requires fresh acceptance and a new operation key.
        if (result.booking.status === 'checkout' && result.booking.quote.version) {
          request.current = null;
          setTerms(false);
          setSandbox(false);
        }
      }
    } catch (cause) {
      if (!mounted.current) return;
      const failure = cause as ApiError;
      setError(failure.message);
      if (['QUOTE_CHANGED', 'QUOTE_EXPIRED'].includes(failure.code || '')) {
        setTerms(false);
        setSandbox(false);
        request.current = null;
        try {
          const latest = await api<{ booking: Booking }>(`/bookings/${id}`);
          if (mounted.current) acceptBooking(latest.booking);
        } catch {
          if (mounted.current) setUncertain(true);
        }
      } else if (
        !(failure instanceof ApiError) ||
        failure.status >= 500 ||
        ['BOOKING_IN_PROGRESS', 'INVALID_BOOKING_STATE', 'IDEMPOTENCY_CONFLICT'].includes(
          failure.code || '',
        )
      )
        setUncertain(true);
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function cancel() {
    if (mutation.current || !acceptCancel) return;
    mutation.current = true;
    setBusy(true);
    setError('');
    cancelRequest.current ||= crypto.randomUUID();
    try {
      const result = await api<{ booking: Booking }>(`/bookings/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ requestId: cancelRequest.current, acceptCancellation: true }),
      });
      if (mounted.current) {
        acceptBooking(result.booking);
        setCancelling(false);
        setAcceptCancel(false);
      }
    } catch (cause) {
      if (mounted.current) {
        setError((cause as Error).message);
        setUncertain(true);
        setCancelling(false);
      }
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const quoteReady = booking?.status === 'checkout' && Boolean(booking.quote.version) && !uncertain;
  const quoteExpired = !!booking && expiredAt(booking.quote.expiresAt, now);
  const canConfirm =
    quoteReady &&
    !quoteExpired &&
    booking?.mode === 'test' &&
    booking.offer.confirmationAvailable !== false;
  const title = !booking
    ? 'Your booking'
    : booking.status === 'checkout' && quoteExpired && booking.quote.version
      ? 'This quote has expired.'
      : booking.status === 'checkout'
        ? 'Your quote, ready to review.'
        : booking.status === 'confirmed'
          ? 'Your sandbox booking is confirmed.'
          : booking.status === 'cancelled'
            ? 'Your sandbox booking is cancelled.'
            : booking.status === 'expired'
              ? 'This quote has expired.'
              : booking.status === 'failed'
                ? 'This booking didn’t complete.'
                : 'Let’s check your booking status.';
  return (
    <BookingPage
      title={title}
      description="Your provider test reservation and its latest status, saved together."
    >
      <SandboxNotice />
      <BookingSteps current={canConfirm ? 1 : booking?.status === 'checkout' ? 0 : 2} />
      {loading ? (
        <Spinner label="Opening your booking…" />
      ) : (
        <>
          {error && <BookingError message={error} />}{' '}
          {booking && (
            <div className="booking-layout">
              <div className="booking-main">
                <section className="booking-panel">
                  <BookingBadge booking={booking} />
                  {booking.message && (
                    <div className="booking-message">
                      <MarkdownText text={booking.message} />
                    </div>
                  )}
                  {uncertain && (
                    <BookingError message="The booking outcome needs checking. Check the saved provider status before taking another action; a second reservation has not been requested." />
                  )}
                  {canConfirm ? (
                    <>
                      <h2>Review the total and terms</h2>
                      {booking.quote.priceChanged && (
                        <div className="booking-price-change" role="status">
                          <strong>The price changed during verification</strong>
                          <p>
                            The search showed{' '}
                            {bookingPrice(booking.quote.originalPrice, booking.offer.currency)}.
                            Your current quote is{' '}
                            {bookingPrice(booking.quote.price, booking.quote.currency)}. Confirm
                            only if you accept this total.
                          </p>
                        </div>
                      )}
                      <p className="booking-muted">
                        Quote valid until {dateTime(booking.quote.expiresAt)}.
                      </p>
                      <QuoteTerms quote={booking.quote} />
                      <h3>{booking.kind === 'hotel' ? 'Lead guest details' : 'Booking contact'}</h3>
                      <p>
                        {booking.kind === 'hotel'
                          ? 'One room is being reserved. The lead guest will be listed on the sandbox reservation.'
                          : 'Provide a contact for the booking and details for every adult traveler.'}
                      </p>
                      <form className="booking-form" onSubmit={confirm}>
                        <fieldset disabled={busy}>
                          <div className="booking-guest-fields">
                            <label>
                              First name
                              <input
                                required
                                maxLength={80}
                                autoComplete="given-name"
                                value={holder.firstName}
                                onChange={(e) =>
                                  setHolder({ ...holder, firstName: e.target.value })
                                }
                              />
                            </label>
                            <label>
                              Last name
                              <input
                                required
                                maxLength={80}
                                autoComplete="family-name"
                                value={holder.lastName}
                                onChange={(e) => setHolder({ ...holder, lastName: e.target.value })}
                              />
                            </label>
                            <label>
                              Email address
                              <input
                                required
                                maxLength={254}
                                type="email"
                                autoComplete="email"
                                value={holder.email}
                                onChange={(e) => setHolder({ ...holder, email: e.target.value })}
                              />
                            </label>
                            {booking.kind === 'flight' && (
                              <label>
                                Phone country calling code
                                <input
                                  required
                                  type="tel"
                                  autoComplete="tel-country-code"
                                  placeholder="44"
                                  maxLength={4}
                                  pattern="[0-9]{1,4}"
                                  value={holder.phoneCountryCode || ''}
                                  onChange={(e) =>
                                    setHolder({ ...holder, phoneCountryCode: e.target.value })
                                  }
                                />
                              </label>
                            )}
                            <label>
                              Phone number
                              <input
                                required
                                type="tel"
                                autoComplete={booking.kind === 'flight' ? 'tel-national' : 'tel'}
                                placeholder={
                                  booking.kind === 'flight' ? '7700900123' : '+44 7700 900123'
                                }
                                maxLength={25}
                                pattern={booking.kind === 'flight' ? '[0-9]{7,15}' : undefined}
                                value={holder.phone}
                                onChange={(e) => setHolder({ ...holder, phone: e.target.value })}
                              />
                            </label>
                          </div>
                          {booking.kind === 'flight' &&
                            guests.map((guest, index) => (
                              <GuestFields
                                key={index}
                                guest={guest}
                                index={index}
                                onChange={(updated) =>
                                  setGuests((current) =>
                                    current.map((entry, i) => (i === index ? updated : entry)),
                                  )
                                }
                              />
                            ))}
                          <label className="booking-check">
                            <input
                              type="checkbox"
                              checked={terms}
                              required
                              onChange={(e) => setTerms(e.target.checked)}
                            />
                            <span>
                              I accept the current total of{' '}
                              <strong>
                                {bookingPrice(booking.quote.price, booking.quote.currency)}
                              </strong>{' '}
                              and the cancellation terms above.
                            </span>
                          </label>
                          <label className="booking-check">
                            <input
                              type="checkbox"
                              checked={sandbox}
                              required
                              onChange={(e) => setSandbox(e.target.checked)}
                            />
                            <span>
                              I understand this is a sandbox reservation. No real stay or flight is
                              reserved and no payment is collected.
                            </span>
                          </label>
                          <div className="booking-actions">
                            <button
                              className="button button-primary"
                              disabled={busy || !terms || !sandbox || quoteExpired}
                            >
                              {busy ? (
                                <LoaderCircle size={16} className="spinning" />
                              ) : (
                                <Check size={16} />
                              )}{' '}
                              {busy ? 'Confirming with provider…' : 'Confirm sandbox booking'}
                            </button>
                          </div>
                        </fieldset>
                      </form>
                    </>
                  ) : (
                    <>
                      <h2>
                        {booking.status === 'checkout' && quoteExpired && booking.quote.version
                          ? 'Quote expired'
                          : statusLabels[booking.status]}
                      </h2>
                      {booking.status === 'checkout' && !booking.quote.version ? (
                        <p>
                          Your quote is still being prepared. Check its status before entering guest
                          details.
                        </p>
                      ) : booking.status === 'checkout' && quoteExpired ? (
                        <p>
                          This quote has expired. Start a new search for current prices and terms.
                        </p>
                      ) : booking.status === 'checkout' &&
                        booking.offer.confirmationAvailable === false ? (
                        <p>
                          {booking.offer.unavailableReason ||
                            'Sandbox confirmation is not enabled for this offer. Your verified quote is available below.'}
                        </p>
                      ) : booking.status === 'confirmed' ? (
                        <p>
                          The provider confirmed this test reservation. It cannot be used for actual
                          travel.
                        </p>
                      ) : booking.status === 'cancelled' ? (
                        <p>The provider reports that this test reservation is cancelled.</p>
                      ) : ['pending', 'confirming', 'unknown', 'cancelling'].includes(
                          booking.status,
                        ) || uncertain ? (
                        <p>
                          The provider has not returned a final outcome. Check the status here; do
                          not create another reservation for the same request.
                        </p>
                      ) : (
                        <p>Search again for a current offer when you are ready.</p>
                      )}
                      {(booking.confirmationCode || booking.providerBookingId) && (
                        <>
                          <h3>Provider reference</h3>
                          <strong className="booking-reference">
                            {booking.confirmationCode || booking.providerBookingId}
                          </strong>
                        </>
                      )}
                      {!!booking.ticketNumbers?.length && (
                        <p>Sandbox ticket references: {booking.ticketNumbers.join(', ')}</p>
                      )}
                      <p className="booking-muted">
                        {booking.paymentStatus === 'simulated'
                          ? 'Payment simulated · no real charge'
                          : booking.paymentStatus === 'unknown'
                            ? 'Payment simulation status is unconfirmed.'
                            : 'No payment collected.'}
                      </p>
                      {booking.cancellation && (
                        <p className="booking-muted">
                          Cancellation: {booking.cancellation.status}
                          {booking.cancellation.fee !== undefined
                            ? ` · ${bookingPrice(booking.cancellation.fee, booking.cancellation.currency || booking.quote.currency)} simulated fee`
                            : ''}
                        </p>
                      )}
                      <div className="booking-actions">
                        <button
                          className="button button-secondary"
                          disabled={busy}
                          onClick={() => void refresh()}
                        >
                          <RefreshCw size={15} className={busy ? 'spinning' : ''} />{' '}
                          {busy ? 'Checking status…' : 'Check booking status'}
                        </button>
                        {booking.status === 'confirmed' && !uncertain && (
                          <button
                            className="button button-secondary"
                            disabled={busy}
                            onClick={() => {
                              setAcceptCancel(false);
                              setCancelling(true);
                            }}
                          >
                            Cancel sandbox booking
                          </button>
                        )}
                        {['failed', 'expired'].includes(booking.status) ||
                        (booking.status === 'checkout' && quoteExpired) ? (
                          <Link
                            className="text-link"
                            to={booking.kind === 'flight' ? '/flights' : '/stays'}
                          >
                            Search again <ArrowRight size={13} />
                          </Link>
                        ) : null}
                      </div>
                      {booking.quote.version && (
                        <details
                          className="booking-saved-terms"
                          open={booking.offer.confirmationAvailable === false || undefined}
                        >
                          <summary>Saved quote & cancellation terms</summary>
                          <QuoteTerms quote={booking.quote} />
                        </details>
                      )}
                    </>
                  )}
                </section>
                <p className="booking-muted">
                  Last updated {dateTime(booking.updatedAt)}. Booking ID: {booking.id}
                </p>
              </div>
              <OfferSummary offer={booking.offer} quote={booking.quote} />
            </div>
          )}
        </>
      )}
      {cancelling && booking && (
        <Modal
          title="Cancel this sandbox booking?"
          onClose={() => {
            if (!busy) setCancelling(false);
          }}
        >
          <p className="modal-intro">
            This requests cancellation of the provider’s test reservation.
          </p>
          <QuoteTerms quote={booking.quote} />
          <label className="booking-check">
            <input
              type="checkbox"
              checked={acceptCancel}
              disabled={busy}
              onChange={(e) => setAcceptCancel(e.target.checked)}
            />
            <span>I accept the cancellation terms for this sandbox booking.</span>
          </label>
          <div className="booking-actions">
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => setCancelling(false)}
            >
              Keep booking
            </button>
            <button
              className="button button-danger"
              disabled={busy || !acceptCancel}
              onClick={() => void cancel()}
            >
              {busy ? 'Cancelling…' : 'Confirm cancellation'}
            </button>
          </div>
        </Modal>
      )}
    </BookingPage>
  );
}

function GuestFields({
  guest,
  index,
  onChange,
}: {
  guest: BookingGuest;
  index: number;
  onChange: (guest: BookingGuest) => void;
}) {
  return (
    <section className="booking-passenger">
      <h3>Traveler {index + 1}</h3>
      <div className="booking-guest-fields">
        <label>
          Traveler {index + 1} first name
          <input
            required
            maxLength={80}
            value={guest.firstName}
            onChange={(e) => onChange({ ...guest, firstName: e.target.value })}
          />
        </label>
        <label>
          Traveler {index + 1} last name
          <input
            required
            maxLength={80}
            value={guest.lastName}
            onChange={(e) => onChange({ ...guest, lastName: e.target.value })}
          />
        </label>
        <label>
          Date of birth
          <input
            required
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            value={guest.dateOfBirth}
            onChange={(e) => onChange({ ...guest, dateOfBirth: e.target.value })}
          />
        </label>
        <label>
          Gender on travel document
          <select
            required
            value={guest.gender || ''}
            onChange={(e) => onChange({ ...guest, gender: e.target.value as 'M' | 'F' })}
          >
            <option value="">Select</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
          </select>
        </label>
        <label>
          Nationality (2-letter code)
          <input
            required
            minLength={2}
            maxLength={2}
            pattern="[A-Za-z]{2}"
            placeholder="GB"
            value={guest.nationality}
            onChange={(e) => onChange({ ...guest, nationality: e.target.value.toUpperCase() })}
          />
        </label>
        <label>
          Passport number
          <input
            required
            maxLength={30}
            value={guest.passportNumber}
            onChange={(e) => onChange({ ...guest, passportNumber: e.target.value })}
          />
        </label>
        <label>
          Passport expiry
          <input
            required
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={guest.passportExpiry}
            onChange={(e) => onChange({ ...guest, passportExpiry: e.target.value })}
          />
        </label>
        <label>
          Passport issuing country (2-letter code)
          <input
            required
            minLength={2}
            maxLength={2}
            pattern="[A-Za-z]{2}"
            placeholder="GB"
            value={guest.passportIssueCountry || ''}
            onChange={(e) =>
              onChange({ ...guest, passportIssueCountry: e.target.value.toUpperCase() })
            }
          />
        </label>
      </div>
    </section>
  );
}

export function Bookings() {
  const { ownerVersion } = useApp();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBookings([]);
    setLoading(true);
    setError('');
    api<{ bookings: Booking[] }>('/bookings', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setBookings(result.bookings);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ownerVersion, version]);
  return (
    <BookingPage
      title="Your bookings, in one place."
      description="Return to a quote, check a provider response, or manage a sandbox reservation."
      back="/trips"
      backLabel="Your trips"
    >
      <SandboxNotice />
      {loading ? (
        <Spinner label="Finding your bookings…" />
      ) : error ? (
        <BookingError message={error}>
          <button onClick={() => setVersion((current) => current + 1)}>Try again</button>
        </BookingError>
      ) : !bookings.length ? (
        <EmptyState
          title="A little room for your next adventure."
          description="Sandbox reservations and saved checkout quotes will appear here."
          action="Explore stays"
          to="/stays"
        />
      ) : (
        <div className="booking-list">
          {bookings.map((booking) => (
            <article className="booking-list-card" key={booking.id}>
              <div>
                <BookingBadge booking={booking} />
                <h2>{booking.offer.name}</h2>
                <p>
                  {readableDate(booking.offer.startDate.slice(0, 10))}
                  {booking.offer.endDate
                    ? ` – ${readableDate(booking.offer.endDate.slice(0, 10))}`
                    : ''}{' '}
                  · {booking.offer.adults} adult{booking.offer.adults === 1 ? '' : 's'}
                </p>
              </div>
              <div>
                <strong>
                  {bookingPrice(
                    booking.quote.version ? booking.quote.price : booking.offer.price,
                    booking.quote.version ? booking.quote.currency : booking.offer.currency,
                  )}
                </strong>
                <Link
                  className="button button-secondary button-small"
                  to={`/bookings/${booking.id}`}
                >
                  {booking.status === 'checkout' ? 'Continue checkout' : 'View booking'}
                  <ArrowRight size={14} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </BookingPage>
  );
}
