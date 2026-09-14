import { useEffect, useState } from 'react';
import type { PlanningPlace } from '../shared/planning';
import { api } from './api';

/** Provider content lives only in the current page, never browser storage or trip mutations. */
export function useFreshPlaces(tripId: string, placeIds: string[], enabled: boolean) {
  const [places, setPlaces] = useState<Record<string, PlanningPlace>>({});
  const ids = placeIds
    .filter((id) => id.startsWith('google-'))
    .sort()
    .join(',');
  useEffect(() => {
    setPlaces({});
  }, [tripId]);
  useEffect(() => {
    if (!enabled || !ids) return;
    const controller = new AbortController();
    for (const id of ids.split(',')) {
      api<{ place: PlanningPlace }>(`/trips/${tripId}/places/${encodeURIComponent(id)}`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted)
            setPlaces((current) => ({ ...current, [id]: result.place }));
        })
        .catch(() => {
          /* The saved idea remains visible; opening details provides a retry. */
        });
    }
    return () => controller.abort();
  }, [tripId, ids, enabled]);
  return places;
}
