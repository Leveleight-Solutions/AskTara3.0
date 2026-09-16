import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, BedDouble, Check, Clock3, Plane, RefreshCw, X } from 'lucide-react';
import {
  AlertDialog,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  DataList,
  Flex,
  Grid,
  Heading,
  Select,
  Separator,
  Text,
  TextField,
} from '@radix-ui/themes';
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
import { EmptyState, Spinner } from '../components/ui';
import {
  BookingError,
  BookingPage,
  BookingSteps,
  SandboxNotice,
  bookingPrice,
} from '../components/BookingUI';
import MarkdownText from '../components/MarkdownText';
import { flightDate, flightTime, flightDuration } from '../../shared/flights';

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
/** Status is never colour alone: every badge carries an icon and its wording. */
function BookingBadge({ booking }: { booking: Booking }) {
  const color =
    booking.status === 'confirmed'
      ? 'green'
      : booking.status === 'failed'
        ? 'red'
        : booking.status === 'cancelled'
          ? 'gray'
          : ['pending', 'unknown', 'confirming', 'cancelling'].includes(booking.status)
            ? 'amber'
            : 'gray';
  return (
    <Badge size="2" radius="full" variant="soft" color={color}>
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
    </Badge>
  );
}
function OfferSummary({ offer, quote }: { offer: BookingOfferView; quote?: BookingQuote }) {
  return (
    <Card asChild size="3">
      <aside aria-label="Booking summary">
        <Flex direction="column" gap="2" align="start">
          <Flex align="center" gap="2">
            {offer.kind === 'hotel' ? <BedDouble size={16} /> : <Plane size={16} />}
            <Text size="1" color="gray" weight="medium" style={{ letterSpacing: '0.12em' }}>
              {offer.kind === 'hotel' ? 'YOUR STAY' : 'YOUR FLIGHT'}
            </Text>
          </Flex>
          <Heading as="h2" size="6">
            {offer.name}
          </Heading>
          <Text as="p" size="2" color="gray">
            {offer.location}
          </Text>
          {offer.room && (
            <Text as="p" size="2" color="gray">
              {offer.room}
            </Text>
          )}
        </Flex>
        <DataList.Root my="4" size="2" orientation="horizontal">
          <DataList.Item>
            <DataList.Label>{offer.kind === 'hotel' ? 'Check-in' : 'Departure'}</DataList.Label>
            <DataList.Value>{readableDate(offer.startDate.slice(0, 10))}</DataList.Value>
          </DataList.Item>
          {offer.endDate && (
            <DataList.Item>
              <DataList.Label>{offer.kind === 'hotel' ? 'Check-out' : 'Return'}</DataList.Label>
              <DataList.Value>{readableDate(offer.endDate.slice(0, 10))}</DataList.Value>
            </DataList.Item>
          )}
          <DataList.Item>
            <DataList.Label>Travelers</DataList.Label>
            <DataList.Value>
              {offer.adults} adult{offer.adults === 1 ? '' : 's'}
            </DataList.Value>
          </DataList.Item>
        </DataList.Root>
        <Separator size="4" my="3" />
        <Flex justify="between" align="baseline" gap="3">
          <Text size="2">{quote?.version ? 'Current quote' : 'Search price'}</Text>
          <Text size="6" weight="bold">
            {bookingPrice(
              quote?.version ? quote.price : offer.price,
              quote?.version ? quote.currency : offer.currency,
            )}
          </Text>
        </Flex>
        <Text as="p" size="1" color="gray" mt="2">
          {quote?.version
            ? `${quote.currency} · total for this ${offer.kind === 'hotel' ? 'stay' : 'journey'}`
            : 'The provider will recheck the price and terms before confirmation.'}
        </Text>
        {!!offer.journeys?.length && (
          <Box mt="4">
            <details>
              <Text asChild size="2" weight="medium">
                <summary style={{ cursor: 'pointer' }}>Review all flight segments</summary>
              </Text>
              <Text as="p" size="1" color="gray" mt="2">
                Times are local to each airport.
              </Text>
              {offer.journeys.map((journey, index) => (
                <Box key={journey.id} asChild mt="3" style={{ overflowWrap: 'anywhere' }}>
                  <section
                    aria-label={
                      index === 0
                        ? 'Outbound journey'
                        : index === 1
                          ? 'Return journey'
                          : `Journey ${index + 1}`
                    }
                  >
                    <Heading size="2" as="h3">
                      {index === 0 ? 'Outbound' : index === 1 ? 'Return' : `Journey ${index + 1}`}:{' '}
                      {journey.origin.code} → {journey.destination.code}
                    </Heading>
                    <Text as="p" size="1" color="gray" mt="1">
                      {flightDuration(journey.duration)} ·{' '}
                      {journey.stops === 0
                        ? 'Nonstop'
                        : `${journey.stops} stop${journey.stops === 1 ? '' : 's'}`}
                    </Text>
                    {journey.segments.map((segment) => (
                      <Box key={segment.id} mt="3">
                        <Text as="div" size="1" weight="bold">
                          {segment.marketingCarrier?.name ||
                            segment.operatingCarrier?.name ||
                            'Airline'}{' '}
                          {segment.marketingCarrier?.code}
                          {segment.marketingFlightNumber}
                        </Text>
                        <Text as="p" size="1" color="gray" mt="1">
                          {segment.origin.code} · {flightDate(segment.departure)}{' '}
                          {flightTime(segment.departure)}
                          <br />
                          {segment.destination.code} · {flightDate(segment.arrival)}{' '}
                          {flightTime(segment.arrival)}
                        </Text>
                        {segment.operatingCarrier && (
                          <Text as="p" size="1" color="gray" mt="1">
                            Operated by {segment.operatingCarrier.name}{' '}
                            {segment.operatingFlightNumber}
                          </Text>
                        )}
                      </Box>
                    ))}
                  </section>
                </Box>
              ))}
            </details>
          </Box>
        )}
        {offer.tripId && (
          <Box mt="4">
            <Button asChild variant="ghost" size="2">
              <Link to={`/chat/${offer.tripId}`}>
                View your itinerary <ArrowRight size={12} />
              </Link>
            </Button>
          </Box>
        )}
      </aside>
    </Card>
  );
}
function QuoteTerms({ quote }: { quote: BookingQuote }) {
  return (
    <>
      <Heading as="h3" size="3" mt="4" mb="2">
        What your quote includes
      </Heading>
      {quote.terms.length ? (
        <Flex asChild direction="column" gap="2">
          <ul style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
            {quote.terms.map((term, index) => (
              <Text asChild size="2" color="gray" key={index}>
                <li>
                  <MarkdownText text={term} />
                </li>
              </Text>
            ))}
          </ul>
        </Flex>
      ) : (
        <Text as="p" size="2" color="gray">
          The provider has not supplied additional rate terms.
        </Text>
      )}
      <Heading as="h3" size="3" mt="4" mb="2">
        Cancellation terms
      </Heading>
      {quote.cancellationPolicies.length ? (
        <Flex asChild direction="column" gap="2">
          <ul style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
            {quote.cancellationPolicies.map((policy, index) => (
              <Text asChild size="2" color="gray" key={index}>
                <li>
                  <MarkdownText text={policy.description} />
                  {policy.from && <span>From {policyDateTime(policy.from)}. </span>}
                  {policy.until && <span>Until {policyDateTime(policy.until)}. </span>}
                  {policy.amount !== undefined && (
                    <span>
                      Fee: {bookingPrice(policy.amount, policy.currency || quote.currency)}.
                    </span>
                  )}
                </li>
              </Text>
            ))}
          </ul>
        </Flex>
      ) : (
        <Text as="p" size="2" color="gray">
          Cancellation fees have not been supplied. Check the booking status before requesting a
          cancellation.
        </Text>
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
            <Grid columns={{ initial: '1', md: 'minmax(0, 1fr) 325px' }} gap="5" align="start">
              <Box
                gridColumn={{ initial: '1', md: '2' }}
                gridRow="1"
                position={{ initial: 'static', md: 'sticky' }}
                top="5"
              >
                <OfferSummary offer={offer} />
              </Box>
              <Box minWidth="0">
                <Card asChild size="3">
                  <section>
                    <Heading as="h2" size="6" mb="3">
                      Your selected {offer.kind === 'hotel' ? 'stay' : 'flight'}
                    </Heading>
                    <Text as="p" size="2" color="gray">
                      {offer.description}
                    </Text>
                    <Text as="p" size="2" color="gray" mt="3">
                      We’ll check the current total and cancellation terms before you continue.
                    </Text>
                    {offer.confirmationAvailable === false && (
                      <Text as="p" size="2" color="gray" mt="3">
                        {offer.unavailableReason ||
                          'Sandbox confirmation is not enabled for this offer. You can still review its price and terms.'}
                      </Text>
                    )}
                    {expiredAt(offer.expiresAt, now) ? (
                      <Box mt="3">
                        <BookingError message="This search offer has expired. Search again for a current offer.">
                          <Button asChild variant="soft" color="red" size="3">
                            <Link to={offer.kind === 'flight' ? '/flights' : '/stays'}>
                              Find another offer
                            </Link>
                          </Button>
                        </BookingError>
                      </Box>
                    ) : (
                      <Text as="p" size="1" color="gray" mt="3">
                        Search offer valid until {dateTime(offer.expiresAt)}.
                      </Text>
                    )}
                    <Flex gap="3" wrap="wrap" mt="5">
                      <Button
                        size="3"
                        loading={busy}
                        disabled={busy || expiredAt(offer.expiresAt, now) || offer.mode !== 'test'}
                        onClick={() => void prepare()}
                      >
                        <ArrowRight size={16} />
                        {busy ? 'Checking price & terms…' : 'Check price & terms'}
                      </Button>
                    </Flex>
                  </section>
                </Card>
              </Box>
            </Grid>
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
            <Grid columns={{ initial: '1', md: 'minmax(0, 1fr) 325px' }} gap="5" align="start">
              <Box
                gridColumn={{ initial: '1', md: '2' }}
                gridRow="1"
                position={{ initial: 'static', md: 'sticky' }}
                top="5"
              >
                <OfferSummary offer={booking.offer} quote={booking.quote} />
              </Box>
              <Box minWidth="0">
                <Card asChild size="3">
                  <section>
                    <BookingBadge booking={booking} />
                    {booking.message && (
                      <Box my="4">
                        <Text as="div" size="2" color="gray">
                          <MarkdownText text={booking.message} />
                        </Text>
                      </Box>
                    )}
                    {uncertain && (
                      <Box my="4">
                        <BookingError message="The booking outcome needs checking. Check the saved provider status before taking another action; a second reservation has not been requested." />
                      </Box>
                    )}
                    {canConfirm ? (
                      <>
                        <Heading as="h2" size="6" mt="4" mb="3">
                          Review the total and terms
                        </Heading>
                        {booking.quote.priceChanged && (
                          <Callout.Root color="amber" role="status" my="4">
                            <Callout.Text>
                              <Text as="span" weight="bold">
                                The price changed during verification
                              </Text>
                              <br />
                              The search showed{' '}
                              {bookingPrice(booking.quote.originalPrice, booking.offer.currency)}.
                              Your current quote is{' '}
                              {bookingPrice(booking.quote.price, booking.quote.currency)}. Confirm
                              only if you accept this total.
                            </Callout.Text>
                          </Callout.Root>
                        )}
                        <Text as="p" size="1" color="gray">
                          Quote valid until {dateTime(booking.quote.expiresAt)}.
                        </Text>
                        <QuoteTerms quote={booking.quote} />
                        <Heading as="h3" size="3" mt="4" mb="2">
                          {booking.kind === 'hotel' ? 'Lead guest details' : 'Booking contact'}
                        </Heading>
                        <Text as="p" size="2" color="gray">
                          {booking.kind === 'hotel'
                            ? 'One room is being reserved. The lead guest will be listed on the sandbox reservation.'
                            : 'Provide a contact for the booking and details for every adult traveler.'}
                        </Text>
                        <form onSubmit={confirm}>
                          <fieldset
                            disabled={busy}
                            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
                          >
                            <Grid columns={{ initial: '1', sm: '2' }} gap="4" mt="4">
                              <label>
                                <Text as="div" size="2" weight="medium" mb="1">
                                  First name
                                </Text>
                                <TextField.Root
                                  size="3"
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
                                <Text as="div" size="2" weight="medium" mb="1">
                                  Last name
                                </Text>
                                <TextField.Root
                                  size="3"
                                  required
                                  maxLength={80}
                                  autoComplete="family-name"
                                  value={holder.lastName}
                                  onChange={(e) =>
                                    setHolder({ ...holder, lastName: e.target.value })
                                  }
                                />
                              </label>
                              <label>
                                <Text as="div" size="2" weight="medium" mb="1">
                                  Email address
                                </Text>
                                <TextField.Root
                                  size="3"
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
                                  <Text as="div" size="2" weight="medium" mb="1">
                                    Phone country calling code
                                  </Text>
                                  <TextField.Root
                                    size="3"
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
                                <Text as="div" size="2" weight="medium" mb="1">
                                  Phone number
                                </Text>
                                <TextField.Root
                                  size="3"
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
                            </Grid>
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
                            {/* The reviewed total and terms stay beside the confirm button. */}
                            <Flex asChild align="start" gap="3" mt="5">
                              <label>
                                <Checkbox
                                  size="3"
                                  checked={terms}
                                  required
                                  onCheckedChange={(checked) => setTerms(checked === true)}
                                />
                                <Text size="2">
                                  I accept the current total of{' '}
                                  <Text weight="bold">
                                    {bookingPrice(booking.quote.price, booking.quote.currency)}
                                  </Text>{' '}
                                  and the cancellation terms above.
                                </Text>
                              </label>
                            </Flex>
                            <Flex asChild align="start" gap="3" mt="4">
                              <label>
                                <Checkbox
                                  size="3"
                                  checked={sandbox}
                                  required
                                  onCheckedChange={(checked) => setSandbox(checked === true)}
                                />
                                <Text size="2">
                                  I understand this is a sandbox reservation. No real stay or flight
                                  is reserved and no payment is collected.
                                </Text>
                              </label>
                            </Flex>
                            <Flex gap="3" wrap="wrap" mt="5">
                              <Button
                                size="3"
                                loading={busy}
                                disabled={busy || !terms || !sandbox || quoteExpired}
                              >
                                <Check size={16} />
                                {busy ? 'Confirming with provider…' : 'Confirm sandbox booking'}
                              </Button>
                            </Flex>
                          </fieldset>
                        </form>
                      </>
                    ) : (
                      <>
                        <Heading as="h2" size="6" mt="4" mb="3">
                          {booking.status === 'checkout' && quoteExpired && booking.quote.version
                            ? 'Quote expired'
                            : statusLabels[booking.status]}
                        </Heading>
                        {booking.status === 'checkout' && !booking.quote.version ? (
                          <Text as="p" size="2" color="gray">
                            Your quote is still being prepared. Check its status before entering
                            guest details.
                          </Text>
                        ) : booking.status === 'checkout' && quoteExpired ? (
                          <Text as="p" size="2" color="gray">
                            This quote has expired. Start a new search for current prices and terms.
                          </Text>
                        ) : booking.status === 'checkout' &&
                          booking.offer.confirmationAvailable === false ? (
                          <Text as="p" size="2" color="gray">
                            {booking.offer.unavailableReason ||
                              'Sandbox confirmation is not enabled for this offer. Your verified quote is available below.'}
                          </Text>
                        ) : booking.status === 'confirmed' ? (
                          /* Peak-End: a confirmed sandbox reservation gets a visible ending. */
                          <Callout.Root color="green" role="status">
                            <Callout.Icon>
                              <Check size={17} />
                            </Callout.Icon>
                            <Callout.Text>
                              The provider confirmed this test reservation. It cannot be used for
                              actual travel.
                            </Callout.Text>
                          </Callout.Root>
                        ) : booking.status === 'cancelled' ? (
                          <Text as="p" size="2" color="gray">
                            The provider reports that this test reservation is cancelled.
                          </Text>
                        ) : ['pending', 'confirming', 'unknown', 'cancelling'].includes(
                            booking.status,
                          ) || uncertain ? (
                          <Text as="p" size="2" color="gray">
                            The provider has not returned a final outcome. Check the status here; do
                            not create another reservation for the same request.
                          </Text>
                        ) : (
                          <Text as="p" size="2" color="gray">
                            Search again for a current offer when you are ready.
                          </Text>
                        )}
                        {(booking.confirmationCode || booking.providerBookingId) && (
                          <>
                            <Heading as="h3" size="3" mt="4" mb="2">
                              Provider reference
                            </Heading>
                            <Text
                              as="div"
                              size="5"
                              weight="bold"
                              my="3"
                              style={{ letterSpacing: '1px', overflowWrap: 'anywhere' }}
                            >
                              {booking.confirmationCode || booking.providerBookingId}
                            </Text>
                          </>
                        )}
                        {!!booking.ticketNumbers?.length && (
                          <Text as="p" size="2" color="gray" mt="3">
                            Sandbox ticket references: {booking.ticketNumbers.join(', ')}
                          </Text>
                        )}
                        <Text as="p" size="1" color="gray" mt="3">
                          {booking.paymentStatus === 'simulated'
                            ? 'Payment simulated · no real charge'
                            : booking.paymentStatus === 'unknown'
                              ? 'Payment simulation status is unconfirmed.'
                              : 'No payment collected.'}
                        </Text>
                        {booking.cancellation && (
                          <Text as="p" size="1" color="gray" mt="2">
                            Cancellation: {booking.cancellation.status}
                            {booking.cancellation.fee !== undefined
                              ? ` · ${bookingPrice(booking.cancellation.fee, booking.cancellation.currency || booking.quote.currency)} simulated fee`
                              : ''}
                          </Text>
                        )}
                        <Flex gap="3" wrap="wrap" align="center" mt="5">
                          <Button
                            size="3"
                            loading={busy}
                            disabled={busy}
                            onClick={() => void refresh()}
                          >
                            <RefreshCw size={15} />
                            {busy ? 'Checking status…' : 'Check booking status'}
                          </Button>
                          {booking.status === 'confirmed' && !uncertain && (
                            <Button
                              size="3"
                              variant="soft"
                              color="red"
                              disabled={busy}
                              onClick={() => {
                                setAcceptCancel(false);
                                setCancelling(true);
                              }}
                            >
                              Cancel sandbox booking
                            </Button>
                          )}
                          {['failed', 'expired'].includes(booking.status) ||
                          (booking.status === 'checkout' && quoteExpired) ? (
                            <Button asChild variant="soft" color="gray" size="3">
                              <Link to={booking.kind === 'flight' ? '/flights' : '/stays'}>
                                Search again <ArrowRight size={13} />
                              </Link>
                            </Button>
                          ) : null}
                        </Flex>
                        {booking.quote.version && (
                          <Box mt="5">
                            <details
                              open={booking.offer.confirmationAvailable === false || undefined}
                            >
                              <Text asChild size="2" weight="medium">
                                <summary style={{ cursor: 'pointer' }}>
                                  Saved quote &amp; cancellation terms
                                </summary>
                              </Text>
                              <QuoteTerms quote={booking.quote} />
                            </details>
                          </Box>
                        )}
                      </>
                    )}
                  </section>
                </Card>
                <Text as="p" size="1" color="gray" mt="3">
                  Last updated {dateTime(booking.updatedAt)}. Booking ID: {booking.id}
                </Text>
              </Box>
            </Grid>
          )}
        </>
      )}
      {booking && (
        <AlertDialog.Root
          open={cancelling}
          onOpenChange={(open) => {
            if (!open && !busy) setCancelling(false);
          }}
        >
          <AlertDialog.Content maxWidth="520px">
            <AlertDialog.Title>Cancel this sandbox booking?</AlertDialog.Title>
            <AlertDialog.Description size="2" color="gray">
              This requests cancellation of the provider’s test reservation.
            </AlertDialog.Description>
            <QuoteTerms quote={booking.quote} />
            <Flex asChild align="start" gap="3" mt="4">
              <label>
                <Checkbox
                  size="3"
                  checked={acceptCancel}
                  disabled={busy}
                  onCheckedChange={(checked) => setAcceptCancel(checked === true)}
                />
                <Text size="2">I accept the cancellation terms for this sandbox booking.</Text>
              </label>
            </Flex>
            <Flex gap="3" wrap="wrap" mt="5" justify="end">
              <AlertDialog.Cancel>
                <Button
                  size="3"
                  variant="soft"
                  color="gray"
                  disabled={busy}
                  onClick={() => setCancelling(false)}
                >
                  Keep booking
                </Button>
              </AlertDialog.Cancel>
              <Button
                size="3"
                color="red"
                loading={busy}
                disabled={busy || !acceptCancel}
                onClick={() => void cancel()}
              >
                {busy ? 'Cancelling…' : 'Confirm cancellation'}
              </Button>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
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
    <Box asChild mt="5">
      <section data-testid="booking-passenger">
        <Separator size="4" mb="4" />
        <Heading as="h3" size="3" mb="3">
          Traveler {index + 1}
        </Heading>
        <Grid columns={{ initial: '1', sm: '2' }} gap="4">
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Traveler {index + 1} first name
            </Text>
            <TextField.Root
              size="3"
              required
              maxLength={80}
              value={guest.firstName}
              onChange={(e) => onChange({ ...guest, firstName: e.target.value })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Traveler {index + 1} last name
            </Text>
            <TextField.Root
              size="3"
              required
              maxLength={80}
              value={guest.lastName}
              onChange={(e) => onChange({ ...guest, lastName: e.target.value })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Date of birth
            </Text>
            <TextField.Root
              size="3"
              required
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={guest.dateOfBirth}
              onChange={(e) => onChange({ ...guest, dateOfBirth: e.target.value })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Gender on travel document
            </Text>
            <Select.Root
              required
              size="3"
              value={guest.gender || ''}
              onValueChange={(value) => onChange({ ...guest, gender: value as 'M' | 'F' })}
            >
              <Select.Trigger placeholder="Select" style={{ width: '100%' }} />
              <Select.Content>
                <Select.Item value="F">Female</Select.Item>
                <Select.Item value="M">Male</Select.Item>
              </Select.Content>
            </Select.Root>
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Nationality (2-letter code)
            </Text>
            <TextField.Root
              size="3"
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
            <Text as="div" size="2" weight="medium" mb="1">
              Passport number
            </Text>
            <TextField.Root
              size="3"
              required
              maxLength={30}
              value={guest.passportNumber}
              onChange={(e) => onChange({ ...guest, passportNumber: e.target.value })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Passport expiry
            </Text>
            <TextField.Root
              size="3"
              required
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={guest.passportExpiry}
              onChange={(e) => onChange({ ...guest, passportExpiry: e.target.value })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Passport issuing country (2-letter code)
            </Text>
            <TextField.Root
              size="3"
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
        </Grid>
      </section>
    </Box>
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
          <Button
            variant="soft"
            color="red"
            size="3"
            onClick={() => setVersion((current) => current + 1)}
          >
            Try again
          </Button>
        </BookingError>
      ) : !bookings.length ? (
        <EmptyState
          title="A little room for your next adventure."
          description="Sandbox reservations and saved checkout quotes will appear here."
          action="Explore stays"
          to="/stays"
        />
      ) : (
        <Flex direction="column" gap="4">
          {bookings.map((booking) => (
            <Card asChild size="3" key={booking.id}>
              <article>
                <Flex
                  direction={{ initial: 'column', sm: 'row' }}
                  justify="between"
                  align={{ initial: 'start', sm: 'center' }}
                  gap="4"
                >
                  <Box minWidth="0">
                    <BookingBadge booking={booking} />
                    <Heading as="h2" size="6" mt="2" mb="1">
                      {booking.offer.name}
                    </Heading>
                    <Text as="p" size="2" color="gray">
                      {readableDate(booking.offer.startDate.slice(0, 10))}
                      {booking.offer.endDate
                        ? ` – ${readableDate(booking.offer.endDate.slice(0, 10))}`
                        : ''}{' '}
                      · {booking.offer.adults} adult{booking.offer.adults === 1 ? '' : 's'}
                    </Text>
                  </Box>
                  <Flex
                    direction={{ initial: 'row', sm: 'column' }}
                    align={{ initial: 'center', sm: 'end' }}
                    justify="between"
                    gap="3"
                    width={{ initial: '100%', sm: 'auto' }}
                    flexShrink="0"
                  >
                    <Text size="5" weight="bold">
                      {bookingPrice(
                        booking.quote.version ? booking.quote.price : booking.offer.price,
                        booking.quote.version ? booking.quote.currency : booking.offer.currency,
                      )}
                    </Text>
                    <Button asChild variant="soft" size="3">
                      <Link to={`/bookings/${booking.id}`}>
                        {booking.status === 'checkout' ? 'Continue checkout' : 'View booking'}
                        <ArrowRight size={14} />
                      </Link>
                    </Button>
                  </Flex>
                </Flex>
              </article>
            </Card>
          ))}
        </Flex>
      )}
    </BookingPage>
  );
}
