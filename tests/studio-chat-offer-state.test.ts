import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { studioQuoteFingerprint } from '../server/studio-suppliers.ts';
import type { StudioJourneyOption } from '../shared/studio-journey.ts';
import {
  studioChatQuoteContextKey,
  studioChatSearchBriefPatch,
  studioChatSearchDraft,
} from '../src/components/studioChatOfferState.ts';

function workspace() {
  const value = newStudioWorkspace();
  value.structureAccepted = true;
  Object.assign(value.brief, {
    adults: 2,
    children: 0,
    hotelStandard: 'Four stars',
    hotelLocation: 'City centre',
    origin: 'Melbourne',
    startDate: '2027-06-02',
    endDate: '2027-06-05',
    cabin: 'Business class',
    passportNationality: 'Australia',
    returnTransport: 'flight',
  });
  value.stops = [
    {
      id: 'london',
      name: 'London',
      country: 'United Kingdom',
      nights: 3,
      arrivalDate: '2027-06-02',
      departureDate: '2027-06-05',
      onwardTransport: 'undecided',
      neighbourhood: 'Soho',
      notes: '',
    },
  ];
  return value;
}

test('chat supplier criteria ignore background revision metadata while matching server route/party eligibility', () => {
  const value = workspace(),
    key = studioChatQuoteContextKey(value),
    fingerprint = studioQuoteFingerprint(value);
  const metadata = structuredClone(value);
  metadata.revision += 2;
  metadata.brief.context = 'A private note that does not change supplier eligibility';
  metadata.updatedAt = '2026-10-06T00:00:00Z';
  metadata.qualification.score++;
  assert.equal(studioChatQuoteContextKey(metadata), key);
  assert.equal(studioQuoteFingerprint(metadata), fingerprint);
  for (const change of [
    (next: typeof value) => {
      next.stops[0].arrivalDate = '2027-06-03';
    },
    (next: typeof value) => {
      next.stops[0].neighbourhood = 'Bloomsbury';
    },
    (next: typeof value) => {
      next.brief.adults = 3;
    },
    (next: typeof value) => {
      next.brief.passportNationality = 'GB';
    },
    (next: typeof value) => {
      next.brief.cabin = 'Economy';
    },
    (next: typeof value) => {
      next.pricing.currency = 'USD';
    },
  ]) {
    const next = structuredClone(value);
    change(next);
    assert.notEqual(studioChatQuoteContextKey(next), key);
    assert.notEqual(studioQuoteFingerprint(next), fingerprint);
  }
});

test('search prefill reuses declared facts without guessing airport codes or flight departure from arrival', () => {
  const value = workspace(),
    draft = studioChatSearchDraft(value);
  assert.equal(draft.nationality, 'AU');
  assert.equal(draft.cabin, 'business');
  assert.equal(draft.adults, '2');
  assert.equal(draft.children, '0');
  assert.equal(draft.origin, '');
  assert.equal(draft.destination, '');
  assert.equal(draft.departureDate, '');
  value.brief.origin = 'Rio';
  value.stops[0].name = 'Spa';
  assert.equal(studioChatSearchDraft(value).origin, '');
  assert.equal(studioChatSearchDraft(value).destination, '');
  assert.equal(draft.returnDate, '2027-06-05');
  value.brief.origin = 'MEL';
  value.brief.departureDate = '2027-06-01';
  assert.equal(studioChatSearchDraft(value).origin, 'MEL');
  assert.equal(studioChatSearchDraft(value).departureDate, '2027-06-01');
  value.stops.push({ ...value.stops[0], id: 'paris', name: 'Paris', country: 'France' });
  assert.equal(studioChatSearchDraft(value).returnDate, '');
});

test('unknown travelling party stays unknown until explicit answers and saves a sparse brief', () => {
  const value = workspace();
  value.brief.adults = null;
  value.brief.children = null;
  const draft = studioChatSearchDraft(value);
  assert.match(studioChatSearchBriefPatch(value, draft, 'hotels').error, /adults/);
  draft.adults = '2';
  assert.match(studioChatSearchBriefPatch(value, draft, 'hotels').error, /children/);
  draft.children = '0';
  assert.deepEqual(studioChatSearchBriefPatch(value, draft, 'hotels'), {
    patch: { adults: 2, children: 0, childAges: [] },
    error: '',
  });
});

test('hotel searches require every child age and automatic flight prices cannot omit children', () => {
  const value = workspace();
  value.brief.children = 2;
  value.brief.childAges = [];
  const draft = studioChatSearchDraft(value);
  draft.childAges = '7';
  assert.match(studioChatSearchBriefPatch(value, draft, 'hotels').error, /one age/);
  draft.childAges = '7, 18';
  assert.match(studioChatSearchBriefPatch(value, draft, 'hotels').error, /0–17/);
  draft.childAges = '7, 12';
  assert.deepEqual(studioChatSearchBriefPatch(value, draft, 'hotels'), {
    patch: { childAges: [7, 12] },
    error: '',
  });
  assert.match(studioChatSearchBriefPatch(value, draft, 'flights').error, /leave out the children/);
});

test('a stale open search popup cannot overwrite trip facts that were saved meanwhile', () => {
  const value = workspace();
  value.brief.adults = null;
  value.brief.hotelStandard = '';
  const draft = studioChatSearchDraft(value);
  draft.adults = '2';
  draft.hotelStandard = 'Four stars';
  value.brief.adults = 3;
  value.brief.hotelStandard = 'Five stars';
  assert.deepEqual(studioChatSearchBriefPatch(value, draft, 'hotels'), { patch: {}, error: '' });
});

const sourcedRoute = (returning = false): StudioJourneyOption => ({
  id: returning ? 'return-route' : 'outward-route',
  basis: 'route_guidance',
  title: 'Synthetic sourced route',
  operator: 'Synthetic airline',
  origin: returning ? 'London' : 'Melbourne',
  destination: returning ? 'Melbourne' : 'London',
  originAirportCode: returning ? 'LHR' : 'MEL',
  destinationAirportCode: returning ? 'MEL' : 'LHR',
  via: ['Dubai'],
  duration: 'Confirm the dated schedule.',
  summary: 'Published route guidance.',
  returnSummary: 'Compare return departures separately.',
  sources: [
    {
      url: 'https://www.qantas.com/',
      label: 'Synthetic official source fixture',
      checkedAt: new Date().toISOString(),
    },
  ],
  departureDate: '',
  arrivalDate: '',
  price: null,
});

test('sourced journey handoff supplies airport codes but never an arrival date as departure', () => {
  const value = workspace();
  value.structureAccepted = false;
  const draft = studioChatSearchDraft(value, { direction: 'outbound', option: sourcedRoute() });
  assert.equal(draft.origin, 'MEL');
  assert.equal(draft.destination, 'LHR');
  assert.equal(draft.departureDate, '');
  assert.equal(value.brief.startDate, '2027-06-02');
  const noSources = sourcedRoute();
  noSources.sources = [];
  const unchecked = studioChatSearchDraft(value, { direction: 'outbound', option: noSources });
  assert.equal(unchecked.origin, '');
  assert.equal(unchecked.destination, '');
  const invalidCodes = sourcedRoute();
  invalidCodes.originAirportCode = 'SYDNEY';
  invalidCodes.destinationAirportCode = 'lhr';
  const unmapped = studioChatSearchDraft(value, { direction: 'outbound', option: invalidCodes });
  assert.equal(unmapped.origin, '');
  assert.equal(unmapped.destination, '');
});

test('return route handoff reverses sourced airports and uses only explicit return departure', () => {
  const value = workspace();
  value.brief.departureDate = '2027-06-01';
  value.brief.returnDepartureDate = '2027-06-08';
  const draft = studioChatSearchDraft(value, { direction: 'return', option: sourcedRoute(true) });
  assert.equal(draft.origin, 'LHR');
  assert.equal(draft.destination, 'MEL');
  assert.equal(draft.departureDate, '2027-06-08');
  assert.equal(draft.returnJourney, 'one_way');
  assert.equal(draft.returnDate, '');
  value.brief.returnDepartureDate = '';
  assert.equal(
    studioChatSearchDraft(value, { direction: 'return', option: sourcedRoute(true) }).departureDate,
    '',
  );
});

test('preapproval search saves explicit outward and return departure without changing arrival or trip days', () => {
  const value = workspace();
  value.structureAccepted = false;
  value.brief.tripDays = 4;
  const draft = studioChatSearchDraft(value, { direction: 'outbound', option: sourcedRoute() });
  draft.departureDate = '2027-06-01';
  draft.returnDate = '2027-06-08';
  assert.deepEqual(studioChatSearchBriefPatch(value, draft, 'flights', { direction: 'outbound' }), {
    patch: { departureDate: '2027-06-01', returnDepartureDate: '2027-06-08' },
    error: '',
  });
  const home = studioChatSearchDraft(value, { direction: 'return', option: sourcedRoute(true) });
  home.departureDate = '2027-06-09';
  assert.deepEqual(studioChatSearchBriefPatch(value, home, 'flights', { direction: 'return' }), {
    patch: { returnDepartureDate: '2027-06-09' },
    error: '',
  });
  assert.equal(value.brief.startDate, '2027-06-02');
  assert.equal(value.brief.tripDays, 4);
  assert.equal(value.stops[0].nights, 3);
});

test('fare context includes explicit duration, return departure, direction and source identity while metadata is irrelevant', () => {
  const value = workspace();
  const context = {
    direction: 'outbound' as const,
    optionId: 'outward-route',
    inputKey: 'a'.repeat(64),
  };
  const key = studioChatQuoteContextKey(value, context);
  value.revision++;
  assert.equal(studioChatQuoteContextKey(value, context), key);
  assert.notEqual(studioChatQuoteContextKey(value, { ...context, direction: 'return' }), key);
  assert.notEqual(
    studioChatQuoteContextKey(value, { ...context, optionId: 'another-source' }),
    key,
  );
  value.brief.tripDays = 4;
  assert.notEqual(studioChatQuoteContextKey(value, context), key);
  const durationKey = studioChatQuoteContextKey(value, context);
  value.brief.returnDepartureDate = '2027-06-09';
  assert.notEqual(studioChatQuoteContextKey(value, context), durationKey);
});
