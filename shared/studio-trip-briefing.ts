import type { StudioWorkspace } from './studio';
import type {
  StudioEntryRequirements,
  StudioTravelEvidence,
  StudioCandidateEntryRequirements,
} from './studio-travel-research';
import { normalizeStudioCountry } from './studio-travel-research';
import { studioEntryPurposeDeclarations } from './studio-entry-context';

export interface StudioWeatherOutlook {
  kind: 'forecast' | 'seasonal_outlook' | 'climate_overview' | 'unavailable';
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
    scope?: 'preliminary' | 'dated_trip';
    entryRequirements: StudioEntryRequirements | null;
    preliminaryEntryRequirements?: StudioPreliminaryEntryRequirements | null;
    entryError: string;
    weather: StudioWeatherOutlook;
  })[];
  notes: string[];
}
export type StudioPreliminaryEntryRequirements = Omit<StudioCandidateEntryRequirements, 'scope'> & {
  scope: 'preliminary_trip';
};

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

/** A known destination starts preliminary checks without requiring dates or route approval. */
export function studioTripBriefingReady(workspace: StudioWorkspace): boolean {
  const destinations = studioTripBriefingDestinations(workspace);
  return (
    destinations.length > 0 &&
    destinations.length <= 20 &&
    destinations.some((stop) => Boolean(stop.destination.trim() && stop.countryCode))
  );
}
export function studioBriefingDestinationDated(
  workspace: StudioWorkspace,
  destination: StudioBriefingDestination,
): boolean {
  return Boolean(
    !workspace.clarification &&
    !workspace.brief.datesFlexible &&
    destination.destination.trim() &&
    destination.countryCode &&
    validDate(destination.startDate) &&
    validDate(destination.endDate) &&
    destination.endDate >= destination.startDate,
  );
}
export function studioPreliminaryEntryInputKey(workspace: StudioWorkspace, stopId = ''): string {
  const brief = workspace.brief as StudioWorkspace['brief'] & {
    tripDays?: number | null;
    returnDepartureDate?: string;
  };
  return JSON.stringify({
    scope: 'preliminary_trip_v1',
    trip: studioEntryRequirementsTrip(workspace, stopId),
    datesFlexible: workspace.brief.datesFlexible,
    clarification: Boolean(workspace.clarification),
    nights: workspace.stops.find((stop) => stop.id === stopId)?.nights ?? null,
    tripDays: brief.tripDays ?? null,
    returnDepartureDate: brief.returnDepartureDate || '',
  });
}

/** Shared, stable allowlist so the automatic UI and server compare exactly the same inputs. */
export function studioTripBriefingInputKey(workspace: StudioWorkspace): string {
  const brief = workspace.brief as StudioWorkspace['brief'] & {
    tripDays?: number | null;
    returnDepartureDate?: string;
  };
  return JSON.stringify({
    version: 2,
    passport: normalizeStudioCountry(workspace.brief.passportNationality || '')?.code || '',
    purpose: workspace.brief.tripPurpose || 'undecided',
    declaredActivities: studioEntryPurposeDeclarations(workspace.brief),
    departureDate: workspace.brief.departureDate || '',
    startDate: workspace.brief.startDate,
    endDate: workspace.brief.endDate,
    outboundTransport: workspace.brief.outboundTransport || 'undecided',
    returnTransport: workspace.brief.returnTransport || 'undecided',
    pendingDateClarification: Boolean(workspace.clarification),
    datesFlexible: workspace.brief.datesFlexible,
    tripDays: brief.tripDays ?? null,
    returnDepartureDate: brief.returnDepartureDate || '',
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
