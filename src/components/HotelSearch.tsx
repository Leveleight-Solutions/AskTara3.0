import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, BedDouble, ChevronDown, CircleAlert, MapPin, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Heading,
  Select,
  Text,
  TextField,
} from '@radix-ui/themes';
import { api, ApiError, readableDate } from '../api';
import { useApp } from '../context';
import type { Trip } from '../../shared/types';
import { tripDestinations } from '../../shared/destinations';
import { EmptyState, Spinner } from './ui';

interface HotelQuery {
  destinationId: string;
  checkin: string;
  checkout: string;
  adults: number;
  guestNationality: string;
}
interface HotelOffer {
  id: string;
  hotelId: string;
  name: string;
  image: string;
  address: string;
  room: string;
  board: string;
  price: number;
  currency: string;
  checkin: string;
  checkout: string;
  bookingOfferId?: string;
}
interface HotelResults {
  offers: HotelOffer[];
  mode: 'live' | 'test' | 'provider';
  warning?: string;
}
const nationalities = [
  ['PK', 'Pakistan'],
  ['US', 'United States'],
  ['GB', 'United Kingdom'],
  ['CA', 'Canada'],
  ['AU', 'Australia'],
  ['NZ', 'New Zealand'],
  ['AE', 'United Arab Emirates'],
  ['SA', 'Saudi Arabia'],
  ['QA', 'Qatar'],
  ['IN', 'India'],
  ['BD', 'Bangladesh'],
  ['LK', 'Sri Lanka'],
  ['CN', 'China'],
  ['JP', 'Japan'],
  ['KR', 'South Korea'],
  ['SG', 'Singapore'],
  ['MY', 'Malaysia'],
  ['ID', 'Indonesia'],
  ['TH', 'Thailand'],
  ['PH', 'Philippines'],
  ['FR', 'France'],
  ['DE', 'Germany'],
  ['IT', 'Italy'],
  ['ES', 'Spain'],
  ['PT', 'Portugal'],
  ['NL', 'Netherlands'],
  ['CH', 'Switzerland'],
  ['TR', 'Türkiye'],
  ['ZA', 'South Africa'],
  ['BR', 'Brazil'],
  ['MX', 'Mexico'],
];

function afterDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function nightsFor(query: HotelQuery) {
  return Math.round((Date.parse(query.checkout) - Date.parse(query.checkin)) / 86_400_000);
}
function formatPrice(offer: HotelOffer) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: offer.currency }).format(
      offer.price,
    );
  } catch {
    return `${offer.currency} ${offer.price.toFixed(2)}`;
  }
}
function normalizeResults(value: unknown): HotelResults {
  if (!value || typeof value !== 'object' || !('offers' in value) || !Array.isArray(value.offers))
    throw new Error('The hotel provider returned an unreadable result. Please try again.');
  const response = value as { offers: unknown[]; mode?: unknown; warning?: unknown };
  const offers = response.offers.map((entry): HotelOffer => {
    if (!entry || typeof entry !== 'object')
      throw new Error('The hotel provider returned incomplete rates. Please try again.');
    const item = entry as Record<string, unknown>;
    if (
      typeof item.id !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.price !== 'number' ||
      !Number.isFinite(item.price) ||
      item.price < 0 ||
      typeof item.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(item.currency)
    )
      throw new Error('The hotel provider returned incomplete rates. Please try again.');
    return {
      id: item.id,
      hotelId: typeof item.hotelId === 'string' ? item.hotelId : '',
      name: item.name,
      image: typeof item.image === 'string' && /^https:\/\//.test(item.image) ? item.image : '',
      address: typeof item.address === 'string' ? item.address : '',
      room: typeof item.room === 'string' ? item.room : '',
      board: typeof item.board === 'string' ? item.board : '',
      price: item.price,
      currency: item.currency,
      checkin: typeof item.checkin === 'string' ? item.checkin : '',
      checkout: typeof item.checkout === 'string' ? item.checkout : '',
      bookingOfferId: typeof item.bookingOfferId === 'string' ? item.bookingOfferId : undefined,
    };
  });
  return {
    offers,
    mode: response.mode === 'test' ? 'test' : response.mode === 'live' ? 'live' : 'provider',
    warning: typeof response.warning === 'string' ? response.warning : undefined,
  };
}
function HotelPhoto({ offer }: { offer: HotelOffer }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [offer.image]);
  return (
    <Flex
      align="center"
      justify="center"
      flexShrink="0"
      style={{
        width: 116,
        height: 96,
        borderRadius: 'var(--radius-3)',
        overflow: 'hidden',
        background: 'var(--gray-3)',
        color: 'var(--gray-9)',
      }}
    >
      {offer.image && !failed ? (
        <img
          src={offer.image}
          alt={offer.name}
          loading="lazy"
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <BedDouble size={26} aria-label="Hotel photo unavailable" />
      )}
    </Flex>
  );
}

export default function HotelSearch({
  destinationId,
  trip,
}: {
  destinationId?: string;
  trip?: Trip;
}) {
  const { catalog, integrations } = useApp();
  const familyPricingUnsupported = trip?.brief?.consultation?.party?.hasChildren === true;
  const destinations = useMemo(
    () => (trip ? tripDestinations(trip) : catalog.destinations),
    [trip, catalog.destinations],
  );
  const [expanded, setExpanded] = useState(integrations.hotels);
  const [query, setQuery] = useState<HotelQuery>({
    destinationId: destinationId || destinations[0]?.id || '',
    checkin: trip?.startDate || afterDays(30),
    checkout: trip?.startDate
      ? new Date(Date.parse(trip.startDate) + trip.days * 86400000).toISOString().slice(0, 10)
      : afterDays(33),
    adults: trip?.travelers || 2,
    guestNationality: trip?.brief?.guestNationality || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<HotelResults | null>(null);
  const [submitted, setSubmitted] = useState<HotelQuery | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (destinationId && destinations.some((destination) => destination.id === destinationId))
      setQuery((previous) => ({ ...previous, destinationId }));
  }, [destinationId, destinations]);
  useEffect(() => {
    if (integrations.hotels) setExpanded(true);
  }, [integrations.hotels]);
  useEffect(() => {
    if (!trip) return;
    controller.current?.abort();
    setBusy(false);
    setError('');
    setQuery((previous) => ({
      ...previous,
      checkin: trip.startDate || previous.checkin,
      checkout: trip.startDate
        ? new Date(Date.parse(trip.startDate) + trip.days * 86400000).toISOString().slice(0, 10)
        : previous.checkout,
      adults: trip.travelers,
      guestNationality: trip.brief?.guestNationality || previous.guestNationality,
    }));
    setResults(null);
    setSubmitted(null);
  }, [
    trip?.id,
    trip?.startDate,
    trip?.days,
    trip?.travelers,
    trip?.brief?.guestNationality,
    familyPricingUnsupported,
  ]);

  function change<K extends keyof HotelQuery>(key: K, value: HotelQuery[K]) {
    setQuery((previous) => ({ ...previous, [key]: value }));
    setError('');
  }
  function planningLink(offer?: HotelOffer) {
    const current = submitted || query;
    const place =
      destinations.find((destination) => destination.id === current.destinationId)?.name ||
      'my next destination';
    const message = `Help me plan a trip to ${place} from ${current.checkin} to ${current.checkout} for ${current.adults} adults.${offer ? ` I am considering ${offer.name} as a place to stay, but have not booked it.` : ''}`;
    return `/chat${trip ? `/${trip.id}` : ''}?q=${encodeURIComponent(message)}`;
  }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !integrations.hotels || familyPricingUnsupported) return;
    setError('');
    if (!destinations.some((destination) => destination.id === query.destinationId)) {
      setError('Choose a destination for your stay.');
      return;
    }
    if (query.checkin < afterDays(0)) {
      setError('Choose a check-in date today or later.');
      return;
    }
    if (query.checkout <= query.checkin) {
      setError('Check-out must be after check-in.');
      return;
    }
    if (!/^[A-Z]{2}$/.test(query.guestNationality.trim().toUpperCase())) {
      setError('Enter the lead guest’s two-letter country code, such as PK or GB.');
      return;
    }
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    const request = { ...query, guestNationality: query.guestNationality.trim().toUpperCase() };
    setBusy(true);
    setResults(null);
    setSubmitted(request);
    try {
      const response = await api<unknown>('/hotels/search', {
        method: 'POST',
        body: JSON.stringify({ ...request, ...(trip ? { tripId: trip.id } : {}) }),
        signal: pending.signal,
      });
      if (!pending.signal.aborted) setResults(normalizeResults(response));
    } catch (cause) {
      if (pending.signal.aborted) return;
      setError(
        cause instanceof ApiError && cause.status === 503
          ? 'Hotel rates are not connected yet. You can still explore sample stays and plan your trip with Tara.'
          : cause instanceof Error
            ? cause.message.replace(
                /Check LITEAPI_API_KEY\./g,
                'The hotel connection needs to be checked.',
              )
            : 'The hotel provider could not complete this search. Please try again.',
      );
    } finally {
      if (!pending.signal.aborted) setBusy(false);
    }
  }

  if (familyPricingUnsupported)
    return (
      <Card size="3" asChild>
        <section aria-labelledby="hotel-search-title">
          <Flex align="center" gap="3">
            <Flex
              align="center"
              justify="center"
              flexShrink="0"
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-3)',
                background: 'var(--accent-3)',
                color: 'var(--accent-11)',
              }}
            >
              <BedDouble size={19} />
            </Flex>
            <Box>
              <Heading size="4" as="h2" id="hotel-search-title">
                A stay for your dates
              </Heading>
              <Text as="p" size="2" color="gray">
                Family room pricing isn’t supported yet; your itinerary can still include children.
              </Text>
            </Box>
          </Flex>
        </section>
      </Card>
    );
  return (
    <Card size="3" asChild>
      <section aria-labelledby="hotel-search-title">
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <Flex align="center" gap="3">
            <Flex
              align="center"
              justify="center"
              flexShrink="0"
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-3)',
                background: 'var(--accent-3)',
                color: 'var(--accent-11)',
              }}
            >
              <BedDouble size={19} />
            </Flex>
            <Box>
              <Heading size="4" as="h2" id="hotel-search-title">
                A stay for your dates
              </Heading>
              <Text as="p" size="2" color="gray">
                {integrations.hotels
                  ? 'Check provider rates for a place to call your own.'
                  : 'Live rates aren’t connected yet. Our sample stays are here for inspiration.'}
              </Text>
            </Box>
          </Flex>
          <Button
            type="button"
            size="3"
            variant="soft"
            color="gray"
            aria-expanded={expanded}
            aria-controls="hotel-search-content"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Hide search' : 'View search options'}
            <ChevronDown
              size={16}
              style={{
                transform: expanded ? 'rotate(180deg)' : undefined,
                transition: 'transform 150ms',
              }}
            />
          </Button>
        </Flex>
        <Box id="hotel-search-content" hidden={!expanded} mt="4">
          <form onSubmit={search}>
            <Box asChild>
              <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                <Grid columns={{ initial: '1', sm: '2', md: '3' }} gap="3">
                  <Box gridColumn={{ initial: 'auto', md: 'span 3' }}>
                    <Flex direction="column" gap="1">
                      <Text as="label" size="2" weight="medium" htmlFor="hotel-destination">
                        Destination
                      </Text>
                      <Select.Root
                        size="3"
                        required
                        value={query.destinationId}
                        onValueChange={(value) => change('destinationId', value)}
                      >
                        <Select.Trigger id="hotel-destination" aria-label="Destination" />
                        <Select.Content>
                          {destinations.map((destination) => (
                            <Select.Item value={destination.id} key={destination.id}>
                              {destination.name}, {destination.country}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                    </Flex>
                  </Box>
                  <Flex direction="column" gap="1" asChild>
                    <label htmlFor="hotel-checkin">
                      <Text size="2" weight="medium">
                        Check-in
                      </Text>
                      <TextField.Root
                        size="3"
                        id="hotel-checkin"
                        type="date"
                        required
                        min={afterDays(0)}
                        value={query.checkin}
                        onChange={(event) => change('checkin', event.target.value)}
                      />
                    </label>
                  </Flex>
                  <Flex direction="column" gap="1" asChild>
                    <label htmlFor="hotel-checkout">
                      <Text size="2" weight="medium">
                        Check-out
                      </Text>
                      <TextField.Root
                        size="3"
                        id="hotel-checkout"
                        type="date"
                        required
                        min={query.checkin || afterDays(0)}
                        value={query.checkout}
                        onChange={(event) => change('checkout', event.target.value)}
                      />
                    </label>
                  </Flex>
                  <Flex direction="column" gap="1">
                    <Text as="label" size="2" weight="medium" htmlFor="hotel-adults">
                      Guests
                    </Text>
                    <Select.Root
                      size="3"
                      value={String(query.adults)}
                      onValueChange={(value) => change('adults', Number(value))}
                    >
                      <Select.Trigger id="hotel-adults" aria-label="Guests" />
                      <Select.Content>
                        {Array.from({ length: 6 }, (_, index) => index + 1).map((adults) => (
                          <Select.Item key={adults} value={String(adults)}>
                            {adults} adult{adults === 1 ? '' : 's'}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                  </Flex>
                  <Flex direction="column" gap="1" asChild>
                    <label htmlFor="hotel-nationality">
                      <Text size="2" weight="medium">
                        Guest nationality
                      </Text>
                      <TextField.Root
                        size="3"
                        id="hotel-nationality"
                        required
                        list="hotel-nationalities"
                        placeholder="e.g. PK"
                        maxLength={2}
                        pattern="[A-Za-z]{2}"
                        autoComplete="off"
                        title="Enter the lead guest’s two-letter country code"
                        aria-describedby="hotel-nationality-hint"
                        value={query.guestNationality}
                        onChange={(event) =>
                          change('guestNationality', event.target.value.toUpperCase())
                        }
                      />
                    </label>
                  </Flex>
                </Grid>
                <datalist id="hotel-nationalities">
                  {nationalities.map(([code, country]) => (
                    <option key={code} value={code}>
                      {country}
                    </option>
                  ))}
                </datalist>
              </fieldset>
            </Box>
            <Flex
              direction={{ initial: 'column', sm: 'row' }}
              align={{ initial: 'start', sm: 'center' }}
              justify="between"
              gap="3"
              mt="4"
            >
              <Text as="p" size="2" color="gray" id="hotel-nationality-hint">
                One room, adults only. Rates may depend on the lead guest’s nationality.
              </Text>
              <Button size="3" disabled={busy || !integrations.hotels} loading={busy}>
                <Search size={16} />{' '}
                {busy
                  ? 'Checking rates…'
                  : integrations.hotels
                    ? 'Check hotel rates'
                    : 'Rates not connected'}
              </Button>
            </Flex>
          </form>
          {!integrations.hotels && (
            <Flex align="center" justify="between" gap="3" wrap="wrap" mt="4">
              <Text size="2" color="gray">
                Personalize your itinerary while hotel search is being connected.
              </Text>
              <Button asChild size="3" variant="soft">
                <Link to={planningLink()}>
                  Plan with Tara
                  <ArrowRight size={13} />
                </Link>
              </Button>
            </Flex>
          )}
          {error && (
            <Callout.Root color="red" role="alert" mt="4">
              <Callout.Icon>
                <CircleAlert size={17} />
              </Callout.Icon>
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          <Box aria-busy={busy} aria-live="polite" mt="4">
            {busy && <Spinner label="Finding room rates for your stay…" />}
            {results && submitted && (
              <>
                <Flex align="end" justify="between" gap="3" wrap="wrap" mb="3">
                  <Box>
                    {results.mode === 'test' ? (
                      <Badge size="2" color="amber" variant="soft">
                        Sandbox rates
                      </Badge>
                    ) : (
                      <Text size="1" color="gray">
                        Provider rates
                      </Text>
                    )}
                    <Heading size="5" as="h3" mt="2">
                      {
                        destinations.find(
                          (destination) => destination.id === submitted.destinationId,
                        )?.name
                      }
                    </Heading>
                    <Text as="p" size="2" color="gray">
                      {readableDate(submitted.checkin)} – {readableDate(submitted.checkout)} ·{' '}
                      {nightsFor(submitted)} night{nightsFor(submitted) === 1 ? '' : 's'} ·{' '}
                      {submitted.adults} adult{submitted.adults === 1 ? '' : 's'}
                    </Text>
                  </Box>
                  <Text size="2" color="gray">
                    {results.offers.length} {results.offers.length === 1 ? 'stay' : 'stays'}
                  </Text>
                </Flex>
                {results.mode === 'test' && (
                  <Callout.Root color="amber" mb="3">
                    <Callout.Icon>
                      <CircleAlert size={17} />
                    </Callout.Icon>
                    <Flex direction="column" align="start" gap="2">
                      <Badge size="2" color="amber" variant="solid">
                        Test mode
                      </Badge>
                      <Callout.Text>
                        Test rates are simulated and do not establish real room availability.
                      </Callout.Text>
                    </Flex>
                  </Callout.Root>
                )}
                {results.warning && (
                  <Callout.Root color="amber" mb="3">
                    <Callout.Text>{results.warning}</Callout.Text>
                  </Callout.Root>
                )}
                {results.offers.length === 0 ? (
                  <EmptyState
                    title="No rates returned for these dates."
                    description="Try a different stay or destination. You can also ask Tara for ideas."
                    action="Explore with Tara"
                    to={planningLink()}
                  />
                ) : (
                  <>
                    <Flex direction="column" gap="3">
                      {results.offers.map((offer) => (
                        <Card key={offer.id} asChild>
                          <article>
                            <Flex
                              direction={{ initial: 'column', sm: 'row' }}
                              gap="3"
                              align={{ initial: 'start', sm: 'center' }}
                            >
                              <HotelPhoto offer={offer} />
                              <Flex direction="column" gap="1" flexGrow="1" minWidth="0">
                                <Heading size="4" as="h3">
                                  {offer.name}
                                </Heading>
                                {offer.address && (
                                  <Flex align="center" gap="1">
                                    <MapPin size={12} />
                                    <Text size="1" color="gray">
                                      {offer.address}
                                    </Text>
                                  </Flex>
                                )}
                                <Text as="p" size="2" color="gray">
                                  {offer.room || 'Room details not supplied'}
                                  {offer.board ? ` · ${offer.board}` : ''}
                                </Text>
                              </Flex>
                              <Flex
                                direction="column"
                                gap="2"
                                align={{ initial: 'start', sm: 'end' }}
                                flexShrink="0"
                              >
                                <Text size="5" weight="bold">
                                  {formatPrice(offer)}
                                </Text>
                                <Text size="1" color="gray">
                                  {offer.currency} · total for {nightsFor(submitted)} night
                                  {nightsFor(submitted) === 1 ? '' : 's'}
                                </Text>
                                <Button asChild size="3" variant="soft" color="gray">
                                  <Link to={planningLink(offer)}>
                                    Plan around this stay
                                    <ArrowRight size={13} />
                                  </Link>
                                </Button>
                                {offer.bookingOfferId && (
                                  <Button asChild size="3" variant="soft">
                                    <Link
                                      to={`/bookings/new?offer=${encodeURIComponent(offer.bookingOfferId)}`}
                                    >
                                      Review sandbox booking
                                      <ArrowRight size={13} />
                                    </Link>
                                  </Button>
                                )}
                              </Flex>
                            </Flex>
                          </article>
                        </Card>
                      ))}
                    </Flex>
                    <Text as="p" size="1" color="gray" mt="4">
                      Rate search does not reserve a room. Eligible test offers support sandbox
                      checkout with a fresh quote and cancellation terms. Real hotel purchases are
                      not enabled.
                    </Text>
                  </>
                )}
              </>
            )}
          </Box>
        </Box>
      </section>
    </Card>
  );
}
