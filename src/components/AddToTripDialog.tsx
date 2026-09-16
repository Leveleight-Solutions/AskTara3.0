import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarPlus, Check, CircleAlert } from 'lucide-react';
import { Box, Button, Callout, Flex, Grid, Select, Text, TextField } from '@radix-ui/themes';
import type { Experience, Stay, Trip } from '../../shared/types';
import { api } from '../api';
import { useApp } from '../context';
import { Modal, Spinner } from './ui';
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
      <Text as="p" size="2" mt="2" mb="4">
        <Text weight="bold">{selection.item.name}</Text>
        <br />
        Add it to a day in {destination.name}. Your choice will be protected when Tara replans.
      </Text>
      {loading ? (
        <Spinner label="Finding your trips…" />
      ) : !trips.length ? (
        <Flex direction="column" align="start" gap="3">
          <Text as="p" size="2">
            You don’t have an itinerary in {destination.name} yet.
          </Text>
          <Button asChild size="3">
            <Link
              to={`/chat?q=${encodeURIComponent(`Plan a 5 day trip to ${destination.name}`)}`}
              onClick={onClose}
            >
              Plan a trip here
              <ArrowRight size={16} />
            </Link>
          </Button>
        </Flex>
      ) : (
        <form
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
          <Flex direction="column" gap="4">
            <Flex direction="column" gap="1">
              <Text as="label" size="2" weight="medium">
                Choose a trip
              </Text>
              <Select.Root size="3" value={tripId} onValueChange={selectTrip}>
                <Select.Trigger aria-label="Choose a trip" />
                <Select.Content>
                  {trips.map((t) => (
                    <Select.Item key={t.id} value={t.id}>
                      {t.title}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
            <Grid columns={{ initial: '1', xs: '2' }} gap="4">
              <Flex direction="column" gap="1">
                <Text as="label" size="2" weight="medium">
                  Choose a day
                </Text>
                <Select.Root
                  size="3"
                  value={String(day)}
                  onValueChange={(value) => {
                    const number = Number(value);
                    setDay(number);
                    setTime(suggestedTime(chosen, number, duration));
                    requestId.current = crypto.randomUUID();
                    setError('');
                  }}
                >
                  <Select.Trigger aria-label="Choose a day" />
                  <Select.Content>
                    {days.map((d) => (
                      <Select.Item key={d.day} value={String(d.day)}>
                        Day {d.day} · {d.title}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </Flex>
              <Flex direction="column" gap="1" asChild>
                <label>
                  <Text size="2" weight="medium">
                    Start time
                  </Text>
                  <TextField.Root
                    size="3"
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
              </Flex>
            </Grid>
            <Text as="p" size="1" color="gray">
              Allow {duration} minutes, plus a 15-minute gap between stops.{' '}
              {selection.kind === 'stay'
                ? 'This adds a sample stay reminder; its nightly room allowance is separate from activity costs.'
                : 'This is an experience idea with an estimated per-person cost.'}
            </Text>
            <Button size="3" disabled={busy || !chosen} loading={busy}>
              {busy ? 'Adding…' : 'Add to this trip'}
              {busy ? <CalendarPlus size={16} /> : <Check size={16} />}
            </Button>
          </Flex>
        </form>
      )}
      {error && (
        <Callout.Root color="red" role="alert" mt="4">
          <Callout.Icon>
            <CircleAlert size={16} />
          </Callout.Icon>
          <Callout.Text>{error}</Callout.Text>
          <Box>
            <Button
              type="button"
              variant="soft"
              size="3"
              color="red"
              onClick={() => {
                requestId.current = crypto.randomUUID();
                setRefresh((n) => n + 1);
              }}
            >
              Refresh trip choices
            </Button>
          </Box>
        </Callout.Root>
      )}
    </Modal>
  );
}
