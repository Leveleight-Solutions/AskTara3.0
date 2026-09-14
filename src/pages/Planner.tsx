import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock3,
  Coffee,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Leaf,
  Link2,
  List,
  LoaderCircle,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Send,
  Share2,
  Sparkles,
  Trash2,
  Users,
  Wallet,
  X,
  BedDouble,
  Plane,
  Globe2,
  History,
  LockKeyhole,
  LockKeyholeOpen,
} from 'lucide-react';
import type { ItineraryItem, Trip } from '../../shared/types';
import { findDestination, tripDestinations } from '../../shared/destinations';
import { api, money, readableDate } from '../api';
import { useApp } from '../context';
import { EmptyState, Modal, Spinner, TaraMark } from '../components/ui';
import type { PlanningPlace, PlanningRun } from '../../shared/planning';
import {
  BriefFields,
  defaultBrief,
  PlaceDetails,
  PlanningProgress,
  PlanningReview,
  RevisionHistory,
  serviceLabels,
} from '../components/PlanningDetails';
import { getConsultation } from '../../shared/consultation';
import { usePlanningRun } from '../usePlanningRun';
import { useFreshPlaces } from '../useFreshPlaces';
import ItineraryMap from '../components/ItineraryMap';
import MarkdownText, { safeWebUrl } from '../components/MarkdownText';
import ConciergeMessage from '../components/ConciergeMessage';
import ConsultationSummary, { consultationBudget } from '../components/ConsultationSummary';
import HotelSearch from '../components/HotelSearch';
import './planner.css';

const categoryIcons = {
  food: Coffee,
  sight: MapPin,
  experience: Sparkles,
  stay: BedDouble,
  leisure: Leaf,
};
function TripSettings({
  trip,
  onClose,
  onUpdate,
}: {
  trip: Trip;
  onClose: () => void;
  onUpdate: (trip: Trip) => void;
}) {
  const consultation = getConsultation(trip);
  const [values, setValues] = useState({
    title: trip.title,
    startDate: consultation.facts.dates?.valueState === 'specified' ? trip.startDate : '',
    days: consultation.facts.duration?.valueState === 'specified' ? trip.days : ('' as number | ''),
    travelers:
      consultation.facts.travelers?.valueState === 'specified'
        ? trip.travelers
        : ('' as number | ''),
    budget:
      consultation.facts.budget?.valueState === 'specified' ? trip.budget : ('' as number | ''),
    brief: { ...defaultBrief, ...trip.brief, consultation },
  });
  const edited = useRef(new Set<keyof typeof values>());
  function updateValues(patch: Partial<typeof values>) {
    for (const key of Object.keys(patch) as (keyof typeof values)[]) edited.current.add(key);
    setValues((current) => ({ ...current, ...patch }));
  }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const changes = Object.fromEntries(
        [...edited.current]
          .filter((key) => !(['days', 'travelers', 'budget'].includes(key) && values[key] === ''))
          .map((key) => [key, values[key]]),
      );
      if (!Object.keys(changes).length) {
        onClose();
        return;
      }
      const result = await api<{ trip: Trip }>(`/trips/${trip.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...changes, revision: trip.revision ?? 0 }),
      });
      onUpdate(result.trip);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Make it your kind of trip" onClose={onClose}>
      <form className="stack-form" onSubmit={save}>
        <label>
          Trip name
          <input
            required
            maxLength={120}
            value={values.title}
            onChange={(e) => updateValues({ title: e.target.value })}
          />
        </label>
        <label>
          Start date
          <input
            type="date"
            value={values.startDate}
            onChange={(e) => updateValues({ startDate: e.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            Number of days
            <input
              type="number"
              min={1}
              max={21}
              value={values.days}
              placeholder="Not discussed"
              onChange={(e) => {
                const days = e.target.value ? Number(e.target.value) : '';
                updateValues({
                  days,
                  brief: {
                    ...values.brief,
                    destinationStops:
                      values.brief.destinationStops.length === 1 && days !== ''
                        ? [{ ...values.brief.destinationStops[0], days }]
                        : values.brief.destinationStops,
                  },
                });
              }}
            />
          </label>
          <label>
            Travelers
            <input
              type="number"
              min={1}
              max={16}
              value={values.travelers}
              placeholder="Not discussed"
              onChange={(e) =>
                updateValues({ travelers: e.target.value ? Number(e.target.value) : '' })
              }
            />
          </label>
        </div>
        <label>
          Total group budget ({values.brief.consultation.currency})
          <input
            type="number"
            min={0}
            max={1000000}
            value={values.budget}
            placeholder="Not discussed"
            onChange={(e) => updateValues({ budget: e.target.value ? Number(e.target.value) : '' })}
          />
        </label>
        <label>
          Budget currency
          <select
            value={values.brief.consultation.currency}
            onChange={(e) =>
              updateValues({
                brief: {
                  ...values.brief,
                  consultation: { ...values.brief.consultation, currency: e.target.value },
                },
              })
            }
          >
            {[
              ...new Set([
                'AUD',
                'USD',
                'GBP',
                'EUR',
                'CAD',
                'NZD',
                'SGD',
                'JPY',
                values.brief.consultation.currency,
              ]),
            ].map((currency) => (
              <option value={currency} key={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>
        <BriefFields
          trip={trip}
          value={values.brief}
          days={values.days || trip.days}
          onChange={(brief) =>
            updateValues({ brief: { ...brief, consultation: brief.consultation || consultation } })
          }
        />
        <p className="muted">
          Your edited stops are protected when the itinerary changes. Earlier versions are saved in
          your trip history.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save trip details'}
          <Check size={16} />
        </button>
      </form>
    </Modal>
  );
}
function ItemEditor({
  item,
  onClose,
  onSave,
}: {
  item: ItineraryItem;
  onClose: () => void;
  onSave: (item: ItineraryItem) => Promise<void>;
}) {
  const [value, setValue] = useState(item);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal title="A moment in your journey" onClose={onClose}>
      <form
        className="stack-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(value);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          What’s the plan?
          <input
            required
            maxLength={160}
            value={value.title}
            onChange={(e) => setValue({ ...value, title: e.target.value })}
          />
        </label>
        <div className="form-row">
          <label>
            Time
            <input
              type="time"
              required
              value={value.time}
              onChange={(e) => setValue({ ...value, time: e.target.value })}
            />
          </label>
          <label>
            Estimated cost / person (USD)
            <input
              type="number"
              min={0}
              max={100000}
              value={value.cost}
              onChange={(e) => setValue({ ...value, cost: Number(e.target.value) })}
            />
          </label>
        </div>
        <label>
          Duration (minutes)
          <input
            type="number"
            min={15}
            max={720}
            step={15}
            value={value.durationMinutes ?? 60}
            onChange={(e) => setValue({ ...value, durationMinutes: Number(e.target.value) })}
          />
        </label>
        <p className="muted">
          Saving a change protects this stop from automatic replanning. You can unlock it from your
          itinerary.
        </p>
        <label>
          Place
          <input
            required
            value={value.location}
            maxLength={200}
            onChange={(e) => setValue({ ...value, location: e.target.value })}
          />
        </label>
        <label>
          Category
          <select
            value={value.category}
            onChange={(e) =>
              setValue({ ...value, category: e.target.value as ItineraryItem['category'] })
            }
          >
            <option value="sight">Place to see</option>
            <option value="food">Food & drink</option>
            <option value="experience">Experience</option>
            <option value="leisure">Free time</option>
            <option value="stay">Stay</option>
          </select>
        </label>
        <label>
          A little more detail
          <textarea
            className="form-textarea"
            value={value.description}
            maxLength={1200}
            rows={3}
            onChange={(e) => setValue({ ...value, description: e.target.value })}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save this moment'}
          <Check size={16} />
        </button>
      </form>
    </Modal>
  );
}
function ShareDialog({
  trip,
  onClose,
  onUpdate,
}: {
  trip: Trip;
  onClose: () => void;
  onUpdate: (trip: Trip) => void;
}) {
  const { toast } = useApp();
  const [token, setToken] = useState(trip.shareToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = token ? `${window.location.origin}/shared/${token}` : '';
  async function enable() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ shareToken: string }>(`/trips/${trip.id}/share`, {
        method: 'POST',
      });
      setToken(result.shareToken);
      onUpdate({ ...trip, shareToken: result.shareToken });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    try {
      await api(`/trips/${trip.id}/share`, { method: 'DELETE' });
      setToken(null);
      onUpdate({ ...trip, shareToken: null });
      toast('The share link has been turned off.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Good trips are better shared." onClose={onClose}>
      <p className="modal-intro">
        Anyone with this link can view your itinerary, dates, and budget. Your conversation and
        account details stay private.
      </p>
      {token ? (
        <>
          <label className="share-url-label">
            Your trip link
            <input
              aria-label="Your trip link"
              value={url}
              readOnly
              onFocus={(e) => e.target.select()}
            />
          </label>
          <div className="share-actions">
            <button
              className="button button-primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  toast('Trip link copied.');
                } catch {
                  toast('Select and copy the link above.');
                }
              }}
            >
              <Copy size={16} />
              Copy link
            </button>
            <a className="button button-secondary" href={url} target="_blank" rel="noreferrer">
              Preview
              <ExternalLink size={15} />
            </a>
          </div>
          <button
            className="plain-button revoke-button"
            disabled={busy}
            onClick={() => void disable()}
          >
            Turn off sharing
          </button>
        </>
      ) : (
        <button
          className="button button-primary full-width"
          disabled={busy}
          onClick={() => void enable()}
        >
          {busy ? 'Creating your link…' : 'Create a share link'}
          <Link2 size={16} />
        </button>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
export function ItineraryView({
  trip,
  onUpdate,
  readOnly = false,
  disabled = false,
}: {
  trip: Trip;
  onUpdate?: (trip: Trip) => void;
  readOnly?: boolean;
  disabled?: boolean;
}) {
  const { catalog, toast } = useApp();
  const [selected, setSelected] = useState(1);
  const [settings, setSettings] = useState(false);
  const [share, setShare] = useState(false);
  const [history, setHistory] = useState(false);
  const [place, setPlace] = useState<PlanningPlace | null>(null);
  const [editing, setEditing] = useState<{
    day: number;
    item: ItineraryItem;
    isNew?: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'itinerary' | 'stays'>('itinerary');
  const destination = findDestination(trip.destinationId, trip);
  const day = trip.itinerary.find((d) => d.day === selected) || trip.itinerary[0];
  const dayDestination =
    findDestination(day?.destinationId || trip.destinationId, trip) || destination;
  const freshPlaces = useFreshPlaces(
    trip.id,
    day?.items.map((i) => i.placeId || '') || [],
    !readOnly,
  );
  const stay = catalog.stays.find((s) => s.destinationId === trip.destinationId);
  const totalActivities =
    trip.itinerary.reduce((sum, d) => sum + d.items.reduce((s, i) => s + i.cost, 0), 0) *
    trip.travelers;
  useEffect(() => {
    if (selected > trip.days) setSelected(1);
  }, [selected, trip.days]);
  const closeSettings = useCallback(() => setSettings(false), []);
  const closeShare = useCallback(() => setShare(false), []);
  const closeEditing = useCallback(() => setEditing(null), []);
  const closeHistory = useCallback(() => setHistory(false), []);
  const closePlace = useCallback(() => setPlace(null), []);
  async function patch(values: Partial<Trip>) {
    setSaving(true);
    try {
      const result = await api<{ trip: Trip }>(`/trips/${trip.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...values, revision: trip.revision ?? 0 }),
      });
      onUpdate?.(result.trip);
      return result.trip;
    } finally {
      setSaving(false);
    }
  }
  async function removeItem(dayNumber: number, id: string) {
    try {
      await patch({
        itinerary: trip.itinerary.map((d) =>
          d.day === dayNumber ? { ...d, items: d.items.filter((i) => i.id !== id) } : d,
        ),
      });
      toast('Stop removed. You can add another whenever you like.');
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function toggleComplete(dayNumber: number, id: string) {
    try {
      await patch({
        itinerary: trip.itinerary.map((d) =>
          d.day === dayNumber
            ? {
                ...d,
                items: d.items.map((i) => (i.id === id ? { ...i, completed: !i.completed } : i)),
              }
            : d,
        ),
      });
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function exportCalendar() {
    if (!trip.startDate) {
      setSettings(true);
      toast('Choose a start date to add this trip to your calendar.');
      return;
    }
    try {
      const response = await fetch(`/api/trips/${trip.id}/calendar.ics`, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Calendar export failed.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `asktara-${destination?.id || 'trip'}.ics`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Your calendar is ready. Open the file to add your itinerary.');
    } catch (e) {
      toast((e as Error).message);
    }
  }
  if (!destination || !day)
    return (
      <>
        <ConsultationSummary
          trip={trip}
          disabled={disabled}
          onSettings={readOnly ? undefined : () => setSettings(true)}
        />
        {settings && <TripSettings trip={trip} onClose={closeSettings} onUpdate={onUpdate!} />}
      </>
    );
  const locked = disabled || saving;
  return (
    <div className="itinerary-view">
      <div className="itinerary-cover">
        <img
          src={destination.image || '/images/destination-placeholder.svg'}
          alt={
            destination.image?.includes('destination-placeholder')
              ? `Illustrated landscape for ${destination.name}`
              : destination.name
          }
        />
        <div className="itinerary-cover-shade" />
        <div className="itinerary-cover-content">
          <span className="eyebrow">{destination.country} · YOUR NEXT CHAPTER</span>
          <h2>{trip.title}</h2>
          <div className="trip-cover-meta">
            <span>
              <CalendarDays size={13} />
              {trip.days} days
            </span>
            <span>
              <Users size={13} />
              {trip.travelers} travelers
            </span>
            <span>
              {trip.status === 'planned' ? (
                <>
                  <CheckCheck size={13} />
                  Ready to go
                </>
              ) : (
                <>
                  <Edit3 size={12} />A work in progress
                </>
              )}
            </span>
          </div>
        </div>
        {!readOnly && (
          <button
            className="edit-trip-button"
            disabled={locked}
            onClick={() => setSettings(true)}
            aria-label="Edit trip details"
          >
            <Edit3 size={15} />
          </button>
        )}
      </div>
      <div className="itinerary-toolbar">
        <div className="itinerary-tabs">
          <button
            className={tab === 'itinerary' ? 'active' : ''}
            onClick={() => setTab('itinerary')}
          >
            <List size={15} />
            Itinerary
          </button>
          <button className={tab === 'stays' ? 'active' : ''} onClick={() => setTab('stays')}>
            <BedDouble size={15} />
            Stays & details
          </button>
        </div>
        {!readOnly && (
          <div className="trip-tools">
            <button
              className="icon-button"
              disabled={locked}
              onClick={() => setHistory(true)}
              aria-label="Itinerary history"
            >
              <History size={16} />
            </button>
            <button
              className="icon-button"
              onClick={() => setShare(true)}
              disabled={locked}
              aria-label="Share trip"
            >
              <Share2 size={16} />
            </button>
            <button
              className="icon-button"
              onClick={() => void exportCalendar()}
              disabled={locked}
              aria-label="Export to calendar"
            >
              <Download size={16} />
            </button>
          </div>
        )}
      </div>
      {tab === 'itinerary' ? (
        <>
          <div className="day-tabs" role="group" aria-label="Itinerary days">
            {trip.itinerary.map((d) => (
              <button
                key={d.day}
                className={day.day === d.day ? 'active' : ''}
                aria-pressed={day.day === d.day}
                onClick={() => setSelected(d.day)}
              >
                Day {d.day}
              </button>
            ))}
          </div>
          <div className="day-intro">
            <div>
              <span className="eyebrow">
                {trip.startDate
                  ? readableDate(
                      new Date(
                        new Date(`${trip.startDate}T12:00:00Z`).getTime() +
                          (day.day - 1) * 86400000,
                      )
                        .toISOString()
                        .slice(0, 10),
                    )
                  : `A LITTLE ${destination.name.toUpperCase()} MAGIC`}
              </span>
              <h3>{day.title}</h3>
              <span className="day-destination">
                <MapPin size={11} />
                {dayDestination?.name}
              </span>
            </div>
            <span className="day-stop-count">{day.items.length} moments</span>
          </div>
          <ItineraryMap trip={trip} day={day} freshPlaces={freshPlaces} />
          <div className="timeline">
            {day.items.map((item) => {
              const Icon = categoryIcons[item.category];
              const fresh = item.placeId ? freshPlaces[item.placeId] : undefined;
              const visibleTitle = fresh?.name || item.title;
              return (
                <article
                  key={item.id}
                  className={`timeline-item ${item.completed ? 'completed' : ''}`}
                >
                  <div className="timeline-time">
                    <span>{item.time}</span>
                    <span className={`timeline-dot category-${item.category}`}>
                      <Icon size={14} />
                    </span>
                  </div>
                  <div className="timeline-card">
                    <div className="timeline-card-header">
                      <h4>{visibleTitle}</h4>
                      {!readOnly && (
                        <button
                          className="complete-button"
                          aria-label={`${item.completed ? 'Mark incomplete' : 'Mark complete'}: ${item.title}`}
                          aria-pressed={item.completed}
                          disabled={locked}
                          onClick={() => void toggleComplete(day.day, item.id)}
                        >
                          {item.completed ? <Check size={13} /> : <span />}
                        </button>
                      )}
                    </div>
                    <p>{item.description}</p>
                    <div className="timeline-card-bottom">
                      <a
                        href={
                          safeWebUrl(fresh?.mapsUrl) ||
                          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.location + ', ' + dayDestination?.name)}${item.placeId?.startsWith('google-') ? '&query_place_id=' + encodeURIComponent(item.placeId.slice(7)) : ''}`
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MapPin size={11} />
                        {fresh?.address || item.location}
                        <ExternalLink size={9} />
                      </a>
                      <span>{item.cost ? `${money(item.cost)} USD est.` : 'No cost added'}</span>
                    </div>
                    <div className="timeline-extra">
                      {fresh && <span className="source-badge">Google Maps</span>}
                      {trip.planning?.sources.some(
                        (source) => source.id === item.sourceId && source.kind === 'web',
                      ) && <span className="source-badge">Web research</span>}
                      {item.durationMinutes && (
                        <span>
                          <Clock3 size={11} />
                          {item.durationMinutes} min
                        </span>
                      )}
                      {!!item.travelMinutes && (
                        <span>Allow {item.travelMinutes} min to get here</span>
                      )}
                      {(trip.planning?.places.some((p) => p.id === item.placeId) ||
                        (!readOnly && item.placeId?.startsWith('google-'))) && (
                        <button
                          onClick={() =>
                            setPlace(
                              fresh ||
                                trip.planning?.places.find((p) => p.id === item.placeId) || {
                                  id: item.placeId!,
                                  name: item.title,
                                  address: item.location,
                                  destinationId: day.destinationId || trip.destinationId,
                                  category: item.category === 'stay' ? 'leisure' : item.category,
                                  durationMinutes: item.durationMinutes || 60,
                                  estimatedCost: item.cost,
                                  sourceId: item.sourceId || `google-places-${trip.destinationId}`,
                                },
                            )
                          }
                        >
                          Place details <ChevronRight size={11} />
                        </button>
                      )}
                      {readOnly && item.locked && (
                        <span>
                          <LockKeyhole size={11} />
                          Personal choice
                        </span>
                      )}
                    </div>
                    {!readOnly && (
                      <div className="timeline-edit-tools">
                        <button
                          className={item.locked ? 'stop-locked' : ''}
                          disabled={locked}
                          aria-label={`${item.locked ? 'Unlock' : 'Lock'} stop: ${item.title}`}
                          onClick={() =>
                            void patch({
                              itinerary: trip.itinerary.map((d) =>
                                d.day === day.day
                                  ? {
                                      ...d,
                                      items: d.items.map((i) =>
                                        i.id === item.id ? { ...i, locked: !i.locked } : i,
                                      ),
                                    }
                                  : d,
                              ),
                            }).catch((e) => toast(e.message))
                          }
                        >
                          {item.locked ? <LockKeyhole size={11} /> : <LockKeyholeOpen size={11} />}
                          {item.locked ? 'Protected' : 'Protect'}
                        </button>
                        <button
                          disabled={locked}
                          onClick={() => setEditing({ day: day.day, item })}
                        >
                          <Edit3 size={11} />
                          Edit
                        </button>
                        <button
                          disabled={locked}
                          aria-label={`Remove ${item.title}`}
                          onClick={() => void removeItem(day.day, item.id)}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {!readOnly && (
            <button
              className="add-moment-button"
              disabled={locked || day.items.length >= 16}
              onClick={() =>
                setEditing({
                  day: day.day,
                  isNew: true,
                  item: {
                    id: crypto.randomUUID(),
                    time: '16:00',
                    title: '',
                    description: '',
                    location: dayDestination?.name || destination.name,
                    durationMinutes: 60,
                    locked: true,
                    category: 'leisure',
                    cost: 0,
                    completed: false,
                  },
                })
              }
            >
              <Plus size={14} />
              Add a little something
            </button>
          )}
          <div className="itinerary-footnote">
            <Sparkles size={14} />
            <p>
              Leave room for the unexpected. Costs are estimates per person; check opening hours and
              book directly.
            </p>
          </div>
        </>
      ) : (
        <div className="trip-details-panel">
          <div className="trip-facts-grid">
            <div>
              <CalendarDays size={18} />
              <span>When</span>
              <strong>
                {getConsultation(trip).facts.dates
                  ? getConsultation(trip).facts.dates?.valueState === 'flexible'
                    ? 'Flexible dates'
                    : readableDate(trip.startDate)
                  : 'Not discussed'}
              </strong>
            </div>
            <div>
              <Users size={18} />
              <span>Who’s coming</span>
              <strong>
                {getConsultation(trip).facts.travelers
                  ? `${trip.travelers} travellers`
                  : 'Not discussed'}
              </strong>
            </div>
            <div>
              <Wallet size={18} />
              <span>Total group budget</span>
              <strong>{consultationBudget(trip)}</strong>
            </div>
            <div>
              <MapPin size={18} />
              <span>Best time to visit</span>
              <strong>{destination.bestTime}</strong>
            </div>
          </div>
          <div className="trip-service-preferences" aria-label="Travel service preferences">
            <span>
              Flights:{' '}
              <strong>{serviceLabels[getConsultation(trip).services.flights.status]}</strong>
            </span>
            <span>
              Accommodation:{' '}
              <strong>{serviceLabels[getConsultation(trip).services.hotels.status]}</strong>
            </span>
          </div>
          {trip.planning ? (
            <PlanningReview
              trip={trip}
              onSettings={readOnly ? undefined : () => setSettings(true)}
            />
          ) : (
            <div className="budget-breakdown">
              <h3>A little budget perspective</h3>
              <div>
                <span>Activities & meals for your group</span>
                <strong>{money(totalActivities)}</strong>
              </div>
              <div>
                <span>Stays & flights</span>
                <span>Not included in this estimate</span>
              </div>
              <p>
                These are planning estimates in USD, not quotes. Final prices depend on your dates,
                availability, and choices.
              </p>
            </div>
          )}
          {!trip.planning && stay && (
            <div className="recommended-stay">
              <span className="eyebrow">SOMEWHERE TO REST YOUR HEAD</span>
              <img src={stay.image} alt={stay.name} />
              <h3>{stay.name}</h3>
              <p>{stay.description}</p>
              <div className="price-line">
                <span>
                  Sample stay · from <strong>{money(stay.price)}</strong> / night
                </span>
                <Link to={`/stays?destination=${destination.id}`} className="text-link">
                  Explore stays
                  <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          )}
          {!readOnly && <HotelSearch trip={trip} destinationId={destination.id} />}
          <Link className="button button-secondary full-width" to="/flights">
            <Plane size={16} />
            Find a way to get there
          </Link>
          <p className="trip-details-note">
            Sample stays are inspiration. No reservations have been made.
          </p>
        </div>
      )}
      {!readOnly && (
        <div className="trip-save-bar">
          <span>
            <Check size={12} />
            {saving ? 'Saving your changes…' : 'All your plans, safely saved'}
          </span>
          <button
            className="button button-primary button-small"
            disabled={locked}
            onClick={() =>
              void patch({ status: trip.status === 'planned' ? 'draft' : 'planned' })
                .then(() =>
                  toast(
                    trip.status === 'planned'
                      ? 'Back to dreaming. Your trip is a draft.'
                      : 'Your trip is marked ready. Nothing is booked.',
                  ),
                )
                .catch((e) => toast(e.message))
            }
          >
            {trip.status === 'planned' ? 'Back to draft' : 'This is my kind of trip'}
            <Check size={14} />
          </button>
        </div>
      )}
      {history && <RevisionHistory trip={trip} onUpdate={onUpdate!} onClose={closeHistory} />}
      {place && (
        <PlaceDetails
          place={freshPlaces[place.id] || place}
          fresh={Boolean(freshPlaces[place.id])}
          trip={trip}
          onClose={closePlace}
        />
      )}
      {settings && <TripSettings trip={trip} onClose={closeSettings} onUpdate={onUpdate!} />}{' '}
      {share && <ShareDialog trip={trip} onClose={closeShare} onUpdate={onUpdate!} />}{' '}
      {editing && (
        <ItemEditor
          item={editing.item}
          onClose={closeEditing}
          onSave={async (item) => {
            await patch({
              itinerary: trip.itinerary.map((d) =>
                d.day === editing.day
                  ? {
                      ...d,
                      items: editing.isNew
                        ? [...d.items, item].sort((a, b) => a.time.localeCompare(b.time))
                        : d.items
                            .map((i) => (i.id === item.id ? item : i))
                            .sort((a, b) => a.time.localeCompare(b.time)),
                    }
                  : d,
              ),
            });
            toast('Your itinerary has been updated.');
          }}
        />
      )}
    </div>
  );
}
function HeartIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>
  );
}
export function Planner() {
  const { id } = useParams();
  const location = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { catalog, integrations, toast, ownerVersion } = useApp();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState('');
  const [warning, setWarning] = useState('');
  const [mobileTab, setMobileTab] = useState<'chat' | 'plan'>('chat');
  const [retryPrompt, setRetryPrompt] = useState('');
  const consultationQuestions = (trip?.planning?.questions || [])
    .filter((question) => {
      if (!trip) return false;
      const consultation = getConsultation(trip);
      if (question.field === 'flights' || question.field === 'hotels')
        return consultation.services[question.field].status === 'unknown';
      if (question.field === 'flight_dates') return true;
      if (question.field === 'nationality') return !trip.brief?.guestNationality;
      if (question.field === 'destination')
        return consultation.facts.destination?.valueState !== 'specified';
      return !consultation.facts[question.field];
    })
    .slice(0, 2);
  const { run, follow, cancel, cancelling, reset } = usePlanningRun();
  const operation = useRef(0);
  const observedOwner = useRef(ownerVersion);
  const observedRoute = useRef(location.pathname + location.search);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const initialSent = useRef('');
  const latestTrip = useRef<Trip | null>(null);
  const busyRef = useRef(false);
  const messagesEnd = useRef<HTMLDivElement>(null);
  latestTrip.current = trip;
  const acceptRun = useCallback(
    async (initial: PlanningRun, token: number) => {
      const finished = await follow(initial);
      if (!mounted.current || token !== operation.current) return;
      if (finished.status === 'completed' && finished.result) {
        const current = await api<{ trip: Trip }>(`/trips/${finished.tripId}`);
        if (!mounted.current || token !== operation.current) return;
        setTrip(current.trip);
        latestTrip.current = current.trip;
        setWarning(finished.result.warning || '');
        setRetryPrompt('');
        sessionStorage.removeItem('asktara-pending-request');
      } else if (finished.status === 'cancelled') {
        setWarning('Planning stopped. Your saved itinerary is still here.');
        sessionStorage.removeItem('asktara-pending-request');
      } else {
        sessionStorage.removeItem('asktara-pending-request');
        throw new Error(finished.error || 'The plan could not be completed. Please try again.');
      }
    },
    [follow],
  );
  const send = useCallback(
    async (message: string) => {
      if (!message.trim() || busyRef.current) return;
      const token = ++operation.current;
      reset();
      busyRef.current = true;
      setBusy(true);
      setError('');
      setWarning('');
      setPending(message);
      setPrompt('');
      setRetryPrompt('');
      const actualMessage = message;
      const current = latestTrip.current;
      try {
        type PendingRequest = {
          requestId: string;
          message: string;
          displayMessage?: string;
          tripId?: string;
          resolvedTripId?: string;
          runId?: string;
        };
        let previous: PendingRequest | undefined;
        try {
          const stored = JSON.parse(
            sessionStorage.getItem('asktara-pending-request') || '{}',
          ) as PendingRequest;
          if (
            typeof stored.requestId === 'string' &&
            (stored.message === actualMessage || stored.displayMessage === message) &&
            (stored.tripId === current?.id || stored.resolvedTripId === current?.id)
          )
            previous = stored;
        } catch {
          /* A malformed pending request starts a new one. */
        }
        const request = previous || {
          requestId: crypto.randomUUID(),
          message: actualMessage,
          displayMessage: message,
          ...(current ? { tripId: current.id } : {}),
        };
        sessionStorage.setItem('asktara-pending-request', JSON.stringify(request));
        const response = request.runId
          ? await api<{ run: PlanningRun }>(`/planning/runs/${request.runId}`)
          : await api<{ run: PlanningRun }>('/planning/runs', {
              method: 'POST',
              body: JSON.stringify({
                requestId: request.requestId,
                message: request.message,
                ...(request.tripId ? { tripId: request.tripId } : {}),
              }),
            });
        if (!mounted.current || token !== operation.current) return;
        sessionStorage.setItem(
          'asktara-pending-request',
          JSON.stringify({
            ...request,
            runId: response.run.id,
            resolvedTripId: response.run.tripId,
          }),
        );
        if (!current) {
          const draft = await api<{ trip: Trip }>(`/trips/${response.run.tripId}`);
          if (!mounted.current || token !== operation.current) return;
          setTrip(draft.trip);
          latestTrip.current = draft.trip;
        }
        navigate(`/chat/${response.run.tripId}`, { replace: true });
        await acceptRun(response.run, token);
      } catch (e) {
        if (mounted.current && token === operation.current && (e as Error).name !== 'AbortError') {
          setError((e as Error).message);
          setRetryPrompt(message);
        }
      } finally {
        if (mounted.current && token === operation.current) {
          setBusy(false);
          setPending('');
          busyRef.current = false;
        }
      }
    },
    [navigate, acceptRun, reset],
  );
  useEffect(() => {
    let cancelled = false;
    const routeChanged = observedRoute.current !== location.pathname + location.search;
    const ownerChanged = observedOwner.current !== ownerVersion;
    observedOwner.current = ownerVersion;
    observedRoute.current = location.pathname + location.search;
    if (ownerChanged) {
      operation.current++;
      reset();
      busyRef.current = false;
      setBusy(false);
      setPending('');
      setRetryPrompt('');
      setTrip(null);
      setError('');
      setWarning('');
      latestTrip.current = null;
      sessionStorage.removeItem('asktara-pending-request');
    }
    if (id && latestTrip.current?.id === id) return;
    // Navigating to a different conversation invalidates the previous observer, not its saved run.
    if (busyRef.current && routeChanged) {
      operation.current++;
      reset();
      busyRef.current = false;
      setBusy(false);
      setPending('');
    }
    if (id) {
      setTrip(null);
      latestTrip.current = null;
      setLoading(true);
      setError('');
      api<{ trip: Trip }>(`/trips/${id}`)
        .then(async (r) => {
          if (cancelled) return;
          setTrip(r.trip);
          latestTrip.current = r.trip;
          const response = await api<{ runs: PlanningRun[] }>(`/trips/${id}/runs`);
          if (cancelled || busyRef.current) return;
          const active = response.runs.find(
            (run) => run.status === 'running' || run.status === 'queued',
          );
          const recent = response.runs[0];
          if (
            !active &&
            recent?.status === 'completed' &&
            recent.result &&
            (recent.result.trip.revision ?? 0) > (r.trip.revision ?? 0)
          ) {
            setTrip(recent.result.trip);
            latestTrip.current = recent.result.trip;
          }
          if (!active && (recent?.status === 'failed' || recent?.status === 'cancelled'))
            setWarning(
              recent.error ||
                'The previous planning request was stopped. Your saved itinerary is still here.',
            );
          if (active) {
            const token = ++operation.current;
            busyRef.current = true;
            setBusy(true);
            setLoading(false);
            try {
              await acceptRun(active, token);
            } finally {
              if (!cancelled && token === operation.current) {
                busyRef.current = false;
                setBusy(false);
              }
            }
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else if (!busyRef.current) {
      setTrip(null);
      latestTrip.current = null;
      setWarning('');
      const q = params.get('q');
      if (q && initialSent.current !== q) {
        initialSent.current = q;
        void send(q);
      } else if (!q) {
        initialSent.current = '';
        setError('');
        setPending('');
      }
    }
    return () => {
      cancelled = true;
    };
  }, [id, location.search, params, send, acceptRun, reset, ownerVersion]);
  useEffect(() => {
    const suggestion = params.get('q');
    if (id && suggestion) {
      setPrompt(suggestion.slice(0, 4000));
      setMobileTab('chat');
    }
  }, [id, params]);
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [trip?.messages.length, pending, busy]);
  return (
    <div className="planner-page">
      <div className="planner-mobile-tabs">
        <button
          className={mobileTab === 'chat' ? 'active' : ''}
          onClick={() => setMobileTab('chat')}
        >
          <MessageCircle size={15} />
          Chat with Tara
        </button>
        <button
          className={mobileTab === 'plan' ? 'active' : ''}
          onClick={() => setMobileTab('plan')}
        >
          <List size={15} />
          Your itinerary{trip?.itinerary.length ? <span>{trip.days}</span> : null}
        </button>
      </div>
      <section className={`chat-panel ${mobileTab === 'plan' ? 'mobile-hidden' : ''}`}>
        <div className="chat-panel-heading">
          <div className="concierge-avatar">
            <TaraMark size={24} />
          </div>
          <div>
            <h2>Your travel concierge</h2>
            <span>
              <i />
              {integrations.ai ? 'Ready for a little adventure' : 'Curated planning mode'}
            </span>
          </div>
          <Link
            className="icon-button"
            to="/chat"
            aria-label="Start a new conversation"
            onClick={(e) => {
              if (busy) e.preventDefault();
            }}
          >
            <Plus size={19} />
          </Link>
        </div>
        <div className="chat-messages">
          {loading ? (
            <Spinner label="Unpacking your plans…" />
          ) : !trip?.messages.length && !pending && !busy ? (
            <div className="chat-welcome">
              <div className="welcome-mark">
                <TaraMark size={41} />
              </div>
              <span className="eyebrow">A LITTLE HELLO FROM TARA</span>
              <h1>
                Where are we
                <br />
                <em>dreaming of?</em>
              </h1>
              <p>
                Tell me about the trip you can’t stop thinking about. A place, a feeling, or just a
                little need to get away.
              </p>
              <div className="chat-starters">
                {[
                  '5 days in Kyoto, with plenty of food and culture',
                  'A slow week on the Amalfi Coast for two',
                  'A 4 day adventure in Hunza Valley',
                ].map((q) => (
                  <button key={q} onClick={() => void send(q)}>
                    {q}
                    <ArrowUp size={14} />
                  </button>
                ))}
              </div>
              <p className="local-mode-note">
                {integrations.ai
                  ? 'Your plans come together here, one conversation at a time.'
                  : `Planning from ${catalog.destinations.length} curated destinations. Tell Tara where you’d like to go.`}
              </p>
            </div>
          ) : (
            <>
              {trip?.messages.map((message) => (
                <div className={`chat-message ${message.role}`} key={message.id}>
                  {message.role === 'assistant' && (
                    <div className="message-avatar">
                      <TaraMark size={18} />
                    </div>
                  )}
                  <div>
                    <span className="message-role">
                      {message.role === 'assistant' ? 'Tara' : 'You'}
                    </span>
                    <div className="message-text">
                      {message.role === 'assistant' ? (
                        <ConciergeMessage text={message.content} />
                      ) : (
                        <MarkdownText text={message.content} />
                      )}
                    </div>
                    {message.role === 'assistant' &&
                      message.id === trip.messages.at(-1)?.id &&
                      !busy && (
                        <div className="consultation-replies">
                          {consultationQuestions
                            .filter((question) => question.suggestions.length)
                            .map((question) => (
                              <div key={question.field} role="group" aria-label={question.question}>
                                <p>
                                  {question.field === 'hotels'
                                    ? 'Accommodation'
                                    : question.field === 'flight_dates'
                                      ? 'Flight dates'
                                      : question.field.charAt(0).toUpperCase() +
                                        question.field.slice(1)}
                                </p>
                                <div>
                                  {question.suggestions.slice(0, 4).map((suggestion) => (
                                    <button
                                      key={suggestion}
                                      type="button"
                                      onClick={() => void send(suggestion)}
                                    >
                                      {suggestion}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    {message.role === 'assistant' &&
                      message.id === trip.messages.at(-1)?.id &&
                      !trip.itinerary.length &&
                      getConsultation(trip).facts.destination?.valueState !== 'specified' && (
                        <div className="suggested-destinations">
                          {tripDestinations(trip)
                            .filter((d) => message.content.includes(d.name))
                            .slice(0, 4)
                            .map((d) => (
                              <button
                                key={d.id}
                                disabled={busy}
                                onClick={() => void send(`Let's go to ${d.name}`)}
                              >
                                <img src={d.image} alt="" />
                                <span>{d.name}</span>
                                <ArrowRight size={13} />
                              </button>
                            ))}
                        </div>
                      )}
                    {message.role === 'assistant' &&
                      message.id === trip.messages.at(-1)?.id &&
                      trip.itinerary.length > 0 && (
                        <button className="mobile-view-plan" onClick={() => setMobileTab('plan')}>
                          Take a look at your itinerary
                          <ArrowRight size={14} />
                        </button>
                      )}
                  </div>
                </div>
              ))}
              {pending && (
                <div className="chat-message user">
                  <div>
                    <span className="message-role">You</span>
                    <div className="message-text">
                      <p>{pending}</p>
                    </div>
                  </div>
                </div>
              )}
              {busy && (
                <div className="chat-message assistant">
                  <div className="message-avatar">
                    <TaraMark size={18} />
                  </div>
                  <div>
                    <span className="message-role">Tara</span>
                    <PlanningProgress
                      run={run}
                      cancelling={cancelling}
                      onCancel={() => void cancel().catch((e) => toast(e.message))}
                    />
                  </div>
                </div>
              )}
            </>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
              {retryPrompt && (
                <button className="retry-chat" onClick={() => void send(retryPrompt)}>
                  Try again <ArrowRight size={12} />
                </button>
              )}
            </div>
          )}
          <div ref={messagesEnd} />
        </div>
        <div className="chat-compose-area">
          {trip?.itinerary.length && !busy && !consultationQuestions.length ? (
            <div className="followup-prompts">
              <button onClick={() => void send('Make it slower and more relaxing')}>
                A slower pace
              </button>
              <button onClick={() => void send('Make the trip more budget friendly')}>
                A smaller budget
              </button>
              <button onClick={() => void send('Add more food and culture')}>
                Follow the food
              </button>
            </div>
          ) : null}
          {trip &&
          !trip.itinerary.length &&
          trip.planning?.questions.length &&
          !consultationQuestions.length &&
          !busy &&
          !loading ? (
            <div className="followup-prompts">
              <button
                onClick={() => void send('Continue planning with the trip details I’ve provided.')}
              >
                Continue planning <ArrowRight size={12} />
              </button>
            </div>
          ) : null}
          <form
            className="chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(prompt);
            }}
          >
            <textarea
              aria-label="Message Tara"
              placeholder={
                trip
                  ? 'A little more adventure? A change of plan?'
                  : 'Tell Tara a little about your next trip…'
              }
              value={prompt}
              maxLength={4000}
              rows={2}
              disabled={busy || loading}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button
              className="composer-submit"
              disabled={busy || loading || !prompt.trim()}
              aria-label="Send message"
            >
              {busy ? <LoaderCircle size={17} className="spinning" /> : <ArrowUp size={18} />}
            </button>
          </form>
          <p className="chat-mode-caption">
            {warning
              ? warning
              : integrations.ai
                ? 'Plans are suggestions. Prices and availability need confirmation.'
                : 'Curated local planner · Estimated costs · No bookings made'}
          </p>
        </div>
      </section>
      <section
        className={`plan-panel ${mobileTab === 'chat' ? 'mobile-hidden' : ''}`}
        aria-label="Your trip itinerary"
      >
        {trip ? (
          <ItineraryView trip={trip} onUpdate={setTrip} disabled={busy} />
        ) : (
          <div className="itinerary-placeholder">
            <span className="placeholder-illustration">
              <Globe2 size={72} strokeWidth={0.8} />
              <Sparkles size={28} strokeWidth={1} />
            </span>
            <span className="eyebrow">THE BEST PART IS STILL AHEAD</span>
            <h2>
              Your next chapter,
              <br />
              coming together.
            </h2>
            <p>
              Your personal itinerary, thoughtful little details,
              <br />
              and everything in between will live right here.
            </p>
            <div className="placeholder-photo-stack">
              {catalog.destinations.slice(0, 3).map((d) => (
                <img key={d.id} src={d.image} alt={d.name} />
              ))}
            </div>
            <span className="placeholder-signoff">
              A little inspiration. A lot to look forward to.
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
export function Trips() {
  const { toast, user, openAuth, ownerVersion } = useApp();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [deleting, setDeleting] = useState<Trip | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setTrips([]);
    setLoading(true);
    setError('');
    setDeleting(null);
    api<{ trips: Trip[] }>('/trips')
      .then((r) => {
        if (active) setTrips(r.trips);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ownerVersion]);
  const closeDelete = useCallback(() => setDeleting(null), []);
  const filtered = trips.filter((t) => filter === 'all' || t.status === filter);
  return (
    <div className="page-container trips-page">
      <div className="trips-page-heading">
        <div className="page-intro">
          <span className="eyebrow">GOOD THINGS ON THE HORIZON</span>
          <h1>Places to go. Stories to tell.</h1>
          <p>Your little escapes and grand adventures, all together.</p>
        </div>
        <Link className="button button-primary" to="/chat">
          <Plus size={16} />
          Dream up a trip
        </Link>
      </div>
      {!user && (
        <div className="guest-save-notice">
          <span>
            <Check size={15} />
            Your trips are saved in this browser’s session.
          </span>
          <button onClick={openAuth}>
            Create an account to keep them across devices <ArrowRight size={13} />
          </button>
        </div>
      )}
      <div className="vibe-filters" role="group" aria-label="Filter trips">
        {[
          { id: 'all', label: 'All your adventures' },
          { id: 'draft', label: 'Still dreaming' },
          { id: 'planned', label: 'Ready to go' },
        ].map((f) => (
          <button
            className={filter === f.id ? 'active' : ''}
            key={f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
          >
            {f.label}
          </button>
        ))}
      </div>
      {loading ? (
        <Spinner label="Finding your adventures…" />
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : !filtered.length ? (
        <EmptyState
          title={trips.length ? 'Room for a new chapter.' : 'Your next adventure starts here.'}
          description={
            trips.length
              ? 'No trips in this collection yet. Your other plans are waiting in All your adventures.'
              : 'A weekend away or that once-in-a-lifetime trip. Tell Tara what you have in mind and we’ll keep the details here.'
          }
          action="Let’s plan something"
          to="/chat"
        />
      ) : (
        <div className="trip-card-grid">
          {filtered.map((trip) => {
            const d = findDestination(trip.destinationId, trip);
            const consultation = getConsultation(trip);
            return (
              <article className="trip-card" key={trip.id}>
                <Link to={`/chat/${trip.id}`} className="trip-card-image">
                  {d ? (
                    <img src={d.image || '/images/destination-placeholder.svg'} alt={d.name} />
                  ) : (
                    <div className="trip-no-image">
                      <TaraMark size={56} />
                    </div>
                  )}
                  <span className="trip-status">
                    {trip.status === 'planned' ? (
                      <>
                        <Check size={12} />
                        Ready to go
                      </>
                    ) : (
                      'Still dreaming'
                    )}
                  </span>
                </Link>
                <div className="trip-card-body">
                  <span className="eyebrow">
                    {d ? `${d.name} · ${d.country}` : 'SOMEWHERE WONDERFUL'}
                  </span>
                  <Link to={`/chat/${trip.id}`}>
                    <h2>{trip.title}</h2>
                  </Link>
                  <div className="trip-card-meta">
                    <span>
                      <CalendarDays size={13} />
                      {trip.itinerary.length
                        ? `${trip.itinerary.length} days`
                        : consultation.facts.duration?.valueState === 'specified'
                          ? `${trip.days} days`
                          : 'Length to discuss'}
                    </span>
                    <span>
                      <Users size={13} />
                      {consultation.facts.travelers?.valueState === 'specified'
                        ? `${trip.travelers} travellers`
                        : 'Party to discuss'}
                    </span>
                    <span>
                      {consultation.facts.dates
                        ? consultation.facts.dates.valueState === 'flexible'
                          ? 'Flexible dates'
                          : readableDate(trip.startDate)
                        : 'Dates to discuss'}
                    </span>
                  </div>
                  <div className="trip-card-footer">
                    <Link to={`/chat/${trip.id}`} className="text-link">
                      Keep dreaming
                      <ArrowRight size={15} />
                    </Link>
                    <button
                      className="icon-button"
                      aria-label={`Delete ${trip.title}`}
                      onClick={() => setDeleting(trip)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {deleting && (
        <Modal title="Let this one go?" onClose={closeDelete}>
          <p className="modal-intro">
            “{deleting.title}” and its conversation will be permanently deleted. Any shared link
            will stop working.
          </p>
          <div className="share-actions">
            <button className="button button-secondary" disabled={busy} onClick={closeDelete}>
              Keep this trip
            </button>
            <button
              className="button button-danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/trips/${deleting.id}`, { method: 'DELETE' });
                  setTrips((current) => current.filter((t) => t.id !== deleting.id));
                  setDeleting(null);
                  toast('Trip deleted. There’s always another adventure.');
                } catch (e) {
                  toast((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Deleting…' : 'Delete trip'}
              <Trash2 size={14} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
export function SharedTrip() {
  const { token } = useParams();
  const { toast } = useApp();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api<{ trip: Trip }>(`/shared/${token}`)
      .then((r) => {
        if (active) setTrip(r.trip);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);
  async function copy() {
    if (!trip) return;
    setBusy(true);
    try {
      const created = await api<{ trip: Trip }>(`/shared/${token}/clone`, {
        method: 'POST',
        body: '{}',
      });
      toast('A little inspiration, made yours.');
      navigate(`/chat/${created.trip.id}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <Spinner label="Opening a little adventure…" />;
  if (error || !trip)
    return (
      <EmptyState
        title="This story isn’t here."
        description={error || 'This trip may have been deleted or its sharing link turned off.'}
        action="Dream up your own trip"
        to="/chat"
      />
    );
  return (
    <div className="shared-trip-page">
      <div className="shared-trip-heading">
        <div>
          <span className="eyebrow">GOOD ADVENTURES ARE WORTH SHARING</span>
          <h1>A little travel inspiration, for you.</h1>
          <p>A shared itinerary. Borrow the idea, make it your own.</p>
        </div>
        <button
          className="button button-primary"
          disabled={busy || !trip.itinerary.length}
          onClick={() => void copy()}
        >
          {busy ? 'Making it yours…' : 'Make this trip mine'}
          <Copy size={16} />
        </button>
      </div>
      <ItineraryView trip={trip} readOnly />
    </div>
  );
}
