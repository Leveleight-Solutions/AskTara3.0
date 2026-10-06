import type { FlightOffer } from '../shared/types.ts';
import type { StudioWorkspace } from '../shared/studio.ts';
import type {
  StudioFlightAdvisory,
  StudioFlightConnection,
  StudioFlightQuote,
} from '../shared/studio-flights.ts';

function elapsedMinutes(arrival: string, departure: string): number | null {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(arrival) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(departure))
    return null;
  const minutes = (Date.parse(departure) - Date.parse(arrival)) / 60000;
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 7 * 24 * 60
    ? Math.round(minutes)
    : null;
}
function suppliedMinutes(duration: string | undefined): number | null {
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?$/i.exec(duration || '');
  if (!match) return null;
  const minutes = Number(match[1] || 0) * 1440 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  return minutes <= 7 * 24 * 60 ? minutes : null;
}

/** All facts come from supplied segments/technical stops or saved trip dates. Unknowns stay unknown. */
export function buildStudioFlightQuote(
  offer: FlightOffer,
  quoteId: string,
  workspace: StudioWorkspace,
  mode: StudioFlightQuote['mode'],
  quotedAt: string,
): StudioFlightQuote {
  const connections: StudioFlightConnection[] = [];
  const advisories: StudioFlightAdvisory[] = [];
  const journeys = offer.journeys?.map((journey, index) => ({
    ...journey,
    id: `${quoteId}-journey-${index + 1}`,
    segments: journey.segments.map((segment, segmentIndex) => ({
      ...segment,
      id: `${quoteId}-segment-${index + 1}-${segmentIndex + 1}`,
      passengers: segment.passengers?.map((passenger, passengerIndex) => ({
        ...passenger,
        passengerId: `passenger-${passengerIndex + 1}`,
      })),
    })),
  }));
  for (const journey of journeys || []) {
    for (let index = 1; index < journey.segments.length; index++) {
      const previous = journey.segments[index - 1],
        next = journey.segments[index];
      const airportChange = previous.destination.code !== next.origin.code;
      const supplied = journey.connectionDetails?.[index - 1];
      const matches =
        supplied?.arrivalAirport.code === previous.destination.code &&
        supplied.departureAirport.code === next.origin.code;
      const supplierDuration =
        matches &&
        supplied.durationMinutes !== undefined &&
        Number.isFinite(supplied.durationMinutes) &&
        supplied.durationMinutes >= 0 &&
        supplied.durationMinutes <= 7 * 24 * 60
          ? Math.round(supplied.durationMinutes)
          : null;
      const connection: StudioFlightConnection = {
        journeyId: journey.id,
        arrivalAirport: previous.destination,
        departureAirport: next.origin,
        arrival: previous.arrival,
        departure: next.departure,
        durationMinutes: supplierDuration ?? elapsedMinutes(previous.arrival, next.departure),
        airportChange,
        overnight: matches
          ? supplied.overnight
          : previous.arrival.slice(0, 10) !== next.departure.slice(0, 10),
        kind: 'connection',
        ...(previous.destination.countryCode
          ? { transitCountryCode: previous.destination.countryCode }
          : {}),
      };
      connections.push(connection);
      advisories.push({
        kind: 'connection',
        basis: 'supplier_schedule',
        summary: `${previous.destination.code}${airportChange ? ` → ${next.origin.code} airport change` : ' connection'}: ${connection.durationMinutes === null ? 'duration was not supplied unambiguously; confirm with the carrier' : `${connection.durationMinutes} minutes ${supplierDuration !== null ? 'reported by the supplier' : 'between supplied segment times'}`}.${connection.overnight ? ' The schedule includes an overnight connection; review overnight arrangements.' : ''}`,
      });
      advisories.push({
        kind: 'transit',
        basis: 'supplier_schedule',
        summary: `${previous.destination.code}${connection.transitCountryCode ? ` (${connection.transitCountryCode})` : ' (airport country not supplied)'}: check transit, terminal changes and baggage with the carrier and immigration authority for the declared passport and exact ticket. This schedule does not establish transit eligibility.`,
      });
    }
    for (const segment of journey.segments)
      for (const stop of segment.stops || []) {
        connections.push({
          journeyId: journey.id,
          arrivalAirport: stop.airport,
          departureAirport: stop.airport,
          arrival: stop.arrival || '',
          departure: stop.departure || '',
          durationMinutes:
            suppliedMinutes(stop.duration) ??
            (stop.arrival && stop.departure ? elapsedMinutes(stop.arrival, stop.departure) : null),
          airportChange: false,
          overnight: Boolean(
            stop.arrival &&
            stop.departure &&
            stop.arrival.slice(0, 10) !== stop.departure.slice(0, 10),
          ),
          kind: 'technical_stop',
          ...(stop.airport.countryCode ? { transitCountryCode: stop.airport.countryCode } : {}),
        });
        advisories.push({
          kind: 'transit',
          basis: 'supplier_schedule',
          summary: `The supplier reports a technical stop at ${stop.airport.code}. Confirm whether passengers must disembark and whether any transit formalities apply; no eligibility is assumed.`,
        });
      }
  }
  const firstArrival = offer.journeys?.[0]?.arrival || offer.arrival;
  const firstStop = workspace.stops[0];
  if (firstStop && firstArrival && firstStop.arrivalDate) {
    const arrivalDate = firstArrival.slice(0, 10);
    if (arrivalDate !== firstStop.arrivalDate)
      advisories.push({
        kind: 'gap',
        basis: 'trip_dates',
        stopId: firstStop.id,
        summary: `The supplied outbound arrival is ${arrivalDate}; the ${firstStop.name} stay starts ${firstStop.arrivalDate}. Review the uncovered dates and transport before selecting this schedule.`,
      });
    advisories.push({
      kind: 'hotel_timing',
      basis: 'supplier_schedule',
      stopId: firstStop.id,
      summary: `Arrival is ${firstArrival}. Confirm luggage storage or early check-in with the selected hotel; its check-in time and availability have not been supplied.`,
    });
  }
  const lastStop = workspace.stops.at(-1);
  const returnJourney = offer.journeys && offer.journeys.length > 1 ? offer.journeys.at(-1) : null;
  if (lastStop && returnJourney)
    advisories.push({
      kind: 'hotel_timing',
      basis: 'supplier_schedule',
      stopId: lastStop.id,
      summary: `The supplied return departs ${returnJourney.departure}. Coordinate hotel check-out, baggage and airport transfer with the hotel and carrier; no hotel time or minimum connection guarantee is assumed.`,
    });
  if (!offer.journeys?.length)
    advisories.push({
      kind: 'verification',
      basis: 'supplier_schedule',
      summary:
        'Detailed flight segments were not supplied. Connection airports, countries and layover durations remain unverified.',
    });
  const { bookingOfferId: _bookingOfferId, ...safe } = offer;
  return {
    ...safe,
    id: quoteId,
    ...(journeys ? { journeys } : {}),
    quoteId,
    quotedAt,
    mode,
    connections,
    advisories,
  };
}
