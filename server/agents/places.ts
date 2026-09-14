import { destinations, experiences } from '../../shared/catalog.ts';
import type { PlanningPlace } from '../../shared/planning.ts';
import type { Destination, Trip } from '../../shared/types.ts';
import { findDestination } from '../../shared/destinations.ts';
import { ProviderError } from '../integrations.ts';

/** Curated names are inspiration, with estimated costs and durations, never live inventory. */
export function curatedPlaces(destinationIds: string[]): PlanningPlace[] {
  return destinationIds.flatMap((id) => {
    const destination = destinations.find((entry) => entry.id === id);
    if (!destination) return [];
    return [
      ...destination.highlights.map((name, index): PlanningPlace => ({
        id: `catalog-${id}-${index}`,
        name,
        destinationId: id,
        address: `${destination.name}, ${destination.country}`,
        category: /walk|garden|beach|valley|lake|forest/i.test(name) ? 'leisure' : 'sight',
        durationMinutes: /trail|mountain|hike|valley/i.test(name) ? 180 : 90,
        estimatedCost: Math.round(destination.dailyBudget * 0.08),
        sourceId: 'catalog-places',
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${destination.name}`)}`,
      })),
      ...experiences
        .filter((entry) => entry.destinationId === id)
        .map((entry): PlanningPlace => ({
          id: entry.id,
          name: entry.name,
          destinationId: id,
          address: destination.name,
          category: 'experience',
          durationMinutes: Math.min(
            240,
            Math.max(60, Number(entry.duration.match(/\d+/)?.[0] || 2) * 60),
          ),
          estimatedCost: entry.price,
          sourceId: 'catalog-places',
        })),
    ];
  });
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  googleMapsUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  businessStatus?: string;
  attributions?: { provider?: string; providerUri?: string }[];
}

const googleAttributions = (entry: GooglePlace) =>
  entry.attributions
    ?.flatMap((attribution) =>
      attribution.provider
        ? [
            {
              provider: attribution.provider.slice(0, 200),
              providerUri: attribution.providerUri?.startsWith('https://')
                ? attribution.providerUri
                : undefined,
            },
          ]
        : [],
    )
    .slice(0, 20);

/** Refresh one saved place on demand. Only its stable ID is needed from persisted data. */
export async function readGooglePlaceDetails(
  placeId: string,
  destinationId: string,
  signal?: AbortSignal,
  resolvedDestination?: Destination,
): Promise<PlanningPlace> {
  signal?.throwIfAborted();
  if (!/^google-[A-Za-z0-9_-]{1,220}$/.test(placeId))
    throw new ProviderError('Invalid place ID.', 400, 'INVALID_PLACE');
  const destination =
    resolvedDestination?.id === destinationId
      ? resolvedDestination
      : findDestination(destinationId);
  if (!destination) throw new ProviderError('Destination not found.', 404, 'INVALID_DESTINATION');
  if (!process.env.GOOGLE_PLACES_API_KEY)
    throw new ProviderError(
      'Live place details are not connected. Your itinerary is still saved.',
      503,
      'PLACES_NOT_CONFIGURED',
    );
  const response = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId.slice(7))}?languageCode=en`,
    {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
      headers: {
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask':
          'id,displayName,formattedAddress,location,types,googleMapsUri,regularOpeningHours.weekdayDescriptions,businessStatus,attributions',
      },
    },
  );
  signal?.throwIfAborted();
  if (!response.ok)
    throw new ProviderError('Fresh place details could not be loaded. Please try again later.');
  const entry = (await response.json()) as GooglePlace;
  signal?.throwIfAborted();
  if (entry.id !== placeId.slice(7) || !entry.displayName?.text)
    throw new ProviderError('The place provider returned an unexpected response.');
  const lat = entry.location?.latitude,
    lng = entry.location?.longitude;
  const coordinates: [number, number] | undefined =
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
      ? [lat, lng]
      : undefined;
  const category = entry.types?.some((type) => /restaurant|cafe|food|bakery/.test(type))
    ? 'food'
    : entry.types?.some((type) => /park|garden|beach/.test(type))
      ? 'leisure'
      : 'sight';
  return {
    id: placeId,
    name: entry.displayName.text.slice(0, 160),
    destinationId,
    address: (entry.formattedAddress || destination.name).slice(0, 200),
    coordinates,
    category,
    durationMinutes: category === 'food' ? 60 : 90,
    estimatedCost: Math.round(destination.dailyBudget * (category === 'food' ? 0.12 : 0.08)),
    sourceId: `google-places-${destinationId}`,
    attributions: googleAttributions(entry),
    mapsUrl: entry.googleMapsUri?.startsWith('https://')
      ? entry.googleMapsUri
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination.name)}&query_place_id=${encodeURIComponent(placeId.slice(7))}`,
    openingHours: entry.regularOpeningHours?.weekdayDescriptions
      ?.filter((value): value is string => typeof value === 'string')
      .slice(0, 7),
  };
}

/** Durable snapshots keep provider place IDs and our own schedule/estimates, not Google content. */
export function stripGooglePlaceContent(original: Trip): Trip {
  const trip = structuredClone(original);
  const livePlaces = trip.planning?.places.filter((place) => place.id.startsWith('google-')) || [];
  if (
    !livePlaces.length &&
    !trip.itinerary.some((day) => day.items.some((item) => item.placeId?.startsWith('google-')))
  )
    return trip;
  const normalize = (text: string) =>
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  const persistent = (place: PlanningPlace): PlanningPlace => {
    const destination = findDestination(place.destinationId, trip);
    // Independent catalog text can be kept; otherwise save a provider-neutral placeholder.
    const catalog = curatedPlaces([place.destinationId]).find(
      (entry) => normalize(entry.name) === normalize(place.name),
    );
    return {
      id: place.id,
      name: catalog?.name || `Saved place in ${destination?.name || 'your destination'}`,
      destinationId: place.destinationId,
      address: destination ? `${destination.name}, ${destination.country}` : '',
      category: catalog?.category || 'sight',
      durationMinutes: place.durationMinutes,
      estimatedCost: place.estimatedCost,
      sourceId: place.sourceId,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination?.name || 'Saved place')}&query_place_id=${encodeURIComponent(place.id.slice(7))}`,
    };
  };
  const safePlaces = new Map(livePlaces.map((place) => [place.id, persistent(place)]));
  for (const day of trip.itinerary) {
    const destinationId = day.destinationId || trip.destinationId;
    if (day.items.some((item) => item.placeId?.startsWith('google-')))
      day.title = `A day in ${findDestination(destinationId, trip)?.name || 'your destination'}`;
    for (const item of day.items) {
      if (!item.placeId?.startsWith('google-')) {
        // A model-composed flexible note could echo source text from transient research.
        if (item.category === 'leisure' && !item.locked)
          item.description =
            'Flexible time for a walk, a café, or a discovery of your own. Confirm travel connections separately.';
        continue;
      }
      const place =
        safePlaces.get(item.placeId) ||
        persistent({
          id: item.placeId,
          name: item.title,
          destinationId,
          address: item.location,
          category: 'sight',
          durationMinutes: item.durationMinutes || 90,
          estimatedCost: item.cost,
          sourceId: item.sourceId || `google-places-${destinationId}`,
        });
      safePlaces.set(place.id, place);
      item.title = place.name;
      item.location = place.address;
      item.description =
        'Saved place reference. Open place details to load its current name, address and opening hours from Google Maps. Duration and cost are Asktara planning estimates.';
    }
  }
  if (trip.planning) {
    trip.planning.places = trip.planning.places.map((place) =>
      place.id.startsWith('google-') ? safePlaces.get(place.id)! : place,
    );
    trip.planning.issues = trip.planning.issues.map((issue) => {
      if (
        !issue.itemId ||
        !trip.itinerary.some((day) =>
          day.items.some((item) => item.id === issue.itemId && item.placeId?.startsWith('google-')),
        )
      )
        return issue;
      return {
        ...issue,
        message:
          issue.code === 'place_closed'
            ? `Day ${issue.day}: the saved place listed this weekday as closed when researched. Open its details to refresh hours before visiting.`
            : `Day ${issue.day}: review this saved place's timing and position in your itinerary.`,
      };
    });
  }
  return trip;
}

/** Places API (New), using an explicit field mask; one bounded search per destination. */
export async function researchGooglePlaces(
  destinationId: string,
  interests: string[],
  signal?: AbortSignal,
  resolvedDestination?: Destination,
): Promise<PlanningPlace[]> {
  signal?.throwIfAborted();
  const destination =
    resolvedDestination?.id === destinationId
      ? resolvedDestination
      : findDestination(destinationId);
  if (!destination || !process.env.GOOGLE_PLACES_API_KEY) return [];
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri,places.regularOpeningHours.weekdayDescriptions,places.businessStatus,places.attributions',
    },
    body: JSON.stringify({
      textQuery: `${interests.includes('Food') ? 'cultural attractions and local food markets' : 'visitor attractions'} in ${destination.name}, ${destination.country}`,
      pageSize: 12,
      languageCode: 'en',
      locationBias: {
        circle: {
          center: { latitude: destination.coordinates[0], longitude: destination.coordinates[1] },
          radius: 25000,
        },
      },
    }),
  });
  signal?.throwIfAborted();
  if (!response.ok)
    throw new ProviderError(
      'Place research is temporarily unavailable. Curated ideas remain available.',
    );
  const data = (await response.json()) as { places?: GooglePlace[] };
  signal?.throwIfAborted();
  if (!Array.isArray(data.places))
    throw new ProviderError('Place research returned an unexpected response.');
  return data.places.slice(0, 12).flatMap((entry): PlanningPlace[] => {
    if (
      !entry.id ||
      !/^[A-Za-z0-9_-]{1,220}$/.test(entry.id) ||
      !entry.displayName?.text ||
      (entry.businessStatus && entry.businessStatus !== 'OPERATIONAL')
    )
      return [];
    const lat = entry.location?.latitude,
      lng = entry.location?.longitude;
    const coordinates: [number, number] | undefined =
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180
        ? [lat, lng]
        : undefined;
    // Bias is not a restriction. Discard distant results instead of scheduling them in this city.
    if (coordinates && distanceKm(coordinates, destination.coordinates) > 100) return [];
    const category = entry.types?.some((type) => /restaurant|cafe|food|bakery/.test(type))
      ? 'food'
      : entry.types?.some((type) => /park|garden|beach/.test(type))
        ? 'leisure'
        : 'sight';
    return [
      {
        id: `google-${entry.id}`,
        name: entry.displayName.text.slice(0, 160),
        destinationId,
        address: (entry.formattedAddress || `${destination.name}, ${destination.country}`).slice(
          0,
          200,
        ),
        coordinates,
        category,
        durationMinutes: category === 'food' ? 60 : 90,
        estimatedCost: Math.round(destination.dailyBudget * (category === 'food' ? 0.12 : 0.08)),
        sourceId: `google-places-${destinationId}`,
        attributions: googleAttributions(entry),
        mapsUrl: entry.googleMapsUri?.startsWith('https://') ? entry.googleMapsUri : undefined,
        openingHours: entry.regularOpeningHours?.weekdayDescriptions
          ?.filter((value): value is string => typeof value === 'string')
          .slice(0, 7),
      },
    ];
  });
}

export function distanceKm(a: [number, number], b: [number, number]) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const angle =
    Math.sin(radians(b[0] - a[0]) / 2) ** 2 +
    Math.cos(radians(a[0])) * Math.cos(radians(b[0])) * Math.sin(radians(b[1] - a[1]) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(angle), Math.sqrt(Math.max(0, 1 - angle)));
}
