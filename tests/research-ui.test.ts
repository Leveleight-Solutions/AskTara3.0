import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownText, { safeWebUrl } from '../src/components/MarkdownText.tsx';
import { itineraryMapStops, itineraryMapRoutes } from '../shared/maps.ts';
import { newTrip } from '../server/planner.ts';
import type { Destination } from '../shared/types.ts';

test('concierge text renders paragraphs, numbered steps and safe source links as semantic HTML', () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownText, {
      text: '## A quieter morning\n\nStart at your own pace.\nKeep the afternoon flexible.\n\n1. **First stop:** [Official guide](https://example.org/guide_(travel))\n2. Check step-free access directly.\n\n- Vegetarian choices\n- Unhurried evenings',
    }),
  );
  // Class-agnostic on purpose: the design language owns the classes, this test owns the semantics.
  assert.match(html, /<p[^>]*><strong[^>]*>A quieter morning<\/strong><\/p>/);
  assert.match(html, /<br\/>Keep the afternoon flexible/);
  assert.match(html, /<ol start="1"[^>]*><li>[^<]*(<[^>]+>)*<strong[^>]*>First stop:<\/strong>/);
  assert.match(
    html,
    /href="https:\/\/example.org\/guide_\(travel\)" target="_blank" rel="noopener noreferrer"/,
  );
  assert.match(html, /<ul[^>]*>.*Vegetarian choices.*Unhurried evenings.*<\/ul>/);
});

test('concierge source rendering never executes HTML or unsafe URL schemes', () => {
  const html = renderToStaticMarkup(
    createElement(MarkdownText, {
      text: '<script>alert(1)</script>\n\n[Bad](javascript:alert(1)) [Credentials](https://person:secret@example.org/) [Relative](//example.org/) [Safe](https://example.org/?q=%3Cscript%3E)',
    }),
  );
  assert.doesNotMatch(html, /<script|href="javascript:|person:secret|href="\/\//);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal((html.match(/<a /g) || []).length, 1);
  for (const url of [
    'data:text/html,hello',
    'javascript:alert(1)',
    '//example.org',
    'https://x:y@example.org',
    'https://example.org/\nprivate',
  ])
    assert.equal(safeWebUrl(url), undefined);
});

test('a non-catalog destination maps source-grounded stops from its saved snapshot without private edits', () => {
  const destination: Destination = {
    id: 'osaka',
    name: 'Osaka',
    country: 'Japan',
    region: 'Asia',
    description: 'A researched city.',
    longDescription: 'Saved destination research.',
    image: '/images/destination-placeholder.svg',
    tags: ['Food'],
    vibe: 'City escapes',
    bestTime: 'Check your travel dates',
    dailyBudget: 100,
    coordinates: [34.6937, 135.5023],
    highlights: [],
  };
  const trip = newTrip();
  trip.destinationId = destination.id;
  trip.destinations = [destination];
  trip.planning = {
    generatedAt: '2026-09-12T00:00:00Z',
    mode: 'live',
    summary: 'A researched plan',
    assumptions: [],
    questions: [],
    issues: [],
    stays: [],
    flights: [],
    destinations: [],
    agentIds: [],
    budget: {
      currency: 'USD',
      target: 1000,
      activities: 20,
      accommodation: 0,
      flights: null,
      total: 20,
      unpriced: [],
    },
    sources: [
      {
        id: 'osaka-guide',
        kind: 'web',
        label: 'Osaka guide',
        url: 'https://example.org/osaka',
        checkedAt: '2026-09-12T00:00:00Z',
        status: 'live',
      },
    ],
    places: [
      {
        id: 'web-osaka-garden',
        name: 'Osaka garden',
        destinationId: 'osaka',
        address: 'Osaka, Japan',
        category: 'sight',
        durationMinutes: 90,
        estimatedCost: 10,
        sourceId: 'osaka-guide',
        evidenceUrls: ['https://example.org/osaka'],
      },
    ],
  };
  const day = {
    day: 1,
    destinationId: 'osaka',
    title: 'A quiet morning',
    items: [
      {
        id: 'stop',
        placeId: 'web-osaka-garden',
        time: '10:00',
        title: 'Private appointment',
        description: 'Private notes',
        location: 'My private home',
        category: 'sight' as const,
        cost: 10,
        completed: false,
      },
    ],
  };
  const stops = itineraryMapStops(trip, day);
  assert.equal(stops.length, 1);
  assert.equal(stops[0].label, 'Osaka garden');
  assert.equal(stops[0].destinationLabel, 'Osaka, Japan');
  assert.equal(stops[0].query, 'Osaka garden, Osaka, Japan');
  const url = new URL(itineraryMapRoutes(stops)[0].url);
  assert.equal(url.origin, 'https://www.google.com');
  assert.doesNotMatch(decodeURIComponent(url.href), /Private|private/);
  trip.planning.sources = [];
  assert.deepEqual(itineraryMapStops(trip, day), []);
});
