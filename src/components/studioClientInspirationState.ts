import type { StudioWorkspace } from '../../shared/studio';
import type { StudioClientProfile } from '../../shared/studio-clients';
import {
  normalizeStudioCountry,
  studioCandidateEntryFresh,
  studioCandidateEntryInputKey,
  studioVisaLabels,
  type StudioDestinationCandidate,
} from '../../shared/studio-travel-research';

/** Base inspiration and passport checks have separate identities so a passport edit keeps ideas. */
export function studioClientInspirationKey(
  workspace: StudioWorkspace,
  profile?: StudioClientProfile,
): string {
  const brief = workspace.brief;
  return JSON.stringify([
    workspace.id,
    brief.clientId,
    brief.context,
    brief.preferredDestination,
    brief.interests,
    brief.foodPreferences,
    brief.startDate,
    brief.endDate,
    brief.datesFlexible,
    brief.budget,
    brief.currency,
    brief.adults,
    brief.children,
    brief.origin,
    profile
      ? {
          context: profile.context,
          interests: profile.interests,
          foodPreferences: profile.foodPreferences,
          history: profile.history,
        }
      : null,
  ]);
}
export function studioClientEntryKey(workspace: StudioWorkspace): string {
  return JSON.stringify(
    (workspace.destinationResearch?.candidates || []).map((candidate) =>
      studioCandidateEntryInputKey(workspace, candidate),
    ),
  );
}
export function studioCandidateEntryLabel(
  workspace: StudioWorkspace,
  candidate: StudioDestinationCandidate,
  now = Date.now(),
): { label: string; state: 'pending' | 'review' | 'preliminary'; current: boolean } {
  if (!normalizeStudioCountry(workspace.brief.passportNationality || ''))
    return { label: 'Add passport nationality for visa advice', state: 'review', current: false };
  const entry = candidate.entryRequirements;
  if (!entry || entry.status === 'pending')
    return { label: 'Visa check pending', state: 'pending', current: false };
  if (!studioCandidateEntryFresh(workspace, candidate, now))
    return { label: 'Visa check needs refreshing', state: 'review', current: false };
  if (entry.status === 'preliminary')
    return {
      label: `${studioVisaLabels[entry.category]} · conditional`,
      state: 'preliminary',
      current: true,
    };
  if (entry.status === 'conflicting')
    return { label: 'Visa sources conflict · review', state: 'review', current: true };
  if (entry.status === 'unavailable')
    return { label: 'Visa check unavailable · review', state: 'review', current: true };
  return { label: 'Visa rules not verified', state: 'review', current: true };
}
