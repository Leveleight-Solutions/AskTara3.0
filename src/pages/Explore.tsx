import { useCallback, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BedDouble,
  Building2,
  CalendarDays,
  Check,
  Clock3,
  Compass,
  Globe2,
  Heart,
  MapPin,
  Mountain,
  Plane,
  Search,
  SlidersHorizontal,
  Sparkles,
  Wallet,
  Waves,
  X,
} from 'lucide-react';
import type { Experience, Stay, Vibe } from '../../shared/types';
import { money } from '../api';
import { useApp } from '../context';
import {
  DestinationCard,
  EmptyState,
  ExperienceCard,
  Modal,
  SaveButton,
  StayCard,
  TaraMark,
} from '../components/ui';
import HotelSearch from '../components/HotelSearch';
import { AddToTripDialog } from '../components/AddToTripDialog';
import './explore.css';

const vibes: { label: Vibe; icon: typeof Compass }[] = [
  { label: 'All places', icon: Globe2 },
  { label: 'By the water', icon: Waves },
  { label: 'City escapes', icon: Building2 },
  { label: 'Into the wild', icon: Mountain },
  { label: 'Culture & charm', icon: Compass },
];
const matches = (text: string, query: string) =>
  text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
type SelectedListing = { kind: 'stay'; item: Stay } | { kind: 'experience'; item: Experience };

function ListingDetail({
  selection,
  onClose,
}: {
  selection: SelectedListing;
  onClose: () => void;
}) {
  const { catalog } = useApp();
  const [adding, setAdding] = useState(false);
  const backToIdea = useCallback(() => setAdding(false), []);
  const item = selection.item;
  const destination = catalog.destinations.find((d) => d.id === item.destinationId)!;
  const isStay = selection.kind === 'stay';
  const prompt = isStay
    ? `Plan a trip to ${destination.name} with a ${(item as Stay).style.toLowerCase()} stay and a relaxed pace`
    : `Plan a trip to ${destination.name} including ${item.name.toLowerCase()}`;
  const search = isStay
    ? `${(item as Stay).style} in ${destination.name}`
    : `${item.name} ${destination.name} tours`;
  if (adding) return <AddToTripDialog selection={selection} onClose={backToIdea} />;
  return (
    <Modal title={item.name} onClose={onClose} wide>
      <div className="listing-detail">
        <div className="listing-detail-photo">
          <img
            src={item.image}
            alt={`${isStay ? 'Stay' : 'Travel'} inspiration for ${destination.name}`}
          />
          <SaveButton type={selection.kind} id={item.id} label={item.name} />
          <span>Sample inspiration</span>
        </div>
        <div className="listing-detail-content">
          <p className="listing-location">
            <MapPin size={15} />
            {destination.name}, {destination.country}
          </p>
          <p className="listing-description">
            {item.description.replace(/^Sample (stay inspiration|itinerary idea): /, '')}
          </p>
          <div className="listing-facts">
            <div>
              <Wallet size={18} />
              <span>
                <small>Planning estimate</small>
                <strong>
                  {money(item.price)} <span className="muted">/ {isStay ? 'night' : 'person'}</span>
                </strong>
              </span>
            </div>
            <div>
              {isStay ? <BedDouble size={18} /> : <Clock3 size={18} />}
              <span>
                <small>{isStay ? 'The feeling' : 'Time to enjoy it'}</small>
                <strong>{isStay ? (item as Stay).style : (item as Experience).duration}</strong>
              </span>
            </div>
          </div>
          {isStay && (
            <div className="listing-amenities">
              {(item as Stay).amenities.map((a) => (
                <span key={a}>
                  <Check size={14} />
                  {a}
                </span>
              ))}
            </div>
          )}
          <p className="notice listing-notice">
            {isStay
              ? 'This is a fictional stay concept to help you shape your trip. Photos illustrate the style; no room inventory, guest reviews, or reservations are offered.'
              : 'This is a curated itinerary idea, not an available tour or a confirmed booking.'}{' '}
            Prices are illustrative USD estimates. Confirm current prices and availability directly
            with a provider.
          </p>
          <div className="listing-actions">
            <button className="button button-primary" onClick={() => setAdding(true)}>
              Add to an existing trip
              <CalendarDays size={16} />
            </button>
            <Link
              className="button button-secondary"
              to={`/chat?q=${encodeURIComponent(prompt)}`}
              onClick={onClose}
            >
              Plan around this
              <Sparkles size={16} />
            </Link>
            <a
              className="button button-secondary"
              href={`https://www.google.com/search?q=${encodeURIComponent(search)}`}
              target="_blank"
              rel="noreferrer"
            >
              Find real options
              <ArrowUpRight size={16} />
            </a>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function Explore() {
  const { catalog } = useApp();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const vibe = vibes.some((v) => v.label === params.get('vibe'))
    ? (params.get('vibe') as Vibe)
    : 'All places';
  const region = params.get('region') || 'all';
  const regions = useMemo(
    () => [...new Set(catalog.destinations.map((d) => d.region))].sort(),
    [catalog],
  );
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === 'all' || value === 'All places') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }
  const destinations = catalog.destinations.filter(
    (d) =>
      (vibe === 'All places' || d.vibe === vibe) &&
      (region === 'all' || d.region === region) &&
      matches(`${d.name} ${d.country} ${d.description} ${d.tags.join(' ')}`, query),
  );
  const filtered = Boolean(query || vibe !== 'All places' || region !== 'all');
  return (
    <div className="page-container explore-page">
      <div className="page-intro">
        <span className="eyebrow">LET CURIOSITY LEAD THE WAY</span>
        <h1>Your next somewhere.</h1>
        <p>A change of scene. A different rhythm. Find a place that speaks to you.</p>
      </div>
      <nav className="explore-nav" aria-label="Discover travel">
        <Link className="active" to="/explore" aria-current="page">
          <Globe2 size={17} />
          Destinations
        </Link>
        <Link to="/flights">
          <Plane size={17} />
          Flights
        </Link>
        <Link to="/stays">
          <BedDouble size={17} />
          Stays
        </Link>
        <Link to="/experiences">
          <Sparkles size={17} />
          Experiences
        </Link>
      </nav>
      <div className="explore-toolbar">
        <label className="explore-search">
          <Search size={18} />
          <input
            aria-label="Search destinations"
            placeholder="A country, a city, a feeling…"
            value={query}
            onChange={(e) => filter('q', e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="icon-button"
              aria-label="Clear search"
              onClick={() => filter('q', '')}
            >
              <X size={16} />
            </button>
          )}
        </label>
        <label className="explore-region">
          <SlidersHorizontal size={16} />
          <span className="sr-only">Filter by region</span>
          <select value={region} onChange={(e) => filter('region', e.target.value)}>
            <option value="all">All regions</option>
            {regions.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="vibe-filters explore-vibes" role="group" aria-label="Travel style">
        {vibes.map(({ label, icon: Icon }) => (
          <button
            key={label}
            className={vibe === label ? 'active' : ''}
            aria-pressed={vibe === label}
            onClick={() => filter('vibe', label)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      <div className="collection-count">
        <span aria-live="polite">
          {destinations.length} {destinations.length === 1 ? 'place' : 'places'} to get lost in
        </span>
        {filtered && (
          <button type="button" onClick={() => setParams({})}>
            Reset filters
            <X size={13} />
          </button>
        )}
      </div>
      {destinations.length > 0 ? (
        <div className="cards-grid explore-grid">
          {destinations.map((d) => (
            <DestinationCard key={d.id} destination={d} />
          ))}
        </div>
      ) : (
        <div className="explore-empty">
          <Search size={28} />
          <h2>A little further off the map.</h2>
          <p>Try another destination or clear a filter to see more places.</p>
          <button className="button button-secondary" onClick={() => setParams({})}>
            Show all destinations
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      <div className="explore-invitation">
        <TaraMark size={30} />
        <div>
          <h3>Not sure where, but ready to go?</h3>
          <p>Tell Tara what a perfect day feels like. Start from there.</p>
        </div>
        <Link className="button button-primary" to="/chat">
          Find my kind of place
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}

export function DestinationDetail() {
  const { id } = useParams();
  const { catalog } = useApp();
  const [selection, setSelection] = useState<SelectedListing | null>(null);
  const close = useCallback(() => setSelection(null), []);
  const destination = catalog.destinations.find((d) => d.id === id);
  if (!destination) return <NotFound />;
  const stays = catalog.stays.filter((s) => s.destinationId === id);
  const experiences = catalog.experiences.filter((e) => e.destinationId === id);
  const nearby = catalog.destinations
    .filter((d) => d.id !== id && (d.vibe === destination.vibe || d.region === destination.region))
    .slice(0, 4);
  return (
    <div className="page-container destination-detail-page">
      <Link to="/explore" className="back-link">
        <ArrowLeft size={16} />
        All destinations
      </Link>
      <div className="destination-cover">
        <img src={destination.image} alt={`${destination.name}, ${destination.country}`} />
        <div className="destination-cover-shade" />
        <SaveButton type="destination" id={destination.id} label={destination.name} />
        <div className="destination-cover-content">
          <span className="eyebrow">
            {destination.country} · {destination.region}
          </span>
          <h1>{destination.name}</h1>
          <p>{destination.description}</p>
        </div>
      </div>
      <div className="destination-overview">
        <div className="destination-story">
          <span className="eyebrow">A LITTLE INTRODUCTION</span>
          <h2>A place to make your own.</h2>
          <p>{destination.longDescription}</p>
          <div className="destination-tags">
            {destination.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </div>
        <aside className="destination-at-a-glance">
          <h3>The little details</h3>
          <div>
            <CalendarDays size={19} />
            <span>
              <small>A lovely time to visit</small>
              <strong>{destination.bestTime}</strong>
            </span>
          </div>
          <div>
            <Wallet size={19} />
            <span>
              <small>Indicative daily budget</small>
              <strong>
                {money(destination.dailyBudget)} <span className="muted">/ person</span>
              </strong>
            </span>
          </div>
          <p className="budget-note">
            A starting estimate in USD for stays, meals, and exploring. Flights are extra; season
            and travel style change the total.
          </p>
          <Link
            className="button button-primary full-width"
            to={`/chat?q=${encodeURIComponent(`Plan a 5 day trip to ${destination.name}`)}`}
          >
            Plan this trip
            <Sparkles size={16} />
          </Link>
        </aside>
      </div>
      <section className="destination-highlights">
        <div className="section-heading">
          <div>
            <span className="eyebrow">A FEW REASONS TO GO</span>
            <h2>Make room for a little wonder.</h2>
            <p>Starting points for your story. Leave space for what you find along the way.</p>
          </div>
        </div>
        <div className="highlight-grid">
          {destination.highlights.map((highlight, i) => (
            <a
              key={highlight}
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${highlight}, ${destination.name}`)}`}
              target="_blank"
              rel="noreferrer"
              className="highlight-item"
            >
              <span className="highlight-number">{String(i + 1).padStart(2, '0')}</span>
              <span>{highlight}</span>
              <ArrowUpRight size={16} />
            </a>
          ))}
        </div>
      </section>
      {(stays.length > 0 || experiences.length > 0) && (
        <section className="destination-ideas">
          <div className="section-heading">
            <div>
              <span className="eyebrow">PIECE IT TOGETHER</span>
              <h2>Little things to build a trip around.</h2>
              <p>Sample stays and experiences to spark an idea.</p>
            </div>
          </div>
          <div className="destination-ideas-grid">
            {stays.map((s) => (
              <StayCard
                key={s.id}
                stay={s}
                onSelect={() => setSelection({ kind: 'stay', item: s })}
              />
            ))}
            {experiences.map((e) => (
              <ExperienceCard
                key={e.id}
                experience={e}
                onSelect={() => setSelection({ kind: 'experience', item: e })}
              />
            ))}
            <div className="destination-plan-card">
              <TaraMark size={34} />
              <h3>
                Your trip.
                <br />
                Your kind of wonderful.
              </h3>
              <p>
                Tell Tara your dates, your pace, and the things you love. Bring it all together in
                one plan.
              </p>
              <Link
                className="button button-secondary"
                to={`/chat?q=${encodeURIComponent(`Help me plan a trip to ${destination.name}`)}`}
              >
                Let’s make a plan
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </section>
      )}
      {nearby.length > 0 && (
        <section className="destination-more">
          <div className="section-heading">
            <div>
              <span className="eyebrow">KEEP THE CURIOSITY GOING</span>
              <h2>Another place, another possibility.</h2>
            </div>
            <Link className="text-link" to="/explore">
              Explore the collection
              <ArrowRight size={16} />
            </Link>
          </div>
          <div className="cards-grid">
            {nearby.map((d) => (
              <DestinationCard key={d.id} destination={d} />
            ))}
          </div>
        </section>
      )}
      {selection && <ListingDetail selection={selection} onClose={close} />}
    </div>
  );
}

export function Collection({ kind }: { kind: 'stays' | 'experiences' }) {
  const { catalog } = useApp();
  const [params, setParams] = useSearchParams();
  const [selection, setSelection] = useState<SelectedListing | null>(null);
  const close = useCallback(() => setSelection(null), []);
  const destinationId = params.get('destination') || 'all';
  const query = params.get('q') || '';
  const isStays = kind === 'stays';
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }
  function visible(item: Stay | Experience) {
    const destination = catalog.destinations.find((d) => d.id === item.destinationId);
    return (
      (destinationId === 'all' || item.destinationId === destinationId) &&
      matches(
        `${item.name} ${item.description} ${destination?.name} ${destination?.country} ${'style' in item ? item.style : item.category}`,
        query,
      )
    );
  }
  const stays = catalog.stays.filter(visible);
  const experiences = catalog.experiences.filter(visible);
  const count = isStays ? stays.length : experiences.length;
  return (
    <div className="page-container collection-page">
      <div className="page-intro">
        <span className="eyebrow">
          {isStays ? 'MORE THAN A PLACE TO SLEEP' : 'COLLECT A FEW GOOD STORIES'}
        </span>
        <h1>{isStays ? 'Stay somewhere wonderful.' : 'The moments that stay with you.'}</h1>
        <p>
          {isStays
            ? 'A courtyard. A mountain view. A room that feels like part of the journey.'
            : 'A taste of somewhere new. A different view. A little closer to the places you go.'}
        </p>
      </div>
      <nav className="explore-nav" aria-label="Discover travel">
        <Link to="/explore">
          <Globe2 size={17} />
          Destinations
        </Link>
        <Link to="/flights">
          <Plane size={17} />
          Flights
        </Link>
        <Link
          className={isStays ? 'active' : ''}
          to="/stays"
          aria-current={isStays ? 'page' : undefined}
        >
          <BedDouble size={17} />
          Stays
        </Link>
        <Link
          className={!isStays ? 'active' : ''}
          to="/experiences"
          aria-current={!isStays ? 'page' : undefined}
        >
          <Sparkles size={17} />
          Experiences
        </Link>
      </nav>
      {isStays && (
        <HotelSearch destinationId={destinationId === 'all' ? undefined : destinationId} />
      )}
      <div className="explore-toolbar">
        <label className="explore-search">
          <Search size={18} />
          <input
            aria-label={`Search ${kind}`}
            placeholder={
              isStays ? 'A hideaway, an island, a city…' : 'Food, culture, a little adventure…'
            }
            value={query}
            onChange={(e) => filter('q', e.target.value)}
          />
          {query && (
            <button
              className="icon-button"
              aria-label="Clear search"
              onClick={() => filter('q', '')}
            >
              <X size={16} />
            </button>
          )}
        </label>
        <label className="explore-region">
          <MapPin size={16} />
          <span className="sr-only">Filter by destination</span>
          <select value={destinationId} onChange={(e) => filter('destination', e.target.value)}>
            <option value="all">All destinations</option>
            {catalog.destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="collection-count">
        <span aria-live="polite">
          {count}{' '}
          {isStays ? (count === 1 ? 'stay' : 'stays') : count === 1 ? 'experience' : 'experiences'}{' '}
          to inspire you
        </span>
        {(query || destinationId !== 'all') && (
          <button onClick={() => setParams({})}>
            Reset filters
            <X size={13} />
          </button>
        )}
      </div>
      <p className="collection-disclosure">
        {isStays
          ? 'An inspiration collection of fictional stays. Photos illustrate a style; prices are estimates, not live room rates.'
          : 'Curated itinerary ideas with indicative prices. These are sample experiences, not bookable tours.'}
      </p>
      {count ? (
        <div className="cards-grid explore-grid">
          {isStays
            ? stays.map((s) => (
                <StayCard
                  key={s.id}
                  stay={s}
                  onSelect={() => setSelection({ kind: 'stay', item: s })}
                />
              ))
            : experiences.map((e) => (
                <ExperienceCard
                  key={e.id}
                  experience={e}
                  onSelect={() => setSelection({ kind: 'experience', item: e })}
                />
              ))}
        </div>
      ) : (
        <div className="explore-empty">
          <Search size={28} />
          <h2>Let’s try a different direction.</h2>
          <p>Clear a filter or try another search to find your next idea.</p>
          <button className="button button-secondary" onClick={() => setParams({})}>
            Show all {kind}
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      {selection && <ListingDetail selection={selection} onClose={close} />}
    </div>
  );
}

export function Saved() {
  const { catalog, saved, user, openAuth } = useApp();
  const [tab, setTab] = useState<'all' | 'destination' | 'stay' | 'experience'>('all');
  const [selection, setSelection] = useState<SelectedListing | null>(null);
  const close = useCallback(() => setSelection(null), []);
  const items = saved.filter((s) => tab === 'all' || s.type === tab);
  const tabs = [
    { value: 'all' as const, label: 'Everything', icon: Heart },
    { value: 'destination' as const, label: 'Destinations', icon: Globe2 },
    { value: 'stay' as const, label: 'Stays', icon: BedDouble },
    { value: 'experience' as const, label: 'Experiences', icon: Sparkles },
  ];
  return (
    <div className="page-container saved-page">
      <div className="page-intro">
        <span className="eyebrow">A LITTLE INSPIRATION, KEPT CLOSE</span>
        <h1>Your someday starts here.</h1>
        <p>The places you love. The things you want to do. Save them now, make a story later.</p>
      </div>
      {!user && saved.length > 0 && (
        <div className="saved-account-note">
          <Heart size={19} />
          <span>
            Your wishlist is saved in this browser. Create an account to keep it with you.
          </span>
          <button className="text-link" onClick={openAuth}>
            Sign in or join
            <ArrowRight size={15} />
          </button>
        </div>
      )}
      <div className="vibe-filters saved-tabs" role="group" aria-label="Filter wishlist">
        {tabs.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            className={tab === value ? 'active' : ''}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            <Icon size={15} />
            {label}
            <span className="saved-tab-count">
              {value === 'all' ? saved.length : saved.filter((s) => s.type === value).length}
            </span>
          </button>
        ))}
      </div>
      {items.length ? (
        <div className="cards-grid explore-grid">
          {items.map((item) => {
            if (item.type === 'destination') {
              const d = catalog.destinations.find((d) => d.id === item.itemId);
              return d ? <DestinationCard key={item.id} destination={d} /> : null;
            }
            if (item.type === 'stay') {
              const s = catalog.stays.find((s) => s.id === item.itemId);
              return s ? (
                <StayCard
                  key={item.id}
                  stay={s}
                  onSelect={() => setSelection({ kind: 'stay', item: s })}
                />
              ) : null;
            }
            const e = catalog.experiences.find((e) => e.id === item.itemId);
            return e ? (
              <ExperienceCard
                key={item.id}
                experience={e}
                onSelect={() => setSelection({ kind: 'experience', item: e })}
              />
            ) : null;
          })}
        </div>
      ) : (
        <EmptyState
          title={
            tab === 'all' ? 'A blank page, full of possibility.' : 'A little room for inspiration.'
          }
          description={
            tab === 'all'
              ? 'Tap the heart on a place, stay, or experience that catches your eye. It will be waiting for you here.'
              : `Your saved ${tab === 'destination' ? 'destinations' : `${tab}s`} will appear here. Find something that feels like you.`
          }
          action={
            tab === 'stay'
              ? 'Explore stays'
              : tab === 'experience'
                ? 'Explore experiences'
                : 'Find your next somewhere'
          }
          to={tab === 'stay' ? '/stays' : tab === 'experience' ? '/experiences' : '/explore'}
        />
      )}
      {selection && <ListingDetail selection={selection} onClose={close} />}
    </div>
  );
}

export function NotFound() {
  return (
    <div className="page-container not-found-page">
      <EmptyState
        title="A little off the beaten path."
        description="This page isn’t here, but there’s a whole world waiting to be explored."
        action="Back to discovering"
        to="/explore"
      />
    </div>
  );
}
