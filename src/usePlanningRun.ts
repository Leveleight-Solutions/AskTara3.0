import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlanningRun } from '../shared/planning';
import { api } from './api';

export function usePlanningRun() {
  const [run, setRun] = useState<PlanningRun | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const polling = useRef<AbortController | null>(null);
  const reset = useCallback(() => {
    polling.current?.abort();
    setRun(null);
    setCancelling(false);
  }, []);
  useEffect(
    () => () => {
      polling.current?.abort();
    },
    [],
  );
  const follow = useCallback(async (initial: PlanningRun) => {
    polling.current?.abort();
    const controller = new AbortController();
    polling.current = controller;
    let current = initial;
    let failures = 0;
    for (;;) {
      controller.signal.throwIfAborted();
      setRun(current);
      if (
        current.status === 'completed' ||
        current.status === 'failed' ||
        current.status === 'cancelled'
      )
        return current;
      await new Promise<void>((resolve, reject) => {
        const stop = () => {
          clearTimeout(timer);
          reject(new DOMException('Polling stopped', 'AbortError'));
        };
        const timer = setTimeout(() => {
          controller.signal.removeEventListener('abort', stop);
          resolve();
        }, 1000);
        controller.signal.addEventListener('abort', stop, { once: true });
      });
      try {
        const response = await api<{ run: PlanningRun }>(`/planning/runs/${current.id}`, {
          signal: controller.signal,
        });
        current = response.run;
        failures = 0;
      } catch (error) {
        if (controller.signal.aborted || ++failures >= 3) throw error;
      }
    }
  }, []);
  const cancel = useCallback(async () => {
    if (!run) return;
    setCancelling(true);
    try {
      const response = await api<{ run: PlanningRun }>(`/planning/runs/${run.id}/cancel`, {
        method: 'POST',
      });
      setRun(response.run);
    } finally {
      setCancelling(false);
    }
  }, [run]);
  return { run, follow, cancel, cancelling, reset };
}
