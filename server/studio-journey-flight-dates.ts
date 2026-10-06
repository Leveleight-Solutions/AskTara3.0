import type { FlightAirport, FlightJourney, FlightOffer } from '../shared/types.ts';
import type { StudioWorkspace, StudioBrief, StudioStop } from '../shared/studio.ts';
import { normalizeStudioCountry } from '../shared/studio-travel-research.ts';
import { StudioError } from './studio-store.ts';

export type StudioJourneyDirection = 'outbound' | 'return';
export interface StudioJourneyDateResolution {
  arrivalDate: string | null;
  returnDepartureDate: string | null;
  nights: number | null;
  notes: string[];
}
const realDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

/** Merge only the same supplier endpoint; another airport cannot lend its city or timezone. */
function endpointAirport(journey: FlightJourney | undefined, edge: 'origin' | 'destination') {
  const airport = journey?.[edge];
  if (!airport) return;
  const segment =
    edge === 'origin' ? journey?.segments[0]?.origin : journey?.segments.at(-1)?.destination;
  if (segment?.code !== airport.code) return airport;
  return {
    ...segment,
    ...airport,
    city: airport.city?.trim() || segment.city,
    timeZone: airport.timeZone || segment.timeZone,
  };
}
function cityName(value: string) {
  let name = value.normalize('NFKC').trim();
  const qualifier = name.match(/,\s*([^,]+)$|\s*\(([^()]*)\)$/);
  if (qualifier && normalizeStudioCountry(qualifier[1] || qualifier[2]))
    name = name.slice(0, qualifier.index).trim();
  return name.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').toLocaleLowerCase('en');
}
function gatewayMismatch(
  airport: FlightAirport | undefined,
  stop: Pick<StudioStop, 'name'> | undefined,
) {
  const city = airport?.city?.trim();
  return Boolean(
    city &&
    stop &&
    !/^(?:unknown|n\/?a|not available|not provided|unspecified|-+)$/i.test(city) &&
    cityName(city) !== cityName(stop.name),
  );
}
function flightEndpoints(flight: FlightOffer, direction: StudioJourneyDirection) {
  const first = flight.journeys?.[0];
  const inbound = flight.journeys?.length === 2 ? flight.journeys[1] : undefined;
  return {
    first,
    inbound,
    arrivalAirport: endpointAirport(first, 'destination'),
    returnAirport: endpointAirport(direction === 'return' ? first : inbound, 'origin'),
  };
}

/** Supplier local/offset timestamps retain their literal date. UTC needs supplier timezone. */
export function studioFlightLocalDate(value: string, airport?: FlightAirport): string | null {
  const parsed =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(
      value,
    );
  if (
    !parsed ||
    !realDate(parsed[1]) ||
    Number(parsed[2]) > 23 ||
    Number(parsed[3]) > 59 ||
    Number(parsed[4] || 0) > 59
  )
    return null;
  const offset = parsed[5];
  if (offset && offset !== 'Z') {
    const digits = offset.slice(1).replace(':', '');
    if (
      Number(digits.slice(0, 2)) > 14 ||
      Number(digits.slice(2)) > 59 ||
      (Number(digits.slice(0, 2)) === 14 && Number(digits.slice(2)) !== 0) ||
      !Number.isFinite(Date.parse(value))
    )
      return null;
  }
  if (offset !== 'Z') return parsed[1];
  if (!airport?.timeZone || !Number.isFinite(Date.parse(value))) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: airport.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(value));
    const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    return realDate(date) ? date : null;
  } catch {
    return null;
  }
}

export function studioJourneyFlightDates(
  flight: FlightOffer,
  direction: StudioJourneyDirection,
  stop?: Pick<StudioStop, 'name' | 'arrivalDate'>,
): StudioJourneyDateResolution {
  const { first, inbound, arrivalAirport, returnAirport } = flightEndpoints(flight, direction);
  let arrivalDate =
    direction === 'outbound'
      ? studioFlightLocalDate(first?.arrival || flight.arrival, arrivalAirport)
      : null;
  const returnDepartureDate =
    direction === 'return'
      ? studioFlightLocalDate(first?.departure || flight.departure, returnAirport)
      : inbound
        ? studioFlightLocalDate(inbound.departure, returnAirport)
        : null;
  const notes: string[] = [];
  if (direction === 'outbound' && !arrivalDate)
    notes.push(
      'The supplier did not provide an unambiguous local arrival date. Confirm arrival before setting hotel dates.',
    );
  if ((direction === 'return' || inbound) && !returnDepartureDate)
    notes.push(
      'The supplier did not provide an unambiguous local return departure date. Confirm it before setting checkout.',
    );
  if (direction === 'outbound' && gatewayMismatch(arrivalAirport, stop)) {
    arrivalDate = null;
    notes.push(
      `The supplier flight lands at ${arrivalAirport!.code} in ${arrivalAirport!.city}, while the itinerary stop is ${stop!.name}. Confirm the airport transfer and the city arrival date before setting hotel dates.`,
    );
    if (stop?.arrivalDate && realDate(stop.arrivalDate))
      notes.push(
        `The recorded arrival (${stop.arrivalDate}) is retained for review; the airport landing does not confirm arrival in ${stop.name}.`,
      );
  }
  if (gatewayMismatch(returnAirport, stop))
    notes.push(
      `The supplier return flight departs ${returnAirport!.code} in ${returnAirport!.city}, while the final stop is ${stop!.name}. Confirm the airport transfer and checkout day; the airport departure does not establish hotel checkout.`,
    );
  return { arrivalDate, returnDepartureDate, nights: null, notes };
}

/** Explicit use-flight-dates selection changes only source-backed dates and exact calendar gaps. */
export function studioJourneyDatePatch(
  workspace: StudioWorkspace,
  flight: FlightOffer,
  direction: StudioJourneyDirection,
  stopId: string,
) {
  const index = workspace.stops.findIndex((stop) => stop.id === stopId);
  if (
    index < 0 ||
    (direction === 'outbound' && index !== 0) ||
    (direction === 'return' && index !== workspace.stops.length - 1)
  )
    throw new StudioError(
      400,
      'Choose the first route stop for outbound flights or the last stop for return flights.',
    );
  const resolution = studioJourneyFlightDates(flight, direction, workspace.stops[index]);
  const { arrivalAirport, returnAirport } = flightEndpoints(flight, direction);
  const arrivalTransferReview =
    direction === 'outbound' && gatewayMismatch(arrivalAirport, workspace.stops[index]);
  const returnTransferReview = gatewayMismatch(returnAirport, workspace.stops[index]);
  const needsTransferReview = arrivalTransferReview || returnTransferReview;
  if (
    workspace.stops.length > 1 &&
    direction === 'outbound' &&
    flight.journeys &&
    flight.journeys.length > 1
  )
    throw new StudioError(
      400,
      'For a multi-stop trip, choose an outbound flight and a separate return from the last destination.',
      'STUDIO_FLIGHT_DATES_CONFLICT',
    );
  const stops: StudioStop[] = workspace.stops.map((stop) => ({ ...stop }));
  const stop = stops[index];
  const brief: Partial<StudioBrief> =
    direction === 'outbound' ? { outboundTransport: 'flight' } : { returnTransport: 'flight' };
  if (direction === 'outbound' && flight.journeys?.length === 2) brief.returnTransport = 'flight';
  if (resolution.arrivalDate) {
    brief.startDate = resolution.arrivalDate;
    stop.arrivalDate = resolution.arrivalDate;
    stop.arrivalFixed = true;
  }
  if (resolution.returnDepartureDate && !needsTransferReview) {
    brief.returnDepartureDate = resolution.returnDepartureDate;
    brief.endDate = resolution.returnDepartureDate;
  }
  const closingDate = needsTransferReview
    ? ''
    : resolution.returnDepartureDate || workspace.brief.returnDepartureDate || '';
  if (stops.length === 1 && realDate(stop.arrivalDate) && realDate(closingDate)) {
    const nights = (Date.parse(closingDate) - Date.parse(stop.arrivalDate)) / 86400000;
    if (nights < 0)
      throw new StudioError(
        409,
        'This return flight leaves before the destination arrival. Choose a compatible schedule.',
        'STUDIO_FLIGHT_DATES_CONFLICT',
      );
    if (nights > 120)
      throw new StudioError(
        409,
        'This flight schedule exceeds the supported 120-night stop. Review the route before selecting it.',
        'STUDIO_FLIGHT_DATES_CONFLICT',
      );
    resolution.nights = nights;
    stop.nights = nights;
    stop.departureDate = closingDate;
    if (resolution.returnDepartureDate) brief.endDate = closingDate;
  } else if (stops.length > 1 && !needsTransferReview) {
    const bound = direction === 'outbound' ? stop.departureDate : stop.arrivalDate;
    const supplied =
      direction === 'outbound' ? resolution.arrivalDate : resolution.returnDepartureDate;
    if (supplied && realDate(bound)) {
      const nights =
        direction === 'outbound'
          ? (Date.parse(bound) - Date.parse(supplied)) / 86400000
          : (Date.parse(supplied) - Date.parse(bound)) / 86400000;
      if (nights < 0 || nights > 120)
        throw new StudioError(
          409,
          'This schedule conflicts with an existing multi-stop stay. Review those dates before selecting the flight.',
          'STUDIO_FLIGHT_DATES_CONFLICT',
        );
      stop.nights = nights;
      if (direction === 'return') stop.departureDate = supplied;
    }
    if (
      resolution.arrivalDate &&
      stops
        .slice(1)
        .some(
          (other) =>
            other.arrivalFixed &&
            realDate(other.arrivalDate) &&
            other.arrivalDate < resolution.arrivalDate!,
        )
    )
      throw new StudioError(
        409,
        'The flight arrives after another fixed stay has already begun. Choose a compatible schedule or edit the route.',
        'STUDIO_FLIGHT_DATES_CONFLICT',
      );
  }
  if (
    resolution.arrivalDate &&
    workspace.brief.startDate &&
    resolution.arrivalDate !== workspace.brief.startDate
  )
    resolution.notes.push(
      `The selected supplier arrival replaces the previously recorded arrival (${workspace.brief.startDate}). Review connections and hotel check-in with the supplier.`,
    );
  if (
    resolution.nights !== null &&
    workspace.stops[0].nights !== null &&
    resolution.nights !== workspace.stops[0].nights
  )
    resolution.notes.push(
      `The selected date endpoints give ${resolution.nights} nights. The previous stay length has been updated; calendar trip days have not been converted into hotel nights.`,
    );
  if (resolution.arrivalDate)
    resolution.notes.push(
      'Hotel check-in, early arrival and luggage storage still need confirmation with the hotel; the flight does not establish room availability.',
    );
  if (resolution.returnDepartureDate && !returnTransferReview)
    resolution.notes.push(
      'Confirm hotel checkout and the airport transfer against this return schedule; no hotel checkout time is assumed.',
    );
  const tripDays = workspace.brief.tripDays;
  const durationNeedsReview =
    resolution.nights !== null && typeof tripDays === 'number' && resolution.nights + 1 > tripDays;
  if (durationNeedsReview)
    resolution.notes.push(
      `The selected flights span ${resolution.nights! + 1} destination calendar days, exceeding the requested ${tripDays} trip days. Review the schedules or trip length; the intended scope of those trip days has not been assumed.`,
    );
  return {
    brief,
    stops,
    dateResolution: resolution,
    needsTransferReview,
    needsDateReview: needsTransferReview || durationNeedsReview,
  };
}
