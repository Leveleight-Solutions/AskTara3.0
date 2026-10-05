import { useEffect, useRef, useState } from 'react';
import type { StudioWorkspace } from '../../shared/studio';
import {
  studioTripBriefingFresh,
  studioTripBriefingInputKey,
  studioTripBriefingReady,
} from '../../shared/studio-trip-briefing';
import { api, ApiError } from '../api';

/** Research runs beside editing, with one automatic attempt per declared trip context. */
export function useStudioTripBriefing({
  workspace,
  enabled,
  paused,
  interrupt,
  onUpdate,
}: {
  workspace: StudioWorkspace | null;
  enabled: boolean;
  paused: boolean;
  /** Foreground actions must not race a background revision save. */
  interrupt: boolean;
  onUpdate: (workspace: StudioWorkspace) => void;
}) {
  const latest = useRef({ workspace, paused, onUpdate });
  latest.current = { workspace, paused, onUpdate };
  const attempted = useRef(new Set<string>());
  const conflicts = useRef(new Map<string, number>());
  const [retry, setRetry] = useState(0);
  const pending = useRef<{ key: string; controller: AbortController } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const key = workspace ? `${workspace.id}:${studioTripBriefingInputKey(workspace)}` : '';
  const ready = Boolean(workspace && studioTripBriefingReady(workspace));
  const fresh = Boolean(workspace && studioTripBriefingFresh(workspace));

  useEffect(() => {
    setError('');
    if (pending.current && (pending.current.key !== key || !enabled || interrupt)) {
      attempted.current.delete(pending.current.key);
      pending.current.controller.abort();
      pending.current = null;
      setLoading(false);
    }
  }, [key, enabled, interrupt]);
  useEffect(
    () => () => {
      if (pending.current) attempted.current.delete(pending.current.key);
      pending.current?.controller.abort();
    },
    [],
  );

  async function refresh(force = false) {
    const current = latest.current.workspace;
    if (
      !current ||
      !enabled ||
      !studioTripBriefingReady(current) ||
      latest.current.paused ||
      pending.current
    )
      return;
    const requestKey = `${current.id}:${studioTripBriefingInputKey(current)}`;
    attempted.current.add(requestKey);
    const operation = { key: requestKey, controller: new AbortController() };
    pending.current = operation;
    setLoading(true);
    setError('');
    try {
      const response = await api<{ workspace: StudioWorkspace }>(
        `/studio/workspaces/${current.id}/trip-briefing`,
        {
          method: 'POST',
          signal: operation.controller.signal,
          body: JSON.stringify({
            revision: current.revision,
            requestId: crypto.randomUUID(),
            ...(force ? { force: true } : {}),
          }),
        },
      );
      const now = latest.current.workspace;
      if (
        !operation.controller.signal.aborted &&
        now?.id === current.id &&
        studioTripBriefingInputKey(now) === studioTripBriefingInputKey(current) &&
        response.workspace.revision >= now.revision
      )
        latest.current.onUpdate(response.workspace);
    } catch (cause) {
      if (operation.controller.signal.aborted || pending.current !== operation) return;
      if (cause instanceof ApiError && cause.status === 409) {
        // A concurrent edit wins. Refresh the saved revision without dropping local inputs.
        try {
          const response = await api<{ workspace: StudioWorkspace }>(
            `/studio/workspaces/${current.id}`,
            { signal: operation.controller.signal },
          );
          const now = latest.current.workspace;
          if (now?.id === current.id && response.workspace.revision >= now.revision)
            latest.current.onUpdate(response.workspace);
          if (
            response.workspace.id === current.id &&
            studioTripBriefingInputKey(response.workspace) ===
              studioTripBriefingInputKey(current) &&
            !studioTripBriefingFresh(response.workspace) &&
            (conflicts.current.get(requestKey) || 0) < 1
          ) {
            conflicts.current.set(requestKey, 1);
            attempted.current.delete(requestKey);
            setRetry((value) => value + 1);
          }
        } catch {
          /* The next explicit refresh can recover when connection returns. */
        }
      } else setError((cause as Error).message);
    } finally {
      if (pending.current === operation) {
        pending.current = null;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    if (!enabled || paused || !ready || fresh || attempted.current.has(key) || pending.current)
      return;
    const timer = setTimeout(() => {
      if (!latest.current.paused) void refresh();
    }, 1200);
    return () => clearTimeout(timer);
  }, [key, enabled, paused, ready, fresh, retry]);
  return { loading, error, refresh: () => void refresh(true) };
}
