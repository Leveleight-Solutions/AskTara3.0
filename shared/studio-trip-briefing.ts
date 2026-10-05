import type { StudioWorkspace } from './studio';
import type { StudioEntryRequirements, StudioTravelEvidence } from './studio-travel-research';
import { normalizeStudioCountry } from './studio-travel-research';
import { studioEntryPurposeDeclarations } from './studio-entry-context';

export interface StudioWeatherOutlook {
  kind: 'forecast' | 'seasonal_outlook' | 'unavailable';
  checkedAt: string;
  summary: string;
  sources: StudioTravelEvidence[];
  days: {
    date: string;
    temperatureMinC: number | null;
    temperatureMaxC: number | null;
    precipitationProbability: number | null;
  }[];
}
export interface StudioBriefingDestination {
  stopId: string;
  destination: string;
  country: string;
  countryCode: string;
  startDate: string;
  endDate: string;
}
export interface StudioTripBriefing {
  inputKey: string;
  checkedAt: string;
  status: 'complete' | 'partial';
  stops: (StudioBriefingDestination & {
    entryRequirements: StudioEntryRequirements | null;
    entryError: string;
    weather: StudioWeatherOutlook;
  })[];
  notes: string[];
}

export const STUDIO_TRIP_BRIEFING_FRESH_MS = 6 * 60 * 60 * 1000;
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

/** Only confirmed geography and travel dates, never the client profile or private request. */
export function studioTripBriefingDestinations(
  workspace: StudioWorkspace,
): StudioBriefingDestination[] {
  const stops = workspace.stops.length
    ? workspace.stops.map((stop) => ({
        stopId: stop.id,
        destination: stop.name,
        country: stop.country,
        startDate: stop.arrivalDate,
        endDate: stop.departureDate,
      }))
    : [
        {
          stopId: '',
          destination: workspace.brief.preferredDestination || '',
          country: workspace.brief.destinationCountry || '',
          startDate: workspace.brief.startDate,
          endDate: workspace.brief.endDate,
        },
      ];
  return stops.map((stop) => {
    const country = normalizeStudioCountry(stop.country);
    return { ...stop, country: country?.name || '', countryCode: country?.code || '' };
  });
}

/** Weather is useful before the passport or purpose is declared; entry checks wait for both. */
export function studioTripBriefingReady(workspace: StudioWorkspace): boolean {
  const destinations = studioTripBriefingDestinations(workspace);
  return (
    !workspace.clarification &&
    destinations.length <= 20 &&
    destinations.every(
      (stop) =>
        Boolean(stop.destination.trim() && stop.countryCode) &&
        validDate(stop.startDate) &&
        validDate(stop.endDate) &&
        stop.endDate >= stop.startDate,
    )
  );
}

/** Shared, stable allowlist so the automatic UI and server compare exactly the same inputs. */
export function studioTripBriefingInputKey(workspace: StudioWorkspace): string {
  return JSON.stringify({
    passport: normalizeStudioCountry(workspace.brief.passportNationality || '')?.code || '',
    purpose: workspace.brief.tripPurpose || 'undecided',
    declaredActivities: studioEntryPurposeDeclarations(workspace.brief),
    departureDate: workspace.brief.departureDate || '',
    startDate: workspace.brief.startDate,
    endDate: workspace.brief.endDate,
    outboundTransport: workspace.brief.outboundTransport || 'undecided',
    returnTransport: workspace.brief.returnTransport || 'undecided',
    pendingDateClarification: Boolean(workspace.clarification),
    destinations: studioTripBriefingDestinations(workspace),
    onwardTransport: workspace.stops.map((stop) => stop.onwardTransport),
  });
}

export function studioTripBriefingFresh(workspace: StudioWorkspace, now = Date.now()): boolean {
  const briefing = workspace.tripBriefing;
  if (!briefing || briefing.inputKey !== studioTripBriefingInputKey(workspace)) return false;
  const age = now - Date.parse(briefing.checkedAt);
  return Number.isFinite(age) && age >= 0 && age < STUDIO_TRIP_BRIEFING_FRESH_MS;
}

/** Matches the existing validated entry-check payload, including ordinary passport and modes. */
export function studioEntryRequirementsTrip(workspace: StudioWorkspace, stopId = '') {
  const stop = stopId ? workspace.stops.find((item) => item.id === stopId) : undefined;
  const index = stop ? workspace.stops.indexOf(stop) : -1;
  return {
    passportCountryCode:
      normalizeStudioCountry(workspace.brief.passportNationality || '')?.code || '',
    destinationCountryCode:
      normalizeStudioCountry(stop?.country || workspace.brief.destinationCountry || '')?.code || '',
    destination: stop?.name || workspace.brief.preferredDestination || '',
    startDate: stop?.arrivalDate || workspace.brief.startDate,
    endDate: stop?.departureDate || workspace.brief.endDate,
    purpose: workspace.brief.tripPurpose || 'undecided',
    declaredActivities: studioEntryPurposeDeclarations(workspace.brief),
    passportType: 'ordinary',
    stopId,
    arrivalTransport:
      stop && index > 0
        ? workspace.stops[index - 1].onwardTransport
        : workspace.brief.outboundTransport || 'undecided',
    departureTransport:
      stop && index < workspace.stops.length - 1
        ? stop.onwardTransport
        : workspace.brief.returnTransport || 'undecided',
  };
}
export function studioEntryRequirementsInputKey(workspace: StudioWorkspace, stopId = ''): string {
  return JSON.stringify(studioEntryRequirementsTrip(workspace, stopId));
}
