import { findDestination } from './destinations';
import type { ItineraryDay, Trip } from './types';
import type { PlanningPlace } from './planning';

export interface ItineraryMapStop {
  id: string;
  label: string;
  query: string;
  destinationLabel: string;
  googlePlaceId?: string;
}
export type MapTravelMode = 'suggested' | 'walking' | 'driving' | 'transit';
const cleanQuery = (value: string) => value.replaceAll('|', ' ').trim().slice(0, 180);

/** Resolve only known landmarks or researched place IDs, never private notes or fictional stays. */
export function itineraryMapStops(
  trip: Trip,
  day: ItineraryDay | undefined,
  freshPlaces: Record<string, PlanningPlace> = {},
): ItineraryMapStop[] {
  const unique = new Set<string>();
  return (day?.items || []).flatMap((item) => {
    const id = item.placeId;
    if (!id || unique.has(id)) return [];
    const destination = findDestination(day?.destinationId || trip.destinationId, trip);
    if (!destination) return [];
    const destinationLabel = `${destination.name}, ${destination.country}`;
    const landmark = destination.highlights.find(
      (_entry, index) => id === `catalog-${destination.id}-${index}`,
    );
    if (landmark) {
      unique.add(id);
      return [
        {
          id,
          label: landmark,
          query: cleanQuery(`${landmark}, ${destinationLabel}`),
          destinationLabel,
        },
      ];
    }
    const webPlace = trip.planning?.places.find(
      (place) =>
        place.id === id &&
        trip.planning?.sources.some(
          (source) => source.id === place.sourceId && source.kind === 'web',
        ),
    );
    if (webPlace) {
      unique.add(id);
      return [
        {
          id,
          label: webPlace.name,
          query: cleanQuery(`${webPlace.name}, ${webPlace.address || destinationLabel}`),
          destinationLabel,
        },
      ];
    }
    // Persisted reports retain the stable Google identity, but not its display data.
    const researched = trip.planning?.places.find(
      (place) => place.id === id && place.sourceId.startsWith('google-places-'),
    );
    if (!/^google-[A-Za-z0-9_-]{1,220}$/.test(id) || !researched) return [];
    unique.add(id);
    const fresh = freshPlaces[id];
    return [
      {
        id,
        label: fresh?.name || `Saved place ${unique.size}`,
        query: cleanQuery(fresh?.name ? `${fresh.name}, ${destinationLabel}` : destinationLabel),
        destinationLabel,
        googlePlaceId: id.slice(7),
      },
    ];
  });
}

export function googlePlaceLink(stop: ItineraryMapStop) {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', stop.query);
  if (stop.googlePlaceId) url.searchParams.set('query_place_id', stop.googlePlaceId);
  return url.href;
}

function directionLink(stops: ItineraryMapStop[], mode: MapTravelMode, minimalQueries = false) {
  if (stops.length === 1) return googlePlaceLink(stops[0]);
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  const query = (stop: ItineraryMapStop) =>
    minimalQueries && stop.googlePlaceId ? stop.destinationLabel : stop.query;
  const first = stops[0],
    last = stops.at(-1)!;
  url.searchParams.set('origin', query(first));
  url.searchParams.set('destination', query(last));
  if (first.googlePlaceId) url.searchParams.set('origin_place_id', first.googlePlaceId);
  if (last.googlePlaceId) url.searchParams.set('destination_place_id', last.googlePlaceId);
  if (mode !== 'suggested') url.searchParams.set('travelmode', mode);
  const waypoints = stops.slice(1, -1);
  if (waypoints.length) {
    url.searchParams.set('waypoints', waypoints.map(query).join('|'));
    if (waypoints.every((stop) => stop.googlePlaceId))
      url.searchParams.set(
        'waypoint_place_ids',
        waypoints.map((stop) => stop.googlePlaceId).join('|'),
      );
  }
  return url.href;
}

/** Split at mobile's three-waypoint limit and when waypoint IDs cannot map one-to-one. */
export function itineraryMapRoutes(stops: ItineraryMapStop[], mode: MapTravelMode = 'suggested') {
  if (!stops.length) return [];
  const groups: ItineraryMapStop[][] = [];
  let current: ItineraryMapStop[] = [stops[0]];
  for (const stop of stops.slice(1)) {
    const candidate = [...current, stop];
    const waypoints = candidate.slice(1, -1);
    const mixed =
      waypoints.some((entry) => entry.googlePlaceId) &&
      waypoints.some((entry) => !entry.googlePlaceId);
    if (candidate.length > 5 || mixed || directionLink(candidate, mode).length > 2048) {
      if (current.length > 1) groups.push(current);
      current = [current.at(-1)!, stop];
    } else current = candidate;
  }
  groups.push(current);
  return groups.map((group) => ({
    stops: group,
    url:
      directionLink(group, mode).length > 2048
        ? directionLink(group, mode, true)
        : directionLink(group, mode),
  }));
}

export function googleEmbedUrl(
  stops: ItineraryMapStop[],
  key: string | undefined,
  mode: MapTravelMode = 'suggested',
) {
  if (!key || !/^[A-Za-z0-9_-]{20,256}$/.test(key) || !stops.length) return undefined;
  const url = new URL(
    `https://www.google.com/maps/embed/v1/${stops.length > 1 ? 'directions' : 'place'}`,
  );
  url.searchParams.set('key', key);
  const location = (stop: ItineraryMapStop) =>
    stop.googlePlaceId ? `place_id:${stop.googlePlaceId}` : stop.query;
  if (stops.length === 1) url.searchParams.set('q', location(stops[0]));
  else {
    url.searchParams.set('origin', location(stops[0]));
    url.searchParams.set('destination', location(stops.at(-1)!));
    if (stops.length > 2)
      url.searchParams.set('waypoints', stops.slice(1, -1).map(location).join('|'));
    if (mode !== 'suggested') url.searchParams.set('mode', mode);
  }
  return url.href;
}
