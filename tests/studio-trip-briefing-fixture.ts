import type { StudioWorkspace } from '../shared/studio';
import type { Route } from '@playwright/test';
import { normalizeStudioCountry } from '../shared/studio-travel-research';
import {
  studioEntryRequirementsInputKey,
  studioTripBriefingDestinations,
  studioTripBriefingFresh,
  studioTripBriefingInputKey,
  type StudioTripBriefing,
} from '../shared/studio-trip-briefing';

/** Synthetic provider responses for browser tests; these are not live travel advice. */
export function syntheticTripBriefing(workspace: StudioWorkspace): StudioTripBriefing {
  const checkedAt = new Date().toISOString();
  const passport = normalizeStudioCountry(workspace.brief.passportNationality || '');
  const stops = studioTripBriefingDestinations(workspace).map((stop) => {
    const country = normalizeStudioCountry(stop.country);
    return {
      stopId: stop.stopId,
      destination: stop.destination,
      country: country?.name || stop.country,
      countryCode: country?.code || '',
      startDate: stop.startDate,
      endDate: stop.endDate,
      entryRequirements: passport
        ? {
            stopId: stop.stopId,
            checkedAt,
            inputKey: studioEntryRequirementsInputKey(workspace, stop.stopId),
            passportCountry: passport.name,
            passportCountryCode: passport.code,
            destination: stop.destination,
            destinationCountry: country?.name || stop.country,
            destinationCountryCode: country?.code || '',
            category: 'visa_required' as const,
            status: 'corroborated' as const,
            summary: `Synthetic entry advice for ${passport.name} passport in ${stop.destination}.`,
            conditions: ['Synthetic provider fixture: check permitted stay.'],
            electronicAuthorisation: 'Synthetic provider fixture: no authorisation established.',
            observations: [],
            notes: [],
            sources: [
              {
                label: 'Synthetic immigration source',
                url: 'https://immigration.example.test/entry',
                kind: 'official_immigration' as const,
                checkedAt,
                publishedAt: checkedAt,
              },
            ],
          }
        : null,
      entryError: passport ? '' : 'Add passport nationality to check entry requirements.',
      weather: {
        kind: 'seasonal_outlook' as const,
        summary: `Synthetic seasonal outlook for ${stop.destination}; this is not a daily forecast.`,
        checkedAt,
        days: [],
        sources: [
          {
            label: 'Synthetic climate source',
            url: 'https://climate.example.test/outlook',
            kind: 'conditions' as const,
            checkedAt,
            publishedAt: checkedAt,
          },
        ],
      },
    };
  });
  return {
    inputKey: studioTripBriefingInputKey(workspace),
    checkedAt,
    status: passport ? 'complete' : 'partial',
    stops,
    notes: ['Synthetic browser-test provider results.'],
  };
}

/** Background checks have their own coverage in studio-guided-workspace.spec.ts. */
export async function fulfilSyntheticTripBriefing(route: Route, workspace: StudioWorkspace) {
  const path = new URL(route.request().url()).pathname;
  if (path !== `/api/studio/workspaces/${workspace.id}/trip-briefing`) return false;
  const body = route.request().postDataJSON() || {};
  if (body.revision !== workspace.revision) {
    await route.fulfill({ status: 409, json: { error: 'Synthetic workspace revision changed.' } });
    return true;
  }
  if (studioTripBriefingFresh(workspace) && !body.force) {
    await route.fulfill({ json: { workspace, briefing: workspace.tripBriefing, reused: true } });
    return true;
  }
  workspace.tripBriefing = syntheticTripBriefing(workspace);
  workspace.entryRequirements = workspace.tripBriefing.stops.flatMap((stop) =>
    stop.entryRequirements ? [stop.entryRequirements] : [],
  );
  workspace.revision++;
  await route.fulfill({ json: { workspace, briefing: workspace.tripBriefing } });
  return true;
}
