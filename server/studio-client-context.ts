import type { StudioTravelHistoryEntry } from '../shared/studio-travel-research.ts';
import { normalizeStudioCountry } from '../shared/studio-travel-research.ts';
import { redactStudioPrivateText } from './studio-imports.ts';

/** Explicit allowlist: profile identity, photos and birth dates never enter model history. */
export function studioRecommendationHistory(history: StudioTravelHistoryEntry[] = []) {
  return history.slice(-20).map((item) => ({
    destination: redactStudioPrivateText(item.destination).slice(0, 120),
    country: normalizeStudioCountry(item.country || '')?.name || '',
    visitedAt: /^\d{4}-\d{2}(?:-\d{2})?$/.test(item.visitedAt || '') ? item.visitedAt : '',
    interests: (item.interests || [])
      .slice(0, 12)
      .map((value) => redactStudioPrivateText(value).slice(0, 80)),
    feedback: ['liked', 'neutral', 'disliked'].includes(item.feedback || '')
      ? item.feedback
      : 'neutral',
    experience: item.experience === 'planned' ? 'planned' : 'visited',
    notes: redactStudioPrivateText(item.notes || '').slice(0, 1000),
  }));
}
