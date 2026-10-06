import { useEffect, useRef, useState } from 'react';
import type { StudioClientProfile } from '../../shared/studio-clients';
import type { StudioWorkspace } from '../../shared/studio';
import { api } from '../api';

/** Client ideas load alongside conversation; a foreground edit cancels obsolete research. */
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
  const key = workspace
    ? JSON.stringify([
        workspace.id,
        workspace.brief.clientId,
        workspace.brief.context,
        workspace.brief.preferredDestination,
        workspace.brief.interests,
        workspace.brief.foodPreferences,
        workspace.brief.startDate,
        workspace.brief.endDate,
        workspace.brief.budget,
        workspace.brief.currency,
        workspace.brief.adults,
        workspace.brief.children,
        workspace.brief.origin,
        profile
          ? {
              context: profile.context,
              interests: profile.interests,
              foodPreferences: profile.foodPreferences,
              history: profile.history,
            }
          : null,
      ])
    : '';
  const latest = useRef({ workspace, paused, enabled, onUpdate, key });
  latest.current = { workspace, paused, enabled, onUpdate, key };
  const pending = useRef<{ key: string; controller: AbortController } | null>(null);
  const attempted = useRef(new Set<string>());
  const ready = Boolean(workspace?.brief.clientId && !workspace.stops.length);
  const hasIdeas = Boolean(workspace?.destinationResearch);
  useEffect(() => {
    if (pending.current && (pending.current.key !== key || paused || !enabled || !ready)) {
      attempted.current.delete(pending.current.key);
      pending.current.controller.abort();
      pending.current = null;
      setLoading(false);
    }
    setError('');
  }, [key, paused, enabled, ready]);
  useEffect(
    () => () => {
      pending.current?.controller.abort();
    },
    [],
  );
  async function refresh(force = false) {
    const current = latest.current.workspace;
    if (
      !current ||
      !latest.current.enabled ||
      latest.current.paused ||
      current.stops.length ||
      pending.current
    )
      return;
    if (!force && current.destinationResearch) return;
    const operation = { key: latest.current.key, controller: new AbortController() };
    attempted.current.add(operation.key);
    pending.current = operation;
    setLoading(true);
    setError('');
    try {
      const result = await api<{ workspace: StudioWorkspace }>(
        `/studio/workspaces/${current.id}/destinations/research`,
        {
          method: 'POST',
          signal: operation.controller.signal,
          body: JSON.stringify({ revision: current.revision, requestId: crypto.randomUUID() }),
        },
      );
      const now = latest.current.workspace;
      if (
        !operation.controller.signal.aborted &&
        now?.id === current.id &&
        now.brief.clientId === current.brief.clientId &&
        latest.current.key === operation.key &&
        !now.stops.length &&
        result.workspace.revision >= now.revision
      )
        latest.current.onUpdate(result.workspace);
    } catch (cause) {
      if (!operation.controller.signal.aborted) setError((cause as Error).message);
    } finally {
      if (pending.current === operation) {
        pending.current = null;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    if (!enabled || paused || !ready || hasIdeas || attempted.current.has(key) || pending.current)
      return;
    const timer = setTimeout(() => void refresh(), 800);
    return () => clearTimeout(timer);
  }, [key, enabled, paused, ready, hasIdeas]);
  return { loading, error, refresh: () => void refresh(true) };
}
