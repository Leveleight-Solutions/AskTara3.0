import { useEffect, useState } from 'react';
import { Badge, Box, Button, Callout, Card, Flex, Grid, Text } from '@radix-ui/themes';
import { CircleAlert, Globe2, ShieldCheck } from 'lucide-react';
import { StudioCandidateEntry } from './StudioCandidateEntry';
import { studioEntryRequirementsInputKey } from '../../shared/studio-trip-briefing';
import type { StudioWorkspace } from '../../shared/studio';
import {
  normalizeStudioCountry,
  studioDestinationResearchFresh,
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

function DestinationCard({
  workspace,
  candidate,
  disabled,
  stale,
  onChoose,
}: {
  workspace: StudioWorkspace;
  candidate: StudioDestinationCandidate;
  disabled: boolean;
  stale: boolean;
  onChoose: (candidate: StudioDestinationCandidate) => void | Promise<unknown>;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => setAcknowledged(false), [candidate, stale]);
  const warning = !candidate.recommendable || stale;
  const statusLabels = {
    checked: 'Current advice checked',
    warning: 'Agent review needed',
    blocked: 'Travel warning',
    unknown: 'Not verified',
  };
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
        <StudioCandidateEntry workspace={workspace} candidate={candidate} />
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
    (!studioDestinationResearchFresh(research) ||
      (research.inputKey.startsWith('{') &&
        (savedResearchTrip.startDate !== brief.startDate ||
          savedResearchTrip.endDate !== brief.endDate ||
          savedResearchTrip.preferredDestination !== (brief.preferredDestination || '') ||
          savedResearchTrip.budget !== brief.budget ||
          savedResearchTrip.currency !== brief.currency ||
          JSON.stringify(savedResearchTrip.interests) !== JSON.stringify(brief.interests))));
  const checkedStop = entryRequirements?.stopId
    ? workspace.stops.find((stop) => stop.id === entryRequirements.stopId)
    : selectedStop;
  const checkedCountry = normalizeStudioCountry(
    checkedStop?.country || brief.destinationCountry || '',
  );
  const entryStale = Boolean(
    entryRequirements &&
    (!Number.isFinite(Date.parse(entryRequirements.checkedAt)) ||
      Date.now() - Date.parse(entryRequirements.checkedAt) < 0 ||
      Date.now() - Date.parse(entryRequirements.checkedAt) >= 86400000 ||
      entryRequirements.inputKey !==
        studioEntryRequirementsInputKey(workspace, entryRequirements.stopId)),
  );
  return (
    <Flex direction="column" gap="4">
      <Box>
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <Box>
            <Text as="div" weight="bold">
              Find a destination
            </Text>
            <Text size="2" color="gray">
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
          <Flex direction="column" gap="3" mt="3">
            <Text size="1" color="gray">
              Checked {new Date(research.checkedAt).toLocaleString()}
              {research.historyUsed ? ' · Based on previous travel' : ''}
            </Text>
            {stale && (
              <Text size="2" color="amber">
                These checks are over six hours old or the brief has changed. Refresh before making
                a recommendation.
              </Text>
            )}
            <Grid columns={{ initial: '1', md: '3' }} gap="3">
              {research.candidates.map((candidate, index) => (
                <DestinationCard
                  workspace={workspace}
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
      </Box>
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
