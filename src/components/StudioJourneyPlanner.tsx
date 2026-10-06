import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, ExternalLink, Plane, Ship, X } from 'lucide-react';
import { Button, TextField } from '@radix-ui/themes';
import type { StudioBrief, StudioWorkspace } from '../../shared/studio';
import {
  studioJourneyInput,
  studioJourneyCanonicalInput,
  studioJourneyResearchFresh,
  type StudioJourneyDirection,
  type StudioJourneyOption,
} from '../../shared/studio-journey';
import { api } from '../api';
import './StudioJourneyPlanner.css';

type Mode = 'flight' | 'cruise';
type Draft = {
  origin: string;
  destination: string;
  departureDate: string;
  returnDepartureDate: string;
  tripDays: string;
  datesFlexible: boolean;
  mode: Mode | 'undecided';
};
const draftFor = (workspace: StudioWorkspace, direction: StudioJourneyDirection): Draft => {
  const input = studioJourneyInput(workspace, direction);
  return {
    origin: input.origin,
    destination: input.destination,
    departureDate: workspace.brief.departureDate || '',
    returnDepartureDate: workspace.brief.returnDepartureDate || '',
    tripDays: workspace.brief.tripDays == null ? '' : String(workspace.brief.tripDays),
    datesFlexible: input.datesFlexible,
    mode: input.mode,
  };
};
const safeSource = (value: string) => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
};

export interface StudioJourneyPlannerProps {
  workspace: StudioWorkspace;
  busy: boolean;
  direction: StudioJourneyDirection;
  mode?: Mode;
  researchEnabled?: boolean;
  onDirectionChange: (direction: StudioJourneyDirection) => void;
  onSaveBrief: (brief: Partial<StudioBrief>) => Promise<StudioWorkspace | false | undefined>;
  onUpdateWorkspace: (workspace: StudioWorkspace) => void;
  onBusyChange?: (active: boolean) => void;
  onUseSupplier?: (option: StudioJourneyOption, direction: StudioJourneyDirection) => void;
  onOpenFlightSearch?: (direction: StudioJourneyDirection) => void;
  onOpenCruise?: () => void;
  onEditRoute?: () => void;
  onClose?: () => void;
}

/** Compare sourced travel routes before an arrival date or hotel stay is confirmed. */
export function StudioJourneyPlanner(props: StudioJourneyPlannerProps) {
  const { workspace, busy, direction, researchEnabled = true } = props;
  const initial = {
    outbound: draftFor(workspace, 'outbound'),
    return: draftFor(workspace, 'return'),
  };
  const [drafts, setDrafts] = useState(initial);
  const seeds = useRef(initial);
  const workspaceId = useRef(workspace.id);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const automatic = useRef(new Set<string>());
  const latest = useRef(props);
  latest.current = props;
  const draft = drafts[direction];
  const mode = draft.mode === 'undecided' ? props.mode : draft.mode;
  const research = workspace.journeyResearch?.[direction];
  const savedInput = studioJourneyInput(workspace, direction, props.mode);
  const draftDirty = Object.entries(draft).some(
    ([key, value]) => key !== 'mode' && value !== initial[direction][key as keyof Draft],
  );
  const current = Boolean(
    !draftDirty &&
    research &&
    mode &&
    studioJourneyResearchFresh(workspace, research, direction, mode, now),
  );
  const selection = workspace.journeySelections?.[direction];
  const selectedId =
    current && selection && selection.inputKey === research?.inputKey ? selection.option.id : '';
  const blocked = busy || working;
  const routePlaceLocked = workspace.stops.length > 0;
  const identity = JSON.stringify(initial);

  useEffect(() => {
    const next = {
      outbound: draftFor(workspace, 'outbound'),
      return: draftFor(workspace, 'return'),
    };
    if (workspaceId.current !== workspace.id) {
      request.current?.abort();
      workspaceId.current = workspace.id;
      automatic.current.clear();
      setDrafts(next);
      setError('');
      setNotice('');
    } else {
      const previous = seeds.current;
      setDrafts((saved) => {
        const result = { ...saved };
        for (const side of ['outbound', 'return'] as const) {
          const refreshed = { ...saved[side] };
          for (const key of Object.keys(next[side]) as (keyof Draft)[])
            if (saved[side][key] === previous[side][key])
              Object.assign(refreshed, { [key]: next[side][key] });
          result[side] = refreshed;
        }
        return result;
      });
    }
    seeds.current = next;
  }, [workspace.id, identity]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
      latest.current.onBusyChange?.(false);
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => setNow(Date.now()), [research?.checkedAt]);
  useEffect(() => {
    if (
      !researchEnabled ||
      !props.mode ||
      busy ||
      working ||
      draftDirty ||
      !savedInput.origin.trim() ||
      !savedInput.destination.trim()
    )
      return;
    const key = `${workspace.id}:${direction}:${props.mode}`;
    if (automatic.current.has(key)) return;
    if (current && research?.input.mode === props.mode) {
      automatic.current.add(key);
      return;
    }
    // Defer until the mount is stable: StrictMode cleanup must not consume an attempt.
    const timer = window.setTimeout(() => {
      automatic.current.add(key);
      void search(props.mode!);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    workspace.id,
    direction,
    props.mode,
    busy,
    working,
    savedInput.origin,
    savedInput.destination,
    draftDirty,
    researchEnabled,
  ]);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDrafts((saved) => ({ ...saved, [direction]: { ...saved[direction], [key]: value } }));
    setError('');
  };
  function briefPatch(chosenMode: Mode): Partial<StudioBrief> {
    return {
      [direction === 'outbound' ? 'outboundTransport' : 'returnTransport']: chosenMode,
      origin: (direction === 'outbound' ? draft.origin : draft.destination).trim(),
      ...(!routePlaceLocked
        ? {
            preferredDestination: (direction === 'outbound'
              ? draft.destination
              : draft.origin
            ).trim(),
          }
        : {}),
      departureDate: draft.departureDate,
      returnDepartureDate: draft.returnDepartureDate,
      tripDays: draft.tripDays === '' ? null : Number(draft.tripDays),
      datesFlexible: draft.datesFlexible,
    };
  }
  async function search(chosenMode: Mode, next?: 'supplier') {
    if (working || busy) return;
    const hasPlaces = Boolean(draft.origin.trim() && draft.destination.trim());
    if (next === 'supplier' || (hasPlaces && researchEnabled))
      automatic.current.add(`${workspace.id}:${direction}:${chosenMode}`);
    update('mode', chosenMode);
    setError('');
    setNotice('');
    setWorking(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      if (
        draft.tripDays &&
        (!Number.isInteger(Number(draft.tripDays)) ||
          Number(draft.tripDays) < 1 ||
          Number(draft.tripDays) > 366)
      )
        throw new Error('Enter the trip duration as a whole number from 1 to 366 days.');
      const patch = hasPlaces
        ? briefPatch(chosenMode)
        : { [direction === 'outbound' ? 'outboundTransport' : 'returnTransport']: chosenMode };
      const changed = Object.entries(patch).some(
        ([key, value]) => workspace.brief[key as keyof StudioBrief] !== value,
      );
      const saved = changed ? await props.onSaveBrief(patch) : workspace;
      if (!saved) throw new Error('The travel details could not be saved. Please try again.');
      if (
        Object.entries(patch).some(
          ([key, value]) => saved.brief[key as keyof StudioBrief] !== value,
        )
      )
        throw new Error('The travel details were not saved. Please try again.');
      if (controller.signal.aborted || !alive.current) return;
      if (next === 'supplier') {
        latest.current.onOpenFlightSearch?.(direction);
        return;
      }
      if (!researchEnabled) {
        setNotice(
          'Travel preference saved. Compare supplier flights or add a reviewed sailing schedule.',
        );
        return;
      }
      if (!hasPlaces) {
        setNotice('Travel mode saved. Add the departure place and destination to find routes.');
        return;
      }
      props.onBusyChange?.(true);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (controller.signal.aborted || !alive.current) return;
      const newest = latest.current.workspace;
      const expected = studioJourneyCanonicalInput(
        studioJourneyInput(saved, direction, chosenMode),
      );
      if (
        newest.id !== saved.id ||
        studioJourneyCanonicalInput(studioJourneyInput(newest, direction, chosenMode)) !== expected
      )
        throw new Error('The journey details changed. Find travel options again.');
      const currentWorkspace = newest.revision >= saved.revision ? newest : saved;
      const result = await api<{ workspace: StudioWorkspace }>(
        `/studio/workspaces/${saved.id}/journey/research`,
        {
          method: 'POST',
          body: JSON.stringify({
            revision: currentWorkspace.revision,
            requestId: crypto.randomUUID(),
            direction,
            mode: chosenMode,
          }),
          signal: controller.signal,
        },
      );
      if (!controller.signal.aborted && alive.current) {
        setNow(Date.now());
        latest.current.onUpdateWorkspace(result.workspace);
      }
    } catch (cause) {
      if (!controller.signal.aborted && alive.current) setError((cause as Error).message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (alive.current) setWorking(false);
        latest.current.onBusyChange?.(false);
      }
    }
  }
  async function choose(option: StudioJourneyOption) {
    if (!current || blocked) return;
    setWorking(true);
    props.onBusyChange?.(true);
    setError('');
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await api<{ workspace: StudioWorkspace }>(
        `/studio/workspaces/${workspace.id}/journey/select`,
        {
          method: 'POST',
          body: JSON.stringify({
            revision: workspace.revision,
            requestId: crypto.randomUUID(),
            direction,
            optionId: option.id,
          }),
          signal: controller.signal,
        },
      );
      if (!controller.signal.aborted && alive.current) {
        latest.current.onUpdateWorkspace(result.workspace);
        setNotice('Route saved. A flight quote or reviewed sailing will confirm the arrival.');
      }
    } catch (cause) {
      if (!controller.signal.aborted && alive.current) setError((cause as Error).message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (alive.current) setWorking(false);
        latest.current.onBusyChange?.(false);
      }
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode) void search(mode);
  };
  const field = (
    key: 'origin' | 'destination' | 'departureDate' | 'returnDepartureDate' | 'tripDays',
    label: string,
    type: 'text' | 'date' | 'number' = 'text',
    readOnly = false,
  ) => (
    <label>
      <span>{label}</span>
      <TextField.Root
        aria-label={label}
        type={type}
        value={draft[key]}
        readOnly={readOnly}
        disabled={blocked}
        required={key === 'origin' || key === 'destination'}
        min={type === 'number' ? 1 : undefined}
        max={type === 'number' ? 366 : undefined}
        step={type === 'number' ? 1 : undefined}
        maxLength={type === 'text' ? 160 : undefined}
        onChange={(event) => update(key, event.target.value)}
      />
    </label>
  );
  return (
    <section className="studio-journey" aria-label="Journey planner">
      <div className="studio-journey__heading">
        <div>
          <span className="studio-journey__eyebrow">TRAVEL THERE & BACK</span>
          <h3>Start with the journey</h3>
        </div>
        {props.onClose && (
          <button type="button" aria-label="Close journey planner" onClick={props.onClose}>
            <X size={16} />
          </button>
        )}
      </div>
      <div className="studio-journey__directions" aria-label="Travel direction">
        {(['outbound', 'return'] as const).map((side) => (
          <button
            key={side}
            type="button"
            aria-pressed={direction === side}
            disabled={blocked}
            onClick={() => props.onDirectionChange(side)}
          >
            {side === 'outbound' ? 'Outward journey' : 'Return journey'}
          </button>
        ))}
      </div>
      <div className="studio-journey__modes" aria-label="Travel mode">
        {(['flight', 'cruise'] as const).map((choice) => {
          const Icon = choice === 'flight' ? Plane : Ship;
          return (
            <button
              key={choice}
              type="button"
              aria-pressed={mode === choice}
              disabled={blocked}
              onClick={() => void search(choice)}
            >
              <Icon size={17} /> {choice === 'flight' ? 'Flight' : 'Cruise'}
            </button>
          );
        })}
      </div>
      <form onSubmit={submit} aria-label="Journey search details">
        <div className="studio-journey__fields">
          {field('origin', 'From', 'text', direction === 'return' && routePlaceLocked)}
          {field('destination', 'To', 'text', direction === 'outbound' && routePlaceLocked)}
          {direction === 'outbound'
            ? field('departureDate', 'Departure date', 'date')
            : field('returnDepartureDate', 'Return departure date', 'date')}
          {field('tripDays', 'Trip duration · days', 'number')}
        </div>
        <div className="studio-journey__search-footer">
          <label className="studio-journey__flexible">
            <input
              type="checkbox"
              checked={draft.datesFlexible}
              disabled={blocked}
              onChange={(event) => update('datesFlexible', event.target.checked)}
            />
            Dates are flexible
          </label>
          <Button type="submit" size="2" disabled={blocked || !mode} loading={working}>
            {researchEnabled ? 'Find travel options' : 'Save travel details'}{' '}
            <ArrowRight size={14} />
          </Button>
        </div>
        {routePlaceLocked && props.onEditRoute && (
          <button
            type="button"
            className="studio-journey__text-button"
            disabled={blocked}
            onClick={props.onEditRoute}
          >
            Change the destination in the route
          </button>
        )}
      </form>
      {!researchEnabled && (
        <p className="studio-journey__hint">
          Internet route research is unavailable. Supplier quotes and reviewed sailing schedules can
          still be used.
        </p>
      )}
      {(props.onOpenFlightSearch || (props.onOpenCruise && !(selectedId && mode === 'cruise'))) && (
        <div className="studio-journey__option-actions" style={{ marginTop: 12 }}>
          {props.onOpenFlightSearch && (
            <Button
              type="button"
              size="2"
              variant="soft"
              disabled={blocked}
              onClick={() => void search('flight', 'supplier')}
            >
              <Plane size={14} /> Compare supplier flights
            </Button>
          )}
          {props.onOpenCruise && !(selectedId && mode === 'cruise') && (
            <Button
              type="button"
              size="2"
              variant="soft"
              disabled={blocked}
              onClick={props.onOpenCruise}
            >
              <Ship size={14} /> Add sailing schedule
            </Button>
          )}
        </div>
      )}
      {working && (
        <p className="studio-journey__hint" role="status">
          Preparing travel options…{' '}
          <button type="button" onClick={() => request.current?.abort()}>
            Cancel
          </button>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && (
        <p className="studio-journey__hint" role="status">
          {notice}
        </p>
      )}
      {research && !current && !working && (
        <p className="studio-journey__hint">
          Trip details changed or this research expired. Find current travel options.
        </p>
      )}
      {current && research && (
        <div
          className="studio-journey__results"
          aria-label={`${direction === 'outbound' ? 'Outward' : 'Return'} travel options`}
        >
          <p className="studio-journey__hint">{research.summary}</p>
          {research.options.map((option) => {
            const selected = selectedId === option.id;
            return (
              <article className="studio-journey__option" key={option.id} aria-label={option.title}>
                <div className="studio-journey__option-top">
                  <span className="studio-journey__operator" aria-hidden="true">
                    {mode === 'cruise' ? <Ship size={18} /> : <Plane size={18} />}
                  </span>
                  <div>
                    <span className="studio-journey__eyebrow">
                      {option.operator || 'Route guidance'}
                    </span>
                    <h4>{option.title}</h4>
                  </div>
                  {selected && (
                    <span className="studio-journey__saved">
                      <Check size={14} /> Selected
                    </span>
                  )}
                </div>
                <p className="studio-journey__route">
                  {option.origin} <ArrowRight size={14} /> {option.destination}
                </p>
                {option.via.length > 0 && (
                  <p className="studio-journey__hint">Via {option.via.join(' · ')}</p>
                )}
                <p>{option.summary}</p>
                <div className="studio-journey__facts">
                  <span>{option.duration || 'Duration not confirmed'}</span>
                  <span>Arrival not confirmed</span>
                  <span>Fare not quoted</span>
                </div>
                <div className="studio-journey__option-actions">
                  <Button
                    type="button"
                    size="2"
                    disabled={blocked || selected}
                    onClick={() => void choose(option)}
                  >
                    {selected ? 'Route selected' : 'Use this route'}
                  </Button>
                  {selected && mode === 'flight' && props.onUseSupplier && (
                    <Button
                      type="button"
                      size="2"
                      variant="soft"
                      disabled={blocked}
                      onClick={() => props.onUseSupplier?.(option, direction)}
                    >
                      Continue to flight quotes
                    </Button>
                  )}
                  {selected && mode === 'cruise' && props.onOpenCruise && (
                    <Button
                      type="button"
                      size="2"
                      variant="soft"
                      disabled={blocked}
                      onClick={props.onOpenCruise}
                    >
                      Add sailing schedule
                    </Button>
                  )}
                </div>
                <details>
                  <summary>Return, connections & sources</summary>
                  <p>{option.returnSummary || 'Compare the return journey separately.'}</p>
                  <p className="studio-journey__hint">
                    Route guidance is not a scheduled departure or a bookable quote. Confirm
                    connection times and any transit requirements with the chosen supplier.
                  </p>
                  <ul className="studio-journey__sources">
                    {option.sources
                      .filter((source) => safeSource(source.url))
                      .map((source) => (
                        <li key={source.url}>
                          <a
                            href={safeSource(source.url)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {source.label || 'Travel source'} <ExternalLink size={12} />
                          </a>
                        </li>
                      ))}
                  </ul>
                </details>
              </article>
            );
          })}
          {research.missingFacts.length > 0 && (
            <details className="studio-journey__pending">
              <summary>Details needed for a quote or schedule</summary>
              <p>{research.missingFacts.join(' · ')}</p>
            </details>
          )}
          {(workspace.brief.children || 0) > 0 && mode === 'flight' && (
            <p className="studio-journey__hint">
              Family routes can be planned here. Automatic fares support adults only; use a reviewed
              supplier quote for children.
            </p>
          )}
          {research.notes.length > 0 && (
            <details className="studio-journey__pending">
              <summary>Research notes</summary>
              {research.notes.map((note, index) => (
                <p key={index}>{note}</p>
              ))}
            </details>
          )}
        </div>
      )}
    </section>
  );
}

export default StudioJourneyPlanner;
