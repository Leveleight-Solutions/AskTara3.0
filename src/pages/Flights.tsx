import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  Plane,
  Search,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
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
import './flights.css';

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
    <div className="page-container flights-page">
      <div className="page-intro flights-intro">
        <div>
          <span className="eyebrow">A window seat to somewhere new</span>
          <h1>
            Your next chapter,
            <br />
            <em>a flight away.</em>
          </h1>
          <p>Find a way there. Let Tara take care of the inspiration.</p>
        </div>
        <div
          className={`flight-connection ${integrations.flights ? 'flight-connection-ready' : ''}`}
        >
          <span className="flight-connection-dot" />
          {integrations.flights ? 'Flight provider connected' : 'Flight search awaiting connection'}
        </div>
      </div>

      <section className="flight-search-panel" aria-labelledby="flight-search-heading">
        <div className="flight-search-heading">
          <h2 id="flight-search-heading">
            <Plane size={19} />
            Find your flight
          </h2>
          <span>Every journey starts somewhere.</span>
        </div>
        <form onSubmit={search} className="stack-form flight-search-form">
          <fieldset disabled={busy} className="flight-fields">
            <div className="flight-trip-types" role="group" aria-label="Journey type">
              <button
                type="button"
                aria-pressed={roundTrip}
                className={roundTrip ? 'selected' : ''}
                onClick={() => {
                  setRoundTrip(true);
                  setError('');
                }}
              >
                {roundTrip && <Check size={13} />}Round trip
              </button>
              <button
                type="button"
                aria-pressed={!roundTrip}
                className={!roundTrip ? 'selected' : ''}
                onClick={() => {
                  setRoundTrip(false);
                  setError('');
                }}
              >
                {!roundTrip && <Check size={13} />}One way
              </button>
            </div>
            <div className="flight-route-fields">
              <label htmlFor="flight-origin">
                From
                <input
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
              <button
                type="button"
                className="icon-button flight-swap"
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
              </button>
              <label htmlFor="flight-destination">
                To
                <input
                  id="flight-destination"
                  list="flight-airports"
                  placeholder="e.g. LHR · London"
                  required
                  autoComplete="off"
                  value={form.destination}
                  maxLength={3}
                  pattern="[A-Za-z]{3}"
                  title="Enter a three-letter airport code, such as LHR"
                  onChange={(event) => update('destination', event.target.value.toUpperCase())}
                />
              </label>
            </div>
            <datalist id="flight-airports">
              {airports.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </datalist>
            <div className="flight-detail-fields">
              <label htmlFor="flight-departure">
                Departure
                <input
                  id="flight-departure"
                  type="date"
                  required
                  min={futureDate(0)}
                  value={form.departureDate}
                  onChange={(event) => update('departureDate', event.target.value)}
                />
              </label>
              {roundTrip && (
                <label htmlFor="flight-return">
                  Return
                  <input
                    id="flight-return"
                    type="date"
                    required
                    min={form.departureDate || futureDate(0)}
                    value={form.returnDate || ''}
                    onChange={(event) => update('returnDate', event.target.value)}
                  />
                </label>
              )}
              <label htmlFor="flight-adults">
                Travelers
                <select
                  id="flight-adults"
                  value={form.adults}
                  onChange={(event) => update('adults', Number(event.target.value))}
                >
                  {Array.from({ length: 9 }, (_, index) => index + 1).map((number) => (
                    <option key={number} value={number}>
                      {number} adult{number > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="flight-cabin">
                Cabin
                <select
                  id="flight-cabin"
                  value={form.cabinClass}
                  onChange={(event) => update('cabinClass', event.target.value)}
                >
                  <option value="economy">Economy</option>
                  <option value="premium_economy">Premium economy</option>
                  <option value="business">Business</option>
                  <option value="first">First</option>
                </select>
              </label>
            </div>
          </fieldset>
          <div className="flight-search-bottom">
            <p>
              Searching for adults. For a trip with children,{' '}
              <Link to="/chat?q=Help%20me%20plan%20a%20family%20trip">start with Tara</Link>.
            </p>
            <button type="submit" disabled={busy} className="button button-primary">
              {busy ? <LoaderCircle size={17} className="flight-spin" /> : <Search size={17} />}{' '}
              {busy ? 'Searching flights…' : 'Search flights'}
            </button>
          </div>
        </form>
      </section>

      {error && (
        <div className="form-error flight-error" role="alert">
          <CircleAlert size={19} />
          <div>
            <p>{error}</p>
            <Link to={planLink(lastSearch)}>
              Plan with Tara
              <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}

      <section className="flight-results" aria-label="Flight search results" aria-busy={busy}>
        {busy ? (
          <div className="flight-empty" role="status">
            <div className="flight-empty-icon">
              <LoaderCircle className="flight-spin" size={27} />
            </div>
            <h2>Finding your way there.</h2>
            <p>Checking flight offers for your dates and travelers.</p>
          </div>
        ) : result ? (
          <>
            {(result.mode === 'test' || result.warning) && (
              <div className="notice flight-result-notice" role="status">
                <CircleAlert size={18} />
                <div>
                  {result.mode === 'test' && (
                    <strong>Test results · simulated flights and prices</strong>
                  )}
                  <p>
                    {result.warning ||
                      'These offers come from the provider’s test environment and cannot be used as real travel availability.'}
                  </p>
                </div>
              </div>
            )}
            <div className="flight-results-heading">
              <div>
                <span className="eyebrow">
                  {result.mode === 'test' ? 'Provider sandbox' : 'Flight offers'}
                </span>
                <h2>
                  {lastSearch?.origin} <ArrowRight size={20} /> {lastSearch?.destination}
                </h2>
                <p>
                  {flightDate(lastSearch?.departureDate || '')}
                  {lastSearch?.returnDate
                    ? ` – ${flightDate(lastSearch.returnDate)}`
                    : ' · One way'}{' '}
                  · {lastSearch?.adults} adult{lastSearch?.adults === 1 ? '' : 's'}
                </p>
              </div>
              <span>
                {result.offers.length} {result.offers.length === 1 ? 'option' : 'options'}
              </span>
            </div>
            {result.offers.length === 0 ? (
              <div className="flight-empty">
                <div className="flight-empty-icon">
                  <Search size={27} />
                </div>
                <h2>A little flexibility goes a long way.</h2>
                <p>
                  No offers were returned for this search. Try another date or a nearby airport.
                </p>
                <Link to={planLink(lastSearch)} className="button">
                  Explore ideas with Tara
                  <ArrowRight size={16} />
                </Link>
              </div>
            ) : (
              <>
                <p className="flight-results-note">
                  {lastSearch?.returnDate
                    ? 'Prices cover outbound and return journeys for all travelers.'
                    : 'Prices cover all travelers in this search.'}{' '}
                  Offers can change; no reservation has been made.
                </p>
                <div className="flight-offer-list">
                  {result.offers.map((offer) => (
                    <article className="flight-offer" key={offer.id}>
                      <div className="flight-airline">
                        <div className="flight-airline-icon">
                          <Plane size={19} />
                        </div>
                        <div>
                          <h3>{offer.airline}</h3>
                          <span>{lastSearch?.cabinClass.replace('_', ' ')}</span>
                        </div>
                      </div>
                      <div className="flight-journey-summaries">
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
                          <div className="flight-journey-summary" key={journey.id}>
                            <span className="flight-journey-label">
                              {index === 0
                                ? 'Outbound'
                                : index === 1
                                  ? 'Return'
                                  : `Journey ${index + 1}`}
                            </span>
                            <div className="flight-timeline">
                              <div className="flight-airport">
                                <strong>{flightTime(journey.departure)}</strong>
                                <span>{journey.origin.code}</span>
                                <small>{flightDate(journey.departure)}</small>
                              </div>
                              <div className="flight-route-line">
                                <span>{duration(journey.duration)}</span>
                                <div>
                                  <i />
                                  <Plane size={13} />
                                  <i />
                                </div>
                                <small>
                                  {journey.stops === 0
                                    ? 'Nonstop'
                                    : `${journey.stops} stop${journey.stops === 1 ? '' : 's'}`}
                                </small>
                              </div>
                              <div className="flight-airport flight-airport-end">
                                <strong>{flightTime(journey.arrival)}</strong>
                                <span>{journey.destination.code}</span>
                                <small>{flightDate(journey.arrival)}</small>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flight-offer-price">
                        <strong>{price(offer)}</strong>
                        <span>
                          {offer.currency} · total for {lastSearch?.adults}
                        </span>
                        <button
                          className="flight-details-button"
                          onClick={() => setSelectedOffer(offer)}
                        >
                          View flight details <ChevronRight size={15} />
                        </button>
                        <Link to={planLink(lastSearch, offer)}>
                          Plan around this flight
                          <ChevronRight size={15} />
                        </Link>
                        {offer.bookingOfferId && (
                          <Link
                            className="button button-secondary booking-offer-action"
                            to={`/bookings/new?offer=${encodeURIComponent(offer.bookingOfferId)}`}
                          >
                            Review sandbox booking
                            <ChevronRight size={14} />
                          </Link>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
                <p className="flight-results-footnote">
                  Times are local to each airport. Eligible test offers support sandbox quote
                  review; confirmation depends on provider account access. Real ticket purchases are
                  not enabled.
                </p>
              </>
            )}
          </>
        ) : (
          !error && (
            <div className="flight-empty">
              <div className="flight-empty-icon">
                <Plane size={27} />
              </div>
              <h2>A good trip begins with a little possibility.</h2>
              <p>
                {integrations.flights
                  ? 'Choose your airports and dates to find flight offers. Or start with a feeling and let Tara help you find a destination.'
                  : 'Flight fares will appear here once the flight provider is connected. In the meantime, find your next destination with Tara.'}
              </p>
              <Link to={planLink()} className="button flight-inspiration-link">
                <Sparkles size={16} />
                Find a little inspiration
                <ArrowRight size={16} />
              </Link>
            </div>
          )
        )}
      </section>
      {selectedOffer && (
        <FlightDetails offer={selectedOffer} onClose={() => setSelectedOffer(null)} />
      )}
    </div>
  );
}
