import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  Clock3,
  ExternalLink,
  History,
  Info,
  MapPin,
  Minus,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  DataList,
  Flex,
  Heading,
  IconButton,
  Link as RadixLink,
  Progress,
  Select,
  Separator,
  Spinner,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes';
import type { PlanningPlace, PlanningRun, TravelBrief, TripRevision } from '../../shared/planning';
import type { FlightOffer, Trip } from '../../shared/types';
import { api, money } from '../api';
import { useApp } from '../context';
import { Modal } from './ui';
import FlightDetails from './FlightDetails';
import { tripDestinations } from '../../shared/destinations';
import MarkdownText, { safeWebUrl } from './MarkdownText';
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

/** A `<details>` block that reads as a Radix surface without leaving semantics behind. */
function Disclosure({
  summary,
  children,
  open,
}: {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <Box asChild>
      <details open={open}>
        <Box asChild py="1">
          <summary style={{ cursor: 'pointer', display: 'list-item' }}>
            <Text size="2" weight="medium">
              {summary}
            </Text>
          </summary>
        </Box>
        <Box pt="2">{children}</Box>
      </details>
    </Box>
  );
}

function FieldLabel({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Text as="label" size="2" weight="medium">
      <Flex direction="column" gap="1">
        {label}
        {children}
      </Flex>
    </Text>
  );
}

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
    <Flex
      asChild
      direction="column"
      gap="3"
      p="3"
      style={{
        border: '1px solid var(--gray-a5)',
        borderRadius: 'var(--radius-3)',
        minInlineSize: 0,
      }}
    >
      <fieldset>
        <Box asChild px="1">
          <legend>
            <Text size="2" weight="bold">
              A few details for a better journey
            </Text>
          </legend>
        </Box>
        <FieldLabel label="Your pace">
          <Select.Root
            size="3"
            value={value.pace}
            onValueChange={(pace) => update({ pace: pace as TravelBrief['pace'] })}
          >
            <Select.Trigger aria-label="Your pace" />
            <Select.Content>
              <Select.Item value="relaxed">Slow &amp; spacious</Select.Item>
              <Select.Item value="balanced">A little of everything</Select.Item>
              <Select.Item value="active">See as much as possible</Select.Item>
            </Select.Content>
          </Select.Root>
        </FieldLabel>
        <Disclosure summary="Plan more than one destination">
          <Flex direction="column" gap="3">
            <Text as="p" size="1" color="gray">
              Allocate all {days} days, in travel order. Travel between cities still needs to be
              arranged.
            </Text>
            {value.destinationStops.map((stop, index) => (
              <Flex key={index} gap="2" align="end" wrap="wrap">
                <Box flexGrow="1" minWidth="160px">
                  <FieldLabel label={`Stop ${index + 1}`}>
                    <Select.Root
                      size="3"
                      value={stop.destinationId}
                      onValueChange={(destinationId) =>
                        update({
                          destinationStops: value.destinationStops.map((s, i) =>
                            i === index ? { ...s, destinationId } : s,
                          ),
                        })
                      }
                    >
                      <Select.Trigger aria-label={`Destination ${index + 1}`} />
                      <Select.Content>
                        {destinations.map((d) => (
                          <Select.Item value={d.id} key={d.id}>
                            {d.name}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                  </FieldLabel>
                </Box>
                <Box width="96px">
                  <FieldLabel label="Days">
                    <TextField.Root
                      size="3"
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
                  </FieldLabel>
                </Box>
                <IconButton
                  type="button"
                  size="3"
                  variant="soft"
                  color="gray"
                  aria-label={`Remove destination ${index + 1}`}
                  onClick={() =>
                    update({
                      destinationStops: value.destinationStops.filter((_, i) => i !== index),
                    })
                  }
                >
                  <X size={15} />
                </IconButton>
              </Flex>
            ))}
            <Box>
              <Button
                type="button"
                size="3"
                variant="soft"
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
              </Button>
            </Box>
            {!!value.destinationStops.length && (
              <Text as="p" size="1" color="gray">
                {value.destinationStops.reduce((n, s) => n + s.days, 0)} of {days} days allocated
              </Text>
            )}
          </Flex>
        </Disclosure>
        <FieldLabel label="Accommodation">
          <Select.Root
            size="3"
            value={consultation.services.hotels.status}
            onValueChange={(status) => updateService('hotels', status as ServiceStatus)}
          >
            <Select.Trigger aria-label="Accommodation" />
            <Select.Content>
              {Object.entries(serviceLabels).map(([status, label]) => (
                <Select.Item key={status} value={status}>
                  {label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </FieldLabel>
        {consultation.services.hotels.status === 'requested' && (
          <FieldLabel label="Guest nationality (2-letter code)">
            <TextField.Root
              size="3"
              placeholder="AU"
              pattern="[A-Za-z]{2}"
              maxLength={2}
              value={value.guestNationality}
              onChange={(e) => update({ guestNationality: e.target.value.toUpperCase() })}
            />
          </FieldLabel>
        )}
        <FieldLabel label="Flights">
          <Select.Root
            size="3"
            value={consultation.services.flights.status}
            onValueChange={(status) => updateService('flights', status as ServiceStatus)}
          >
            <Select.Trigger aria-label="Flights" />
            <Select.Content>
              {Object.entries(serviceLabels).map(([status, label]) => (
                <Select.Item key={status} value={status}>
                  {label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </FieldLabel>
        {consultation.services.flights.status === 'requested' && (
          <Flex gap="3" wrap="wrap">
            <Box flexGrow="1" minWidth="140px">
              <FieldLabel label="From airport">
                <TextField.Root
                  size="3"
                  placeholder="SYD"
                  pattern="[A-Za-z]{3}"
                  maxLength={3}
                  value={value.originAirport}
                  onChange={(e) => update({ originAirport: e.target.value.toUpperCase() })}
                />
              </FieldLabel>
            </Box>
            <Box flexGrow="1" minWidth="140px">
              <FieldLabel label="To airport">
                <TextField.Root
                  size="3"
                  placeholder="KIX"
                  pattern="[A-Za-z]{3}"
                  maxLength={3}
                  value={value.arrivalAirport}
                  onChange={(e) => update({ arrivalAirport: e.target.value.toUpperCase() })}
                />
              </FieldLabel>
            </Box>
          </Flex>
        )}
        <FieldLabel label="Anything to keep in mind?">
          <TextArea
            size="3"
            rows={2}
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
          <Text as="span" size="1" color="gray" weight="regular">
            Up to 12 notes, one per line, with 500 characters per note. Edit these to replace saved
            profile requirements for this trip.
          </Text>
        </FieldLabel>
        <Text as="p" size="1" color="gray">
          Leave a service as “Not discussed” if you haven’t decided. Save your answers, then
          continue with Tara.
        </Text>
      </fieldset>
    </Flex>
  );
}

const stageBadge = {
  running: { color: 'blue', label: 'Working' },
  completed: { color: 'green', label: 'Done' },
  skipped: { color: 'gray', label: 'Skipped' },
  failed: { color: 'red', label: 'Failed' },
} as const;

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
  const stages = Array.from(latest.values());
  const settled = stages.filter((event) => event.status !== 'running').length;
  return (
    <Card variant="surface" aria-live="polite" role="status">
      <Flex direction="column" gap="3">
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <Flex align="center" gap="2">
            <Spinner size="2" />
            <Text size="2" weight="medium">
              Your journey is taking shape
            </Text>
          </Flex>
          <Button
            type="button"
            size="3"
            variant="soft"
            color="red"
            loading={cancelling}
            disabled={!run || !['queued', 'running'].includes(run.status) || cancelling}
            onClick={onCancel}
          >
            <X size={15} />
            {cancelling ? 'Stopping…' : 'Stop'}
          </Button>
        </Flex>
        <Progress size="2" aria-label="Planning in progress" />
        {!stages.length ? (
          <Text as="p" size="2" color="gray">
            Gathering your trip details…
          </Text>
        ) : (
          <>
            <Text as="p" size="1" color="gray">
              {settled} of {stages.length} stages finished so far
            </Text>
            <Flex asChild direction="column" gap="2">
              <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {stages.map((event) => {
                  const badge = stageBadge[event.status];
                  return (
                    <Flex asChild gap="2" align="start" key={event.agent}>
                      <li>
                        <Box pt="1" style={{ color: `var(--${badge.color}-11)` }}>
                          {event.status === 'running' ? (
                            <Spinner size="1" />
                          ) : event.status === 'completed' ? (
                            <Check size={14} />
                          ) : event.status === 'failed' ? (
                            <TriangleAlert size={14} />
                          ) : (
                            <Minus size={14} />
                          )}
                        </Box>
                        <Box flexGrow="1">
                          <Flex align="center" gap="2" wrap="wrap">
                            <Text size="2" weight="bold">
                              {event.label}
                            </Text>
                            <Badge color={badge.color} variant="soft">
                              {badge.label}
                            </Badge>
                          </Flex>
                          <Text as="p" size="1" color="gray">
                            {event.detail}
                          </Text>
                        </Box>
                      </li>
                    </Flex>
                  );
                })}
              </ol>
            </Flex>
          </>
        )}
      </Flex>
    </Card>
  );
}

function SourceBadge({
  status,
  children,
}: {
  status?: 'curated' | 'live' | 'test' | 'unverified' | 'user';
  children: ReactNode;
}) {
  return (
    <Badge
      variant="soft"
      color={status === 'test' ? 'amber' : status === 'unverified' ? 'orange' : 'gray'}
    >
      {status === 'test' || status === 'unverified' ? <TriangleAlert size={11} /> : null}
      {children}
    </Badge>
  );
}

export function PlanningReview({ trip, onSettings }: { trip: Trip; onSettings?: () => void }) {
  const [selectedFlight, setSelectedFlight] = useState<FlightOffer | null>(null);
  const report = trip.planning;
  const consultation = getConsultation(trip);
  if (!report) return null;
  return (
    <Card size="3">
      <Flex direction="column" gap="3">
        <Flex align="center" gap="3">
          <Box style={{ color: 'var(--accent-11)' }}>
            <ShieldCheck size={19} />
          </Box>
          <Box>
            <Text size="1" color="gray" weight="medium">
              THE DETAILS BEHIND YOUR DAYS
            </Text>
            <Heading size="4" as="h3">
              Your trip, considered
            </Heading>
          </Box>
        </Flex>
        <Text as="p" size="2">
          {report.summary}
        </Text>
        {report.researchSummary && (
          <Card variant="surface" data-testid="research-summary">
            <Text size="1" color="gray" weight="medium">
              RESEARCH FOR YOUR JOURNEY
            </Text>
            <MarkdownText text={report.researchSummary} />
          </Card>
        )}
        {report.questions.length > 0 && (
          <Callout.Root color="blue">
            <Callout.Icon>
              <Info size={16} />
            </Callout.Icon>
            <Callout.Text>
              <Text weight="bold">A little more detail would help</Text>
            </Callout.Text>
            {report.questions.map((q, i) => (
              <Callout.Text key={i}>{q.question}</Callout.Text>
            ))}
            {onSettings && (
              <Box>
                <Button size="3" variant="soft" onClick={onSettings}>
                  Add trip details
                </Button>
              </Box>
            )}
          </Callout.Root>
        )}
        <Card variant="surface" data-testid="budget-breakdown">
          <Heading size="3" as="h3" mb="2">
            Your estimated group spend ({report.budget.currency})
          </Heading>
          <DataList.Root size="2">
            <DataList.Item>
              <DataList.Label minWidth="180px">Activities &amp; meals</DataList.Label>
              <DataList.Value>
                <Text weight="bold">{money(report.budget.activities, report.budget.currency)}</Text>
              </DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label minWidth="180px">Accommodation</DataList.Label>
              <DataList.Value>
                <Text weight="bold">
                  {serviceBudget(
                    consultation.services.hotels.status,
                    report.budget.accommodation,
                    report.budget.currency,
                  )}
                </Text>
              </DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label minWidth="180px">Flights</DataList.Label>
              <DataList.Value>
                <Text weight="bold">
                  {serviceBudget(
                    consultation.services.flights.status,
                    report.budget.flights,
                    report.budget.currency,
                  )}
                </Text>
              </DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label minWidth="180px">Estimated total</DataList.Label>
              <DataList.Value>
                <Text weight="bold" size="3">
                  {money(report.budget.total, report.budget.currency)} {report.budget.currency}
                </Text>
              </DataList.Value>
            </DataList.Item>
            <DataList.Item>
              <DataList.Label minWidth="180px">Your group budget</DataList.Label>
              <DataList.Value>
                <Text weight="bold">
                  {consultation.facts.budget
                    ? consultation.facts.budget.valueState === 'flexible'
                      ? 'Flexible'
                      : `${money(report.budget.target, report.budget.targetCurrency || consultation.currency)} ${report.budget.targetCurrency || consultation.currency}`
                    : 'Not discussed'}
                </Text>
              </DataList.Value>
            </DataList.Item>
          </DataList.Root>
          {(report.budget.targetCurrency || consultation.currency) !== report.budget.currency &&
            consultation.facts.budget?.valueState === 'specified' && (
              <Text as="p" size="1" color="gray" mt="2">
                Estimates are in {report.budget.currency}; your budget is in{' '}
                {report.budget.targetCurrency || consultation.currency}. No exchange-rate conversion
                has been applied.
              </Text>
            )}
          <Text as="p" size="1" color="gray" mt="2">
            {report.budget.unpriced.length
              ? `Still to allow for: ${report.budget.unpriced.join(', ')}.`
              : 'Estimates can change before booking.'}
          </Text>
        </Card>
        {!!report.issues.length && (
          <Disclosure
            summary={`${report.issues.length} planning notes`}
            open={report.issues.some((i) => i.severity === 'error')}
          >
            <Flex direction="column" gap="2" asChild>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {report.issues.map((issue, i) => (
                  <Flex asChild gap="2" align="center" key={i}>
                    <li>
                      <Badge
                        color={
                          issue.severity === 'error'
                            ? 'red'
                            : issue.severity === 'warning'
                              ? 'amber'
                              : 'gray'
                        }
                        variant="soft"
                      >
                        {issue.severity === 'info' ? (
                          <Info size={11} />
                        ) : (
                          <TriangleAlert size={11} />
                        )}
                        {issue.severity === 'error'
                          ? 'Needs attention'
                          : issue.severity === 'warning'
                            ? 'Worth a look'
                            : 'Note'}
                      </Badge>
                      <Text size="2">
                        {issue.day ? `Day ${issue.day}: ` : ''}
                        {issue.message}
                      </Text>
                    </li>
                  </Flex>
                ))}
              </ul>
            </Flex>
          </Disclosure>
        )}
        <Disclosure summary={'Assumptions & sources'}>
          {report.model && (
            <Text as="p" size="1" color="gray">
              Research assisted by {report.model}.
            </Text>
          )}
          <Flex direction="column" gap="1" asChild>
            <ul style={{ margin: 'var(--space-2) 0', paddingLeft: 'var(--space-5)' }}>
              {report.assumptions.map((a, i) => (
                <li key={i}>
                  <Text size="2">{a}</Text>
                </li>
              ))}
            </ul>
          </Flex>
          <Flex direction="column" gap="3">
            {report.sources.map((source) => (
              <Flex direction="column" gap="1" align="start" key={source.id}>
                <SourceBadge status={source.status}>
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
                </SourceBadge>
                {safeWebUrl(source.url) ? (
                  <RadixLink
                    size="2"
                    href={safeWebUrl(source.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Flex align="center" gap="1" display="inline-flex">
                      {source.label}
                      <ExternalLink size={11} />
                    </Flex>
                  </RadixLink>
                ) : (
                  <Text size="2">{source.label}</Text>
                )}
                <Text size="1" color="gray">
                  {source.kind === 'web' ? 'Researched' : 'Checked'}{' '}
                  {new Date(source.checkedAt).toLocaleDateString()}
                  {source.kind === 'web'
                    ? ' · Published information may change before your trip.'
                    : source.status === 'test'
                      ? ' · Simulated rates; availability is not confirmed.'
                      : ''}
                </Text>
              </Flex>
            ))}
          </Flex>
        </Disclosure>
        {report.stays.length > 0 && (
          <Disclosure summary={`Places to stay (${report.stays.length})`}>
            <Flex direction="column" gap="3">
              {report.stays.map((stay) => (
                <Card asChild key={stay.id}>
                  <article>
                    <Flex gap="3" align="start">
                      {stay.image && (
                        <img
                          src={stay.image}
                          alt=""
                          style={{
                            width: 84,
                            height: 84,
                            objectFit: 'cover',
                            borderRadius: 'var(--radius-2)',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <Flex direction="column" gap="1" minWidth="0">
                        <Heading size="3" as="h4">
                          {stay.name}
                        </Heading>
                        <Text as="p" size="2" color="gray">
                          {stay.description}
                        </Text>
                        <Text size="2" weight="bold">
                          {money(stay.price, stay.currency)} /{' '}
                          {stay.basis === 'night' ? 'night' : 'stay'}
                        </Text>
                        <Text size="1" color="gray">
                          {report.sources.find((s) => s.id === stay.sourceId)?.status === 'test'
                            ? 'Sandbox rate · simulated availability'
                            : report.sources.find((s) => s.id === stay.sourceId)?.status ===
                                'curated'
                              ? 'Sample stay · estimate'
                              : 'Provider result · availability can change'}
                        </Text>
                      </Flex>
                    </Flex>
                  </article>
                </Card>
              ))}
            </Flex>
          </Disclosure>
        )}
        {report.flights.length > 0 && (
          <Disclosure summary={`Flight options (${report.flights.length})`}>
            <Flex direction="column" gap="3">
              {report.flights.map((flight) => (
                <Card asChild key={flight.id}>
                  <article>
                    <Flex direction="column" gap="1" align="start">
                      {(flight.liveMode === false ||
                        report.sources.some(
                          (source) => source.id.endsWith('-flights') && source.status === 'test',
                        )) && (
                        <SourceBadge status="test">
                          Sandbox fare · simulated availability
                        </SourceBadge>
                      )}
                      <Text size="2" weight="bold">
                        {flight.origin} → {flight.destination} ·{' '}
                        {money(flight.price, flight.currency)}
                      </Text>
                      <Text as="p" size="2" color="gray">
                        {flight.airline} · {flight.stops ? `${flight.stops} stop(s)` : 'Direct'} ·{' '}
                        {flight.departure.slice(0, 16).replace('T', ' ')}
                      </Text>
                      <Button size="3" variant="soft" onClick={() => setSelectedFlight(flight)}>
                        View full journey <ExternalLink size={12} />
                      </Button>
                    </Flex>
                  </article>
                </Card>
              ))}
            </Flex>
          </Disclosure>
        )}
        <Text as="p" size="1" color="gray">
          A travel plan, with no reservations made. Confirm opening hours and final prices before
          you go.
        </Text>
      </Flex>
      {selectedFlight && (
        <FlightDetails offer={selectedFlight} onClose={() => setSelectedFlight(null)} />
      )}
    </Card>
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
      <Flex direction="column" gap="3" align="start" mt="3">
        {loading && (
          <Flex align="center" gap="2" role="status">
            <Spinner size="1" />
            <Text size="2" color="gray">
              Checking current place details…
            </Text>
          </Flex>
        )}
        {error && (
          <Callout.Root color="red" role="alert">
            <Callout.Icon>
              <TriangleAlert size={16} />
            </Callout.Icon>
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        <SourceBadge status={source?.status}>
          {source?.kind === 'web'
            ? 'Web research'
            : source?.kind === 'google_places'
              ? 'Google Places data'
              : 'Curated place idea'}
        </SourceBadge>
        {place.description && (
          <Box>
            <MarkdownText text={place.description} />
          </Box>
        )}
        <Flex align="center" gap="2">
          <MapPin size={16} />
          <Text size="2">{place.address}</Text>
        </Flex>
        {!!place.suitability?.length && (
          <Box>
            <Heading size="3" as="h3" mb="1">
              How this fits your trip
            </Heading>
            <Flex direction="column" gap="1" asChild>
              <ul style={{ margin: 'var(--space-1) 0', paddingLeft: 'var(--space-5)' }}>
                {place.suitability.map((note, index) => (
                  <li key={index}>
                    <Text size="2">{note}</Text>
                  </li>
                ))}
              </ul>
            </Flex>
            <Text as="p" size="1" color="gray">
              Confirm dietary and access requirements directly with the venue before visiting.
            </Text>
          </Box>
        )}
        {!!place.evidenceUrls?.some((url) => safeWebUrl(url)) && (
          <Box>
            <Heading size="3" as="h3" mb="1">
              Read the source
            </Heading>
            <Flex direction="column" gap="1" asChild>
              <ul style={{ margin: 'var(--space-1) 0', paddingLeft: 'var(--space-5)' }}>
                {place.evidenceUrls
                  .filter((url) => safeWebUrl(url))
                  .map((url, index) => (
                    <li key={index}>
                      <RadixLink
                        size="2"
                        href={safeWebUrl(url)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Flex align="center" gap="1" display="inline-flex">
                          {new URL(url).hostname.replace(/^www\./, '')}
                          <ExternalLink size={12} />
                        </Flex>
                      </RadixLink>
                    </li>
                  ))}
              </ul>
            </Flex>
            {source && (
              <Text as="p" size="1" color="gray">
                Researched {new Date(source.checkedAt).toLocaleDateString()}. Published details may
                change.
              </Text>
            )}
          </Box>
        )}
        <Flex align="center" gap="2">
          <Clock3 size={16} />
          <Text size="2">
            Allow around {place.durationMinutes} minutes · {money(place.estimatedCost)} estimated
            per person
          </Text>
        </Flex>
        {place.openingHours?.length ? (
          <Box>
            <Heading size="3" as="h3" mb="1">
              Published opening hours
            </Heading>
            <Flex direction="column" gap="1" asChild>
              <ul style={{ margin: 'var(--space-1) 0', paddingLeft: 'var(--space-5)' }}>
                {place.openingHours.map((h) => (
                  <li key={h}>
                    <Text size="2">{h}</Text>
                  </li>
                ))}
              </ul>
            </Flex>
            <Text as="p" size="1" color="gray">
              Hours may change for your travel dates.
            </Text>
          </Box>
        ) : (
          <Text as="p" size="1" color="gray">
            Opening hours haven’t been verified. Check the place before travelling.
          </Text>
        )}
        <Button asChild size="3">
          <a
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
        </Button>
        {source && (
          <Text as="p" size="1" color="gray">
            Source: {source.label}
          </Text>
        )}
        {place.id.startsWith('google-') && (
          <Text size="1" weight="bold">
            Google Maps
          </Text>
        )}
        {place.attributions?.map((a, i) => (
          <Text as="p" size="1" color="gray" key={i}>
            {a.providerUri?.startsWith('https://') ? (
              <RadixLink href={a.providerUri} target="_blank" rel="noreferrer">
                {a.provider}
              </RadixLink>
            ) : (
              a.provider
            )}
          </Text>
        ))}
      </Flex>
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
      <Flex direction="column" gap="3" mt="3">
        <Text as="p" size="2" color="gray">
          Restore a saved itinerary. Your conversation and sharing settings stay current.
        </Text>
        {error && (
          <Callout.Root color="red" role="alert">
            <Callout.Icon>
              <TriangleAlert size={16} />
            </Callout.Icon>
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        {busy && (
          <Flex align="center" gap="2" role="status">
            <Spinner size="1" />
            <Text size="2" color="gray">
              Loading your plans…
            </Text>
          </Flex>
        )}
        <Separator size="4" />
        <Flex direction="column" gap="2">
          {revisions.map((r) => (
            <Card asChild key={r.id}>
              <article>
                <Flex gap="3" align="center">
                  <Box style={{ color: 'var(--gray-11)' }}>
                    <History size={17} />
                  </Box>
                  <Box flexGrow="1" minWidth="0">
                    <Flex align="center" gap="2" wrap="wrap">
                      <Text size="2" weight="bold">
                        Version {r.version}
                      </Text>
                      {r.version === trip.revision && (
                        <Badge color="green" variant="soft">
                          <Check size={11} />
                          Current
                        </Badge>
                      )}
                    </Flex>
                    <Text as="p" size="2" color="gray">
                      {r.reason}
                    </Text>
                    <Text size="1" color="gray">
                      {new Date(r.createdAt).toLocaleString()}
                    </Text>
                  </Box>
                  <Button
                    size="3"
                    variant="soft"
                    disabled={busy || r.version === trip.revision}
                    onClick={() => void restore(r)}
                  >
                    Restore
                  </Button>
                </Flex>
              </article>
            </Card>
          ))}
        </Flex>
        {!busy && !revisions.length && (
          <Text as="p" size="2" color="gray">
            Your next saved change will appear here.
          </Text>
        )}
      </Flex>
    </Modal>
  );
}
