import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  Plane,
  Search,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Container,
  Flex,
  Grid,
  Heading,
  IconButton,
  Select,
  Separator,
  Text,
  TextField,
} from '@radix-ui/themes';
import { api, ApiError } from '../api';
import { useApp } from '../context';
import type { FlightOffer } from '../../shared/types';
import {
  flightDate,
  flightTime,
  flightDuration as duration,
  flightPrice as price,
} from '../../shared/flights';
import FlightDetails from '../components/FlightDetails';
import { EmptyState, Spinner } from '../components/ui';

interface SearchInput {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  adults: number;
  cabinClass: string;
}
interface SearchResult {
  offers: FlightOffer[];
  mode: 'live' | 'test';
  warning?: string;
}

const airports = [
  ['JFK', 'New York · John F. Kennedy'],
  ['EWR', 'Newark Liberty'],
  ['LHR', 'London Heathrow'],
  ['LGW', 'London Gatwick'],
  ['CDG', 'Paris Charles de Gaulle'],
  ['LIS', 'Lisbon'],
  ['FCO', 'Rome Fiumicino'],
  ['AMS', 'Amsterdam Schiphol'],
  ['BCN', 'Barcelona'],
  ['DXB', 'Dubai'],
  ['DOH', 'Doha'],
  ['KHI', 'Karachi'],
  ['LHE', 'Lahore'],
  ['ISB', 'Islamabad'],
  ['SIN', 'Singapore Changi'],
  ['BKK', 'Bangkok Suvarnabhumi'],
  ['NRT', 'Tokyo Narita'],
  ['HND', 'Tokyo Haneda'],
  ['DPS', 'Bali Denpasar'],
  ['SYD', 'Sydney'],
  ['LAX', 'Los Angeles'],
  ['SFO', 'San Francisco'],
  ['CPT', 'Cape Town'],
];

function futureDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function planLink(search?: SearchInput | null, offer?: FlightOffer) {
  const message = search
    ? `Help me plan a trip from ${search.origin} to ${search.destination}, departing ${search.departureDate}${search.returnDate ? ` and returning ${search.returnDate}` : ''}, for ${search.adults} adult${search.adults === 1 ? '' : 's'}.${offer ? ` I am considering the ${offer.airline} flight departing ${offer.departure}. Help me plan around it; I have not booked it.` : ''}`
    : 'Help me choose where to fly for my next trip.';
  return `/chat?q=${encodeURIComponent(message)}`;
}

export default function Flights() {
  const { integrations } = useApp();
  const [roundTrip, setRoundTrip] = useState(true);
  const [form, setForm] = useState<SearchInput>({
    origin: '',
    destination: '',
    departureDate: futureDate(30),
    returnDate: futureDate(37),
    adults: 1,
    cabinClass: 'economy',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [selectedOffer, setSelectedOffer] = useState<FlightOffer | null>(null);
  const [lastSearch, setLastSearch] = useState<SearchInput | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  function update<K extends keyof SearchInput>(key: K, value: SearchInput[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setError('');
  }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const query: SearchInput = {
      ...form,
      origin: form.origin.trim().toUpperCase(),
      destination: form.destination.trim().toUpperCase(),
      returnDate: roundTrip ? form.returnDate : undefined,
    };
    if (!/^[A-Z]{3}$/.test(query.origin) || !/^[A-Z]{3}$/.test(query.destination)) {
      setError('Choose an airport or enter its three-letter IATA code.');
      return;
    }
    if (query.origin === query.destination) {
      setError('Choose a different airport for your destination.');
      return;
    }
    if (query.departureDate < futureDate(0)) {
      setError('Choose a departure date today or later.');
      return;
    }
    if (roundTrip && (!query.returnDate || query.returnDate < query.departureDate)) {
      setError('Your return date must be on or after your departure date.');
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setResult(null);
    setLastSearch(query);
    try {
      const response = await api<SearchResult>('/flights/search', {
        method: 'POST',
        body: JSON.stringify(query),
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setResult(response);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        cause instanceof ApiError && cause.status === 503
          ? 'Flight search is not available yet. The flight provider needs to be connected before Tara can retrieve fares. You can still plan your trip with Tara.'
          : cause instanceof Error
            ? cause.message
            : 'We couldn’t retrieve flights. Please try again.',
      );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <Container size="4" px="4" py="6">
      <Flex
        direction={{ initial: 'column', sm: 'row' }}
        align={{ initial: 'start', sm: 'end' }}
        justify="between"
        gap="4"
        mb="5"
      >
        <Box>
          <Text size="1" color="gray">
            A window seat to somewhere new
          </Text>
          <Heading as="h1" size="8" mt="2" mb="2">
            Your next chapter,
            <br />
            <em>a flight away.</em>
          </Heading>
          <Text as="p" size="2" color="gray">
            Find a way there. Let Tara take care of the inspiration.
          </Text>
        </Box>
        <Badge size="2" color={integrations.flights ? 'green' : 'gray'} variant="soft">
          {integrations.flights ? 'Flight provider connected' : 'Flight search awaiting connection'}
        </Badge>
      </Flex>

      <Card size="3" asChild>
        <section aria-labelledby="flight-search-heading">
          <Flex align="center" justify="between" gap="4" wrap="wrap">
            <Heading size="4" id="flight-search-heading" as="h2">
              <Flex align="center" gap="2">
                <Plane size={19} />
                Find your flight
              </Flex>
            </Heading>
            <Text size="2" color="gray">
              Every journey starts somewhere.
            </Text>
          </Flex>
          <Separator size="4" my="4" />
          <form onSubmit={search}>
            <Box asChild>
              <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                <Flex align="center" gap="2" mb="4" role="group" aria-label="Journey type">
                  <Button
                    type="button"
                    size="3"
                    variant={roundTrip ? 'solid' : 'soft'}
                    color="gray"
                    aria-pressed={roundTrip}
                    onClick={() => {
                      setRoundTrip(true);
                      setError('');
                    }}
                  >
                    {roundTrip && <Check size={13} />}Round trip
                  </Button>
                  <Button
                    type="button"
                    size="3"
                    variant={!roundTrip ? 'solid' : 'soft'}
                    color="gray"
                    aria-pressed={!roundTrip}
                    onClick={() => {
                      setRoundTrip(false);
                      setError('');
                    }}
                  >
                    {!roundTrip && <Check size={13} />}One way
                  </Button>
                </Flex>
                <Grid
                  columns={{ initial: '1', sm: 'minmax(0, 1fr) auto minmax(0, 1fr)' }}
                  align="end"
                  gap="3"
                  mb="4"
                >
                  <Flex direction="column" gap="1" asChild>
                    <label htmlFor="flight-origin">
                      <Text size="2" weight="medium">
                        From
                      </Text>
                      <TextField.Root
                        size="3"
                        id="flight-origin"
                        list="flight-airports"
                        placeholder="e.g. JFK · New York"
                        required
                        autoComplete="off"
                        value={form.origin}
                        maxLength={3}
                        pattern="[A-Za-z]{3}"
                        title="Enter a three-letter airport code, such as JFK"
                        onChange={(event) => update('origin', event.target.value.toUpperCase())}
                      />
                    </label>
                  </Flex>
                  <IconButton
                    type="button"
                    size="3"
                    variant="soft"
                    color="gray"
                    aria-label="Swap origin and destination"
                    onClick={() => {
                      setForm((previous) => ({
                        ...previous,
                        origin: previous.destination,
                        destination: previous.origin,
                      }));
                      setError('');
                    }}
                  >
                    <ArrowLeftRight size={17} />
                  </IconButton>
                  <Flex direction="column" gap="1" asChild>
                    <label htmlFor="flight-destination">
                      <Text size="2" weight="medium">
                        To
                      </Text>
                      <TextField.Root
                        size="3"
                        id="flight-destination"
                        list="flight-airports"
                        placeholder="e.g. LHR · London"
                        required
                        autoComplete="off"
                        value={form.destination}
                        maxLength={3}
                        pattern="[A-Za-z]{3}"
                        title="Enter a three-letter airport code, such as LHR"
                        onChange={(event) =>
                          update('destination', event.target.value.toUpperCase())
                        }
                      />
                    </label>
                  </Flex>
                </Grid>
                <datalist id="flight-airports">
                  {airports.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </datalist>
                <Grid columns={{ initial: '1', sm: '2', md: '4' }} gap="3">
                  <Flex direction="column" gap="1" asChild>
                    <label htmlFor="flight-departure">
                      <Text size="2" weight="medium">
                        Departure
                      </Text>
                      <TextField.Root
                        size="3"
                        id="flight-departure"
                        type="date"
                        required
                        min={futureDate(0)}
                        value={form.departureDate}
                        onChange={(event) => update('departureDate', event.target.value)}
                      />
                    </label>
                  </Flex>
                  {roundTrip && (
                    <Flex direction="column" gap="1" asChild>
                      <label htmlFor="flight-return">
                        <Text size="2" weight="medium">
                          Return
                        </Text>
                        <TextField.Root
                          size="3"
                          id="flight-return"
                          type="date"
                          required
                          min={form.departureDate || futureDate(0)}
                          value={form.returnDate || ''}
                          onChange={(event) => update('returnDate', event.target.value)}
                        />
                      </label>
                    </Flex>
                  )}
                  <Flex direction="column" gap="1">
                    <Text as="label" size="2" weight="medium" htmlFor="flight-adults">
                      Travelers
                    </Text>
                    <Select.Root
                      size="3"
                      value={String(form.adults)}
                      onValueChange={(value) => update('adults', Number(value))}
                    >
                      <Select.Trigger id="flight-adults" aria-label="Travelers" />
                      <Select.Content>
                        {Array.from({ length: 9 }, (_, index) => index + 1).map((number) => (
                          <Select.Item key={number} value={String(number)}>
                            {number} adult{number > 1 ? 's' : ''}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                  </Flex>
                  <Flex direction="column" gap="1">
                    <Text as="label" size="2" weight="medium" htmlFor="flight-cabin">
                      Cabin
                    </Text>
                    <Select.Root
                      size="3"
                      value={form.cabinClass}
                      onValueChange={(value) => update('cabinClass', value)}
                    >
                      <Select.Trigger id="flight-cabin" aria-label="Cabin" />
                      <Select.Content>
                        <Select.Item value="economy">Economy</Select.Item>
                        <Select.Item value="premium_economy">Premium economy</Select.Item>
                        <Select.Item value="business">Business</Select.Item>
                        <Select.Item value="first">First</Select.Item>
                      </Select.Content>
                    </Select.Root>
                  </Flex>
                </Grid>
              </fieldset>
            </Box>
            <Flex
              align={{ initial: 'start', sm: 'center' }}
              direction={{ initial: 'column', sm: 'row' }}
              justify="between"
              gap="3"
              mt="4"
            >
              <Text as="p" size="2" color="gray">
                Searching for adults. For a trip with children,{' '}
                <Link to="/chat?q=Help%20me%20plan%20a%20family%20trip">start with Tara</Link>.
              </Text>
              <Button type="submit" size="3" disabled={busy} loading={busy}>
                <Search size={17} /> {busy ? 'Searching flights…' : 'Search flights'}
              </Button>
            </Flex>
          </form>
        </section>
      </Card>

      {error && (
        <Callout.Root color="red" role="alert" mt="4">
          <Callout.Icon>
            <CircleAlert size={19} />
          </Callout.Icon>
          <Flex direction="column" align="start" gap="2">
            <Callout.Text>{error}</Callout.Text>
            <Button asChild size="3" variant="soft" color="red">
              <Link to={planLink(lastSearch)}>
                Plan with Tara
                <ArrowRight size={14} />
              </Link>
            </Button>
          </Flex>
        </Callout.Root>
      )}

      <Box asChild mt="5">
        <section aria-label="Flight search results" aria-busy={busy}>
          {busy ? (
            <Box py="6">
              <Heading as="h2" size="5" align="center">
                Finding your way there.
              </Heading>
              <Spinner label="Checking flight offers for your dates and travelers." />
            </Box>
          ) : result ? (
            <>
              {(result.mode === 'test' || result.warning) && (
                <Callout.Root color="amber" role="status" mb="4">
                  <Callout.Icon>
                    <CircleAlert size={18} />
                  </Callout.Icon>
                  <Flex direction="column" align="start" gap="2">
                    {result.mode === 'test' && (
                      <Badge size="2" color="amber" variant="solid">
                        Test results · simulated flights and prices
                      </Badge>
                    )}
                    <Callout.Text>
                      {result.warning ||
                        'These offers come from the provider’s test environment and cannot be used as real travel availability.'}
                    </Callout.Text>
                  </Flex>
                </Callout.Root>
              )}
              <Flex align="end" justify="between" gap="4" wrap="wrap" mb="4">
                <Box>
                  {result.mode === 'test' ? (
                    <Badge size="2" color="amber" variant="soft">
                      Provider sandbox
                    </Badge>
                  ) : (
                    <Text size="1" color="gray">
                      Flight offers
                    </Text>
                  )}
                  <Heading size="6" as="h2" mt="2">
                    <Flex align="center" gap="2">
                      {lastSearch?.origin} <ArrowRight size={20} /> {lastSearch?.destination}
                    </Flex>
                  </Heading>
                  <Text as="p" size="2" color="gray">
                    {flightDate(lastSearch?.departureDate || '')}
                    {lastSearch?.returnDate
                      ? ` – ${flightDate(lastSearch.returnDate)}`
                      : ' · One way'}{' '}
                    · {lastSearch?.adults} adult{lastSearch?.adults === 1 ? '' : 's'}
                  </Text>
                </Box>
                <Text size="2" color="gray">
                  {result.offers.length} {result.offers.length === 1 ? 'option' : 'options'}
                </Text>
              </Flex>
              {result.offers.length === 0 ? (
                <EmptyState
                  title="A little flexibility goes a long way."
                  description="No offers were returned for this search. Try another date or a nearby airport."
                  action="Explore ideas with Tara"
                  to={planLink(lastSearch)}
                />
              ) : (
                <>
                  <Text as="p" size="2" color="gray" mb="4">
                    {lastSearch?.returnDate
                      ? 'Prices cover outbound and return journeys for all travelers.'
                      : 'Prices cover all travelers in this search.'}{' '}
                    Offers can change; no reservation has been made.
                  </Text>
                  <Flex direction="column" gap="3">
                    {result.offers.map((offer) => (
                      <Card size="3" key={offer.id} asChild>
                        <article>
                          <Flex
                            direction={{ initial: 'column', md: 'row' }}
                            gap="4"
                            justify="between"
                          >
                            <Flex direction="column" gap="4" flexGrow="1" minWidth="0">
                              <Flex align="center" gap="3">
                                <Flex
                                  align="center"
                                  justify="center"
                                  style={{
                                    width: 38,
                                    height: 38,
                                    borderRadius: 'var(--radius-3)',
                                    background: 'var(--accent-3)',
                                    color: 'var(--accent-11)',
                                    flexShrink: 0,
                                  }}
                                >
                                  <Plane size={19} />
                                </Flex>
                                <Box>
                                  <Heading size="4" as="h3">
                                    {offer.airline}
                                  </Heading>
                                  <Text size="1" color="gray">
                                    {lastSearch?.cabinClass.replace('_', ' ')}
                                  </Text>
                                </Box>
                              </Flex>
                              <Flex direction="column" gap="4">
                                {(offer.journeys?.length
                                  ? offer.journeys
                                  : [
                                      {
                                        id: `${offer.id}-summary`,
                                        departure: offer.departure,
                                        arrival: offer.arrival,
                                        origin: { code: offer.origin },
                                        destination: { code: offer.destination },
                                        duration: offer.duration,
                                        stops: offer.stops,
                                      },
                                    ]
                                ).map((journey, index) => (
                                  <Box key={journey.id} data-testid="flight-journey-summary">
                                    <Text size="1" color="gray" weight="medium">
                                      {index === 0
                                        ? 'Outbound'
                                        : index === 1
                                          ? 'Return'
                                          : `Journey ${index + 1}`}
                                    </Text>
                                    <Flex align="center" gap="4" mt="1">
                                      <Flex direction="column">
                                        <Text size="5" weight="bold">
                                          {flightTime(journey.departure)}
                                        </Text>
                                        <Text size="2">{journey.origin.code}</Text>
                                        <Text size="1" color="gray">
                                          {flightDate(journey.departure)}
                                        </Text>
                                      </Flex>
                                      <Flex
                                        direction="column"
                                        align="center"
                                        gap="1"
                                        flexGrow="1"
                                        minWidth="0"
                                      >
                                        <Text size="1" color="gray">
                                          {duration(journey.duration)}
                                        </Text>
                                        <Flex align="center" gap="2" width="100%">
                                          <Box flexGrow="1">
                                            <Separator size="4" />
                                          </Box>
                                          <Plane size={13} />
                                          <Box flexGrow="1">
                                            <Separator size="4" />
                                          </Box>
                                        </Flex>
                                        <Text size="1" color="gray">
                                          {journey.stops === 0
                                            ? 'Nonstop'
                                            : `${journey.stops} stop${journey.stops === 1 ? '' : 's'}`}
                                        </Text>
                                      </Flex>
                                      <Flex direction="column" align="end">
                                        <Text size="5" weight="bold">
                                          {flightTime(journey.arrival)}
                                        </Text>
                                        <Text size="2">{journey.destination.code}</Text>
                                        <Text size="1" color="gray">
                                          {flightDate(journey.arrival)}
                                        </Text>
                                      </Flex>
                                    </Flex>
                                  </Box>
                                ))}
                              </Flex>
                            </Flex>
                            <Flex
                              direction="column"
                              gap="2"
                              align={{ initial: 'start', md: 'end' }}
                              minWidth="200px"
                            >
                              <Text size="6" weight="bold">
                                {price(offer)}
                              </Text>
                              <Text size="1" color="gray">
                                {offer.currency} · total for {lastSearch?.adults}
                              </Text>
                              <Button
                                size="3"
                                variant="soft"
                                color="gray"
                                onClick={() => setSelectedOffer(offer)}
                              >
                                View flight details <ChevronRight size={15} />
                              </Button>
                              <Button asChild size="3" variant="soft" color="gray">
                                <Link to={planLink(lastSearch, offer)}>
                                  Plan around this flight
                                  <ChevronRight size={15} />
                                </Link>
                              </Button>
                              {offer.bookingOfferId && (
                                <Button asChild size="3" variant="soft">
                                  <Link
                                    to={`/bookings/new?offer=${encodeURIComponent(offer.bookingOfferId)}`}
                                  >
                                    Review sandbox booking
                                    <ChevronRight size={14} />
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
                    Times are local to each airport. Eligible test offers support sandbox quote
                    review; confirmation depends on provider account access. Real ticket purchases
                    are not enabled.
                  </Text>
                </>
              )}
            </>
          ) : (
            !error && (
              <EmptyState
                title="A good trip begins with a little possibility."
                description={
                  integrations.flights
                    ? 'Choose your airports and dates to find flight offers. Or start with a feeling and let Tara help you find a destination.'
                    : 'Flight fares will appear here once the flight provider is connected. In the meantime, find your next destination with Tara.'
                }
                action="Find a little inspiration"
                to={planLink()}
              />
            )
          )}
        </section>
      </Box>
      {selectedOffer && (
        <FlightDetails offer={selectedOffer} onClose={() => setSelectedOffer(null)} />
      )}
    </Container>
  );
}
