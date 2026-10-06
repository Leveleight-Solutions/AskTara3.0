import type { StudioClientProfile } from '../../shared/studio-clients';
import { normalizeStudioCountry } from '../../shared/studio-travel-research';

export type StudioClientDraft = Omit<StudioClientProfile, 'id' | 'updatedAt' | 'previousTripCount'>;
export function clientProfileDraft(client?: StudioClientProfile): StudioClientDraft {
  return {
    name: client?.name || '',
    country: client?.country || '',
    nationality: client?.nationality || '',
    dateOfBirth: client?.dateOfBirth || '',
    context: client?.context || '',
    passportNationality: client?.passportNationality || '',
    photoDataUrl: client?.photoDataUrl || '',
    interests: [...(client?.interests || [])],
    foodPreferences: [...(client?.foodPreferences || [])],
    history: structuredClone(client?.history || []),
  };
}
export const clientCountryLabel = (value?: string) =>
  normalizeStudioCountry(value || '')?.name || value || '';
export const clientListValues = (value: string) =>
  value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
export function filterStudioClients(clients: StudioClientProfile[], query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return clients.filter((client) => {
    const text = [
      client.name,
      clientCountryLabel(client.country),
      clientCountryLabel(client.nationality),
      ...client.interests,
      ...client.history.map((trip) => trip.destination),
    ]
      .join(' ')
      .toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}
