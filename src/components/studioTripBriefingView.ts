import type { StudioWorkspace } from '../../shared/studio';
import type { StudioEntryRequirements } from '../../shared/studio-travel-research';
import { normalizeStudioCountry } from '../../shared/studio-travel-research';
import {
  STUDIO_TRIP_BRIEFING_FRESH_MS,
  studioEntryRequirementsInputKey,
  studioTripBriefingDestinations,
  studioTripBriefingFresh,
  studioTripBriefingReady,
  studioBriefingDestinationDated,
  studioPreliminaryEntryInputKey,
} from '../../shared/studio-trip-briefing';

function currentEntry(
  workspace: StudioWorkspace,
  entry: StudioEntryRequirements | null | undefined,
  stopId: string,
  now: number,
) {
  if (
    !entry ||
    !normalizeStudioCountry(workspace.brief.passportNationality || '') ||
    !workspace.brief.tripPurpose ||
    workspace.brief.tripPurpose === 'undecided'
  )
    return null;
  const age = now - Date.parse(entry.checkedAt);
  return entry.stopId === stopId &&
    entry.inputKey === studioEntryRequirementsInputKey(workspace, stopId) &&
    Number.isFinite(age) &&
    age >= 0 &&
    age < STUDIO_TRIP_BRIEFING_FRESH_MS
    ? entry
    : null;
}

/** Show only current-route, fresh evidence. A valid standalone entry check can bridge a refresh. */
export function studioTripBriefingDisplay(workspace: StudioWorkspace, now = Date.now()) {
  const ready = studioTripBriefingReady(workspace);
  const fresh = ready && studioTripBriefingFresh(workspace, now);
  const briefing = fresh ? workspace.tripBriefing : null;
  const rows = studioTripBriefingDestinations(workspace)
    .filter((destination) => destination.destination.trim() || destination.countryCode)
    .map((destination) => {
      const checked = briefing?.stops.find(
        (stop) =>
          stop.stopId === destination.stopId &&
          stop.destination === destination.destination &&
          stop.countryCode === destination.countryCode &&
          stop.startDate === destination.startDate &&
          stop.endDate === destination.endDate,
      );
      const candidates = [
        checked?.entryRequirements,
        ...(workspace.entryRequirements?.filter((entry) => entry.stopId === destination.stopId) ||
          []),
      ];
      const dated = studioBriefingDestinationDated(workspace, destination);
      const entryRequirements = dated
        ? candidates.reduce<StudioEntryRequirements | null>((latest, candidate) => {
            const entry = currentEntry(workspace, candidate, destination.stopId, now);
            // A later standalone recheck can contradict the cached briefing. Equal timestamps
            // also favour the standalone result, which follows the cached entry in this list.
            return entry && (!latest || Date.parse(entry.checkedAt) >= Date.parse(latest.checkedAt))
              ? entry
              : latest;
          }, null)
        : null;
      const preliminary = checked?.preliminaryEntryRequirements;
      const preliminaryAge = preliminary ? now - Date.parse(preliminary.checkedAt) : NaN;
      const preliminaryEntryRequirements =
        preliminary &&
        normalizeStudioCountry(workspace.brief.passportNationality || '') &&
        preliminary.scope === 'preliminary_trip' &&
        preliminary.inputKey === studioPreliminaryEntryInputKey(workspace, destination.stopId) &&
        Number.isFinite(preliminaryAge) &&
        preliminaryAge >= 0 &&
        preliminaryAge < STUDIO_TRIP_BRIEFING_FRESH_MS
          ? preliminary
          : null;
      const weatherAge = checked ? now - Date.parse(checked.weather.checkedAt) : NaN;
      const weather =
        Number.isFinite(weatherAge) && weatherAge >= 0 && weatherAge < STUDIO_TRIP_BRIEFING_FRESH_MS
          ? checked!.weather
          : null;
      return {
        ...destination,
        scope: checked?.scope || (dated ? 'dated_trip' : 'preliminary'),
        entryRequirements,
        preliminaryEntryRequirements,
        weather,
        entryError: checked?.entryError || '',
      };
    });
  return { ready, fresh, rows };
}
