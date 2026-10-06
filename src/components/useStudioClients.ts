import { useEffect, useState } from 'react';
import type { StudioClientProfile } from '../../shared/studio-clients';
import { api } from '../api';
import { useApp } from '../context';

export function useStudioClients() {
  const { ownerVersion } = useApp();
  const [clients, setClients] = useState<StudioClientProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setClients([]);
    void api<{ clients: StudioClientProfile[] }>('/studio/client-profiles', {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setClients(result.clients);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError((cause as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [ownerVersion, version]);
  const upsert = (client: StudioClientProfile) =>
    setClients((current) => [client, ...current.filter((item) => item.id !== client.id)]);
  return {
    clients,
    setClients,
    loading,
    error,
    upsert,
    reload: () => setVersion((value) => value + 1),
  };
}
