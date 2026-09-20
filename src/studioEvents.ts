import type { StudioWorkspace } from '../shared/studio';

/**
 * Changes made to a workspace from outside Studio — the sidebar's Recent menu renames and deletes
 * proposals — announced to whichever Studio view is open. A rename bumps the workspace revision,
 * so an open Studio that did not hear about it would send its next save against the old revision
 * and hit a conflict.
 */
export type StudioWorkspaceEvent =
  { type: 'updated'; workspace: StudioWorkspace } | { type: 'deleted'; id: string };

const listeners = new Set<(event: StudioWorkspaceEvent) => void>();

export function emitStudioWorkspaceEvent(event: StudioWorkspaceEvent) {
  listeners.forEach((listener) => listener(event));
}

export function onStudioWorkspaceEvent(listener: (event: StudioWorkspaceEvent) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
