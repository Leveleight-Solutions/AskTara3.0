import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { destinations, experiences, stays } from '../shared/catalog.ts';
import type { ItineraryItem } from '../shared/types.ts';
import { ownedTrip, persistTripRevision } from './database.ts';
import { refreshPlanningReport } from './agents/index.ts';
import { catalogDurationMinutes } from '../shared/durations.ts';

export class TripItemError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const selectionSchema = z
  .object({
    kind: z.enum(['experience', 'stay']),
    itemId: z.string().min(1).max(100),
    day: z.number().int().min(1).max(21),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    revision: z.number().int().min(0),
    requestId: z.string().uuid(),
  })
  .strict();
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** Resolve trusted catalog content server-side and insert one protected activity atomically. */
export function addCatalogItem(db: DatabaseSync, ownerId: string, tripId: string, input: unknown) {
  const body = selectionSchema.parse(input);
  const original = ownedTrip(db, ownerId, tripId);
  if (!original) throw new TripItemError(404, 'Trip not found.');
  const listing =
    body.kind === 'stay'
      ? stays.find((s) => s.id === body.itemId)
      : experiences.find((e) => e.id === body.itemId);
  if (!listing) throw new TripItemError(404, 'This inspiration item is not available.');
  const id = `inspiration-${body.requestId}`;
  const prior = original.itinerary
    .flatMap((day) => day.items.map((item) => ({ day: day.day, item })))
    .find((entry) => entry.item.id === id);
  if (prior) {
    if (
      prior.item.placeId !== body.itemId ||
      prior.day !== body.day ||
      prior.item.time !== body.time
    )
      throw new TripItemError(
        409,
        'This request was already used for a different addition. Reopen the dialog to make another choice.',
      );
    return { trip: original, item: prior.item, alreadyAdded: true };
  }
  if ((original.revision ?? 0) !== body.revision)
    throw new TripItemError(
      409,
      'This trip has changed. Refresh the trip choices before adding this idea.',
    );
  let trip = structuredClone(original);
  const day = trip.itinerary.find((d) => d.day === body.day);
  if (!day) throw new TripItemError(400, 'Choose a day in an existing itinerary.');
  if ((day.destinationId || trip.destinationId) !== listing.destinationId)
    throw new TripItemError(400, 'Choose a day in the same destination as this idea.');
  if (day.items.length >= 16)
    throw new TripItemError(
      409,
      'This day already has 16 stops. Remove one before adding another.',
    );
  const existingDay = trip.itinerary.find((d) =>
    d.items.some((item) => item.placeId === listing.id),
  );
  if (existingDay)
    throw new TripItemError(
      409,
      `This idea is already planned on day ${existingDay.day}. You can edit that stop in your itinerary.`,
    );
  const durationMinutes =
    body.kind === 'stay'
      ? 60
      : catalogDurationMinutes('duration' in listing ? listing.duration : '2 hours');
  const start = minutes(body.time);
  if (start + durationMinutes > 1440)
    throw new TripItemError(400, 'Choose an earlier time so the activity finishes on this day.');
  const conflict = day.items.find(
    (item) =>
      start < minutes(item.time) + (item.durationMinutes || 60) + 15 &&
      start + durationMinutes + 15 > minutes(item.time),
  );
  if (conflict)
    throw new TripItemError(
      409,
      `That time overlaps “${conflict.title}” or its travel buffer. Choose another time or edit the day first.`,
    );
  const destination = destinations.find((d) => d.id === listing.destinationId)!;
  const item: ItineraryItem = {
    id,
    time: body.time,
    title: body.kind === 'stay' ? `Stay idea: ${listing.name}` : listing.name,
    description:
      body.kind === 'stay'
        ? `${listing.description} This is a fictional stay concept, with an indicative room allowance of $${listing.price} per night. This stop is a reminder to arrange accommodation, not a reservation. The room allowance is separate from activity costs.`
        : `${listing.description} A curated experience idea; confirm availability and any booking directly.`,
    location: `${destination.name}, ${destination.country}`,
    category: body.kind === 'stay' ? 'stay' : 'experience',
    cost: body.kind === 'stay' ? 0 : listing.price,
    completed: false,
    locked: true,
    durationMinutes,
    travelMinutes: 15,
    placeId: listing.id,
    sourceId: 'catalog-places',
  };
  day.items.push(item);
  day.items.sort((a, b) => a.time.localeCompare(b.time));
  trip = refreshPlanningReport(trip);
  persistTripRevision(
    db,
    ownerId,
    trip,
    `Added ${body.kind === 'stay' ? 'a stay idea' : 'an experience'} to day ${day.day}`,
  );
  return { trip, item, alreadyAdded: false };
}
