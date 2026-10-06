import type { StudioBrief, StudioWorkspace } from '../../shared/studio';
import { normalizeStudioCountry } from '../../shared/studio-travel-research';
import type { StudioJourneyDirection, StudioJourneyOption } from '../../shared/studio-journey';

export interface StudioChatJourneyContext {
  direction: StudioJourneyDirection;
  optionId?: string;
  inputKey?: string;
}
export interface StudioChatJourneyPrefill {
  direction: StudioJourneyDirection;
  option?: StudioJourneyOption;
}

export type StudioChatOfferAction = 'hotels' | 'flights' | 'cruises' | 'activities';
export type StudioChatSearchKind = 'hotels' | 'flights';
export interface StudioChatSearchDraft {
  stopId: string;
  nationality: string;
  adults: string;
  children: string;
  childAges: string;
  hotelStandard: string;
  hotelLocation: string;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  returnJourney: '' | 'one_way' | 'return';
  cabin: string;
}

/** Mirrors supplier eligibility; research metadata and proposal additions don't invalidate rates. */
export function studioChatQuoteContextKey(
  workspace: StudioWorkspace,
  journey?: StudioChatJourneyContext,
) {
  const b = workspace.brief;
  return JSON.stringify({
    id: workspace.id,
    accepted: workspace.structureAccepted,
    startDate: b.startDate,
    endDate: b.endDate,
    stops: workspace.stops.map(
      ({
        id,
        name,
        country,
        nights,
        arrivalDate,
        departureDate,
        onwardTransport,
        neighbourhood,
      }) => ({
        id,
        name,
        country,
        nights,
        arrivalDate,
        departureDate,
        onwardTransport,
        neighbourhood,
      }),
    ),
    adults: b.adults,
    children: b.children,
    childAges: b.childAges,
    passportNationality: b.passportNationality,
    currency: b.currency,
    pricingCurrency: workspace.pricing.currency,
    hotelStandard: b.hotelStandard,
    hotelLocation: b.hotelLocation,
    cabin: b.cabin,
    origin: b.origin,
    departureDate: b.departureDate || '',
    returnDepartureDate: b.returnDepartureDate || '',
    tripDays: b.tripDays ?? null,
    journey: journey || null,
    outbound: b.outboundTransport || 'undecided',
    returning: b.returnTransport || 'undecided',
  });
}

export function studioChatCabin(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[-_]/g, ' ')
    .replace(/ class$/, '');
  return (
    (
      {
        economy: 'economy',
        'premium economy': 'premium_economy',
        business: 'business',
        first: 'first',
      } as Record<string, string>
    )[normalized] || ''
  );
}
export function studioChatSearchDraft(
  workspace: StudioWorkspace,
  journey?: StudioChatJourneyPrefill,
): StudioChatSearchDraft {
  const b = workspace.brief;
  const direction = journey?.direction || 'outbound';
  const option = journey?.option;
  const sourced =
    option?.basis === 'route_guidance' &&
    option.sources.some((source) => studioChatMediaUrl(source.url));
  const code = (value: string | undefined) => (/^[A-Z]{3}$/.test(value || '') ? value! : '');
  const first = workspace.stops[0];
  const last = workspace.stops.at(-1);
  return {
    stopId: (direction === 'outbound' ? first : last)?.id || '',
    nationality: normalizeStudioCountry(b.passportNationality || '')?.code || '',
    adults: b.adults === null ? '' : String(b.adults),
    children: b.children === null ? '' : String(b.children),
    childAges: b.childAges.join(', '),
    hotelStandard: b.hotelStandard,
    hotelLocation: b.hotelLocation,
    // City names aren't airport declarations. Arrival isn't an outbound departure date.
    origin:
      (sourced ? code(option.originAirportCode) : '') ||
      code(direction === 'outbound' ? b.origin.trim() : last?.name.trim()),
    destination:
      (sourced ? code(option.destinationAirportCode) : '') ||
      code(direction === 'outbound' ? first?.name.trim() : b.origin.trim()),
    departureDate: direction === 'outbound' ? b.departureDate || '' : b.returnDepartureDate || '',
    returnDate:
      direction === 'outbound' && b.returnTransport === 'flight' && workspace.stops.length === 1
        ? b.returnDepartureDate || b.endDate
        : '',
    returnJourney:
      direction === 'return'
        ? 'one_way'
        : b.returnTransport === 'flight'
          ? 'return'
          : b.returnTransport === 'cruise'
            ? 'one_way'
            : '',
    cabin: studioChatCabin(b.cabin),
  };
}

export function studioChatSearchBriefPatch(
  workspace: StudioWorkspace,
  draft: StudioChatSearchDraft,
  kind: StudioChatSearchKind,
  journey?: StudioChatJourneyContext,
): { patch: Partial<StudioBrief>; error: string } {
  const b = workspace.brief,
    patch: Partial<StudioBrief> = {};
  const adults = b.adults ?? (draft.adults.trim() ? Number(draft.adults) : NaN);
  const children = b.children ?? (draft.children.trim() ? Number(draft.children) : NaN);
  if (!Number.isInteger(adults) || adults < 1 || adults > 100)
    return { patch, error: 'Confirm how many adults are travelling.' };
  if (!Number.isInteger(children) || children < 0 || children > 30)
    return { patch, error: 'Confirm whether children are travelling.' };
  if (b.adults === null) patch.adults = adults;
  if (b.children === null) patch.children = children;
  if (kind === 'flights' && children > 0)
    return {
      patch: {},
      error:
        'Family flight prices need a reviewed supplier quote. Adult-only fares would leave out the children.',
    };
  if (kind === 'hotels' && children > 0 && b.childAges.length !== children) {
    const parts = draft.childAges.split(',').map((value) => value.trim());
    const ages = parts.map((value) => (value ? Number(value) : NaN));
    if (
      ages.length !== children ||
      ages.some((age) => !Number.isInteger(age) || age < 0 || age > 17)
    )
      return { patch: {}, error: 'Enter one age (0–17) for each child.' };
    patch.childAges = ages;
  } else if (children === 0 && b.children === null) patch.childAges = [];
  if (kind === 'hotels') {
    if (!b.hotelStandard.trim()) {
      if (!draft.hotelStandard.trim())
        return { patch: {}, error: 'Choose the hotel standard for this stay.' };
      patch.hotelStandard = draft.hotelStandard.trim();
    }
    if (!b.hotelLocation.trim()) {
      if (!draft.hotelLocation.trim())
        return { patch: {}, error: 'Choose the hotel location for this stay.' };
      patch.hotelLocation = draft.hotelLocation.trim();
    }
  } else if (!studioChatCabin(b.cabin)) {
    if (!studioChatCabin(draft.cabin))
      return { patch: {}, error: 'Choose the flight cabin for this search.' };
    patch.cabin = draft.cabin.replaceAll('_', ' ');
  }
  if (kind === 'flights' && journey) {
    const departureField =
      journey.direction === 'outbound' ? 'departureDate' : 'returnDepartureDate';
    if (draft.departureDate && draft.departureDate !== (b[departureField] || ''))
      patch[departureField] = draft.departureDate;
    if (
      journey.direction === 'outbound' &&
      draft.returnJourney === 'return' &&
      draft.returnDate &&
      draft.returnDate !== b.returnDepartureDate
    )
      patch.returnDepartureDate = draft.returnDate;
    if (studioChatCabin(draft.cabin) && studioChatCabin(draft.cabin) !== studioChatCabin(b.cabin))
      patch.cabin = draft.cabin.replaceAll('_', ' ');
  }
  return { patch, error: '' };
}

export function studioChatMediaUrl(value: string | undefined) {
  try {
    const url = new URL(value || '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}
