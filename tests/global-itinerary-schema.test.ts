import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTrip } from '../server/planner.ts';
import { defaultBrief, buildLocalItinerary } from '../server/agents/schedule.ts';
import { itinerarySchema } from '../server/validation.ts';
import { destinations } from '../shared/catalog.ts';

test('long researched descriptions and addresses remain editable through the public itinerary contract', () => {
  const trip = {
    ...newTrip(),
    days: 1,
    destinationId: 'global-city',
    destinations: [{ ...destinations[0], id: 'global-city', name: 'Global city' }],
  };
  const brief = {
    ...defaultBrief(),
    destinationStops: [{ destinationId: 'global-city', days: 1 }],
  };
  const place = {
    id: 'web-place-fixture',
    destinationId: 'global-city',
    name: 'A researched museum',
    address: 'A long official street address '.repeat(8),
    category: 'sight' as const,
    durationMinutes: 90,
    estimatedCost: 20,
    sourceId: 'web-source',
    description: 'A substantive researched description. '.repeat(16),
    suitability: ['A detailed suitability caveat. '.repeat(8)],
    evidenceUrls: ['https://example.com/museum'],
  };
  const itinerary = buildLocalItinerary(
    trip,
    brief,
    [place],
    [
      {
        day: 1,
        title: 'A personal day',
        placeIds: [place.id],
        note: 'A personal explanation for this day. '.repeat(16),
      },
    ],
  );
  assert.ok(
    itinerarySchema.safeParse(itinerary).success,
    'A generated itinerary must round-trip through the same schema the edit UI sends',
  );
  const stop = itinerary[0].items.find((item) => item.placeId === place.id)!;
  assert.equal(stop.sourceId, 'web-source');
  assert.ok(stop.description.includes('planning estimates'));
  assert.ok(stop.location.length <= 200);
});
