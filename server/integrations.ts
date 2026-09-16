import { z } from 'zod';
import type {
  Destination,
  FlightAirport,
  FlightSegment,
  FlightJourney,
  FlightOffer,
  IntegrationStatus,
} from '../shared/types.ts';
import { destinations } from '../shared/catalog.ts';
import { flightSearchSchema, hotelSearchSchema } from './validation.ts';

type ProviderMode = 'test' | 'live' | 'provider';

function resolveProviderMode(token: string, sandboxPayload?: boolean): ProviderMode {
  if (
    sandboxPayload === true ||
    process.env.LITEAPI_MODE === 'test' ||
    /^(sandbox_|sand_)/.test(token)
  )
    return 'test';
  return sandboxPayload === false ||
    process.env.LITEAPI_MODE === 'live' ||
    token.startsWith('prod_')
    ? 'live'
    : 'provider';
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status = 502,
    public code = 'PROVIDER_ERROR',
  ) {
    super(message);
  }
}
export function integrationStatus(): IntegrationStatus {
  return {
    ai: Boolean(process.env.OPENAI_API_KEY),
    flights: Boolean(process.env.DUFFEL_ACCESS_TOKEN || process.env.LITEAPI_API_KEY),
    hotels: Boolean(process.env.LITEAPI_API_KEY),
    activities: false,
    mode: process.env.OPENAI_API_KEY ? 'live' : 'local',
  };
}

// Contract: https://duffel.com/docs/api/v2/offers
// Only fields documented by Duffel are retained. Missing optional supplier details
// stay absent; a broken segment invalidates its whole offer, never half a journey.
const duffelAirport = z.object({
  iata_code: z.string().regex(/^[A-Z]{3}$/),
  name: z.string().nullish(),
  city_name: z.string().nullish(),
  time_zone: z.string().nullish(),
});
const duffelCarrier = z.object({ name: z.string(), iata_code: z.string().nullish() });
const duffelSegment = z.object({
  id: z.string().optional(),
  departing_at: z.string().min(1),
  arriving_at: z.string().min(1),
  duration: z.string().nullish(),
  origin: duffelAirport,
  destination: duffelAirport,
  origin_terminal: z.string().nullish(),
  destination_terminal: z.string().nullish(),
  marketing_carrier: duffelCarrier.nullish(),
  operating_carrier: duffelCarrier.nullish(),
  marketing_carrier_flight_number: z.string().nullish(),
  operating_carrier_flight_number: z.string().nullish(),
  passengers: z
    .array(
      z.object({
        passenger_id: z.string().optional(),
        cabin_class: z.string().nullish(),
        cabin_class_marketing_name: z.string().nullish(),
        baggages: z
          .array(
            z.object({
              type: z.string(),
              quantity: z.number().int().nonnegative(),
            }),
          )
          .nullish(),
      }),
    )
    .nullish(),
  stops: z
    .array(
      z.object({
        airport: duffelAirport,
        arriving_at: z.string().nullish(),
        departing_at: z.string().nullish(),
        duration: z.string().nullish(),
      }),
    )
    .nullish(),
});
const duffelOffer = z.object({
  id: z.string().min(1),
  owner: duffelCarrier.nullish(),
  total_amount: z.string().regex(/^\d+(?:\.\d+)?$/),
  total_currency: z.string().regex(/^[A-Z]{3}$/),
  expires_at: z.string().nullish(),
  live_mode: z.boolean().optional(),
  slices: z
    .array(
      z.object({
        id: z.string().optional(),
        duration: z.string().nullish(),
        segments: z.array(duffelSegment).min(1),
      }),
    )
    .min(1),
});
function flightAirport(airport: z.infer<typeof duffelAirport>): FlightAirport {
  return {
    code: airport.iata_code,
    name: airport.name || undefined,
    city: airport.city_name || undefined,
    timeZone: airport.time_zone || undefined,
  };
}
export function normalizeFlightOffer(
  value: unknown,
  input: Pick<z.infer<typeof flightSearchSchema>, 'adults' | 'returnDate'>,
): FlightOffer | null {
  const parsed = duffelOffer.safeParse(value);
  if (!parsed.success || !Number.isFinite(Number(parsed.data.total_amount))) return null;
  const offer = parsed.data;
  const carrier = (value: z.infer<typeof duffelCarrier> | null | undefined) =>
    value ? { name: value.name, code: value.iata_code || undefined } : undefined;
  const journeys = offer.slices.map((slice, index) => {
    const segments = slice.segments.map((segment, segmentIndex) => ({
      id: segment.id || `${offer.id}-journey-${index}-segment-${segmentIndex}`,
      origin: flightAirport(segment.origin),
      destination: flightAirport(segment.destination),
      // These are local airport times. Preserve any supplied offset exactly.
      departure: segment.departing_at,
      arrival: segment.arriving_at,
      duration: segment.duration || undefined,
      originTerminal: segment.origin_terminal || undefined,
      destinationTerminal: segment.destination_terminal || undefined,
      marketingCarrier: carrier(segment.marketing_carrier),
      operatingCarrier: carrier(segment.operating_carrier),
      marketingFlightNumber: segment.marketing_carrier_flight_number || undefined,
      operatingFlightNumber: segment.operating_carrier_flight_number || undefined,
      passengers: segment.passengers?.map((passenger, passengerIndex) => ({
        passengerId: passenger.passenger_id || `passenger-${passengerIndex + 1}`,
        cabin: passenger.cabin_class_marketing_name || passenger.cabin_class || undefined,
        baggages: passenger.baggages ?? undefined,
      })),
      stops: segment.stops?.map((stop) => ({
        airport: flightAirport(stop.airport),
        arrival: stop.arriving_at || undefined,
        departure: stop.departing_at || undefined,
        duration: stop.duration || undefined,
      })),
    }));
    const first = segments[0],
      last = segments.at(-1)!;
    return {
      id: slice.id || `${offer.id}-journey-${index}`,
      origin: first.origin,
      destination: last.destination,
      departure: first.departure,
      arrival: last.arrival,
      duration: slice.duration || undefined,
      connections: segments.length - 1,
      stops:
        segments.length -
        1 +
        segments.reduce((total, segment) => total + (segment.stops?.length || 0), 0),
      segments,
    };
  });
  const outbound = journeys[0];
  // Expiry is an absolute timestamp, unlike local segment times. Reject ambiguous dates.
  const expiresAt =
    offer.expires_at &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(offer.expires_at) &&
    Number.isFinite(Date.parse(offer.expires_at))
      ? offer.expires_at
      : undefined;
  return {
    id: offer.id,
    airline:
      offer.owner?.name || outbound.segments[0].marketingCarrier?.name || 'Airline unavailable',
    origin: outbound.origin.code,
    destination: outbound.destination.code,
    departure: outbound.departure,
    arrival: outbound.arrival,
    duration: outbound.duration || '',
    stops: outbound.stops,
    price: Number(offer.total_amount),
    currency: offer.total_currency,
    journeys,
    requestedJourneyCount: input.returnDate ? 2 : 1,
    passengerCount: input.adults,
    priceScope: 'all_passengers_complete_journey',
    expiresAt,
    liveMode: offer.live_mode,
  };
}
async function searchFlightsWithDuffel(
  input: z.infer<typeof flightSearchSchema>,
  signal?: AbortSignal,
) {
  const token = process.env.DUFFEL_ACCESS_TOKEN!;
  const slices = [
    { origin: input.origin, destination: input.destination, departure_date: input.departureDate },
  ];
  if (input.returnDate)
    slices.push({
      origin: input.destination,
      destination: input.origin,
      departure_date: input.returnDate,
    });
  let response: Response;
  try {
    response = await fetch(
      'https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=10000',
      {
        method: 'POST',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
          : AbortSignal.timeout(20_000),
        headers: {
          Authorization: `Bearer ${token}`,
          'Duffel-Version': 'v2',
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          data: {
            slices,
            passengers: Array.from({ length: input.adults }, () => ({ type: 'adult' })),
            cabin_class: input.cabinClass,
          },
        }),
      },
    );
  } catch {
    signal?.throwIfAborted();
    throw new ProviderError('The flight provider could not be reached. Please try again shortly.');
  }
  if (!response.ok)
    throw new ProviderError(
      response.status === 401 || response.status === 403
        ? 'The flight provider rejected the credentials. Check DUFFEL_ACCESS_TOKEN.'
        : 'The flight provider could not complete this search. Check the airports and dates, then try again.',
    );
  const payload = (await response.json()) as { data?: { offers?: unknown[]; live_mode?: boolean } };
  signal?.throwIfAborted();
  if (!Array.isArray(payload.data?.offers))
    throw new ProviderError(
      'The flight provider returned an unexpected response. Please try again.',
    );
  const offers = payload.data.offers.slice(0, 30).flatMap((offer) => {
    const normalized = normalizeFlightOffer(offer, input);
    return normalized ? [normalized] : [];
  });
  const isTest =
    token.startsWith('duffel_test_') ||
    payload.data.live_mode === false ||
    offers.some((offer) => offer.liveMode === false);
  if (isTest) for (const offer of offers) offer.liveMode = false;
  return {
    offers,
    mode: isTest ? 'test' : 'live',
    warning: isTest
      ? 'Duffel test mode: these are simulated offers, not real schedules or prices.'
      : 'Prices are for all passengers and the complete requested journey. Availability can change; no booking has been made.',
    roundTrip: Boolean(input.returnDate),
    source: 'duffel' as const,
  };
}

// Contract: https://docs.liteapi.travel/reference/post_flights-rates
// Verified against the provider's real data[].journeys[] response. A journey here
// contains every requested direction; cheapestOffer carries the complete fare.
const liteDuration = z.object({
  iso8601: z.string().optional(),
  minutes: z.number().finite().nonnegative().optional(),
});
const liteFlightSegment = z.object({
  segmentKey: z.string().optional(),
  originCode: z.string().regex(/^[A-Z]{3}$/),
  destinationCode: z.string().regex(/^[A-Z]{3}$/),
  originName: z.string().optional(),
  destinationName: z.string().optional(),
  departureTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
  arrivalTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
  direction: z.enum(['OUTBOUND', 'INBOUND']).optional(),
  duration: liteDuration.optional(),
  carrier: z
    .object({
      marketingCode: z.string().optional(),
      marketingName: z.string().optional(),
      operatingCode: z.string().optional(),
      operatingName: z.string().optional(),
    })
    .optional(),
  flight: z
    .object({ marketingNumber: z.string().optional(), operatingNumber: z.string().optional() })
    .optional(),
});
const liteFare = z.object({
  offerId: z.string().min(1),
  expiration: z.string().optional(),
  pricing: z.object({
    display: z.object({
      total: z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(?:\.\d+)?$/)]),
      currency: z.string().regex(/^[A-Z]{3}$/),
    }),
  }),
  segmentFares: z
    .array(z.object({ segmentKey: z.string(), cabin: z.string().optional() }))
    .optional(),
});
const liteFlightJourney = z.object({
  journeyKey: z.string().optional(),
  cheapestOffer: liteFare.optional(),
  offers: z.array(liteFare).optional(),
  segments: z.array(liteFlightSegment).min(1),
  legDurations: z
    .array(z.object({ direction: z.enum(['OUTBOUND', 'INBOUND']), duration: liteDuration }))
    .optional(),
});
function durationMinutes(value: string): number | undefined {
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?$/i.exec(value);
  return match
    ? Number(match[1] || 0) * 1440 + Number(match[2] || 0) * 60 + Number(match[3] || 0)
    : undefined;
}
function normalizeLiteDuration(
  value: z.infer<typeof liteDuration> | undefined,
): string | undefined {
  if (!value) return undefined;
  if (value.iso8601 && durationMinutes(value.iso8601) !== undefined) return value.iso8601;
  if (value.minutes === undefined || value.minutes <= 0) return undefined;
  const minutes = Math.round(value.minutes);
  const hours = Math.floor(minutes / 60),
    remainder = minutes % 60;
  return `PT${hours ? `${hours}H` : ''}${remainder ? `${remainder}M` : ''}`;
}
export function normalizeLiteFlightOffer(
  value: unknown,
  input: z.infer<typeof flightSearchSchema>,
): FlightOffer | null {
  const parsed = liteFlightJourney.safeParse(value);
  if (!parsed.success) return null;
  const item = parsed.data;
  const fare = item.cheapestOffer || item.offers?.[0];
  if (!fare || !Number.isFinite(Number(fare.pricing.display.total))) return null;
  const requestedDirections = input.returnDate
    ? (['OUTBOUND', 'INBOUND'] as const)
    : (['OUTBOUND'] as const);
  if (input.returnDate && item.segments.some((segment) => !segment.direction)) return null;
  if (!input.returnDate && item.segments.some((segment) => segment.direction === 'INBOUND'))
    return null;
  const journeys: FlightJourney[] = [];
  for (const direction of requestedDirections) {
    const segments: FlightSegment[] = item.segments
      .filter((segment) => (segment.direction || 'OUTBOUND') === direction)
      .map((segment, index) => {
        const cabin = fare.segmentFares?.find(
          (entry) => entry.segmentKey === segment.segmentKey,
        )?.cabin;
        return {
          id: segment.segmentKey || `${fare.offerId}-${direction}-${index}`,
          origin: { code: segment.originCode, name: segment.originName },
          destination: { code: segment.destinationCode, name: segment.destinationName },
          departure: segment.departureTime,
          arrival: segment.arrivalTime,
          duration: normalizeLiteDuration(segment.duration),
          marketingCarrier: segment.carrier?.marketingName
            ? { name: segment.carrier.marketingName, code: segment.carrier.marketingCode }
            : undefined,
          operatingCarrier: segment.carrier?.operatingName
            ? { name: segment.carrier.operatingName, code: segment.carrier.operatingCode }
            : undefined,
          marketingFlightNumber: segment.flight?.marketingNumber,
          operatingFlightNumber: segment.flight?.operatingNumber,
          // Offer-level baggage hints do not establish an allowance on every segment.
          passengers: cabin
            ? Array.from({ length: input.adults }, (_, passenger) => ({
                passengerId: `passenger-${passenger + 1}`,
                cabin,
              }))
            : undefined,
        };
      });
    if (!segments.length) return null;
    const first = segments[0],
      last = segments.at(-1)!;
    let duration = normalizeLiteDuration(
      item.legDurations?.find((leg) => leg.direction === direction)?.duration,
    );
    const knownFlightMinutes = segments.reduce(
      (total, segment) => total + (durationMinutes(segment.duration || '') || 0),
      0,
    );
    // The sandbox can return a leg shorter than its own flight. Omit inconsistent
    // totals; summing flight durations would incorrectly omit connection time.
    if (duration && (durationMinutes(duration) || 0) < knownFlightMinutes) duration = undefined;
    if (!duration && segments.length === 1) duration = first.duration;
    journeys.push({
      id: `${fare.offerId}-${direction}`,
      origin: first.origin,
      destination: last.destination,
      departure: first.departure,
      arrival: last.arrival,
      duration,
      connections: segments.length - 1,
      stops: segments.length - 1,
      segments,
    });
  }
  const outbound = journeys[0];
  const expiresAt =
    fare.expiration &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(fare.expiration) &&
    Number.isFinite(Date.parse(fare.expiration))
      ? fare.expiration
      : undefined;
  const airlines = [
    ...new Set(item.segments.map((segment) => segment.carrier?.marketingName).filter(Boolean)),
  ];
  return {
    id: fare.offerId,
    airline: airlines.join(' + ') || 'Airline unavailable',
    origin: outbound.origin.code,
    destination: outbound.destination.code,
    departure: outbound.departure,
    arrival: outbound.arrival,
    duration: outbound.duration || '',
    stops: outbound.stops,
    price: Number(fare.pricing.display.total),
    currency: fare.pricing.display.currency,
    journeys,
    requestedJourneyCount: requestedDirections.length,
    passengerCount: input.adults,
    priceScope: 'all_passengers_complete_journey',
    expiresAt,
  };
}

export async function searchFlights(
  input: z.infer<typeof flightSearchSchema>,
  signal?: AbortSignal,
) {
  if (process.env.DUFFEL_ACCESS_TOKEN) return searchFlightsWithDuffel(input, signal);
  if (process.env.LITEAPI_API_KEY) return searchFlightsWithLite(input, signal);
  throw new ProviderError(
    'Live flight search is not connected yet. Add DUFFEL_ACCESS_TOKEN or LITEAPI_API_KEY to the server environment and restart. No flight offers or bookings have been made.',
    503,
    'FLIGHTS_NOT_CONFIGURED',
  );
}

async function searchFlightsWithLite(
  input: z.infer<typeof flightSearchSchema>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const token = process.env.LITEAPI_API_KEY;
  if (!token) return searchFlightsWithDuffel(input, signal);
  const legs: { origin: string; destination: string; date: string; direction?: 'INBOUND' }[] = [
    { origin: input.origin, destination: input.destination, date: input.departureDate },
  ];
  if (input.returnDate)
    legs.push({
      origin: input.destination,
      destination: input.origin,
      date: input.returnDate,
      direction: 'INBOUND',
    });
  let response: Response;
  try {
    response = await fetch('https://api.liteapi.travel/v3.0/flights/rates', {
      method: 'POST',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(45_000)])
        : AbortSignal.timeout(45_000),
      headers: {
        'X-API-Key': token,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        legs,
        adults: input.adults,
        currency: 'USD',
        cabinClass: input.cabinClass.toUpperCase(),
      }),
    });
  } catch {
    signal?.throwIfAborted();
    throw new ProviderError('The flight provider could not be reached. Please try again shortly.');
  }
  if (!response.ok)
    throw new ProviderError(
      response.status === 401 || response.status === 403
        ? 'The flight provider rejected the credentials. Check LITEAPI_API_KEY.'
        : 'The flight provider could not complete this search. Check the airports and dates, then try again.',
    );
  const payload = (await response.json()) as {
    data?: { journeys?: unknown[] }[];
    sandbox?: boolean;
    error?: unknown;
  };
  signal?.throwIfAborted();
  if (
    payload.error ||
    !Array.isArray(payload.data) ||
    payload.data.some((entry) => !Array.isArray(entry.journeys))
  )
    throw new ProviderError(
      'The flight provider returned an unexpected response. Please try again.',
    );
  const mode = resolveProviderMode(token, payload.sandbox);
  const seen = new Set<string>();
  const offers = payload.data
    .flatMap((entry) => entry.journeys || [])
    .flatMap((entry) => {
      const normalized = normalizeLiteFlightOffer(entry, input);
      if (!normalized || seen.has(normalized.id)) return [];
      seen.add(normalized.id);
      normalized.liveMode = mode === 'test' ? false : mode === 'live' ? true : undefined;
      return [normalized];
    });
  const environmentNotice =
    mode === 'test'
      ? 'LiteAPI test mode: rates are for integration testing. '
      : mode === 'provider'
        ? 'Provider environment has not been marked as production; verify the API key mode before relying on rates. '
        : '';
  return {
    offers: offers.slice(0, 30),
    mode,
    warning: `${environmentNotice}Flight prices are for all requested travelers. Check taxes, baggage, cancellation terms and final availability before booking. No reservation has been made.`,
    roundTrip: Boolean(input.returnDate),
    source: 'liteapi' as const,
  };
}

const liteHotel = z.object({
  hotelId: z.string().min(1),
  roomTypes: z.array(
    z.object({
      offerId: z.string().min(1).optional(),
      rates: z.array(
        z.object({
          name: z.string().nullish(),
          boardName: z.string().nullish(),
          retailRate: z.object({
            total: z.array(
              z.object({
                amount: z.union([
                  z.number().finite().nonnegative(),
                  z.string().regex(/^\d+(?:\.\d+)?$/),
                ]),
                currency: z.string().regex(/^[A-Z]{3}$/),
              }),
            ),
          }),
        }),
      ),
    }),
  ),
});
const liteHotelInfo = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  main_photo: z.string().nullish(),
  address: z.string().nullish(),
});
const liteHotelResponse = z.object({
  data: z.array(z.unknown()),
  hotels: z.array(z.unknown()).optional(),
  sandbox: z.boolean().optional(),
  error: z.unknown().optional(),
});
const hotelEnvironmentNotice = (mode: ProviderMode) =>
  mode === 'test'
    ? 'LiteAPI test mode: rates are for integration testing. '
    : mode === 'provider'
      ? 'Provider environment has not been marked as production; verify the API key mode before relying on rates. '
      : '';

/** The optional destination must come from server-resolved trip data, never request JSON. */
export async function searchHotels(
  input: z.infer<typeof hotelSearchSchema>,
  signal?: AbortSignal,
  destination?: Destination,
) {
  signal?.throwIfAborted();
  const location = destination ?? destinations.find((d) => d.id === input.destinationId);
  if (
    !location ||
    location.id !== input.destinationId ||
    !Array.isArray(location.coordinates) ||
    location.coordinates.length !== 2 ||
    !location.coordinates.every((value) => Number.isFinite(value)) ||
    Math.abs(location.coordinates[0]) > 90 ||
    Math.abs(location.coordinates[1]) > 180
  )
    throw new ProviderError(
      'Choose a destination with a verified location before searching for hotels.',
      400,
      'INVALID_DESTINATION',
    );
  const token = process.env.LITEAPI_API_KEY;
  if (!token)
    throw new ProviderError(
      'Live hotel search is not connected yet. Add LITEAPI_API_KEY to the server environment and restart. Inspiration stays are not live availability.',
      503,
      'HOTELS_NOT_CONFIGURED',
    );
  let response: Response;
  try {
    response = await fetch('https://api.liteapi.travel/v3.0/hotels/rates', {
      method: 'POST',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
      headers: {
        'X-API-Key': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        checkin: input.checkin,
        checkout: input.checkout,
        currency: 'USD',
        guestNationality: input.guestNationality,
        occupancies: [{ adults: input.adults }],
        latitude: location.coordinates[0],
        longitude: location.coordinates[1],
        radius: 15000,
        includeHotelData: true,
        maxRatesPerHotel: 1,
        limit: 12,
        timeout: 10,
      }),
    });
  } catch {
    signal?.throwIfAborted();
    throw new ProviderError('The hotel provider could not be reached. Please try again shortly.');
  }
  signal?.throwIfAborted();
  if (!response.ok)
    throw new ProviderError(
      response.status === 401 || response.status === 403
        ? 'The hotel provider rejected the credentials. Check LITEAPI_API_KEY.'
        : 'The hotel provider could not complete this search. Check the dates and try again.',
    );
  if (response.status === 204) {
    const mode = resolveProviderMode(token);
    return {
      offers: [],
      mode,
      warning: `${hotelEnvironmentNotice(mode)}No hotel availability was returned for these dates. No reservation has been made.`,
    };
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    signal?.throwIfAborted();
    throw new ProviderError(
      'The hotel provider returned an unreadable response. Please try again.',
    );
  }
  signal?.throwIfAborted();
  const parsedPayload = liteHotelResponse.safeParse(raw);
  if (!parsedPayload.success || parsedPayload.data.error)
    throw new ProviderError(
      'The hotel provider returned an unexpected response. Please try again.',
    );
  const payload = parsedPayload.data;
  const hotels = (payload.hotels || []).flatMap((value) => {
    const parsed = liteHotelInfo.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
  const offers = payload.data.flatMap((value) => {
    const parsed = liteHotel.safeParse(value);
    if (!parsed.success) return [];
    const hotel = parsed.data;
    const room = hotel.roomTypes?.[0],
      rate = room?.rates?.[0],
      total = rate?.retailRate?.total?.[0];
    const info = hotels.find((entry) => entry.id === hotel.hotelId);
    if (!total || !Number.isFinite(Number(total.amount)) || Number(total.amount) < 0) return [];
    return [
      {
        id: room?.offerId || hotel.hotelId,
        offerId: room?.offerId,
        hotelId: hotel.hotelId,
        name: info?.name || hotel.hotelId,
        image: info?.main_photo || '',
        address: info?.address || '',
        room: rate?.name || 'Room',
        board: rate?.boardName || '',
        price: Number(total.amount),
        currency: total.currency,
        checkin: input.checkin,
        checkout: input.checkout,
      },
    ];
  });
  if (payload.data.length && !offers.length)
    throw new ProviderError('The hotel provider returned no valid rates. Please try again.');
  const mode = resolveProviderMode(token, payload.sandbox);
  return {
    offers,
    mode,
    warning: `${hotelEnvironmentNotice(mode)}Provider rates are for the full stay. Check taxes, cancellation rules and final availability before booking. No reservation has been made.`,
  };
}
