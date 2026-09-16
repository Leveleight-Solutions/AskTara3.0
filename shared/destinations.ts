import { destinations } from './catalog';
import type { Destination, Trip } from './types';

type DestinationContext = Pick<Trip, 'destinations' | 'planning'>;

/** Research belongs to its trip, never to a mutable process-wide catalog. */
export function findDestination(id: string, trip?: DestinationContext): Destination | undefined {
  return (
    trip?.destinations?.find((entry) => entry.id === id) ||
    trip?.planning?.destinations.find((entry) => entry.id === id) ||
    destinations.find((entry) => entry.id === id)
  );
}

export function tripDestinations(trip: DestinationContext): Destination[] {
  const entries = new Map<string, Destination>();
  for (const destination of [
    ...destinations,
    ...(trip.planning?.destinations || []),
    ...(trip.destinations || []),
  ])
    entries.set(destination.id, destination);
  return [...entries.values()];
}
