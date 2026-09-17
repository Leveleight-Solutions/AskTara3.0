import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUp,
  CalendarDays,
  Check,
  CheckCheck,
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
  MapPin,
  MessageCircle,
  Plus,
  Share2,
  Sparkles,
  Trash2,
  TriangleAlert,
  Users,
  Wallet,
  BedDouble,
  Plane,
  Globe2,
  History,
  LockKeyhole,
  LockKeyholeOpen,
} from 'lucide-react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Container,
  DataList,
  Em,
  Flex,
  Grid,
  Heading,
  IconButton,
  Inset,
  Link as RadixLink,
  Select,
  Separator,
  Tabs,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes';
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
import { SplitWorkspace, type PaneTab } from '../components/SplitWorkspace';
import { ChatTurn, TaraAvatar } from '../components/ChatTurn';
import ConsultationSummary, { consultationBudget } from '../components/ConsultationSummary';
import HotelSearch from '../components/HotelSearch';

const categoryIcons = {
  food: Coffee,
  sight: MapPin,
  experience: Sparkles,
  stay: BedDouble,
  leisure: Leaf,
};

/** A label above its control, the Radix Themes way. */
function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Text as="label" size="2" weight="medium">
      <Flex direction="column" gap="1">
        {label}
        {children}
      </Flex>
    </Text>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <Callout.Root color="red" role="alert">
      <Callout.Icon>
        <TriangleAlert size={16} />
      </Callout.Icon>
      <Callout.Text>{message}</Callout.Text>
    </Callout.Root>
  );
}

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
      <Flex asChild direction="column" gap="3" mt="3">
        <form onSubmit={save}>
          <Field label="Trip name">
            <TextField.Root
              size="3"
              required
              maxLength={120}
              value={values.title}
              onChange={(e) => updateValues({ title: e.target.value })}
            />
          </Field>
          <Field label="Start date">
            <TextField.Root
              size="3"
              type="date"
              value={values.startDate}
              onChange={(e) => updateValues({ startDate: e.target.value })}
            />
          </Field>
          <Flex gap="3" wrap="wrap">
            <Box flexGrow="1" minWidth="140px">
              <Field label="Number of days">
                <TextField.Root
                  size="3"
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
              </Field>
            </Box>
            <Box flexGrow="1" minWidth="140px">
              <Field label="Travelers">
                <TextField.Root
                  size="3"
                  type="number"
                  min={1}
                  max={16}
                  value={values.travelers}
                  placeholder="Not discussed"
                  onChange={(e) =>
                    updateValues({ travelers: e.target.value ? Number(e.target.value) : '' })
                  }
                />
              </Field>
            </Box>
          </Flex>
          <Field label={`Total group budget (${values.brief.consultation.currency})`}>
            <TextField.Root
              size="3"
              type="number"
              min={0}
              max={1000000}
              value={values.budget}
              placeholder="Not discussed"
              onChange={(e) =>
                updateValues({ budget: e.target.value ? Number(e.target.value) : '' })
              }
            />
          </Field>
          <Field label="Budget currency">
            <Select.Root
              size="3"
              value={values.brief.consultation.currency}
              onValueChange={(currency) =>
                updateValues({
                  brief: {
                    ...values.brief,
                    consultation: { ...values.brief.consultation, currency },
                  },
                })
              }
            >
              <Select.Trigger aria-label="Budget currency" />
              <Select.Content>
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
                  <Select.Item value={currency} key={currency}>
                    {currency}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Field>
          <BriefFields
            trip={trip}
            value={values.brief}
            days={values.days || trip.days}
            onChange={(brief) =>
              updateValues({
                brief: { ...brief, consultation: brief.consultation || consultation },
              })
            }
          />
          <Text as="p" size="1" color="gray">
            Your edited stops are protected when the itinerary changes. Earlier versions are saved
            in your trip history.
          </Text>
          {error && <FormError message={error} />}
          <Button size="3" loading={busy} disabled={busy}>
            {busy ? 'Saving…' : 'Save trip details'}
            <Check size={16} />
          </Button>
        </form>
      </Flex>
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
      <Flex asChild direction="column" gap="3" mt="3">
        <form
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
          <Field label="What’s the plan?">
            <TextField.Root
              size="3"
              required
              maxLength={160}
              value={value.title}
              onChange={(e) => setValue({ ...value, title: e.target.value })}
            />
          </Field>
          <Flex gap="3" wrap="wrap">
            <Box flexGrow="1" minWidth="140px">
              <Field label="Time">
                <TextField.Root
                  size="3"
                  type="time"
                  required
                  value={value.time}
                  onChange={(e) => setValue({ ...value, time: e.target.value })}
                />
              </Field>
            </Box>
            <Box flexGrow="1" minWidth="140px">
              <Field label="Estimated cost / person (USD)">
                <TextField.Root
                  size="3"
                  type="number"
                  min={0}
                  max={100000}
                  value={value.cost}
                  onChange={(e) => setValue({ ...value, cost: Number(e.target.value) })}
                />
              </Field>
            </Box>
          </Flex>
          <Field label="Duration (minutes)">
            <TextField.Root
              size="3"
              type="number"
              min={15}
              max={720}
              step={15}
              value={value.durationMinutes ?? 60}
              onChange={(e) => setValue({ ...value, durationMinutes: Number(e.target.value) })}
            />
          </Field>
          <Text as="p" size="1" color="gray">
            Saving a change protects this stop from automatic replanning. You can unlock it from
            your itinerary.
          </Text>
          <Field label="Place">
            <TextField.Root
              size="3"
              required
              value={value.location}
              maxLength={200}
              onChange={(e) => setValue({ ...value, location: e.target.value })}
            />
          </Field>
          <Field label="Category">
            <Select.Root
              size="3"
              value={value.category}
              onValueChange={(category) =>
                setValue({ ...value, category: category as ItineraryItem['category'] })
              }
            >
              <Select.Trigger aria-label="Category" />
              <Select.Content>
                <Select.Item value="sight">Place to see</Select.Item>
                <Select.Item value="food">Food &amp; drink</Select.Item>
                <Select.Item value="experience">Experience</Select.Item>
                <Select.Item value="leisure">Free time</Select.Item>
                <Select.Item value="stay">Stay</Select.Item>
              </Select.Content>
            </Select.Root>
          </Field>
          <Field label="A little more detail">
            <TextArea
              size="3"
              value={value.description}
              maxLength={1200}
              rows={3}
              onChange={(e) => setValue({ ...value, description: e.target.value })}
            />
          </Field>
          {error && <FormError message={error} />}
          <Button size="3" loading={busy} disabled={busy}>
            {busy ? 'Saving…' : 'Save this moment'}
            <Check size={16} />
          </Button>
        </form>
      </Flex>
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
      <Flex direction="column" gap="3" mt="3" align="start">
        <Text as="p" size="2" color="gray">
          Anyone with this link can view your itinerary, dates, and budget. Your conversation and
          account details stay private.
        </Text>
        {token ? (
          <>
            <Box width="100%">
              <Field label="Your trip link">
                <TextField.Root
                  size="3"
                  aria-label="Your trip link"
                  value={url}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
              </Field>
            </Box>
            <Flex gap="3" wrap="wrap">
              <Button
                size="3"
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
              </Button>
              <Button asChild size="3" variant="soft">
                <a href={url} target="_blank" rel="noreferrer">
                  Preview
                  <ExternalLink size={15} />
                </a>
              </Button>
            </Flex>
            <Button
              size="3"
              variant="soft"
              color="gray"
              disabled={busy}
              onClick={() => void disable()}
            >
              Turn off sharing
            </Button>
          </>
        ) : (
          <Button
            size="3"
            style={{ width: '100%' }}
            loading={busy}
            disabled={busy}
            onClick={() => void enable()}
          >
            {busy ? 'Creating your link…' : 'Create a share link'}
            <Link2 size={16} />
          </Button>
        )}
        {error && <FormError message={error} />}
      </Flex>
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
    <Flex direction="column" gap="4" p={{ initial: '3', md: '4' }}>
      <Card size="2">
        <Inset clip="padding-box" side="top" pb="current">
          <Box position="relative">
            <img
              src={destination.image || '/images/destination-placeholder.svg'}
              alt={
                destination.image?.includes('destination-placeholder')
                  ? `Illustrated landscape for ${destination.name}`
                  : destination.name
              }
              style={{ display: 'block', width: '100%', height: 200, objectFit: 'cover' }}
            />
            {!readOnly && (
              <Box position="absolute" top="2" right="2">
                <IconButton
                  size="3"
                  variant="solid"
                  color="gray"
                  highContrast
                  disabled={locked}
                  onClick={() => setSettings(true)}
                  aria-label="Edit trip details"
                >
                  <Edit3 size={15} />
                </IconButton>
              </Box>
            )}
          </Box>
        </Inset>
        <Flex direction="column" gap="2" align="start">
          <Text size="1" color="gray" weight="medium">
            {destination.country} · YOUR NEXT CHAPTER
          </Text>
          <Heading size="6" as="h2">
            {trip.title}
          </Heading>
          <Flex gap="2" wrap="wrap" align="center">
            <Badge color="gray" variant="soft">
              <CalendarDays size={13} />
              {trip.days} days
            </Badge>
            <Badge color="gray" variant="soft">
              <Users size={13} />
              {trip.travelers} travelers
            </Badge>
            {trip.status === 'planned' ? (
              <Badge color="green" variant="soft">
                <CheckCheck size={13} />
                Ready to go
              </Badge>
            ) : (
              <Badge color="amber" variant="soft">
                <Edit3 size={12} />A work in progress
              </Badge>
            )}
          </Flex>
        </Flex>
      </Card>
      <Tabs.Root value={tab} onValueChange={(value) => setTab(value as 'itinerary' | 'stays')}>
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <Tabs.List size="2">
            <Tabs.Trigger value="itinerary">
              <Flex align="center" gap="2">
                <List size={15} />
                Itinerary
              </Flex>
            </Tabs.Trigger>
            <Tabs.Trigger value="stays">
              <Flex align="center" gap="2">
                <BedDouble size={15} />
                Stays &amp; details
              </Flex>
            </Tabs.Trigger>
          </Tabs.List>
          {!readOnly && (
            <Flex gap="2">
              <IconButton
                size="3"
                variant="soft"
                color="gray"
                disabled={locked}
                onClick={() => setHistory(true)}
                aria-label="Itinerary history"
              >
                <History size={16} />
              </IconButton>
              <IconButton
                size="3"
                variant="soft"
                color="gray"
                onClick={() => setShare(true)}
                disabled={locked}
                aria-label="Share trip"
              >
                <Share2 size={16} />
              </IconButton>
              <IconButton
                size="3"
                variant="soft"
                color="gray"
                onClick={() => void exportCalendar()}
                disabled={locked}
                aria-label="Export to calendar"
              >
                <Download size={16} />
              </IconButton>
            </Flex>
          )}
        </Flex>
        <Tabs.Content value="itinerary">
          <Flex direction="column" gap="4" pt="4">
            <Flex gap="2" wrap="wrap" role="group" aria-label="Itinerary days">
              {trip.itinerary.map((d) => (
                <Button
                  key={d.day}
                  size="3"
                  variant={day.day === d.day ? 'solid' : 'soft'}
                  color="gray"
                  highContrast={day.day === d.day}
                  aria-pressed={day.day === d.day}
                  onClick={() => setSelected(d.day)}
                >
                  Day {d.day}
                </Button>
              ))}
            </Flex>
            <Flex align="end" justify="between" gap="3" wrap="wrap" data-testid="day-intro">
              <Flex direction="column" gap="1" align="start">
                <Text size="1" color="gray" weight="medium">
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
                </Text>
                <Heading size="5" as="h3">
                  {day.title}
                </Heading>
                <Flex align="center" gap="1">
                  <MapPin size={11} />
                  <Text size="1" color="gray">
                    {dayDestination?.name}
                  </Text>
                </Flex>
              </Flex>
              <Badge color="gray" variant="soft">
                {day.items.length} moments
              </Badge>
            </Flex>
            <ItineraryMap trip={trip} day={day} freshPlaces={freshPlaces} />
            <Flex direction="column" gap="3">
              {day.items.map((item) => {
                const Icon = categoryIcons[item.category];
                const fresh = item.placeId ? freshPlaces[item.placeId] : undefined;
                const visibleTitle = fresh?.name || item.title;
                return (
                  <Flex gap="3" align="start" key={item.id}>
                    <Flex direction="column" align="center" gap="1" width="56px" flexShrink="0">
                      <Text size="1" color="gray" weight="medium">
                        {item.time}
                      </Text>
                      <Flex
                        align="center"
                        justify="center"
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: '100%',
                          background: 'var(--accent-3)',
                          color: 'var(--accent-11)',
                        }}
                      >
                        <Icon size={14} />
                      </Flex>
                    </Flex>
                    <Box flexGrow="1" minWidth="0">
                      <Card asChild size="2">
                        <article style={{ opacity: item.completed ? 0.65 : 1 }}>
                          <Flex direction="column" gap="2" align="start">
                            <Flex align="start" justify="between" gap="3" width="100%">
                              <Flex align="center" gap="2" wrap="wrap">
                                <Heading size="3" as="h4">
                                  {visibleTitle}
                                </Heading>
                                {item.completed && (
                                  <Badge color="green" variant="soft">
                                    <Check size={11} />
                                    Done
                                  </Badge>
                                )}
                              </Flex>
                              {!readOnly && (
                                <IconButton
                                  size="3"
                                  variant={item.completed ? 'solid' : 'soft'}
                                  color={item.completed ? 'green' : 'gray'}
                                  aria-label={`${item.completed ? 'Mark incomplete' : 'Mark complete'}: ${item.title}`}
                                  aria-pressed={item.completed}
                                  disabled={locked}
                                  onClick={() => void toggleComplete(day.day, item.id)}
                                >
                                  <Check size={13} />
                                </IconButton>
                              )}
                            </Flex>
                            <Text as="p" size="2" color="gray">
                              {item.description}
                            </Text>
                            <Flex align="center" justify="between" gap="3" wrap="wrap" width="100%">
                              <RadixLink
                                size="1"
                                href={
                                  safeWebUrl(fresh?.mapsUrl) ||
                                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.location + ', ' + dayDestination?.name)}${item.placeId?.startsWith('google-') ? '&query_place_id=' + encodeURIComponent(item.placeId.slice(7)) : ''}`
                                }
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Flex align="center" gap="1" display="inline-flex">
                                  <MapPin size={11} />
                                  {fresh?.address || item.location}
                                  <ExternalLink size={9} />
                                </Flex>
                              </RadixLink>
                              <Text size="1" color="gray">
                                {item.cost ? `${money(item.cost)} USD est.` : 'No cost added'}
                              </Text>
                            </Flex>
                            <Flex align="center" gap="2" wrap="wrap">
                              {fresh && (
                                <Badge color="gray" variant="soft">
                                  Google Maps
                                </Badge>
                              )}
                              {trip.planning?.sources.some(
                                (source) => source.id === item.sourceId && source.kind === 'web',
                              ) && (
                                <Badge color="gray" variant="soft">
                                  Web research
                                </Badge>
                              )}
                              {item.durationMinutes && (
                                <Flex align="center" gap="1">
                                  <Clock3 size={11} />
                                  <Text size="1" color="gray">
                                    {item.durationMinutes} min
                                  </Text>
                                </Flex>
                              )}
                              {!!item.travelMinutes && (
                                <Text size="1" color="gray">
                                  Allow {item.travelMinutes} min to get here
                                </Text>
                              )}
                              {(trip.planning?.places.some((p) => p.id === item.placeId) ||
                                (!readOnly && item.placeId?.startsWith('google-'))) && (
                                <Button
                                  size="2"
                                  variant="ghost"
                                  color="gray"
                                  onClick={() =>
                                    setPlace(
                                      fresh ||
                                        trip.planning?.places.find(
                                          (p) => p.id === item.placeId,
                                        ) || {
                                          id: item.placeId!,
                                          name: item.title,
                                          address: item.location,
                                          destinationId: day.destinationId || trip.destinationId,
                                          category:
                                            item.category === 'stay' ? 'leisure' : item.category,
                                          durationMinutes: item.durationMinutes || 60,
                                          estimatedCost: item.cost,
                                          sourceId:
                                            item.sourceId || `google-places-${trip.destinationId}`,
                                        },
                                    )
                                  }
                                >
                                  Place details <ChevronRight size={11} />
                                </Button>
                              )}
                              {readOnly && item.locked && (
                                <Badge color="amber" variant="soft">
                                  <LockKeyhole size={11} />
                                  Personal choice
                                </Badge>
                              )}
                            </Flex>
                            {!readOnly && (
                              <Flex gap="2" wrap="wrap" pt="3">
                                <Button
                                  size="3"
                                  variant="soft"
                                  color={item.locked ? 'amber' : 'gray'}
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
                                  {item.locked ? (
                                    <LockKeyhole size={11} />
                                  ) : (
                                    <LockKeyholeOpen size={11} />
                                  )}
                                  {item.locked ? 'Protected' : 'Protect'}
                                </Button>
                                <Button
                                  size="3"
                                  variant="soft"
                                  color="gray"
                                  disabled={locked}
                                  onClick={() => setEditing({ day: day.day, item })}
                                >
                                  <Edit3 size={11} />
                                  Edit
                                </Button>
                                <IconButton
                                  size="3"
                                  variant="soft"
                                  color="gray"
                                  disabled={locked}
                                  aria-label={`Remove ${item.title}`}
                                  onClick={() => void removeItem(day.day, item.id)}
                                >
                                  <Trash2 size={11} />
                                </IconButton>
                              </Flex>
                            )}
                          </Flex>
                        </article>
                      </Card>
                    </Box>
                  </Flex>
                );
              })}
            </Flex>
            {!readOnly && (
              <Button
                size="3"
                variant="soft"
                style={{ width: '100%' }}
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
              </Button>
            )}
            <Callout.Root color="gray" variant="surface">
              <Callout.Icon>
                <Sparkles size={14} />
              </Callout.Icon>
              <Callout.Text>
                Leave room for the unexpected. Costs are estimates per person; check opening hours
                and book directly.
              </Callout.Text>
            </Callout.Root>
          </Flex>
        </Tabs.Content>
        <Tabs.Content value="stays">
          <Flex direction="column" gap="4" pt="4">
            <Grid columns={{ initial: '2', md: '4' }} gap="3">
              <Card>
                <Flex direction="column" gap="1" align="start">
                  <CalendarDays size={18} />
                  <Text size="1" color="gray">
                    When
                  </Text>
                  <Text size="2" weight="bold">
                    {getConsultation(trip).facts.dates
                      ? getConsultation(trip).facts.dates?.valueState === 'flexible'
                        ? 'Flexible dates'
                        : readableDate(trip.startDate)
                      : 'Not discussed'}
                  </Text>
                </Flex>
              </Card>
              <Card>
                <Flex direction="column" gap="1" align="start">
                  <Users size={18} />
                  <Text size="1" color="gray">
                    Who’s coming
                  </Text>
                  <Text size="2" weight="bold">
                    {getConsultation(trip).facts.travelers
                      ? `${trip.travelers} travellers`
                      : 'Not discussed'}
                  </Text>
                </Flex>
              </Card>
              <Card>
                <Flex direction="column" gap="1" align="start">
                  <Wallet size={18} />
                  <Text size="1" color="gray">
                    Total group budget
                  </Text>
                  <Text size="2" weight="bold">
                    {consultationBudget(trip)}
                  </Text>
                </Flex>
              </Card>
              <Card>
                <Flex direction="column" gap="1" align="start">
                  <MapPin size={18} />
                  <Text size="1" color="gray">
                    Best time to visit
                  </Text>
                  <Text size="2" weight="bold">
                    {destination.bestTime}
                  </Text>
                </Flex>
              </Card>
            </Grid>
            <Box aria-label="Travel service preferences">
              <DataList.Root size="2" orientation="horizontal">
                <DataList.Item>
                  <DataList.Label minWidth="140px">Flights</DataList.Label>
                  <DataList.Value>
                    <Text weight="bold">
                      {serviceLabels[getConsultation(trip).services.flights.status]}
                    </Text>
                  </DataList.Value>
                </DataList.Item>
                <DataList.Item>
                  <DataList.Label minWidth="140px">Accommodation</DataList.Label>
                  <DataList.Value>
                    <Text weight="bold">
                      {serviceLabels[getConsultation(trip).services.hotels.status]}
                    </Text>
                  </DataList.Value>
                </DataList.Item>
              </DataList.Root>
            </Box>
            {trip.planning ? (
              <PlanningReview
                trip={trip}
                onSettings={readOnly ? undefined : () => setSettings(true)}
              />
            ) : (
              <Card size="3">
                <Heading size="4" as="h3" mb="2">
                  A little budget perspective
                </Heading>
                <DataList.Root size="2">
                  <DataList.Item>
                    <DataList.Label minWidth="220px">
                      Activities &amp; meals for your group
                    </DataList.Label>
                    <DataList.Value>
                      <Text weight="bold">{money(totalActivities)}</Text>
                    </DataList.Value>
                  </DataList.Item>
                  <DataList.Item>
                    <DataList.Label minWidth="220px">Stays &amp; flights</DataList.Label>
                    <DataList.Value>Not included in this estimate</DataList.Value>
                  </DataList.Item>
                </DataList.Root>
                <Text as="p" size="1" color="gray" mt="2">
                  These are planning estimates in USD, not quotes. Final prices depend on your
                  dates, availability, and choices.
                </Text>
              </Card>
            )}
            {!trip.planning && stay && (
              <Card size="2">
                <Inset clip="padding-box" side="top" pb="current">
                  <img
                    src={stay.image}
                    alt={stay.name}
                    style={{ display: 'block', width: '100%', height: 180, objectFit: 'cover' }}
                  />
                </Inset>
                <Flex direction="column" gap="2" align="start">
                  <Text size="1" color="gray" weight="medium">
                    SOMEWHERE TO REST YOUR HEAD
                  </Text>
                  <Heading size="4" as="h3">
                    {stay.name}
                  </Heading>
                  <Text as="p" size="2" color="gray">
                    {stay.description}
                  </Text>
                  <Flex align="center" justify="between" gap="3" wrap="wrap" width="100%">
                    <Text size="2">
                      Sample stay · from <Text weight="bold">{money(stay.price)}</Text> / night
                    </Text>
                    <RadixLink asChild size="2">
                      <Link to={`/stays?destination=${destination.id}`}>
                        <Flex align="center" gap="1" display="inline-flex">
                          Explore stays
                          <ArrowRight size={14} />
                        </Flex>
                      </Link>
                    </RadixLink>
                  </Flex>
                </Flex>
              </Card>
            )}
            {!readOnly && <HotelSearch trip={trip} destinationId={destination.id} />}
            <Button asChild size="3" variant="soft" style={{ width: '100%' }}>
              <Link to="/flights">
                <Plane size={16} />
                Find a way to get there
              </Link>
            </Button>
            <Text as="p" size="1" color="gray">
              Sample stays are inspiration. No reservations have been made.
            </Text>
          </Flex>
        </Tabs.Content>
      </Tabs.Root>
      {!readOnly && (
        <Card
          style={{
            position: 'sticky',
            bottom: 0,
            background: 'var(--color-panel-solid)',
          }}
        >
          <Flex align="center" justify="between" gap="3" wrap="wrap">
            <Flex align="center" gap="2" role="status">
              <Check size={12} />
              <Text size="1" color="gray">
                {saving ? 'Saving your changes…' : 'All your plans, safely saved'}
              </Text>
            </Flex>
            <Button
              size="3"
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
            </Button>
          </Flex>
        </Card>
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
    </Flex>
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
  const [mobileTab, setMobileTab] = useState<PaneTab>('primary');
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
      setMobileTab('primary');
    }
  }, [id, params]);
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [trip?.messages.length, pending, busy]);
  return (
    <SplitWorkspace
      tab={mobileTab}
      onTabChange={setMobileTab}
      tabs={{
        primary: { label: 'Chat with Tara', icon: <MessageCircle size={15} /> },
        secondary: {
          label: 'Your itinerary',
          icon: <List size={15} />,
          badge: trip?.itinerary.length ? (
            <Badge color="gray" variant="soft">
              {trip.days}
            </Badge>
          ) : null,
        },
      }}
      tabsLabel="Trip planner panes"
      primaryLabel="Conversation with Tara"
      primaryBodyTestId="chat-messages"
      primaryHeader={
        <Flex align="center" gap="3" p="3" style={{ borderBottom: '1px solid var(--gray-a5)' }}>
          <Flex
            align="center"
            justify="center"
            flexShrink="0"
            style={{
              width: 40,
              height: 40,
              borderRadius: 'var(--radius-3)',
              background: 'var(--accent-3)',
              color: 'var(--accent-11)',
            }}
          >
            <TaraMark size={24} />
          </Flex>
          <Flex direction="column" gap="1" align="start" flexGrow="1" minWidth="0">
            <Heading size="2" as="h2">
              Your travel concierge
            </Heading>
            <Badge color={integrations.ai ? 'green' : 'gray'} variant="soft">
              {integrations.ai ? 'Ready for a little adventure' : 'Curated planning mode'}
            </Badge>
          </Flex>
          <IconButton asChild size="3" variant="soft" color="gray">
            <Link
              to="/chat"
              aria-label="Start a new conversation"
              onClick={(e) => {
                if (busy) e.preventDefault();
              }}
            >
              <Plus size={19} />
            </Link>
          </IconButton>
        </Flex>
      }
      primary={
        <>
          {loading ? (
            <Spinner label="Unpacking your plans…" />
          ) : !trip?.messages.length && !pending && !busy ? (
            <Flex
              direction="column"
              align="start"
              gap="3"
              py="5"
              style={{ maxWidth: 440, margin: '0 auto' }}
            >
              <Box style={{ color: 'var(--accent-11)' }}>
                <TaraMark size={41} />
              </Box>
              <Text size="1" color="gray" weight="medium">
                A LITTLE HELLO FROM TARA
              </Text>
              <Heading size="8" as="h1">
                Where are we
                <br />
                <Em>dreaming of?</Em>
              </Heading>
              <Text as="p" size="3" color="gray">
                Tell me about the trip you can’t stop thinking about. A place, a feeling, or just a
                little need to get away.
              </Text>
              <Flex direction="column" gap="2" width="100%" my="2">
                {[
                  '5 days in Kyoto, with plenty of food and culture',
                  'A slow week on the Amalfi Coast for two',
                  'A 4 day adventure in Hunza Valley',
                ].map((q) => (
                  <Button
                    key={q}
                    size="3"
                    variant="soft"
                    color="gray"
                    style={{ width: '100%', justifyContent: 'space-between' }}
                    onClick={() => void send(q)}
                  >
                    {q}
                    <ArrowUp size={14} />
                  </Button>
                ))}
              </Flex>
              <Text as="p" size="1" color="gray">
                {integrations.ai
                  ? 'Your plans come together here, one conversation at a time.'
                  : `Planning from ${catalog.destinations.length} curated destinations. Tell Tara where you’d like to go.`}
              </Text>
            </Flex>
          ) : (
            <Flex direction="column" gap="4">
              {trip?.messages.map((message) => (
                <ChatTurn
                  key={message.id}
                  role={message.role === 'assistant' ? 'assistant' : 'user'}
                  testId={`${message.role}-message`}
                  after={
                    <>
                      {message.role === 'assistant' &&
                        message.id === trip.messages.at(-1)?.id &&
                        !busy && (
                          <Flex direction="column" gap="2" mt="1" align="start">
                            {consultationQuestions
                              .filter((question) => question.suggestions.length)
                              .map((question) => (
                                <Box
                                  key={question.field}
                                  role="group"
                                  aria-label={question.question}
                                >
                                  <Text as="p" size="1" color="gray" mb="1">
                                    {question.field === 'hotels'
                                      ? 'Accommodation'
                                      : question.field === 'flight_dates'
                                        ? 'Flight dates'
                                        : question.field.charAt(0).toUpperCase() +
                                          question.field.slice(1)}
                                  </Text>
                                  <Flex gap="2" wrap="wrap">
                                    {question.suggestions.slice(0, 4).map((suggestion) => (
                                      <Button
                                        key={suggestion}
                                        type="button"
                                        size="3"
                                        variant="soft"
                                        onClick={() => void send(suggestion)}
                                      >
                                        {suggestion}
                                      </Button>
                                    ))}
                                  </Flex>
                                </Box>
                              ))}
                          </Flex>
                        )}
                      {message.role === 'assistant' &&
                        message.id === trip.messages.at(-1)?.id &&
                        !trip.itinerary.length &&
                        getConsultation(trip).facts.destination?.valueState !== 'specified' && (
                          <Flex gap="2" wrap="wrap" mt="1">
                            {tripDestinations(trip)
                              .filter((d) => message.content.includes(d.name))
                              .slice(0, 4)
                              .map((d) => (
                                <Button
                                  key={d.id}
                                  size="3"
                                  variant="soft"
                                  color="gray"
                                  disabled={busy}
                                  onClick={() => void send(`Let's go to ${d.name}`)}
                                >
                                  <img
                                    src={d.image}
                                    alt=""
                                    style={{
                                      width: 22,
                                      height: 22,
                                      borderRadius: 'var(--radius-1)',
                                      objectFit: 'cover',
                                    }}
                                  />
                                  {d.name}
                                  <ArrowRight size={13} />
                                </Button>
                              ))}
                          </Flex>
                        )}
                      {message.role === 'assistant' &&
                        message.id === trip.messages.at(-1)?.id &&
                        trip.itinerary.length > 0 && (
                          <Box display={{ initial: 'block', md: 'none' }} mt="1">
                            <Button
                              size="3"
                              variant="soft"
                              onClick={() => setMobileTab('secondary')}
                            >
                              Take a look at your itinerary
                              <ArrowRight size={14} />
                            </Button>
                          </Box>
                        )}
                    </>
                  }
                >
                  {message.role === 'assistant' ? (
                    <ConciergeMessage text={message.content} />
                  ) : (
                    <MarkdownText text={message.content} />
                  )}
                </ChatTurn>
              ))}
              {pending && (
                <ChatTurn role="user">
                  <Text as="p" size="2">
                    {pending}
                  </Text>
                </ChatTurn>
              )}
              {busy && (
                <Flex gap="2" align="start">
                  <TaraAvatar />
                  <Flex direction="column" gap="1" align="start" flexGrow="1" minWidth="0">
                    <PlanningProgress
                      run={run}
                      cancelling={cancelling}
                      onCancel={() => void cancel().catch((e) => toast(e.message))}
                    />
                  </Flex>
                </Flex>
              )}
            </Flex>
          )}
          {error && (
            <Callout.Root color="red" role="alert" mt="3">
              <Callout.Icon>
                <TriangleAlert size={16} />
              </Callout.Icon>
              <Callout.Text>{error}</Callout.Text>
              {retryPrompt && (
                <Box>
                  <Button
                    size="3"
                    variant="soft"
                    color="red"
                    onClick={() => void send(retryPrompt)}
                  >
                    Try again <ArrowRight size={12} />
                  </Button>
                </Box>
              )}
            </Callout.Root>
          )}
          <div ref={messagesEnd} />
        </>
      }
      primaryFooter={
        <Flex
          direction="column"
          gap="2"
          p="3"
          flexShrink="0"
          style={{ borderTop: '1px solid var(--gray-a5)' }}
        >
          {trip?.itinerary.length && !busy && !consultationQuestions.length ? (
            <Flex gap="2" wrap="wrap">
              <Button
                size="3"
                variant="soft"
                color="gray"
                onClick={() => void send('Make it slower and more relaxing')}
              >
                A slower pace
              </Button>
              <Button
                size="3"
                variant="soft"
                color="gray"
                onClick={() => void send('Make the trip more budget friendly')}
              >
                A smaller budget
              </Button>
              <Button
                size="3"
                variant="soft"
                color="gray"
                onClick={() => void send('Add more food and culture')}
              >
                Follow the food
              </Button>
            </Flex>
          ) : null}
          {trip &&
          !trip.itinerary.length &&
          trip.planning?.questions.length &&
          !consultationQuestions.length &&
          !busy &&
          !loading ? (
            <Flex gap="2" wrap="wrap">
              <Button
                size="3"
                variant="soft"
                onClick={() => void send('Continue planning with the trip details I’ve provided.')}
              >
                Continue planning <ArrowRight size={12} />
              </Button>
            </Flex>
          ) : null}
          <Flex
            asChild
            align="end"
            gap="2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(prompt);
            }}
          >
            <form>
              <Box flexGrow="1" minWidth="0">
                <TextArea
                  size="3"
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
              </Box>
              <IconButton
                type="submit"
                size="3"
                loading={busy}
                disabled={busy || loading || !prompt.trim()}
                aria-label="Send message"
              >
                <ArrowUp size={18} />
              </IconButton>
            </form>
          </Flex>
          <Text as="p" size="1" color="gray">
            {warning
              ? warning
              : integrations.ai
                ? 'Plans are suggestions. Prices and availability need confirmation.'
                : 'Curated local planner · Estimated costs · No bookings made'}
          </Text>
        </Flex>
      }
      secondaryLabel="Your trip itinerary"
      secondary={
        <>
          {trip ? (
            <ItineraryView trip={trip} onUpdate={setTrip} disabled={busy} />
          ) : (
            <Flex
              direction="column"
              align="center"
              justify="center"
              gap="3"
              py="9"
              px="4"
              height="100%"
              style={{ minHeight: 550, textAlign: 'center' }}
            >
              <Flex align="center" gap="2" style={{ color: 'var(--accent-9)' }}>
                <Globe2 size={72} strokeWidth={0.8} />
                <Sparkles size={28} strokeWidth={1} />
              </Flex>
              <Text size="1" color="gray" weight="medium">
                THE BEST PART IS STILL AHEAD
              </Text>
              <Heading size="7" as="h2" align="center">
                Your next chapter,
                <br />
                coming together.
              </Heading>
              <Text as="p" size="2" color="gray" align="center">
                Your personal itinerary, thoughtful little details,
                <br />
                and everything in between will live right here.
              </Text>
              <Flex gap="2" mt="2" wrap="wrap" justify="center">
                {catalog.destinations.slice(0, 3).map((d) => (
                  <img
                    key={d.id}
                    src={d.image}
                    alt={d.name}
                    style={{
                      width: 84,
                      height: 84,
                      objectFit: 'cover',
                      borderRadius: 'var(--radius-3)',
                    }}
                  />
                ))}
              </Flex>
              <Text size="1" color="gray">
                A little inspiration. A lot to look forward to.
              </Text>
            </Flex>
          )}
        </>
      }
    />
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
    <Container size="4" px={{ initial: '4', md: '6' }} py="6">
      <Flex direction="column" gap="4">
        <Flex align="end" justify="between" gap="3" wrap="wrap">
          <Flex direction="column" gap="2" align="start">
            <Text size="1" color="gray" weight="medium">
              GOOD THINGS ON THE HORIZON
            </Text>
            <Heading size="8" as="h1">
              Places to go. Stories to tell.
            </Heading>
            <Text as="p" size="3" color="gray">
              Your little escapes and grand adventures, all together.
            </Text>
          </Flex>
          <Button asChild size="3">
            <Link to="/chat">
              <Plus size={16} />
              Dream up a trip
            </Link>
          </Button>
        </Flex>
        {!user && (
          <Callout.Root color="gray" variant="surface">
            <Callout.Icon>
              <Check size={15} />
            </Callout.Icon>
            <Callout.Text>Your trips are saved in this browser’s session.</Callout.Text>
            <Box>
              <Button size="3" variant="soft" onClick={openAuth}>
                Create an account to keep them across devices <ArrowRight size={13} />
              </Button>
            </Box>
          </Callout.Root>
        )}
        <Flex gap="2" wrap="wrap" role="group" aria-label="Filter trips">
          {[
            { id: 'all', label: 'All your adventures' },
            { id: 'draft', label: 'Still dreaming' },
            { id: 'planned', label: 'Ready to go' },
          ].map((f) => (
            <Button
              key={f.id}
              size="3"
              variant={filter === f.id ? 'solid' : 'soft'}
              color="gray"
              highContrast={filter === f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
            >
              {f.label}
            </Button>
          ))}
        </Flex>
        {loading ? (
          <Spinner label="Finding your adventures…" />
        ) : error ? (
          <FormError message={error} />
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
          <Grid columns={{ initial: '1', sm: '2', lg: '3' }} gap="4">
            {filtered.map((trip) => {
              const d = findDestination(trip.destinationId, trip);
              const consultation = getConsultation(trip);
              return (
                <Card asChild size="2" key={trip.id}>
                  <article>
                    <Inset clip="padding-box" side="top" pb="current">
                      <Box position="relative">
                        <Link to={`/chat/${trip.id}`}>
                          {d ? (
                            <img
                              src={d.image || '/images/destination-placeholder.svg'}
                              alt={d.name}
                              style={{
                                display: 'block',
                                width: '100%',
                                height: 170,
                                objectFit: 'cover',
                              }}
                            />
                          ) : (
                            <Flex
                              align="center"
                              justify="center"
                              style={{
                                height: 170,
                                background: 'var(--accent-3)',
                                color: 'var(--accent-11)',
                              }}
                            >
                              <TaraMark size={56} />
                            </Flex>
                          )}
                        </Link>
                        <Box position="absolute" top="2" left="2">
                          {trip.status === 'planned' ? (
                            <Badge color="green" variant="solid">
                              <Check size={12} />
                              Ready to go
                            </Badge>
                          ) : (
                            <Badge color="gray" variant="solid">
                              Still dreaming
                            </Badge>
                          )}
                        </Box>
                      </Box>
                    </Inset>
                    <Flex direction="column" gap="2" align="start">
                      <Text size="1" color="gray" weight="medium">
                        {d ? `${d.name} · ${d.country}` : 'SOMEWHERE WONDERFUL'}
                      </Text>
                      <RadixLink asChild>
                        <Link to={`/chat/${trip.id}`}>
                          <Heading size="4" as="h2">
                            {trip.title}
                          </Heading>
                        </Link>
                      </RadixLink>
                      <Flex gap="2" wrap="wrap" align="center">
                        <Badge color="gray" variant="soft">
                          <CalendarDays size={13} />
                          {trip.itinerary.length
                            ? `${trip.itinerary.length} days`
                            : consultation.facts.duration?.valueState === 'specified'
                              ? `${trip.days} days`
                              : 'Length to discuss'}
                        </Badge>
                        <Badge color="gray" variant="soft">
                          <Users size={13} />
                          {consultation.facts.travelers?.valueState === 'specified'
                            ? `${trip.travelers} travellers`
                            : 'Party to discuss'}
                        </Badge>
                        <Badge color="gray" variant="soft">
                          {consultation.facts.dates
                            ? consultation.facts.dates.valueState === 'flexible'
                              ? 'Flexible dates'
                              : readableDate(trip.startDate)
                            : 'Dates to discuss'}
                        </Badge>
                      </Flex>
                      <Separator size="4" my="1" />
                      <Flex align="center" justify="between" gap="3" width="100%">
                        <RadixLink asChild size="2">
                          <Link to={`/chat/${trip.id}`}>
                            <Flex align="center" gap="1" display="inline-flex">
                              Keep dreaming
                              <ArrowRight size={15} />
                            </Flex>
                          </Link>
                        </RadixLink>
                        <IconButton
                          size="3"
                          variant="soft"
                          color="gray"
                          aria-label={`Delete ${trip.title}`}
                          onClick={() => setDeleting(trip)}
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </Flex>
                    </Flex>
                  </article>
                </Card>
              );
            })}
          </Grid>
        )}
      </Flex>
      {deleting && (
        <Modal title="Let this one go?" onClose={closeDelete}>
          <Flex direction="column" gap="3" mt="3">
            <Text as="p" size="2" color="gray">
              “{deleting.title}” and its conversation will be permanently deleted. Any shared link
              will stop working.
            </Text>
            <Flex gap="3" justify="end" wrap="wrap">
              <Button size="3" variant="soft" color="gray" disabled={busy} onClick={closeDelete}>
                Keep this trip
              </Button>
              <Button
                size="3"
                color="red"
                loading={busy}
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
              </Button>
            </Flex>
          </Flex>
        </Modal>
      )}
    </Container>
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
    <Container size="4" px={{ initial: '4', md: '6' }} py="6">
      <Flex align="end" justify="between" gap="3" wrap="wrap" mb="4">
        <Flex direction="column" gap="2" align="start">
          <Text size="1" color="gray" weight="medium">
            GOOD ADVENTURES ARE WORTH SHARING
          </Text>
          <Heading size="8" as="h1">
            A little travel inspiration, for you.
          </Heading>
          <Text as="p" size="3" color="gray">
            A shared itinerary. Borrow the idea, make it your own.
          </Text>
        </Flex>
        <Button
          size="3"
          loading={busy}
          disabled={busy || !trip.itinerary.length}
          onClick={() => void copy()}
        >
          {busy ? 'Making it yours…' : 'Make this trip mine'}
          <Copy size={16} />
        </Button>
      </Flex>
      <ItineraryView trip={trip} readOnly />
    </Container>
  );
}
