import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarPlus, Check } from 'lucide-react';
import type { Experience, Stay, Trip } from '../../shared/types';
import { api } from '../api';
import { useApp } from '../context';
import { Modal } from './ui';
import { catalogDurationMinutes } from '../../shared/durations';

type Selection = { kind: 'stay'; item: Stay } | { kind: 'experience'; item: Experience };
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
function suggestedTime(trip: Trip | undefined, number: number, duration: number) {
  const day = trip?.itinerary.find((d) => d.day === number);
  if (!day) return '16:00';
  for (let start = 480; start + duration <= 1440; start += 15) {
    if (
      day.items.every(
        (item) =>
          start >= minutes(item.time) + (item.durationMinutes || 60) + 15 ||
          start + duration + 15 <= minutes(item.time),
      )
    )
      return `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
  }
  return '16:00';
}
export function AddToTripDialog({
  selection,
  onClose,
}: {
  selection: Selection;
  onClose: () => void;
}) {
  const { toast, ownerVersion, catalog } = useApp();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState('');
  const [day, setDay] = useState(1);
  const [time, setTime] = useState('16:00');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const requestId = useRef(crypto.randomUUID());
  const duration = selection.kind === 'stay' ? 60 : catalogDurationMinutes(selection.item.duration);
  const destination = catalog.destinations.find((d) => d.id === selection.item.destinationId)!;
  const chosen = trips.find((t) => t.id === tripId);
  const days =
    chosen?.itinerary.filter(
      (d) => (d.destinationId || chosen.destinationId) === selection.item.destinationId,
    ) || [];
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setTrips([]);
    setTripId('');
    api<{ trips: Trip[] }>('/trips')
      .then((result) => {
        if (!active) return;
        const eligible = result.trips.filter((t) =>
          t.itinerary.some(
            (d) => (d.destinationId || t.destinationId) === selection.item.destinationId,
          ),
        );
        setTrips(eligible);
        if (eligible.length) {
          const first = eligible[0];
          const dayNumber = first.itinerary.find(
            (d) => (d.destinationId || first.destinationId) === selection.item.destinationId,
          )!.day;
          setTripId(first.id);
          setDay(dayNumber);
          setTime(suggestedTime(first, dayNumber, duration));
        }
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
  }, [selection.item.destinationId, ownerVersion, duration, refresh]);
  function selectTrip(id: string) {
    const trip = trips.find((t) => t.id === id)!;
    const number = trip.itinerary.find(
      (d) => (d.destinationId || trip.destinationId) === selection.item.destinationId,
    )!.day;
    setTripId(id);
    setDay(number);
    setTime(suggestedTime(trip, number, duration));
    requestId.current = crypto.randomUUID();
    setError('');
  }
  return (
    <Modal title="Make room for this idea" onClose={onClose}>
      <p className="modal-intro">
        <strong>{selection.item.name}</strong>
        <br />
        Add it to a day in {destination.name}. Your choice will be protected when Tara replans.
      </p>
      {loading ? (
        <p role="status">Finding your trips…</p>
      ) : !trips.length ? (
        <div className="stack-form">
          <p>You don’t have an itinerary in {destination.name} yet.</p>
          <Link
            className="button button-primary"
            to={`/chat?q=${encodeURIComponent(`Plan a 5 day trip to ${destination.name}`)}`}
            onClick={onClose}
          >
            Plan a trip here
            <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
        <form
          className="stack-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!chosen) return;
            setBusy(true);
            setError('');
            try {
              const result = await api<{ trip: Trip }>(`/trips/${chosen.id}/items`, {
                method: 'POST',
                body: JSON.stringify({
                  kind: selection.kind,
                  itemId: selection.item.id,
                  day,
                  time,
                  revision: chosen.revision ?? 0,
                  requestId: requestId.current,
                }),
              });
              toast('Added to your itinerary and protected. Nothing has been booked.');
              onClose();
              navigate(`/chat/${result.trip.id}`);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Choose a trip
            <select value={tripId} onChange={(e) => selectTrip(e.target.value)}>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              Choose a day
              <select
                value={day}
                onChange={(e) => {
                  const number = Number(e.target.value);
                  setDay(number);
                  setTime(suggestedTime(chosen, number, duration));
                  requestId.current = crypto.randomUUID();
                  setError('');
                }}
              >
                {days.map((d) => (
                  <option key={d.day} value={d.day}>
                    Day {d.day} · {d.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start time
              <input
                type="time"
                required
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  requestId.current = crypto.randomUUID();
                  setError('');
                }}
              />
            </label>
          </div>
          <p className="muted">
            Allow {duration} minutes, plus a 15-minute gap between stops.{' '}
            {selection.kind === 'stay'
              ? 'This adds a sample stay reminder; its nightly room allowance is separate from activity costs.'
              : 'This is an experience idea with an estimated per-person cost.'}
          </p>
          <button className="button button-primary" disabled={busy || !chosen}>
            {busy ? 'Adding…' : 'Add to this trip'}
            {busy ? <CalendarPlus size={16} /> : <Check size={16} />}
          </button>
        </form>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
          <button
            type="button"
            className="text-link"
            onClick={() => {
              requestId.current = crypto.randomUUID();
              setRefresh((n) => n + 1);
            }}
          >
            Refresh trip choices
          </button>
        </div>
      )}
    </Modal>
  );
}
