import { useEffect, useRef, useState } from 'react';
import type { StudioClientProfile } from '../../shared/studio-clients';
import type { StudioWorkspace } from '../../shared/studio';
import {
  STUDIO_CANDIDATE_ENTRY_FRESH_MS,
  STUDIO_DESTINATION_RESEARCH_FRESH_MS,
  studioCandidateEntryNeedsResearch,
  studioDestinationResearchFresh,
} from '../../shared/studio-travel-research';
import { api, ApiError } from '../api';
import { studioClientEntryKey, studioClientInspirationKey } from './studioClientInspirationState';

/** Ideas and passport checks run in sequence beside chat; edits cancel obsolete work. */
export function useStudioClientInspiration({
  workspace,
  enabled,
  paused,
  profile,
  onUpdate,
}: {
  workspace: StudioWorkspace | null;
  enabled: boolean;
  paused: boolean;
  profile?: StudioClientProfile;
  onUpdate: (workspace: StudioWorkspace) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const [retry, setRetry] = useState(0);
  const baseKey = workspace ? studioClientInspirationKey(workspace, profile) : '';
  const entryKey = workspace ? studioClientEntryKey(workspace) : '';
  const key = `${baseKey}:${entryKey}`;
  const latest = useRef({ workspace, paused, enabled, onUpdate, baseKey, entryKey });
  latest.current = { workspace, paused, enabled, onUpdate, baseKey, entryKey };
  const pending = useRef<{ key: string; attemptKey: string; controller: AbortController } | null>(
    null,
  );
  const attempted = useRef(new Set<string>());
  const conflicts = useRef(new Set<string>());
  const clockSuspended = useRef(new Set<string>());
  const clockMessage =
    'The destination checks are dated ahead of this browser. Check your device time, then use Find ideas to retry.';
  const ready = Boolean(
    workspace &&
    !workspace.stops.length &&
    (workspace.brief.clientId || workspace.destinationResearch),
  );
  const researchFresh = studioDestinationResearchFresh(workspace?.destinationResearch);
  const entriesNeeded = Boolean(
    workspace?.destinationResearch?.candidates.some((candidate) =>
      studioCandidateEntryNeedsResearch(workspace, candidate),
    ),
  );
  const researchStamp = workspace?.destinationResearch?.checkedAt || '';
  const entryStamps = JSON.stringify(
    workspace?.destinationResearch?.candidates.map((candidate) => [
      candidate.entryRequirements?.checkedAt,
      candidate.entryRequirements?.status,
    ]) || [],
  );

  useEffect(() => {
    if (pending.current && (pending.current.key !== key || paused || !enabled || !ready)) {
      attempted.current.delete(pending.current.attemptKey);
      pending.current.controller.abort();
      pending.current = null;
      setLoading(false);
    }
    setError(clockSuspended.current.has(key) ? clockMessage : '');
  }, [key, paused, enabled, ready]);
  useEffect(
    () => () => {
      pending.current?.controller.abort();
    },
    [],
  );
  useEffect(() => {
    // Persisted cache expiry is re-evaluated without typing. A small server clock lead
    // gets a catch-up tick; future timestamps never count as fresh evidence.
    const now = Date.now();
    const stamps = [
      {
        checkedAt: workspace?.destinationResearch?.checkedAt,
        ttl: STUDIO_DESTINATION_RESEARCH_FRESH_MS,
      },
      ...(workspace?.destinationResearch?.candidates || []).map((candidate) => ({
        checkedAt: candidate.entryRequirements?.checkedAt,
        ttl: STUDIO_CANDIDATE_ENTRY_FRESH_MS,
      })),
    ];
    const next = stamps.flatMap(({ checkedAt, ttl }) => {
      const checked = Date.parse(checkedAt || '');
      if (!Number.isFinite(checked)) return [];
      if (checked > now && checked - now <= 5000) return [checked + 10];
      return checked <= now && checked + ttl > now ? [checked + ttl + 10] : [];
    });
    if (!next.length) return;
    const timer = setTimeout(() => setClock(Date.now()), Math.max(1, Math.min(...next) - now));
    return () => clearTimeout(timer);
  }, [workspace?.id, researchStamp, entryStamps, clock]);

  async function refresh(force = false) {
    const context = latest.current;
    const current = context.workspace;
    if (!current || !context.enabled || context.paused || current.stops.length || pending.current)
      return;
    const identity = `${context.baseKey}:${context.entryKey}`;
    if (!force && clockSuspended.current.has(identity)) return;
    const checkResultClock = (saved: StudioWorkspace) => {
      const resultKey = `${context.baseKey}:${studioClientEntryKey(saved)}`;
      const resultStamps = [
        saved.destinationResearch?.checkedAt,
        ...(saved.destinationResearch?.candidates || []).map(
          (candidate) => candidate.entryRequirements?.checkedAt,
        ),
      ];
      const ahead = resultStamps.some((stamp) => Date.parse(stamp || '') - Date.now() > 5000);
      if (ahead) {
        // A new ahead-of-device stamp must not dispatch another paid request.
        // Keep evidence hidden and require an explicit retry.
        clockSuspended.current.add(identity);
        clockSuspended.current.add(resultKey);
        setError(clockMessage);
      } else {
        clockSuspended.current.delete(identity);
        clockSuspended.current.delete(resultKey);
      }
      return ahead;
    };
    const checkedStamps = [
      current.destinationResearch?.checkedAt,
      ...(current.destinationResearch?.candidates || []).map(
        (candidate) => candidate.entryRequirements?.checkedAt,
      ),
    ];
    if (
      checkedStamps.some((stamp) => {
        const lead = Date.parse(stamp || '') - Date.now();
        return lead > 0 && lead <= 5000;
      })
    )
      return;
    const fresh = studioDestinationResearchFresh(current.destinationResearch);
    const needsEntries = current.destinationResearch?.candidates.some((candidate) =>
      studioCandidateEntryNeedsResearch(current, candidate),
    );
    const kind = force || !fresh ? 'research' : needsEntries ? 'entry-requirements' : null;
    if (!kind) return;
    const cacheStamp =
      kind === 'entry-requirements'
        ? JSON.stringify(
            current.destinationResearch?.candidates.map((candidate) => [
              candidate.entryRequirements?.checkedAt,
              candidate.entryRequirements?.status,
            ]),
          )
        : current.destinationResearch?.checkedAt || '';
    const attemptKey = `${identity}:${kind}:${cacheStamp}`;
    if (!force && attempted.current.has(attemptKey)) return;
    attempted.current.add(attemptKey);
    const operation = { key: identity, attemptKey, controller: new AbortController() };
    pending.current = operation;
    setLoading(true);
    setError('');
    try {
      const result = await api<{ workspace: StudioWorkspace }>(
        `/studio/workspaces/${current.id}/destinations/${kind}`,
        {
          method: 'POST',
          signal: operation.controller.signal,
          body: JSON.stringify({ revision: current.revision, requestId: crypto.randomUUID() }),
        },
      );
      const now = latest.current;
      if (
        !operation.controller.signal.aborted &&
        now.workspace?.id === current.id &&
        now.baseKey === context.baseKey &&
        now.entryKey === context.entryKey &&
        !now.workspace.stops.length &&
        result.workspace.revision >= now.workspace.revision
      ) {
        checkResultClock(result.workspace);
        now.onUpdate(result.workspace);
      }
    } catch (cause) {
      if (operation.controller.signal.aborted || pending.current !== operation) return;
      if (cause instanceof ApiError && cause.status === 409 && !conflicts.current.has(attemptKey)) {
        conflicts.current.add(attemptKey);
        try {
          const result = await api<{ workspace: StudioWorkspace }>(
            `/studio/workspaces/${current.id}`,
            {
              signal: operation.controller.signal,
            },
          );
          const now = latest.current;
          if (
            !operation.controller.signal.aborted &&
            now.workspace?.id === current.id &&
            now.baseKey === context.baseKey &&
            now.entryKey === context.entryKey &&
            result.workspace.revision >= now.workspace.revision
          ) {
            const ahead = checkResultClock(result.workspace);
            now.onUpdate(result.workspace);
            if (!ahead) {
              attempted.current.delete(attemptKey);
              setRetry((value) => value + 1);
            }
          }
        } catch {
          setError('The destination checks could not reload. Use Find ideas to retry.');
        }
      } else setError((cause as Error).message);
    } finally {
      if (pending.current === operation) {
        pending.current = null;
        setLoading(false);
        // Stage one can retain the same brief identity; wake stage two after its save.
        setRetry((value) => value + 1);
      }
    }
  }
  useEffect(() => {
    if (!enabled || paused || !ready || (researchFresh && !entriesNeeded) || pending.current)
      return;
    const timer = setTimeout(() => void refresh(), 800);
    return () => clearTimeout(timer);
  }, [
    key,
    enabled,
    paused,
    ready,
    researchFresh,
    entriesNeeded,
    researchStamp,
    entryStamps,
    retry,
  ]);
  return { loading, error, refresh: () => void refresh(true) };
}
