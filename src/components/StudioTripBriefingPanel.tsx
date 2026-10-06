import { useEffect, useState } from 'react';
import { Button } from '@radix-ui/themes';
import { CloudSun, Globe2, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import type { StudioWorkspace } from '../../shared/studio';
import {
  normalizeStudioCountry,
  studioVisaLabels,
  type StudioTravelEvidence,
} from '../../shared/studio-travel-research';
import {
  STUDIO_TRIP_BRIEFING_FRESH_MS,
  studioTripBriefingInputKey,
} from '../../shared/studio-trip-briefing';
import { studioTripBriefingDisplay } from './studioTripBriefingView';
import './StudioTripBriefingPanel.css';

export interface StudioTripBriefingPanelProps {
  workspace: StudioWorkspace;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}

function concise(value: string) {
  if (value.length <= 260) return value;
  const candidate = value.slice(0, 257);
  const sentenceEnd = candidate.lastIndexOf('. ');
  return sentenceEnd > 130 ? candidate.slice(0, sentenceEnd + 1) : `${candidate.trimEnd()}…`;
}
function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';
}
function checkedLabel(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Time unavailable';
}
function sourceUrl(value: string) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}
function Sources({ sources }: { sources: StudioTravelEvidence[] }) {
  return (
    <ul className="studio-trip-briefing__sources">
      {sources.map((source, index) => {
        const url = sourceUrl(source.url);
        return (
          <li key={`${source.url}-${index}`}>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer">
                {source.label}
              </a>
            ) : (
              <span>{source.label}</span>
            )}
            <small>
              Checked {checkedLabel(source.checkedAt)}
              {source.publishedAt ? ` · published ${checkedLabel(source.publishedAt)}` : ''}
            </small>
          </li>
        );
      })}
    </ul>
  );
}

export function StudioTripBriefingPanel({
  workspace,
  loading,
  error,
  onRefresh,
}: StudioTripBriefingPanelProps) {
  const [clock, setClock] = useState(Date.now);
  const now = Math.max(clock, Date.now());
  const { ready, fresh, rows } = studioTripBriefingDisplay(workspace, now);
  // Recheck a small server/browser clock gap, then expire idle snapshots on time.
  // The strict evidence guards still reject future data until its time is reached.
  useEffect(() => {
    const current = Date.now();
    const checkedTimes = [
      workspace.tripBriefing?.checkedAt,
      ...(workspace.entryRequirements?.map((entry) => entry.checkedAt) || []),
      ...(workspace.tripBriefing?.stops.map((stop) => stop.weather.checkedAt) || []),
      ...(workspace.tripBriefing?.stops.map(
        (stop) => stop.preliminaryEntryRequirements?.checkedAt,
      ) || []),
    ]
      .filter(Boolean)
      .map((value) => Date.parse(value!))
      .filter(Number.isFinite);
    const transitions = [
      ...checkedTimes.filter((time) => time > current && time - current <= 5000),
      ...checkedTimes.map((time) => time + STUDIO_TRIP_BRIEFING_FRESH_MS),
    ].filter((time) => time > current);
    if (!transitions.length) return;
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.min(...transitions) - current + 20,
    );
    return () => window.clearTimeout(timer);
  }, [workspace.tripBriefing, workspace.entryRequirements, clock]);
  const passport = normalizeStudioCountry(workspace.brief.passportNationality || '');
  const purposeMissing =
    !workspace.brief.tripPurpose || workspace.brief.tripPurpose === 'undecided';
  const oldBriefing = Boolean(workspace.tripBriefing && !fresh);
  const changed =
    oldBriefing && workspace.tripBriefing!.inputKey !== studioTripBriefingInputKey(workspace);
  const missingDetails = workspace.clarification
    ? 'Trip dates need confirmation. Preliminary destination checks can continue.'
    : !rows.length
      ? 'Choose a destination and its country to start automatic entry and climate checks.'
      : 'Confirm the destination country to start its checks. Dates can be added afterwards.';
  return (
    <section
      className="studio-trip-briefing"
      aria-label="Travel briefing"
      data-testid="studio-travel-briefing"
    >
      <header className="studio-trip-briefing__header">
        <div className="studio-trip-briefing__title">
          <Globe2 size={17} aria-hidden="true" />
          <div>
            <h3>Travel briefing</h3>
            <p>Entry requirements and weather for every stop.</p>
          </div>
        </div>
        <Button
          size="1"
          variant="soft"
          type="button"
          disabled={loading || !ready}
          onClick={onRefresh}
        >
          <RefreshCw size={12} aria-hidden="true" /> {error ? 'Retry briefing' : 'Refresh briefing'}
        </Button>
      </header>
      <div className="studio-trip-briefing__status" role="status" aria-live="polite">
        {loading ? (
          <>
            <LoaderCircle size={13} className="studio-trip-briefing__loading" aria-hidden="true" />{' '}
            Checking travel details… You can keep planning.
          </>
        ) : !ready ? (
          missingDetails
        ) : oldBriefing ? (
          changed ? (
            'Trip details changed. A new briefing is needed.'
          ) : (
            'This briefing needs a refresh.'
          )
        ) : fresh ? (
          <>
            Checked {checkedLabel(workspace.tripBriefing!.checkedAt)}
            {workspace.tripBriefing!.status === 'partial' ? ' · Some checks need attention' : ''}
          </>
        ) : (
          'The briefing will appear when the checks finish.'
        )}
      </div>
      {error && (
        <p className="studio-trip-briefing__error" role="alert">
          {error}
        </p>
      )}
      <div className="studio-trip-briefing__destinations">
        {rows.map((stop) => {
          const entry = stop.entryRequirements || stop.preliminaryEntryRequirements;
          const preliminary = !stop.entryRequirements && Boolean(stop.preliminaryEntryRequirements);
          const weather = stop.weather;
          const entryPending = !passport
            ? 'Passport needed'
            : loading && ready
              ? 'Checking'
              : 'Not checked';
          const entryGuidance = !passport
            ? 'Add the passport nationality used for this trip.'
            : stop.entryError ||
              (!ready
                ? 'Confirm this destination’s country.'
                : 'Preliminary passport guidance is checked automatically; dates and purpose will refine it.');
          const weatherAvailable = weather && weather.kind !== 'unavailable';
          const weatherLabel =
            weather?.kind === 'forecast'
              ? 'Forecast'
              : weather?.kind === 'seasonal_outlook'
                ? 'Seasonal outlook'
                : weather?.kind === 'climate_overview'
                  ? 'Destination climate'
                  : weather?.kind === 'unavailable'
                    ? 'Not available'
                    : loading && ready
                      ? 'Checking'
                      : 'Not checked';
          const dateRange = [dateLabel(stop.startDate), dateLabel(stop.endDate)]
            .filter(Boolean)
            .join(' – ');
          return (
            <article
              className="studio-trip-briefing__destination"
              key={stop.stopId || `${stop.destination}-${stop.countryCode}`}
              aria-label={`${stop.destination || stop.country} travel briefing`}
            >
              <div className="studio-trip-briefing__destination-heading">
                <h4>
                  {stop.destination || stop.country}
                  {stop.country && stop.country !== stop.destination && (
                    <span> · {stop.country}</span>
                  )}
                </h4>
                <p>
                  {dateRange || 'Dates need confirmation'}
                  {!stop.countryCode ? ' · Country needs confirmation' : ''}
                </p>
              </div>
              <div className="studio-trip-briefing__checks">
                <div>
                  <div className="studio-trip-briefing__check-title">
                    <ShieldCheck size={14} aria-hidden="true" />
                    <h5>Visa & entry</h5>
                  </div>
                  <span
                    className={`studio-trip-briefing__tag${entry?.status === 'corroborated' && entry.category !== 'unknown' ? ' studio-trip-briefing__tag--checked' : ''}`}
                  >
                    {entry ? studioVisaLabels[entry.category] : entryPending}
                  </span>
                  {entry && (
                    <span className="studio-trip-briefing__evidence-status">
                      {preliminary && entry.status === 'preliminary'
                        ? 'Conditional preliminary guidance'
                        : entry.status === 'corroborated'
                          ? 'Official sources checked'
                          : entry.status === 'conflicting'
                            ? 'Conflicting sources'
                            : 'Unverified'}
                    </span>
                  )}
                  <p className="studio-trip-briefing__summary">
                    {concise(entry?.summary || entryGuidance)}
                  </p>
                  {entry && (
                    <p className="studio-trip-briefing__context">
                      For {entry.passportCountry} passport ·{' '}
                      {purposeMissing ? 'purpose not confirmed' : workspace.brief.tripPurpose}
                      {preliminary ? ' · preliminary, not eligibility confirmation' : ''}
                    </p>
                  )}
                </div>
                <div>
                  <div className="studio-trip-briefing__check-title">
                    <CloudSun size={14} aria-hidden="true" />
                    <h5>Weather & packing</h5>
                  </div>
                  <span
                    className={`studio-trip-briefing__tag${weatherAvailable ? ' studio-trip-briefing__tag--weather' : ''}`}
                  >
                    {weatherLabel}
                  </span>
                  <p className="studio-trip-briefing__summary">
                    {concise(
                      weather?.summary ||
                        (!ready
                          ? 'Confirm the destination country for climate guidance.'
                          : 'Weather guidance has not been checked yet.'),
                    )}
                  </p>
                  {weather?.kind === 'seasonal_outlook' && (
                    <p className="studio-trip-briefing__context">
                      Usual patterns, not a forecast for these dates.
                    </p>
                  )}
                  {weather?.kind === 'climate_overview' && (
                    <p className="studio-trip-briefing__context">
                      General destination climate. Travel dates are not confirmed.
                    </p>
                  )}
                </div>
              </div>
              {(entry || weatherAvailable) && (
                <details className="studio-trip-briefing__details">
                  <summary>Sources & details</summary>
                  {entry && (
                    <div className="studio-trip-briefing__evidence">
                      <h5>Entry requirements</h5>
                      <p>{entry.summary}</p>
                      {entry.electronicAuthorisation && (
                        <p>
                          <strong>Electronic authorisation:</strong> {entry.electronicAuthorisation}
                        </p>
                      )}
                      {entry.conditions.length > 0 && (
                        <ul>
                          {entry.conditions.map((condition, index) => (
                            <li key={index}>{condition}</li>
                          ))}
                        </ul>
                      )}
                      {'missingFacts' in entry && entry.missingFacts.length > 0 && (
                        <p>
                          <strong>Still needed:</strong> {entry.missingFacts.join(', ')}.
                        </p>
                      )}
                      {'observations' in entry && entry.observations.length > 0 && (
                        <ul>
                          {entry.observations.map((observation, index) => (
                            <li key={index}>
                              <strong>{studioVisaLabels[observation.category]}</strong> ·{' '}
                              {observation.summary}{' '}
                              {sourceUrl(observation.sourceUrl) && (
                                <a
                                  href={sourceUrl(observation.sourceUrl)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Source
                                </a>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      <Sources sources={entry.sources} />
                      {entry.notes.map((note, index) => (
                        <p className="studio-trip-briefing__context" key={index}>
                          {note}
                        </p>
                      ))}
                    </div>
                  )}
                  {weatherAvailable && (
                    <div className="studio-trip-briefing__evidence">
                      <h5>
                        {weather!.kind === 'forecast'
                          ? 'Weather forecast'
                          : weather!.kind === 'climate_overview'
                            ? 'Destination climate guidance'
                            : 'Seasonal weather guidance'}
                      </h5>
                      <p>{weather!.summary}</p>
                      {weather!.kind === 'forecast' && weather!.days.length > 0 && (
                        <table>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Low / high °C</th>
                              <th>Rain chance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {weather!.days.map((day) => (
                              <tr key={day.date}>
                                <td>{dateLabel(day.date)}</td>
                                <td>
                                  {day.temperatureMinC ?? '—'} / {day.temperatureMaxC ?? '—'}
                                </td>
                                <td>
                                  {day.precipitationProbability === null
                                    ? '—'
                                    : `${day.precipitationProbability}%`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <Sources sources={weather!.sources} />
                    </div>
                  )}
                </details>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
