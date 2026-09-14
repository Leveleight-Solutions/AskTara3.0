import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Compass,
  Globe2,
  Heart,
  MapPin,
  Plane,
  Sparkles,
  Users,
  Waves,
  Mountain,
  Building2,
  Leaf,
  Coffee,
  BedDouble,
  Route,
} from 'lucide-react';
import { useApp } from '../context';
import { DestinationCard, ExperienceCard, Modal, StayCard, TaraMark } from '../components/ui';
import type { Vibe } from '../../shared/types';
import { buildTripPrompt } from '../../shared/trip-prompt';

const vibeFilters: { label: Vibe; icon: typeof Compass }[] = [
  { label: 'All places', icon: Globe2 },
  { label: 'By the water', icon: Waves },
  { label: 'City escapes', icon: Building2 },
  { label: 'Into the wild', icon: Mountain },
  { label: 'Culture & charm', icon: Compass },
];
export function TravelSketch({ kind }: { kind: 'stay' | 'flight' | 'experience' | 'discover' }) {
  return (
    <div className={`travel-sketch sketch-${kind}`} aria-hidden="true">
      {kind === 'stay' ? (
        <>
          <div className="sketch-sun" />
          <svg viewBox="0 0 120 94">
            <path d="M32 83V43a27 27 0 0 1 54 0v40M29 83h62M41 83V45a18 18 0 0 1 36 0v38M59 65v4M25 80V59m0 10c-13 0-12-11-12-11 12-1 12 11 12 11Zm0 5c12-1 12-11 12-11-11 0-12 11-12 11ZM101 83V55m0 14c-12-1-12-12-12-12 12 0 12 12 12 12Zm0-9c10-2 9-12 9-12-10 1-9 12-9 12Z" />
          </svg>
        </>
      ) : kind === 'flight' ? (
        <>
          <div className="sketch-sun" />
          <svg viewBox="0 0 120 94">
            <path d="m27 35 65-16-29 57-8-26-28-15Zm28 15 37-31M14 79c14-11 24 10 40 0s26-6 35-2M15 89c14-10 24 9 39 0s26-6 35-2" />
          </svg>
        </>
      ) : kind === 'experience' ? (
        <>
          <div className="sketch-sun" />
          <svg viewBox="0 0 120 94">
            <path d="M18 78c0-19 48-2 43-21S24 43 35 26c7-10 20-9 30-9M87 82V55m-8 0h16m-13 0-2-16h15l-3 16M67 80h29M19 35l-3 5-3-5-5-3 5-3 3-5 3 5 5 3-5 3ZM85 11l4 8 9 2-7 7 1 9-7-5-8 5 2-9-7-7 10-2 3-8Z" />
          </svg>
        </>
      ) : (
        <>
          <div className="sketch-sun" />
          <svg viewBox="0 0 120 94">
            <circle cx="59" cy="43" r="29" />
            <path d="m47 57 7-18 17-10-7 19-17 9ZM59 9V3m0 80v-7M25 43h-7m82 0h-8M12 88c22-15 33 8 54 0s26-4 37-2" />
          </svg>
        </>
      )}
    </div>
  );
}
export default function Home() {
  const { catalog } = useApp();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [vibe, setVibe] = useState<Vibe>('All places');
  const [travelers, setTravelers] = useState<number | undefined>();
  const [startDate, setStartDate] = useState('');
  const [details, setDetails] = useState(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    const query = buildTripPrompt(prompt, { travelers, startDate });
    navigate(`/studio?q=${encodeURIComponent(query)}`);
  }
  const filtered = catalog.destinations
    .filter((d) => vibe === 'All places' || d.vibe === vibe)
    .slice(0, 4);
  return (
    <>
      <section className="hero">
        <div className="hero-orbit orbit-one" />
        <div className="hero-orbit orbit-two" />
        <span className="hero-doodle doodle-left">
          <Plane size={35} strokeWidth={1} />
        </span>
        <span className="hero-doodle doodle-right">
          <Sparkles size={32} strokeWidth={1} />
        </span>
        <div className="hero-content">
          <div className="hero-kicker">
            <span className="tiny-star">✦</span> Your expertise. Tara’s assistance.
          </div>
          <h1>
            A clearer brief.
            <br />
            <span>
              A better <em>proposal.</em>
            </span>
            <svg className="heading-underline" viewBox="0 0 260 15" aria-hidden="true">
              <path d="M3 11C80 0 173 2 254 6M22 14c71-8 161-7 217-4" />
            </svg>
          </h1>
          <p className="hero-description">
            Meet Tara, your travel agent assistant.
            <br className="mobile-break" /> Shape the route. Add the details. Make it yours.
          </p>
          <form className="hero-composer" onSubmit={submit}>
            <div className="composer-input">
              <TaraMark size={25} />
              <textarea
                aria-label="Tell Tara about your trip"
                placeholder="Your client’s request, a rough route, or the notes from your last call…"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={2}
                maxLength={4000}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
            </div>
            <div className="composer-bottom">
              <div className="composer-options">
                <button type="button" onClick={() => setDetails(true)}>
                  <Users size={15} />
                  <span>{travelers ? `${travelers} travellers` : 'Who’s travelling?'}</span>
                  <ChevronDown size={12} />
                </button>
                <span className="composer-divider" />
                <button type="button" onClick={() => setDetails(true)}>
                  <CalendarDays size={15} />
                  <span>
                    {startDate
                      ? new Date(startDate + 'T12:00:00').toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })
                      : 'Add dates'}
                  </span>
                  <ChevronDown size={12} />
                </button>
              </div>
              <button
                className="composer-submit"
                disabled={!prompt.trim()}
                aria-label="Start planning your trip"
                type="submit"
              >
                <ArrowUp size={21} />
              </button>
            </div>
          </form>
          <div className="starter-prompts">
            <span>A little inspiration</span>
            <button
              onClick={() =>
                navigate('/studio?q=' + encodeURIComponent('Plan a slow 5 day escape to Bali'))
              }
            >
              Somewhere to slow down <ArrowUpRight size={12} />
            </button>
            <button
              onClick={() =>
                navigate(
                  '/studio?q=' + encodeURIComponent('Plan a food focused 4 day trip to Kyoto'),
                )
              }
            >
              Follow the food <ArrowUpRight size={12} />
            </button>
            <button
              onClick={() =>
                navigate(
                  '/studio?q=' + encodeURIComponent('Plan a 5 day adventure in the Dolomites'),
                )
              }
            >
              A little adventure <ArrowUpRight size={12} />
            </button>
          </div>
          <div className="hero-footnote">
            <span>
              <Check size={12} /> Structure first
            </span>
            <span className="dot" />
            <span>
              <Check size={12} /> Your expertise in control
            </span>
            <span className="dot" />
            <span>
              <Check size={12} /> Client-ready proposals
            </span>
          </div>
        </div>
      </section>
      <div className="home-content">
        <section className="services-strip" aria-label="Explore travel services">
          {[
            {
              kind: 'stay' as const,
              title: 'Somewhere to stay',
              desc: 'Beautiful stays with a little soul.',
              to: '/stays',
            },
            {
              kind: 'flight' as const,
              title: 'A way to get there',
              desc: 'The right flight for your journey.',
              to: '/flights',
            },
            {
              kind: 'experience' as const,
              title: 'Something to remember',
              desc: 'Little moments. Lasting memories.',
              to: '/experiences',
            },
            {
              kind: 'discover' as const,
              title: 'A new perspective',
              desc: 'Find your next somewhere.',
              to: '/explore',
            },
          ].map((s) => (
            <Link to={s.to} className="service-card" key={s.kind}>
              <TravelSketch kind={s.kind} />
              <div>
                <h3>
                  {s.title}
                  <ArrowUpRight size={15} />
                </h3>
                <p>{s.desc}</p>
              </div>
            </Link>
          ))}
        </section>
        <section className="home-section destination-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">THE WORLD IS CALLING</span>
              <h2>Where will your curiosity take you?</h2>
              <p>Places with a story. Find the one that feels like yours.</p>
            </div>
            <Link to="/explore" className="text-link">
              Explore all destinations <ArrowRight size={17} />
            </Link>
          </div>
          <div
            className="vibe-filters"
            role="group"
            aria-label="Filter destinations by travel style"
          >
            {vibeFilters.map(({ label, icon: Icon }) => (
              <button
                key={label}
                className={vibe === label ? 'active' : ''}
                onClick={() => setVibe(label)}
                aria-pressed={vibe === label}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
          <div className="cards-grid destination-grid">
            {filtered.map((d) => (
              <DestinationCard key={d.id} destination={d} />
            ))}
          </div>
        </section>
        <section className="journey-banner">
          <div className="journey-banner-copy">
            <span className="eyebrow">GOOD TRIPS START WITH A CONVERSATION</span>
            <h2>
              You dream it.
              <br />
              Tara connects the dots.
            </h2>
            <p>
              The quiet little hotel. The long lunch. The road worth taking.
              <br />
              Tell Tara what you love, and watch your trip come together.
            </p>
            <Link className="button button-primary" to="/studio">
              Let’s dream something up <Sparkles size={16} />
            </Link>
            <span className="banner-note">Your itinerary. Your pace. Your kind of wonderful.</span>
          </div>
          <div className="journey-preview" aria-hidden="true">
            <div className="mini-postcard">
              <img
                src={
                  catalog.destinations.find((d) => d.id === 'amalfi')?.image ||
                  catalog.destinations[1]?.image
                }
                alt=""
              />
              <span>Somewhere on the Amalfi Coast…</span>
            </div>
            <div className="mini-chat">
              <TaraMark size={25} />
              <span>
                “A little less rush.
                <br />A little more <em>dolce vita.</em>”
              </span>
            </div>
            <div className="mini-itinerary">
              <span className="mini-itinerary-label">
                <Route size={14} />A DAY THAT FEELS LIKE YOU
              </span>
              <div>
                <span className="mini-time">09:00</span>
                <Coffee size={15} />
                <span>A slow start, a perfect espresso</span>
              </div>
              <div>
                <span className="mini-time">11:00</span>
                <Waves size={15} />
                <span>Take the scenic route to the sea</span>
              </div>
              <div>
                <span className="mini-time">17:00</span>
                <Leaf size={15} />
                <span>Nowhere to be. Everything to see.</span>
              </div>
            </div>
            <span className="preview-sparkle">✧</span>
          </div>
        </section>
        <section className="home-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">STAY A LITTLE LONGER</span>
              <h2>A room with a point of view.</h2>
              <p>For the places that become part of the story.</p>
            </div>
            <Link to="/stays" className="text-link">
              Find your stay <ArrowRight size={17} />
            </Link>
          </div>
          <div className="cards-grid">
            {catalog.stays.slice(0, 4).map((s) => (
              <StayCard
                key={s.id}
                stay={s}
                onSelect={() => navigate(`/stays?destination=${s.destinationId}`)}
              />
            ))}
          </div>
          <p className="catalog-disclosure">
            A curated collection of sample stays. Prices are planning estimates, not live rates.
          </p>
        </section>
        <section className="home-section experience-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">COLLECT MOMENTS, NOT CHECKLISTS</span>
              <h2>The things you’ll talk about later.</h2>
              <p>Get a little closer to the places you go.</p>
            </div>
            <Link to="/experiences" className="text-link">
              Find your moment <ArrowRight size={17} />
            </Link>
          </div>
          <div className="cards-grid">
            {catalog.experiences.slice(0, 4).map((e) => (
              <ExperienceCard
                key={e.id}
                experience={e}
                onSelect={() => navigate(`/experiences?destination=${e.destinationId}`)}
              />
            ))}
          </div>
        </section>
        <section className="home-section borrowed-stories">
          <div className="section-heading">
            <div>
              <span className="eyebrow">A LITTLE INSPIRATION GOES A LONG WAY</span>
              <h2>Borrow the idea. Make it your own.</h2>
              <p>Three ways to get away. A starting point, never a script.</p>
            </div>
          </div>
          <div className="story-grid">
            {[
              {
                id: 'kyoto',
                title: 'The art of slowing down',
                label: '5 DAYS IN KYOTO',
                prompt: 'Plan a slow 5 day trip to Kyoto, with tea, temples, food and culture',
              },
              {
                id: 'amalfi',
                title: 'A week of dolce vita',
                label: '7 DAYS ON THE AMALFI COAST',
                prompt:
                  'Plan a relaxed 7 day trip to the Amalfi Coast for 2 travelers with beaches and food',
              },
              {
                id: 'marrakech',
                title: 'Follow the colors',
                label: '3 DAYS IN MARRAKECH',
                prompt: 'Plan a 3 day trip to Marrakech focused on art, food and culture',
              },
            ].map((story) => (
              <Link
                key={story.id}
                to={`/studio?q=${encodeURIComponent(story.prompt)}`}
                className="story-card"
              >
                <img
                  src={catalog.destinations.find((d) => d.id === story.id)?.image}
                  alt=""
                  loading="lazy"
                />
                <div>
                  <span className="eyebrow">{story.label}</span>
                  <h3>{story.title}</h3>
                  <span className="story-action">
                    Make this trip yours
                    <ArrowUpRight size={15} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
        <section className="final-invitation">
          <span className="invitation-star">
            <TaraMark size={32} />
          </span>
          <h2>Your next story is out there.</h2>
          <p>Let’s find it together.</p>
          <Link className="button button-primary" to="/studio">
            Ask Tara <ArrowRight size={16} />
          </Link>
        </section>
      </div>
      {details && (
        <Modal title="A few little details" onClose={() => setDetails(false)}>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              setDetails(false);
            }}
          >
            <label>
              How many travelers?
              <input
                type="number"
                min={1}
                max={9}
                value={travelers ?? ''}
                placeholder="Not sure yet"
                onChange={(e) => setTravelers(e.target.value ? Number(e.target.value) : undefined)}
              />
            </label>
            <label>
              When would you like to go?
              <input
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <p className="muted">
              Leave anything undecided blank. Tara will ask what she needs to know.
            </p>
            <button className="button button-primary">
              Sounds good <Check size={16} />
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
