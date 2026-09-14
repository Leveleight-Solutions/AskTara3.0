import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  BedDouble,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  MapPin,
  Search,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, ApiError, readableDate } from '../api';
import { useApp } from '../context';
import type { Trip } from '../../shared/types';
import { tripDestinations } from '../../shared/destinations';
import './hotel-search.css';

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
    <div className="hotel-rate-photo">
      {offer.image && !failed ? (
        <img src={offer.image} alt={offer.name} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <BedDouble size={26} aria-label="Hotel photo unavailable" />
      )}
    </div>
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
      <section className="hotel-search" aria-labelledby="hotel-search-title">
        <div className="hotel-search-header">
          <div className="hotel-search-title">
            <span className="hotel-search-icon">
              <BedDouble size={19} />
            </span>
            <div>
              <h2 id="hotel-search-title">A stay for your dates</h2>
              <p>
                Family room pricing isn’t supported yet; your itinerary can still include children.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  return (
    <section className="hotel-search" aria-labelledby="hotel-search-title">
      <div className="hotel-search-header">
        <div className="hotel-search-title">
          <span className="hotel-search-icon">
            <BedDouble size={19} />
          </span>
          <div>
            <h2 id="hotel-search-title">A stay for your dates</h2>
            <p>
              {integrations.hotels
                ? 'Check provider rates for a place to call your own.'
                : 'Live rates aren’t connected yet. Our sample stays are here for inspiration.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="hotel-search-toggle"
          aria-expanded={expanded}
          aria-controls="hotel-search-content"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Hide search' : 'View search options'}
          <ChevronDown size={16} className={expanded ? 'hotel-chevron-open' : ''} />
        </button>
      </div>
      <div id="hotel-search-content" hidden={!expanded}>
        <form className="stack-form hotel-search-form" onSubmit={search}>
          <fieldset disabled={busy} className="hotel-search-fields">
            <label className="hotel-search-destination" htmlFor="hotel-destination">
              Destination
              <select
                id="hotel-destination"
                required
                value={query.destinationId}
                onChange={(event) => change('destinationId', event.target.value)}
              >
                {destinations.map((destination) => (
                  <option value={destination.id} key={destination.id}>
                    {destination.name}, {destination.country}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="hotel-checkin">
              Check-in
              <input
                id="hotel-checkin"
                type="date"
                required
                min={afterDays(0)}
                value={query.checkin}
                onChange={(event) => change('checkin', event.target.value)}
              />
            </label>
            <label htmlFor="hotel-checkout">
              Check-out
              <input
                id="hotel-checkout"
                type="date"
                required
                min={query.checkin || afterDays(0)}
                value={query.checkout}
                onChange={(event) => change('checkout', event.target.value)}
              />
            </label>
            <label htmlFor="hotel-adults">
              Guests
              <select
                id="hotel-adults"
                value={query.adults}
                onChange={(event) => change('adults', Number(event.target.value))}
              >
                {Array.from({ length: 6 }, (_, index) => index + 1).map((adults) => (
                  <option key={adults} value={adults}>
                    {adults} adult{adults === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="hotel-nationality">
              Guest nationality
              <input
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
                onChange={(event) => change('guestNationality', event.target.value.toUpperCase())}
              />
            </label>
            <datalist id="hotel-nationalities">
              {nationalities.map(([code, country]) => (
                <option key={code} value={code}>
                  {country}
                </option>
              ))}
            </datalist>
          </fieldset>
          <div className="hotel-search-actions">
            <p id="hotel-nationality-hint">
              One room, adults only. Rates may depend on the lead guest’s nationality.
            </p>
            <button className="button button-primary" disabled={busy || !integrations.hotels}>
              {busy ? (
                <LoaderCircle size={16} className="hotel-search-spin" />
              ) : (
                <Search size={16} />
              )}{' '}
              {busy
                ? 'Checking rates…'
                : integrations.hotels
                  ? 'Check hotel rates'
                  : 'Rates not connected'}
            </button>
          </div>
        </form>
        {!integrations.hotels && (
          <div className="hotel-connection-note">
            <span>Personalize your itinerary while hotel search is being connected.</span>
            <Link to={planningLink()}>
              Plan with Tara
              <ArrowRight size={13} />
            </Link>
          </div>
        )}
        {error && (
          <p className="form-error hotel-search-error" role="alert">
            <CircleAlert size={17} />
            {error}
          </p>
        )}
        <div className="hotel-search-results" aria-busy={busy} aria-live="polite">
          {busy && (
            <div className="hotel-search-loading" role="status">
              <LoaderCircle className="hotel-search-spin" size={19} />
              <span>Finding room rates for your stay…</span>
            </div>
          )}
          {results && submitted && (
            <>
              <div className="hotel-rate-heading">
                <div>
                  <span className="eyebrow">
                    {results.mode === 'test' ? 'Sandbox rates' : 'Provider rates'}
                  </span>
                  <h3>
                    {
                      destinations.find((destination) => destination.id === submitted.destinationId)
                        ?.name
                    }
                  </h3>
                  <p>
                    {readableDate(submitted.checkin)} – {readableDate(submitted.checkout)} ·{' '}
                    {nightsFor(submitted)} night{nightsFor(submitted) === 1 ? '' : 's'} ·{' '}
                    {submitted.adults} adult{submitted.adults === 1 ? '' : 's'}
                  </p>
                </div>
                <span>
                  {results.offers.length} {results.offers.length === 1 ? 'stay' : 'stays'}
                </span>
              </div>
              {results.mode === 'test' && (
                <p className="notice hotel-sandbox-note">
                  <CircleAlert size={17} />
                  Test rates are simulated and do not establish real room availability.
                </p>
              )}
              {results.warning && <p className="hotel-provider-warning">{results.warning}</p>}
              {results.offers.length === 0 ? (
                <div className="hotel-search-empty">
                  <BedDouble size={25} />
                  <h3>No rates returned for these dates.</h3>
                  <p>Try a different stay or destination. You can also ask Tara for ideas.</p>
                  <Link to={planningLink()}>
                    Explore with Tara
                    <ArrowRight size={14} />
                  </Link>
                </div>
              ) : (
                <>
                  <div className="hotel-rate-list">
                    {results.offers.map((offer) => (
                      <article className="hotel-rate" key={offer.id}>
                        <HotelPhoto offer={offer} />
                        <div className="hotel-rate-details">
                          <h3>{offer.name}</h3>
                          {offer.address && (
                            <p className="hotel-rate-address">
                              <MapPin size={12} />
                              {offer.address}
                            </p>
                          )}
                          <p>
                            {offer.room || 'Room details not supplied'}
                            {offer.board ? ` · ${offer.board}` : ''}
                          </p>
                        </div>
                        <div className="hotel-rate-price">
                          <strong>{formatPrice(offer)}</strong>
                          <span>
                            {offer.currency} · total for {nightsFor(submitted)} night
                            {nightsFor(submitted) === 1 ? '' : 's'}
                          </span>
                          <Link to={planningLink(offer)}>
                            Plan around this stay
                            <ArrowRight size={13} />
                          </Link>
                          {offer.bookingOfferId && (
                            <Link
                              className="button button-secondary booking-offer-action"
                              to={`/bookings/new?offer=${encodeURIComponent(offer.bookingOfferId)}`}
                            >
                              Review sandbox booking
                              <ArrowRight size={13} />
                            </Link>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                  <p className="hotel-purchase-note">
                    Rate search does not reserve a room. Eligible test offers support sandbox
                    checkout with a fresh quote and cancellation terms. Real hotel purchases are not
                    enabled.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
