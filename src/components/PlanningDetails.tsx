import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Clock3,
  ExternalLink,
  History,
  LoaderCircle,
  MapPin,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { PlanningPlace, PlanningRun, TravelBrief, TripRevision } from '../../shared/planning';
import type { FlightOffer, Trip } from '../../shared/types';
import { api, money } from '../api';
import { useApp } from '../context';
import { Modal } from './ui';
import FlightDetails from './FlightDetails';
import { tripDestinations } from '../../shared/destinations';
import MarkdownText, { safeWebUrl } from './MarkdownText';
import './planning-details.css';
import { getConsultation, type ServiceStatus } from '../../shared/consultation';

export const serviceLabels: Record<ServiceStatus, string> = {
  unknown: 'Not discussed',
  requested: 'Need help',
  already_booked: 'Already booked',
  not_needed: 'Not needed',
};

function serviceBudget(status: ServiceStatus, amount: number | null, currency: string) {
  if (status === 'not_needed') return 'Not in scope';
  if (status === 'already_booked') return 'Arranged separately';
  if (status === 'unknown') return 'Not discussed';
  return amount !== null && Number.isFinite(amount) && amount > 0
    ? money(amount, currency)
    : 'Not priced';
}

export const defaultBrief: TravelBrief = {
  pace: 'balanced',
  originAirport: '',
  arrivalAirport: '',
  guestNationality: '',
  includeFlights: false,
  includeHotels: false,
  destinationStops: [],
  notes: [],
};

export function BriefFields({
  value,
  onChange,
  days,
  trip,
}: {
  value: TravelBrief;
  onChange: (value: TravelBrief) => void;
  days: number;
  trip?: Trip;
}) {
  const { catalog } = useApp();
  const destinations = useMemo(
    () => (trip ? tripDestinations(trip) : catalog.destinations),
    [trip, catalog.destinations],
  );
  const [notesText, setNotesText] = useState(value.notes.join('\n'));
  const notesFocused = useRef(false);
  useEffect(() => {
    if (!notesFocused.current) setNotesText(value.notes.join('\n'));
  }, [value.notes]);
  const update = (patch: Partial<TravelBrief>) => onChange({ ...value, ...patch });
  const consultation = getConsultation({ brief: value });
  const updateService = (service: 'flights' | 'hotels', status: ServiceStatus) =>
    update({
      [service === 'flights' ? 'includeFlights' : 'includeHotels']: status === 'requested',
      consultation: {
        ...consultation,
        services: {
          ...consultation.services,
          [service]: {
            status,
            source: 'form',
            evidence: `${service === 'flights' ? 'Flights' : 'Accommodation'}: ${serviceLabels[status]}`,
          },
        },
      },
    });
  return (
    <fieldset className="brief-fields">
      <legend>A few details for a better journey</legend>
      <label>
        Your pace
        <select
          value={value.pace}
          onChange={(e) => update({ pace: e.target.value as TravelBrief['pace'] })}
        >
          <option value="relaxed">Slow & spacious</option>
          <option value="balanced">A little of everything</option>
          <option value="active">See as much as possible</option>
        </select>
      </label>
      <details>
        <summary>Plan more than one destination</summary>
        <p className="muted">
          Allocate all {days} days, in travel order. Travel between cities still needs to be
          arranged.
        </p>
        {value.destinationStops.map((stop, index) => (
          <div className="route-stop" key={index}>
            <label>
              Stop {index + 1}
              <select
                aria-label={`Destination ${index + 1}`}
                value={stop.destinationId}
                onChange={(e) =>
                  update({
                    destinationStops: value.destinationStops.map((s, i) =>
                      i === index ? { ...s, destinationId: e.target.value } : s,
                    ),
                  })
                }
              >
                {destinations.map((d) => (
                  <option value={d.id} key={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Days
              <input
                aria-label={`Days in stop ${index + 1}`}
                type="number"
                min={1}
                max={21}
                value={stop.days}
                onChange={(e) =>
                  update({
                    destinationStops: value.destinationStops.map((s, i) =>
                      i === index ? { ...s, days: Number(e.target.value) } : s,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove destination ${index + 1}`}
              onClick={() =>
                update({ destinationStops: value.destinationStops.filter((_, i) => i !== index) })
              }
            >
              <X size={15} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-link"
          disabled={value.destinationStops.length >= 5}
          onClick={() =>
            update({
              destinationStops: [
                ...value.destinationStops,
                {
                  destinationId:
                    destinations.find(
                      (d) => !value.destinationStops.some((s) => s.destinationId === d.id),
                    )?.id || 'kyoto',
                  days: value.destinationStops.length ? 1 : days,
                },
              ],
            })
          }
        >
          Add destination
        </button>
        {!!value.destinationStops.length && (
          <p className="muted">
            {value.destinationStops.reduce((n, s) => n + s.days, 0)} of {days} days allocated
          </p>
        )}
      </details>
      <label>
        Accommodation
        <select
          value={consultation.services.hotels.status}
          onChange={(e) => updateService('hotels', e.target.value as ServiceStatus)}
        >
          {Object.entries(serviceLabels).map(([status, label]) => (
            <option key={status} value={status}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {consultation.services.hotels.status === 'requested' && (
        <label>
          Guest nationality (2-letter code)
          <input
            placeholder="AU"
            pattern="[A-Za-z]{2}"
            maxLength={2}
            value={value.guestNationality}
            onChange={(e) => update({ guestNationality: e.target.value.toUpperCase() })}
          />
        </label>
      )}
      <label>
        Flights
        <select
          value={consultation.services.flights.status}
          onChange={(e) => updateService('flights', e.target.value as ServiceStatus)}
        >
          {Object.entries(serviceLabels).map(([status, label]) => (
            <option key={status} value={status}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {consultation.services.flights.status === 'requested' && (
        <div className="form-row">
          <label>
            From airport
            <input
              placeholder="SYD"
              pattern="[A-Za-z]{3}"
              maxLength={3}
              value={value.originAirport}
              onChange={(e) => update({ originAirport: e.target.value.toUpperCase() })}
            />
          </label>
          <label>
            To airport
            <input
              placeholder="KIX"
              pattern="[A-Za-z]{3}"
              maxLength={3}
              value={value.arrivalAirport}
              onChange={(e) => update({ arrivalAirport: e.target.value.toUpperCase() })}
            />
          </label>
        </div>
      )}
      <label>
        Anything to keep in mind?
        <textarea
          rows={2}
          className="form-textarea"
          maxLength={6011}
          placeholder="Dietary preferences, accessibility, must-see places…"
          value={notesText}
          onFocus={() => {
            notesFocused.current = true;
          }}
          onBlur={() => {
            notesFocused.current = false;
            setNotesText(value.notes.join('\n'));
          }}
          onChange={(e) => {
            const text = e.target.value;
            const notes = text
              .split('\n')
              .map((note) => note.trim())
              .filter(Boolean);
            e.currentTarget.setCustomValidity(
              notes.length > 12
                ? 'Use at most 12 notes.'
                : notes.some((note) => note.length > 500)
                  ? 'Keep each note to 500 characters or fewer.'
                  : '',
            );
            setNotesText(text);
            update({ notes });
          }}
        />
        <small className="muted">
          Up to 12 notes, one per line, with 500 characters per note. Edit these to replace saved
          profile requirements for this trip.
        </small>
      </label>
      <p className="muted">
        Leave a service as “Not discussed” if you haven’t decided. Save your answers, then continue
        with Tara.
      </p>
    </fieldset>
  );
}

export function PlanningProgress({
  run,
  onCancel,
  cancelling,
}: {
  run: PlanningRun | null;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const latest = new Map(run?.events.map((event) => [event.agent, event]));
  return (
    <div className="planning-progress" aria-live="polite" role="status">
      <div className="planning-progress-heading">
        <span>
          <LoaderCircle size={14} className="spinning" />
          Your journey is taking shape
        </span>
        <button
          type="button"
          disabled={!run || !['queued', 'running'].includes(run.status) || cancelling}
          onClick={onCancel}
        >
          {cancelling ? 'Stopping…' : 'Stop'}
        </button>
      </div>
      {!latest.size ? (
        <p>Gathering your trip details…</p>
      ) : (
        <ol>
          {Array.from(latest.values()).map((event) => (
            <li key={event.agent} className={`stage-${event.status}`}>
              <span>
                {event.status === 'running' ? (
                  <LoaderCircle size={13} className="spinning" />
                ) : event.status === 'completed' ? (
                  <Check size={13} />
                ) : (
                  <span className="stage-dot" />
                )}
              </span>
              <div>
                <strong>{event.label}</strong>
                <p>{event.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function PlanningReview({ trip, onSettings }: { trip: Trip; onSettings?: () => void }) {
  const [selectedFlight, setSelectedFlight] = useState<FlightOffer | null>(null);
  const report = trip.planning;
  const consultation = getConsultation(trip);
  if (!report) return null;
  return (
    <div className="planning-review">
      <div className="review-heading">
        <ShieldCheck size={19} />
        <div>
          <span className="eyebrow">THE DETAILS BEHIND YOUR DAYS</span>
          <h3>Your trip, considered</h3>
        </div>
      </div>
      <p>{report.summary}</p>
      {report.researchSummary && (
        <div className="research-summary">
          <span className="eyebrow">RESEARCH FOR YOUR JOURNEY</span>
          <MarkdownText text={report.researchSummary} />
        </div>
      )}
      {report.questions.length > 0 && (
        <div className="planning-questions">
          <strong>A little more detail would help</strong>
          {report.questions.map((q, i) => (
            <p key={i}>{q.question}</p>
          ))}
          {onSettings && (
            <button className="text-link" onClick={onSettings}>
              Add trip details
            </button>
          )}
        </div>
      )}
      <div className="budget-breakdown">
        <h3>Your estimated group spend ({report.budget.currency})</h3>
        <div>
          <span>Activities & meals</span>
          <strong>{money(report.budget.activities, report.budget.currency)}</strong>
        </div>
        <div>
          <span>Accommodation</span>
          <strong>
            {serviceBudget(
              consultation.services.hotels.status,
              report.budget.accommodation,
              report.budget.currency,
            )}
          </strong>
        </div>
        <div>
          <span>Flights</span>
          <strong>
            {serviceBudget(
              consultation.services.flights.status,
              report.budget.flights,
              report.budget.currency,
            )}
          </strong>
        </div>
        <div className="budget-total">
          <span>Estimated total</span>
          <strong>
            {money(report.budget.total, report.budget.currency)} {report.budget.currency}
          </strong>
        </div>
        <div>
          <span>Your group budget</span>
          <strong>
            {consultation.facts.budget
              ? consultation.facts.budget.valueState === 'flexible'
                ? 'Flexible'
                : `${money(report.budget.target, report.budget.targetCurrency || consultation.currency)} ${report.budget.targetCurrency || consultation.currency}`
              : 'Not discussed'}
          </strong>
        </div>
        {(report.budget.targetCurrency || consultation.currency) !== report.budget.currency &&
          consultation.facts.budget?.valueState === 'specified' && (
            <p>
              Estimates are in {report.budget.currency}; your budget is in{' '}
              {report.budget.targetCurrency || consultation.currency}. No exchange-rate conversion
              has been applied.
            </p>
          )}
        <p>
          {report.budget.unpriced.length
            ? `Still to allow for: ${report.budget.unpriced.join(', ')}.`
            : 'Estimates can change before booking.'}
        </p>
      </div>
      {!!report.issues.length && (
        <details open={report.issues.some((i) => i.severity === 'error')}>
          <summary>{report.issues.length} planning notes</summary>
          <ul>
            {report.issues.map((issue, i) => (
              <li key={i} className={`review-${issue.severity}`}>
                {issue.day ? `Day ${issue.day}: ` : ''}
                {issue.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary>Assumptions & sources</summary>
        {report.model && <p className="muted">Research assisted by {report.model}.</p>}
        <ul>
          {report.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
        <div className="plan-sources">
          {report.sources.map((source) => (
            <div key={source.id}>
              <span className={`source-badge source-${source.status}`}>
                {source.kind === 'web'
                  ? 'Web research'
                  : source.status === 'curated'
                    ? 'Curated idea'
                    : source.status === 'live'
                      ? 'Provider data'
                      : source.status === 'test'
                        ? 'Sandbox data'
                        : source.status === 'unverified'
                          ? 'Environment unverified'
                          : 'Your choice'}
              </span>
              {safeWebUrl(source.url) ? (
                <a href={safeWebUrl(source.url)} target="_blank" rel="noopener noreferrer">
                  {source.label}
                  <ExternalLink size={11} />
                </a>
              ) : (
                <span>{source.label}</span>
              )}
              <small>
                {source.kind === 'web' ? 'Researched' : 'Checked'}{' '}
                {new Date(source.checkedAt).toLocaleDateString()}
                {source.kind === 'web'
                  ? ' · Published information may change before your trip.'
                  : source.status === 'test'
                    ? ' · Simulated rates; availability is not confirmed.'
                    : ''}
              </small>
            </div>
          ))}
        </div>
      </details>
      {report.stays.length > 0 && (
        <details>
          <summary>Places to stay ({report.stays.length})</summary>
          <div className="research-stays">
            {report.stays.map((stay) => (
              <article key={stay.id}>
                {stay.image && <img src={stay.image} alt="" />}
                <div>
                  <h4>{stay.name}</h4>
                  <p>{stay.description}</p>
                  <strong>
                    {money(stay.price, stay.currency)} / {stay.basis === 'night' ? 'night' : 'stay'}
                  </strong>
                  <small>
                    {report.sources.find((s) => s.id === stay.sourceId)?.status === 'test'
                      ? 'Sandbox rate · simulated availability'
                      : report.sources.find((s) => s.id === stay.sourceId)?.status === 'curated'
                        ? 'Sample stay · estimate'
                        : 'Provider result · availability can change'}
                  </small>
                </div>
              </article>
            ))}
          </div>
        </details>
      )}
      {report.flights.length > 0 && (
        <details>
          <summary>Flight options ({report.flights.length})</summary>
          {report.flights.map((flight) => (
            <article className="research-flight" key={flight.id}>
              {(flight.liveMode === false ||
                report.sources.some(
                  (source) => source.id.endsWith('-flights') && source.status === 'test',
                )) && <span className="source-badge">Sandbox fare · simulated availability</span>}
              <strong>
                {flight.origin} → {flight.destination} · {money(flight.price, flight.currency)}
              </strong>
              <p>
                {flight.airline} · {flight.stops ? `${flight.stops} stop(s)` : 'Direct'} ·{' '}
                {flight.departure.slice(0, 16).replace('T', ' ')}
              </p>
              <button className="text-link" onClick={() => setSelectedFlight(flight)}>
                View full journey <ExternalLink size={12} />
              </button>
            </article>
          ))}
        </details>
      )}
      <p className="research-disclaimer">
        A travel plan, with no reservations made. Confirm opening hours and final prices before you
        go.
      </p>
      {selectedFlight && (
        <FlightDetails offer={selectedFlight} onClose={() => setSelectedFlight(null)} />
      )}
    </div>
  );
}

export function PlaceDetails({
  place: savedPlace,
  trip,
  onClose,
  fresh = false,
}: {
  place: PlanningPlace;
  trip: Trip;
  fresh?: boolean;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<PlanningPlace | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!savedPlace.id.startsWith('google-') || fresh) return;
    const controller = new AbortController();
    setLoading(true);
    api<{ place: PlanningPlace }>(`/trips/${trip.id}/places/${encodeURIComponent(savedPlace.id)}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!controller.signal.aborted) setLoaded(r.place);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [savedPlace.id, trip.id, fresh]);
  const place = loaded || savedPlace;
  const source = trip.planning?.sources.find((s) => s.id === place.sourceId);
  return (
    <Modal title={place.name} onClose={onClose}>
      <div className="place-details">
        {loading && <p role="status">Checking current place details…</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <span className="source-badge">
          {source?.kind === 'web'
            ? 'Web research'
            : source?.kind === 'google_places'
              ? 'Google Places data'
              : 'Curated place idea'}
        </span>
        {place.description && <MarkdownText text={place.description} />}
        <p>
          <MapPin size={16} />
          {place.address}
        </p>
        {!!place.suitability?.length && (
          <div className="place-suitability">
            <h3>How this fits your trip</h3>
            <ul>
              {place.suitability.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
            <p className="muted">
              Confirm dietary and access requirements directly with the venue before visiting.
            </p>
          </div>
        )}
        {!!place.evidenceUrls?.some((url) => safeWebUrl(url)) && (
          <div className="place-evidence">
            <h3>Read the source</h3>
            <ul>
              {place.evidenceUrls
                .filter((url) => safeWebUrl(url))
                .map((url, index) => (
                  <li key={index}>
                    <a href={safeWebUrl(url)} target="_blank" rel="noopener noreferrer">
                      {new URL(url).hostname.replace(/^www\./, '')}
                      <ExternalLink size={12} />
                    </a>
                  </li>
                ))}
            </ul>
            {source && (
              <p className="muted">
                Researched {new Date(source.checkedAt).toLocaleDateString()}. Published details may
                change.
              </p>
            )}
          </div>
        )}
        <p>
          <Clock3 size={16} />
          Allow around {place.durationMinutes} minutes · {money(place.estimatedCost)} estimated per
          person
        </p>
        {place.openingHours?.length ? (
          <div>
            <h3>Published opening hours</h3>
            <ul>
              {place.openingHours.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
            <p className="muted">Hours may change for your travel dates.</p>
          </div>
        ) : (
          <p className="muted">
            Opening hours haven’t been verified. Check the place before travelling.
          </p>
        )}
        <a
          className="button button-primary"
          target="_blank"
          rel="noreferrer"
          href={
            safeWebUrl(place.mapsUrl) ||
            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + place.address)}`
          }
        >
          Open in Google Maps
          <ExternalLink size={15} />
        </a>
        {source && <p className="muted">Source: {source.label}</p>}
        {place.id.startsWith('google-') && <strong>Google Maps</strong>}
        {place.attributions?.map((a, i) => (
          <p className="muted" key={i}>
            {a.providerUri?.startsWith('https://') ? (
              <a href={a.providerUri} target="_blank" rel="noreferrer">
                {a.provider}
              </a>
            ) : (
              a.provider
            )}
          </p>
        ))}
      </div>
    </Modal>
  );
}

export function RevisionHistory({
  trip,
  onUpdate,
  onClose,
}: {
  trip: Trip;
  onUpdate: (trip: Trip) => void;
  onClose: () => void;
}) {
  const [revisions, setRevisions] = useState<TripRevision[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const { toast } = useApp();
  useEffect(() => {
    let active = true;
    api<{ revisions: TripRevision[] }>(`/trips/${trip.id}/revisions`)
      .then((r) => {
        if (active) setRevisions(r.revisions);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [trip.id]);
  async function restore(revision: TripRevision) {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ trip: Trip }>(`/trips/${trip.id}/revisions/${revision.id}/restore`, {
        method: 'POST',
        body: JSON.stringify({ revision: trip.revision ?? 0 }),
      });
      onUpdate(r.trip);
      toast('Earlier itinerary restored. Your history is still saved.');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Every version of your journey" onClose={onClose}>
      <p className="modal-intro">
        Restore a saved itinerary. Your conversation and sharing settings stay current.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {busy && <p role="status">Loading your plans…</p>}
      <div className="revision-list">
        {revisions.map((r) => (
          <article key={r.id}>
            <History size={17} />
            <div>
              <strong>
                Version {r.version} {r.version === trip.revision && <small>· Current</small>}
              </strong>
              <p>{r.reason}</p>
              <small>{new Date(r.createdAt).toLocaleString()}</small>
            </div>
            <button
              className="button button-secondary button-small"
              disabled={busy || r.version === trip.revision}
              onClick={() => void restore(r)}
            >
              Restore
            </button>
          </article>
        ))}
      </div>
      {!busy && !revisions.length && <p>Your next saved change will appear here.</p>}
    </Modal>
  );
}
