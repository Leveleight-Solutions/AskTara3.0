import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { publicConfig } from '../server/config.ts';
import { newTrip } from '../server/planner.ts';
import {
  googleEmbedUrl,
  googlePlaceLink,
  itineraryMapRoutes,
  itineraryMapStops,
  type ItineraryMapStop,
} from '../shared/maps.ts';
import type { ItineraryDay } from '../shared/types.ts';
import type { PlanningPlace, PlanningReport } from '../shared/planning.ts';
const keys = [
  'GOOGLE_MAPS_EMBED_API_KEY',
  'GOOGLE_PLACES_API_KEY',
  'OPENAI_API_KEY',
  'DUFFEL_ACCESS_TOKEN',
  'LITEAPI_API_KEY',
];
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const key of keys)
    saved[key] === undefined ? delete process.env[key] : (process.env[key] = saved[key]);
});
const embedKey = 'browser_embed_key_example_12345';
function dayWith(...ids: string[]): ItineraryDay {
  return {
    day: 1,
    destinationId: 'kyoto',
    title: 'Kyoto day',
    items: ids.map((id, index) => ({
      id: `item-${index}`,
      time: '10:00',
      title: 'My private appointment',
      description: 'Private details never sent to Maps',
      location: 'Private home address',
      category: 'sight',
      cost: 0,
      completed: false,
      placeId: id,
    })),
  };
}
function place(id: string): PlanningPlace {
  return {
    id,
    name: 'Saved place in Kyoto',
    address: 'Kyoto, Japan',
    destinationId: 'kyoto',
    category: 'sight',
    durationMinutes: 90,
    estimatedCost: 5,
    sourceId: 'google-places-kyoto',
  };
}
function report(places: PlanningPlace[]): PlanningReport {
  return {
    generatedAt: '2027-01-01T00:00:00Z',
    mode: 'local',
    summary: '',
    assumptions: [],
    questions: [],
    issues: [],
    sources: [],
    places,
    stays: [],
    flights: [],
    destinations: [],
    budget: {
      currency: 'USD',
      target: 0,
      activities: 0,
      accommodation: 0,
      flights: null,
      total: 0,
      unpriced: [],
    },
    agentIds: [],
  };
}
function stop(index: number, google = false): ItineraryMapStop {
  return {
    id: `point-${index}`,
    label: `Stop ${index}`,
    query: `Place ${index}, Kyoto, Japan`,
    destinationLabel: 'Kyoto, Japan',
    ...(google ? { googlePlaceId: `ChIJ_example_${index}` } : {}),
  };
}

test('map resolution uses known landmark identities and fresh page data, excluding private notes and fictional stays', () => {
  const trip = newTrip();
  trip.destinationId = 'kyoto';
  trip.planning = report([place('google-ChIJ_test_1')]);
  const day = dayWith(
    'catalog-kyoto-0',
    'catalog-kyoto-0',
    'google-ChIJ_test_1',
    'kyoto-stay',
    'not-a-place',
    'google-forged',
  );
  const snapshot = JSON.stringify(trip);
  const points = itineraryMapStops(trip, day, {
    'google-ChIJ_test_1': { ...place('google-ChIJ_test_1'), name: 'A&B | Garden' },
  });
  assert.equal(points.length, 2);
  assert.equal(points[0].label, 'Fushimi Inari Taisha');
  assert.equal(points[1].label, 'A&B | Garden');
  assert.equal(points[1].query, 'A&B   Garden, Kyoto, Japan');
  assert.equal(points[1].googlePlaceId, 'ChIJ_test_1');
  assert.ok(!JSON.stringify(points).includes('Private'));
  assert.ok(!JSON.stringify(points).includes('appointment'));
  assert.equal(JSON.stringify(trip), snapshot);
  const savedOnly = itineraryMapStops(trip, day)[1];
  assert.equal(savedOnly.label, 'Saved place 2');
  assert.equal(
    new URL(googlePlaceLink(savedOnly)).searchParams.get('query_place_id'),
    'ChIJ_test_1',
  );
});

test('embedded map URLs have a fixed trusted origin, separate encoded key and precise place IDs', () => {
  const points = [stop(1), stop(2, true), stop(3, true)];
  const url = new URL(googleEmbedUrl(points, embedKey, 'walking')!);
  assert.equal(url.origin, 'https://www.google.com');
  assert.equal(url.pathname, '/maps/embed/v1/directions');
  assert.equal(url.searchParams.get('key'), embedKey);
  assert.equal(url.searchParams.get('origin'), 'Place 1, Kyoto, Japan');
  assert.equal(url.searchParams.get('waypoints'), 'place_id:ChIJ_example_2');
  assert.equal(url.searchParams.get('destination'), 'place_id:ChIJ_example_3');
  assert.equal(url.searchParams.get('mode'), 'walking');
  assert.equal(googleEmbedUrl(points, undefined), undefined);
  assert.equal(googleEmbedUrl(points, 'https://attacker.example/key'), undefined);
  assert.equal(googleEmbedUrl([], embedKey), undefined);
  const one = new URL(googleEmbedUrl([points[1]], embedKey)!);
  assert.equal(one.pathname, '/maps/embed/v1/place');
  assert.equal(one.searchParams.get('q'), 'place_id:ChIJ_example_2');
});

test('no-key routes preserve every stop and Google identity across mobile-safe sections', () => {
  const points = Array.from({ length: 10 }, (_, index) => stop(index, index % 3 === 0));
  const routes = itineraryMapRoutes(points, 'transit');
  assert.ok(routes.length > 1);
  assert.deepEqual(
    routes.flatMap((route, index) => (index === 0 ? route.stops : route.stops.slice(1))),
    points,
  );
  for (const route of routes) {
    assert.ok(route.stops.length <= 5);
    assert.ok(route.url.length <= 2048);
    const url = new URL(route.url);
    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.searchParams.get('api'), '1');
    assert.equal(url.searchParams.get('key'), null);
    assert.equal(url.searchParams.get('travelmode'), 'transit');
    const middle = route.stops.slice(1, -1);
    const identities = middle.filter((point) => point.googlePlaceId);
    assert.ok(identities.length === 0 || identities.length === middle.length);
    if (identities.length)
      assert.equal(
        url.searchParams.get('waypoint_place_ids'),
        identities.map((point) => point.googlePlaceId).join('|'),
      );
  }
});

test('oversized fresh labels are split without dropping stops or exceeding Maps URL limits', () => {
  const points = Array.from({ length: 4 }, (_, index) => ({
    ...stop(index, true),
    query: '庭'.repeat(180),
    googlePlaceId: 'a'.repeat(200) + index,
  }));
  const routes = itineraryMapRoutes(points);
  assert.deepEqual(
    routes.flatMap((route, index) => (index ? route.stops.slice(1) : route.stops)),
    points,
  );
  assert.ok(routes.every((route) => route.url.length <= 2048));
});

test('public config exposes only the explicitly public Embed key and refuses reused server secrets', async () => {
  for (const key of keys) delete process.env[key];
  process.env.GOOGLE_PLACES_API_KEY = 'secret_places_key_example_12345';
  process.env.OPENAI_API_KEY = 'secret_openai_key_example_12345';
  assert.deepEqual(publicConfig(), {});
  process.env.GOOGLE_MAPS_EMBED_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
  assert.deepEqual(publicConfig(), {});
  process.env.GOOGLE_MAPS_EMBED_API_KEY = embedKey;
  const app = createApp(':memory:');
  try {
    const response = await request(app).get('/api/config').expect(200);
    assert.deepEqual(response.body, { mapsEmbedApiKey: embedKey });
    assert.match(response.headers['cache-control'], /no-store/);
    assert.match(
      response.headers['content-security-policy'],
      /frame-src 'self' https:\/\/www.google.com/,
    );
    assert.ok(!response.text.includes(process.env.GOOGLE_PLACES_API_KEY));
    assert.ok(!response.text.includes(process.env.OPENAI_API_KEY));
  } finally {
    app.locals.db.close();
  }
});
