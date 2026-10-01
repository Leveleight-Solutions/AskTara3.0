import { useEffect, useState, type ReactNode } from 'react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Heading,
  Link,
  Text,
} from '@radix-ui/themes';
import { CircleAlert, ClipboardList, Globe2, RefreshCw, ShieldCheck } from 'lucide-react';
import { breakDownConditions } from './conditionsText';
import type { StudioStop, StudioWorkspace } from '../../shared/studio';
import {
  normalizeStudioCountry,
  studioVisaLabels,
  type StudioDestinationCandidate,
  type StudioDestinationResearch,
  type StudioEntryRequirements,
  type StudioTravelEvidence,
  type StudioTravelHistoryEntry,
} from '../../shared/studio-travel-research';

function Evidence({ sources }: { sources: StudioTravelEvidence[] }) {
  return (
    <Flex direction="column" gap="1" mt="2">
      {sources.map((source, index) => (
        <Text size="1" color="gray" key={`${source.url}-${index}`}>
          <a href={source.url} target="_blank" rel="noreferrer">
            {source.label}
          </a>
          {' · '}
          {source.kind.replaceAll('_', ' ')}
          {source.publishedAt
            ? ` · updated ${source.publishedAt.slice(0, 10)}`
            : ' · publication date not stated'}
          {' · checked '}
          {new Date(source.checkedAt).toLocaleString()}
        </Text>
      ))}
    </Flex>
  );
}

const statusLabels: Record<StudioDestinationCandidate['status'], string> = {
  checked: 'Advice checked',
  warning: 'Review the advice',
  blocked: 'Travel warning',
  unknown: 'Not verified',
};
const statusColors = {
  checked: 'green',
  warning: 'amber',
  blocked: 'red',
  unknown: 'gray',
} as const;
/* Worst first: the card's badge speaks for the riskiest stop, not the first one. */
const severity = { blocked: 3, warning: 2, unknown: 1, checked: 0 } as const;
function DestinationCard({
  candidate,
  disabled,
  stale,
  onChoose,
}: {
  candidate: StudioDestinationCandidate;
  disabled: boolean;
  stale: boolean;
  onChoose: (candidate: StudioDestinationCandidate) => void | Promise<unknown>;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => setAcknowledged(false), [candidate, stale]);
  const warning = !candidate.recommendable || stale;
  return (
    <Card>
      <Flex direction="column" gap="2">
        <Flex justify="between" align="start" gap="2" wrap="wrap">
          <Box>
            <Text as="div" weight="bold">
              {candidate.destination}
            </Text>
            <Text size="2" color="gray">
              {candidate.country} · Suggested {candidate.suggestedDays} days
            </Text>
          </Box>
          <Badge color={candidate.status === 'blocked' ? 'red' : warning ? 'amber' : 'green'}>
            {statusLabels[candidate.status]}
          </Badge>
        </Flex>
        <Text size="2">{candidate.reason}</Text>
        <Callout.Root
          size="1"
          color={candidate.status === 'blocked' ? 'red' : warning ? 'amber' : 'gray'}
        >
          <Callout.Icon>
            {warning ? <CircleAlert size={16} /> : <ShieldCheck size={16} />}
          </Callout.Icon>
          <Callout.Text>{candidate.advisory}</Callout.Text>
        </Callout.Root>
        <details>
          <summary style={{ cursor: 'pointer' }}>Current conditions, ideas and sources</summary>
          <Flex direction="column" gap="2" mt="2">
            <Text size="2">
              <strong>Current conditions:</strong> {candidate.conditions}
            </Text>
            <Text size="2">
              <strong>Seasonal guidance, not a forecast:</strong>{' '}
              {candidate.seasonalGuidance || 'Not established for these dates.'}
            </Text>
            {candidate.thingsToDo.length > 0 && (
              <Box>
                <Text size="2" weight="medium">
                  Things to do
                </Text>
                <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                  {candidate.thingsToDo.map((idea) => (
                    <li key={idea}>
                      <Text size="2">{idea}</Text>
                    </li>
                  ))}
                </ul>
              </Box>
            )}
            <Evidence sources={candidate.sources} />
          </Flex>
        </details>
        {warning && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            I have reviewed the warning and will verify this destination before proceeding.
          </label>
        )}
        <Button
          variant={warning ? 'outline' : 'solid'}
          color={warning ? 'amber' : undefined}
          disabled={disabled || (warning && !acknowledged)}
          onClick={() => void onChoose(candidate)}
        >
          {warning ? 'Choose with warning' : 'Let’s go'}
        </Button>
      </Flex>
    </Card>
  );
}

const checkedAt = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/* Which researched candidates describe the route. The research call always includes the preferred
   destination and pads the list with alternatives, so the route's own places are picked out by
   name, and by country only for a stop no candidate names (a stop entered as "South Africa"
   against a "Cape Town" candidate). */
function routeCandidates(candidates: StudioDestinationCandidate[], stops: StudioStop[]) {
  const named = candidates.filter((c) => stops.some((stop) => sameName(c.destination, stop.name)));
  const unnamed = stops.filter((stop) => !named.some((c) => sameName(c.destination, stop.name)));
  const byCountry = candidates.filter(
    (c) =>
      !named.includes(c) &&
      unnamed.some((stop) => normalizeStudioCountry(stop.country)?.code === c.countryCode),
  );
  return [...named, ...byCountry];
}

const shortDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
/* One line per site the agent might open: the same page found twice is one link, several pages
   from one site share its line, the bare "www." is dropped, and the fetch time is not repeated —
   the card states it once. A site's date is its most recent page's. */
function sourceList(sources: StudioTravelEvidence[]) {
  const sites = new Map<string, { label: string; urls: string[]; publishedAt: string }>();
  for (const source of sources) {
    const label = source.label.replace(/^www\./, '');
    const site = sites.get(label) || { label, urls: [], publishedAt: '' };
    if (!site.urls.includes(source.url)) site.urls.push(source.url);
    if (source.publishedAt > site.publishedAt) site.publishedAt = source.publishedAt;
    sites.set(label, site);
  }
  return [...sites.values()];
}
/* A rule in the status colour rather than a filled callout: the advice is the first thing to read,
   but a full-width tinted block made a routine "no alert" look like an alarm. Red and amber keep
   their icon so the meaning never rests on colour alone. */
function Advisory({
  status,
  text,
}: {
  status: StudioDestinationCandidate['status'];
  text: string;
}) {
  const color = statusColors[status];
  return (
    <Flex
      gap="2"
      align="start"
      py="1"
      pl="3"
      style={{ borderLeft: `3px solid var(--${color}-${color === 'gray' ? '7' : '9'})` }}
    >
      {(status === 'blocked' || status === 'warning') && (
        <Box flexShrink="0" mt="1" style={{ color: `var(--${color}-11)` }}>
          <CircleAlert size={14} aria-hidden="true" />
        </Box>
      )}
      <Text as="p" size="2" style={{ maxWidth: '75ch' }}>
        {text}
      </Text>
    </Flex>
  );
}

/* Short sentences under a small label, one per line: scanned, not read. */
function ConditionsList({
  label,
  note,
  items,
  empty,
}: {
  label: string;
  note?: string;
  items: string[];
  empty: string;
}) {
  return (
    <Box>
      <Text as="div" size="1" weight="medium" color="gray">
        {label}
        {note && <Text weight="regular"> · {note}</Text>}
      </Text>
      {items.length ? (
        <ul className="conditions-list" style={{ marginTop: 'var(--space-2)' }}>
          {items.map((item) => (
            <li key={item}>
              <Text size="2">{item}</Text>
            </li>
          ))}
        </ul>
      ) : (
        <Text as="p" size="2" color="gray" mt="1">
          {empty}
        </Text>
      )}
    </Box>
  );
}

function ConditionsBlock({
  candidate,
  named,
}: {
  candidate: StudioDestinationCandidate;
  /** With several places on the route each block names its own; with one, the card's heading does. */
  named: boolean;
}) {
  const breakdown = breakDownConditions(candidate.conditions, candidate.seasonalGuidance);
  return (
    <Flex direction="column" gap="4">
      {named && (
        <Flex align="center" gap="2" wrap="wrap">
          <Heading as="h3" size="3">
            {candidate.destination}
          </Heading>
          <Badge variant="soft" color={statusColors[candidate.status]}>
            {statusLabels[candidate.status]}
          </Badge>
        </Flex>
      )}
      <Advisory status={candidate.status} text={candidate.advisory} />
      <Grid columns={{ initial: '1', md: '2' }} gapX="6" gapY="4">
        <ConditionsList
          label="Right now"
          items={breakdown.now}
          empty="No current conditions were found."
        />
        <ConditionsList
          label="Usual for the season"
          note="not a forecast"
          items={breakdown.season}
          empty="Not established for these dates."
        />
      </Grid>
      {/* The instructions buried in both paragraphs, gathered where the agent will act on them. */}
      {breakdown.actions.length > 0 && (
        <Box p="3" style={{ background: 'var(--gray-a2)', borderRadius: 'var(--radius-3)' }}>
          <Flex align="center" gap="2">
            <Box style={{ color: 'var(--gray-11)' }}>
              <ClipboardList size={14} aria-hidden="true" />
            </Box>
            <Text size="1" weight="medium" color="gray">
              Before you book
            </Text>
          </Flex>
          <ul className="conditions-list" style={{ marginTop: 'var(--space-2)' }}>
            {breakdown.actions.map((item) => (
              <li key={item}>
                <Text size="2">{item}</Text>
              </li>
            ))}
          </ul>
        </Box>
      )}
    </Flex>
  );
}

export function StudioTravelResearch({
  workspace,
  history = [],
  busy = false,
  research,
  entryRequirements: legacyEntryRequirements,
  entryResults,
  onResearch,
  onCheckEntry,
  onChooseDestination,
}: {
  workspace: StudioWorkspace;
  history?: StudioTravelHistoryEntry[];
  busy?: boolean;
  research?: StudioDestinationResearch | null;
  entryRequirements?: StudioEntryRequirements | null;
  entryResults?: StudioEntryRequirements[];
  onResearch: () => void | Promise<unknown>;
  onCheckEntry: (stopId?: string) => void | Promise<unknown>;
  onChooseDestination: (candidate: StudioDestinationCandidate) => void | Promise<unknown>;
}) {
  const [stopId, setStopId] = useState('');
  useEffect(() => setStopId(''), [workspace.id]);
  useEffect(() => {
    if (stopId && !workspace.stops.some((stop) => stop.id === stopId)) setStopId('');
  }, [workspace.stops, stopId]);
  const brief = workspace.brief as StudioWorkspace['brief'] & {
    passportNationality?: string;
    preferredDestination?: string;
    destinationCountry?: string;
  };
  const passport = normalizeStudioCountry(brief.passportNationality || '');
  const selectedStop =
    workspace.stops.find((stop) => stop.id === stopId) ||
    (!stopId ? workspace.stops[0] : undefined);
  const country = normalizeStudioCountry(selectedStop?.country || brief.destinationCountry || '');
  const destination = selectedStop?.name || brief.preferredDestination;
  const results = entryResults || (legacyEntryRequirements ? [legacyEntryRequirements] : []);
  const matchingResults = results.filter((result) =>
    selectedStop
      ? result.stopId === selectedStop.id ||
        (!result.stopId &&
          result.destination === selectedStop.name &&
          result.destinationCountryCode === country?.code)
      : !result.stopId &&
        result.destination === destination &&
        result.destinationCountryCode === country?.code,
  );
  const entryRequirements =
    [...matchingResults].reverse().find((result) => {
      try {
        const input = JSON.parse(result.inputKey) as Record<string, unknown>;
        return (
          result.passportCountryCode === passport?.code &&
          input.startDate === (selectedStop?.arrivalDate || brief.startDate) &&
          input.endDate === (selectedStop?.departureDate || brief.endDate)
        );
      } catch {
        return false;
      }
    }) || matchingResults.at(-1);
  const savedResearchTrip = (() => {
    try {
      return JSON.parse(research?.inputKey || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const stale =
    !!research &&
    (Date.now() - Date.parse(research.checkedAt) > 86400000 ||
      savedResearchTrip.startDate !== brief.startDate ||
      savedResearchTrip.endDate !== brief.endDate ||
      savedResearchTrip.preferredDestination !== (brief.preferredDestination || '') ||
      savedResearchTrip.budget !== brief.budget ||
      savedResearchTrip.currency !== brief.currency ||
      JSON.stringify(savedResearchTrip.interests) !== JSON.stringify(brief.interests));
  const checkedStop = entryRequirements?.stopId
    ? workspace.stops.find((stop) => stop.id === entryRequirements.stopId)
    : selectedStop;
  const checkedCountry = normalizeStudioCountry(
    checkedStop?.country || brief.destinationCountry || '',
  );
  const savedEntryTrip = (() => {
    try {
      return JSON.parse(entryRequirements?.inputKey || '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const arrivalTransport =
    checkedStop && workspace.stops.indexOf(checkedStop) > 0
      ? workspace.stops[workspace.stops.indexOf(checkedStop) - 1].onwardTransport
      : brief.outboundTransport || 'undecided';
  const entryStale =
    !!entryRequirements &&
    (Date.now() - Date.parse(entryRequirements.checkedAt) > 86400000 ||
      entryRequirements.passportCountryCode !== passport?.code ||
      entryRequirements.destinationCountryCode !== checkedCountry?.code ||
      (!!entryRequirements.stopId && !checkedStop) ||
      entryRequirements.destination !== (checkedStop?.name || brief.preferredDestination) ||
      savedEntryTrip.startDate !== (checkedStop?.arrivalDate || brief.startDate) ||
      savedEntryTrip.endDate !== (checkedStop?.departureDate || brief.endDate) ||
      savedEntryTrip.arrivalTransport !== arrivalTransport ||
      savedEntryTrip.departureTransport !==
        (checkedStop?.onwardTransport || brief.returnTransport || 'undecided'));
  return (
    <Flex direction="column" gap="4">
      {workspace.stops.length ? (
        <TravelConditions
          workspace={workspace}
          research={research}
          stale={stale}
          busy={busy}
          onResearch={onResearch}
          onChooseDestination={onChooseDestination}
        />
      ) : (
        <Card asChild size="3">
          <section aria-label="Destination ideas">
            <Flex align="start" justify="between" gap="3" wrap="wrap">
              <Box>
                <Text size="1" color="gray">
                  Destination ideas
                </Text>
                <Heading as="h2" size="5" mt="1">
                  Find a destination
                </Heading>
                <Text as="p" size="2" color="gray" mt="1">
                  {history.length
                    ? 'Use this client’s travel history and current conditions to find their next trip.'
                    : 'Explore destinations against the brief and current travel conditions.'}
                </Text>
              </Box>
              <Button variant="soft" disabled={busy} onClick={() => void onResearch()}>
                <Globe2 size={16} />
                {research ? 'Refresh destination research' : 'Research destinations'}
              </Button>
            </Flex>
            {research && (
              <Flex direction="column" gap="3" mt="4">
                <Text size="1" color="gray">
                  Checked {checkedAt(research.checkedAt)}
                  {research.historyUsed ? ' · Based on previous travel' : ''}
                </Text>
                {stale && (
                  <Text size="2" color="amber">
                    These checks are over 24 hours old or the brief has changed. Refresh before
                    making a recommendation.
                  </Text>
                )}
                <Grid columns={{ initial: '1', md: '3' }} gap="3">
                  {research.candidates.map((candidate, index) => (
                    <DestinationCard
                      key={`${research.checkedAt}-${candidate.countryCode}-${index}`}
                      candidate={candidate}
                      disabled={busy}
                      stale={stale}
                      onChoose={onChooseDestination}
                    />
                  ))}
                </Grid>
                {research.notes.map((note, index) => (
                  <Text size="1" color="gray" key={index}>
                    {note}
                  </Text>
                ))}
              </Flex>
            )}
          </section>
        </Card>
      )}
      <Card>
        <Flex direction="column" gap="3">
          <Flex align="center" justify="between" gap="3" wrap="wrap">
            <Box>
              <Text as="div" weight="bold">
                Entry requirements
              </Text>
              <Text size="2" color="gray">
                {passport && country && destination
                  ? `${passport.name} passport → ${destination}, ${country.name}`
                  : 'Choose a passport nationality and destination to check visas.'}
              </Text>
            </Box>
            <Button
              variant="soft"
              disabled={busy || !passport || !country || !destination}
              onClick={() => void onCheckEntry(selectedStop?.id)}
            >
              Check entry requirements
            </Button>
          </Flex>
          {workspace.stops.length > 1 && (
            <label style={{ fontSize: 13 }}>
              Destination to check{' '}
              <select
                aria-label="Destination for entry check"
                value={selectedStop?.id || ''}
                onChange={(event) => setStopId(event.target.value)}
              >
                {workspace.stops.map((stop) => (
                  <option key={stop.id} value={stop.id}>
                    {stop.name}
                    {stop.country ? `, ${stop.country}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!entryRequirements && country && destination && (
            <Text size="2" color="gray">
              No entry check for this destination yet.
            </Text>
          )}
          {entryRequirements && (
            <Flex direction="column" gap="2" aria-live="polite">
              <Flex align="center" gap="2" wrap="wrap">
                <Badge
                  color={
                    entryRequirements.status === 'corroborated' && !entryStale ? 'green' : 'amber'
                  }
                >
                  {studioVisaLabels[entryRequirements.category]}
                </Badge>
                <Text size="2" weight="medium">
                  {entryRequirements.status === 'corroborated'
                    ? 'Official source found — confirm before booking'
                    : entryRequirements.status === 'conflicting'
                      ? 'Conflicting sources'
                      : 'Unverified'}
                </Text>
              </Flex>
              <Text size="2">
                Checked for {entryRequirements.passportCountry} passport →{' '}
                {entryRequirements.destination}, {entryRequirements.destinationCountry} only ·{' '}
                {new Date(entryRequirements.checkedAt).toLocaleString()}
              </Text>
              {entryStale && (
                <Text size="2" color="amber">
                  This result is older than 24 hours or the passport, destination, dates or
                  transport has changed. Run a new check.
                </Text>
              )}
              <Text size="2">{entryRequirements.summary}</Text>
              <Text size="2">
                <strong>Electronic authorisation:</strong>{' '}
                {entryRequirements.electronicAuthorisation}
              </Text>
              {entryRequirements.conditions.length > 0 && (
                <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
                  {entryRequirements.conditions.map((condition, index) => (
                    <li key={index}>
                      <Text size="2">{condition}</Text>
                    </li>
                  ))}
                </ul>
              )}
              <details>
                <summary style={{ cursor: 'pointer' }}>Compare evidence and sources</summary>
                {entryRequirements.observations.map((observation, index) => (
                  <Text as="p" size="2" key={index}>
                    <strong>{studioVisaLabels[observation.category]}</strong> ·{' '}
                    {observation.kind.replaceAll('_', ' ')}: {observation.summary}{' '}
                    <a href={observation.sourceUrl} target="_blank" rel="noreferrer">
                      Source
                    </a>
                  </Text>
                ))}
                <Evidence sources={entryRequirements.sources} />
              </details>
              {entryRequirements.notes.map((note, index) => (
                <Text size="1" color="gray" key={index}>
                  {note}
                </Text>
              ))}
            </Flex>
          )}
        </Flex>
      </Card>
    </Flex>
  );
}

/* Once the route has places in it the question is no longer where to go but whether, and how, to
   go there: the advice, what is happening now and what the season brings. The card leads with the
   route's own places. Everything that supports the judgement rather than makes it — sources,
   research caveats, the other places the research turned up — is folded away below, one line
   each. */
function TravelConditions({
  workspace,
  research,
  stale,
  busy,
  onResearch,
  onChooseDestination,
}: {
  workspace: StudioWorkspace;
  research?: StudioDestinationResearch | null;
  stale: boolean;
  busy: boolean;
  onResearch: () => void | Promise<unknown>;
  onChooseDestination: (candidate: StudioDestinationCandidate) => void | Promise<unknown>;
}) {
  const route = workspace.stops.map((stop) => stop.name).join(' → ');
  const covered = research ? routeCandidates(research.candidates, workspace.stops) : [];
  const alternatives = research ? research.candidates.filter((c) => !covered.includes(c)) : [];
  const worst = [...covered].sort((a, b) => severity[b.status] - severity[a.status])[0];
  const badge = !research
    ? { label: 'Not checked', color: 'gray' as const }
    : !worst
      ? { label: 'Route not covered', color: 'gray' as const }
      : stale && worst.status === 'checked'
        ? { label: 'Out of date', color: 'amber' as const }
        : { label: statusLabels[worst.status], color: statusColors[worst.status] };
  const sources = sourceList(covered.flatMap((candidate) => candidate.sources));
  const notes = research?.notes || [];
  /* The whole header opens and closes the card, the way the brief review above it does. Remembered
     per workspace so a closed card stays closed while the agent works further down the canvas. */
  const key = `asktara-conditions-open:${workspace.id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== '0';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(key, open ? '0' : '1');
    } catch {
      /* Not remembered this time; the toggle still works. */
    }
  };
  // Before a first check there is nothing to show or hide.
  const collapsible = !!research;
  const expanded = !collapsible || open;
  const bodyId = `travel-conditions-${workspace.id}`;
  /* Accordion pattern: the place name is the real button, inside its heading, so assistive tech
     hears "South Africa, collapsed". No chevron, by request: the header itself is the affordance. The rest of the header is a larger pointer target for the same
     toggle — the eyebrow and status line belong to it visually, and a heading cannot sit inside a
     button. "Check again" stays outside both. */
  const title = collapsible ? (
    <button
      type="button"
      className="conditions-toggle"
      aria-expanded={expanded}
      aria-controls={bodyId}
      onClick={(event) => {
        event.stopPropagation();
        toggle();
      }}
    >
      {route}
    </button>
  ) : (
    route
  );
  return (
    <Card asChild size="3">
      <section aria-label="Travel conditions">
        <Flex align="start" justify="between" gap="3">
          <Box
            minWidth="0"
            flexGrow="1"
            onClick={collapsible ? toggle : undefined}
            style={{ cursor: collapsible ? 'pointer' : undefined }}
          >
            <Text size="1" color="gray">
              Travel conditions
            </Text>
            <Heading as="h2" size="5" mt="1">
              {title}
            </Heading>
            {/* Status and freshness on one line: the two things that decide whether the agent can
                rely on what follows. */}
            <Flex align="center" gap="2" mt="2" wrap="wrap">
              <Badge variant="soft" color={badge.color}>
                {badge.label}
              </Badge>
              <Text size="1" color="gray">
                {research
                  ? `Checked ${checkedAt(research.checkedAt)}`
                  : 'Travel advice, current conditions and the usual season'}
              </Text>
            </Flex>
          </Box>
          <Button
            size="2"
            variant={research ? 'ghost' : 'soft'}
            disabled={busy}
            onClick={() => void onResearch()}
            style={{ flexShrink: 0 }}
          >
            {research ? <RefreshCw size={14} /> : <Globe2 size={15} />}
            {research ? 'Check again' : 'Check conditions'}
          </Button>
        </Flex>
        <div id={bodyId} hidden={!expanded}>
          {research && stale && (
            <Text as="p" size="2" color="amber" mt="3">
              Over 24 hours old, or the brief has changed since. Check again before advising the
              client.
            </Text>
          )}
          {!!covered.length && (
            <Flex direction="column" gap="6" mt="5">
              {covered.map((candidate, index) => (
                <ConditionsBlock
                  key={`${research!.checkedAt}-${candidate.countryCode}-${index}`}
                  candidate={candidate}
                  named={covered.length > 1}
                />
              ))}
            </Flex>
          )}
          {research && !covered.length && (
            <Text as="p" size="2" color="gray" mt="4">
              The last check ran before {route} was on the route. Check again to see its conditions.
            </Text>
          )}
          {research && (sources.length > 0 || notes.length > 0 || alternatives.length > 0) && (
            <Flex
              direction="column"
              gap="2"
              mt="5"
              pt="4"
              style={{ borderTop: '1px solid var(--gray-a4)' }}
            >
              {sources.length > 0 && (
                <Disclosure label={`Sources (${sources.length})`}>
                  <Flex asChild direction="column" gap="1">
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                      {sources.map((site) => (
                        <li key={site.label}>
                          <Text size="2">
                            <Link href={site.urls[0]} target="_blank" rel="noreferrer">
                              {site.label}
                            </Link>
                            {site.urls.slice(1).map((url, index) => (
                              <Text key={url} size="1">
                                {' · '}
                                <Link href={url} target="_blank" rel="noreferrer">
                                  page {index + 2}
                                </Link>
                              </Text>
                            ))}
                          </Text>
                          {site.publishedAt && (
                            <Text size="1" color="gray">
                              {' '}
                              · updated {shortDate(site.publishedAt)}
                            </Text>
                          )}
                        </li>
                      ))}
                    </ul>
                  </Flex>
                </Disclosure>
              )}
              {notes.length > 0 && (
                <Disclosure label="About this check">
                  <Flex asChild direction="column" gap="2">
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {notes.map((note, index) => (
                        <li key={index}>
                          <Text size="2" color="gray">
                            {note}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  </Flex>
                </Disclosure>
              )}
              {alternatives.length > 0 && (
                <Disclosure label={`Other places Tara looked at (${alternatives.length})`}>
                  <Grid columns={{ initial: '1', md: '3' }} gap="3">
                    {alternatives.map((candidate, index) => (
                      <DestinationCard
                        key={`${research.checkedAt}-alt-${candidate.countryCode}-${index}`}
                        candidate={candidate}
                        disabled={busy}
                        stale={stale}
                        onChoose={onChooseDestination}
                      />
                    ))}
                  </Grid>
                </Disclosure>
              )}
            </Flex>
          )}
        </div>
      </section>
    </Card>
  );
}

function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details>
      <summary style={{ cursor: 'pointer', paddingBlock: 'var(--space-1)' }}>
        <Text size="2" color="gray">
          {label}
        </Text>
      </summary>
      <Box mt="2" mb="2">
        {children}
      </Box>
    </details>
  );
}
