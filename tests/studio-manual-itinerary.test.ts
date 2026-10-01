import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  moveStudioItineraryEntry,
  sanitizeManualStudioItinerary,
  STUDIO_MANUAL_ITINERARY_MAX_DAYS,
  studioItinerarySchema,
  type StudioItinerary,
} from '../shared/studio-itinerary.ts';

const source = {
  label: 'Visitor guide',
  url: 'https://tourism.example/park',
  checkedAt: '2027-01-01T00:00:00.000Z',
};
function itinerary(): StudioItinerary {
  return {
    generatedAt: '2027-01-01T00:00:00.000Z',
    days: [
      {
        day: 1,
        date: '',
        stopIds: [],
        title: 'London',
        summary: '',
        activities: [
          {
            period: 'morning',
            title: 'Walk in the park',
            description: 'Explore the public gardens.',
            sources: [source],
          },
        ],
      },
    ],
    notes: [],
  };
}

test('manual edits clear stale citations and cannot attach invented source links', () => {
  const previous = itinerary();
  const edited = structuredClone(previous);
  edited.days[0].activities[0].description = 'My own private restaurant recommendation.';
  assert.deepEqual(
    sanitizeManualStudioItinerary(edited, previous).days[0].activities[0].sources,
    [],
  );
  assert.deepEqual(sanitizeManualStudioItinerary(edited).days[0].activities[0].sources, []);
  const unchanged = structuredClone(previous);
  unchanged.days[0].activities[0].sources = [{ ...source, url: 'https://invented.example' }];
  assert.deepEqual(
    sanitizeManualStudioItinerary(unchanged, previous).days[0].activities[0].sources,
    [source],
  );
});

test('manual plans accept 366 days, empty days and up to twenty agent activities', () => {
  const value = itinerary();
  value.days = Array.from({ length: STUDIO_MANUAL_ITINERARY_MAX_DAYS }, (_, index) => ({
    ...value.days[0],
    day: index + 1,
    activities: [],
  }));
  assert.equal(studioItinerarySchema.safeParse(value).success, true);
  value.days[0].activities = Array.from({ length: 20 }, () => itinerary().days[0].activities[0]);
  assert.equal(studioItinerarySchema.safeParse(value).success, true);
  value.days[0].activities.push(itinerary().days[0].activities[0]);
  assert.equal(studioItinerarySchema.safeParse(value).success, false);
  value.days[0].activities = [];
  value.days.push({ ...value.days[0], day: STUDIO_MANUAL_ITINERARY_MAX_DAYS + 1 });
  assert.equal(studioItinerarySchema.safeParse(value).success, false);
});

test('manual dates reject impossible calendar days and preserve valid leap dates', () => {
  const value = itinerary();
  for (const date of [
    '2027-02-29',
    '2027-02-30',
    '2027-13-01',
    '2027-01-32',
    '2027-01-01T00:00:00Z',
  ]) {
    value.days[0].date = date;
    assert.equal(studioItinerarySchema.safeParse(value).success, false);
  }
  for (const date of ['', '2028-02-29', '2027-10-01']) {
    value.days[0].date = date;
    assert.equal(studioItinerarySchema.safeParse(value).success, true);
  }
});

test('reordering days and activities preserves their content and cannot escape the list', () => {
  const entries = [{ title: 'First' }, { title: 'Second' }, { title: 'Third' }];
  assert.deepEqual(
    moveStudioItineraryEntry(entries, 1, -1).map((entry) => entry.title),
    ['Second', 'First', 'Third'],
  );
  assert.deepEqual(
    moveStudioItineraryEntry(entries, 1, 1).map((entry) => entry.title),
    ['First', 'Third', 'Second'],
  );
  assert.deepEqual(moveStudioItineraryEntry(entries, 0, -1), entries);
  assert.deepEqual(
    entries.map((entry) => entry.title),
    ['First', 'Second', 'Third'],
  );
  const value = itinerary();
  value.days.push({ ...value.days[0], day: 2, title: 'Paris' });
  value.days = moveStudioItineraryEntry(value.days, 1, -1);
  const saved = sanitizeManualStudioItinerary(value, itinerary());
  assert.deepEqual(
    saved.days.map((day) => [day.day, day.title]),
    [
      [1, 'Paris'],
      [2, 'London'],
    ],
  );
});
