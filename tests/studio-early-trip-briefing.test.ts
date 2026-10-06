import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { newStudioWorkspace, StudioError } from '../server/studio-store.ts';
import {
  researchStudioTripBriefing,
  researchStudioWeatherOutlook,
  mergeStudioTripBriefing,
} from '../server/studio-trip-briefing.ts';
import {
  studioTripBriefingReady,
  studioTripBriefingInputKey,
  studioTripBriefingDestinations,
  studioBriefingDestinationDated,
  studioEntryRequirementsInputKey,
  studioPreliminaryEntryInputKey,
  STUDIO_TRIP_BRIEFING_FRESH_MS,
  type StudioWeatherOutlook,
} from '../shared/studio-trip-briefing.ts';
import type { StudioWorkspace } from '../shared/studio.ts';
import type { StudioEntryRequirements } from '../shared/studio-travel-research.ts';
import { studioTripBriefingDisplay } from '../src/components/studioTripBriefingView.ts';
import { studioCanvasTravelStatus } from '../src/components/studioCanvasTravelStatus.ts';

const originalFetch = globalThis.fetch;
const keys = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.OPENAI_API_KEY = 'unit-test-early-briefing';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => assert.fail('Unexpected provider request');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of keys)
    previous[key] === undefined ? delete process.env[key] : (process.env[key] = previous[key]);
});
const stamp = () => new Date().toISOString();
const climateUrl =
  'https://www.metoffice.gov.uk/research/climate/maps-and-data/uk-climate-averages';
const visaUrl = 'https://www.gov.uk/eta';
function early(): StudioWorkspace {
  const workspace = newStudioWorkspace();
  Object.assign(workspace.brief, {
    passportNationality: 'AU',
    preferredDestination: 'London',
    destinationCountry: 'GB',
    tripPurpose: 'undecided',
    context: 'PRIVATE CLIENT NOTES',
    clientName: 'PRIVATE NAME',
  });
  return workspace;
}
function entry(workspace: StudioWorkspace, stopId = ''): StudioEntryRequirements {
  return {
    inputKey: studioEntryRequirementsInputKey(workspace, stopId),
    checkedAt: stamp(),
    stopId,
    passportCountry: 'Australia',
    passportCountryCode: 'AU',
    destination: 'London',
    destinationCountry: 'United Kingdom',
    destinationCountryCode: 'GB',
    category: 'visa_free',
    status: 'corroborated',
    summary: 'Conditional ordinary-passport visitor guidance.',
    conditions: ['Confirm permitted visitor activities and length of stay.'],
    electronicAuthorisation: 'An ETA may be required separately.',
    sources: [
      {
        label: 'Official visa guidance',
        url: visaUrl,
        kind: 'official_immigration',
        checkedAt: stamp(),
        publishedAt: '',
      },
    ],
    notes: [],
    observations: [],
  };
}
function climate(kind: StudioWeatherOutlook['kind'] = 'climate_overview'): StudioWeatherOutlook {
  return {
    kind,
    checkedAt: stamp(),
    summary: 'Typical climate varies by season; confirm travel months for a seasonal outlook.',
    sources: [
      {
        label: 'Official climate',
        url: climateUrl,
        kind: 'conditions',
        checkedAt: stamp(),
        publishedAt: '',
      },
    ],
    days: [],
  };
}
function response(data: unknown, urls = [climateUrl]) {
  return Response.json({
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: { sources: urls.map((url) => ({ url, title: 'Official climate evidence' })) },
      },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
    ],
  });
}

test('London starts conditional entry and destination climate before dates, purpose or route approval', async () => {
  const workspace = early();
  assert.equal(studioTripBriefingReady(workspace), true);
  assert.equal(
    studioBriefingDestinationDated(workspace, studioTripBriefingDestinations(workspace)[0]),
    false,
  );
  let entryCalls = 0,
    weatherCalls = 0;
  const result = await researchStudioTripBriefing(workspace, undefined, {
    researchEntry: async (current, _signal, stopId, shortlist) => {
      entryCalls++;
      assert.ok(shortlist);
      assert.equal(current.brief.passportNationality, 'AU');
      assert.equal(current.brief.tripPurpose, 'undecided');
      return entry(current, stopId);
    },
    researchWeather: async (destination) => {
      weatherCalls++;
      assert.equal(destination.destination, 'London');
      assert.equal(destination.startDate, '');
      assert.equal(destination.endDate, '');
      return climate();
    },
  });
  assert.deepEqual([entryCalls, weatherCalls], [1, 1]);
  const row = result.briefing.stops[0];
  assert.equal(row.scope, 'preliminary');
  assert.equal(row.entryRequirements, null);
  assert.equal(row.preliminaryEntryRequirements?.scope, 'preliminary_trip');
  assert.equal(row.preliminaryEntryRequirements?.status, 'preliminary');
  assert.equal(row.preliminaryEntryRequirements?.category, 'visa_free');
  assert.ok(
    row.preliminaryEntryRequirements?.missingFacts.includes(
      'Travel purpose and permitted activities',
    ),
  );
  assert.ok(
    row.preliminaryEntryRequirements?.missingFacts.includes(
      'Confirmed arrival and departure dates',
    ),
  );
  assert.equal(row.weather.kind, 'climate_overview');
  mergeStudioTripBriefing(workspace, result.briefing);
  assert.deepEqual(workspace.entryRequirements, []);
  assert.equal(workspace.structureAccepted, false);
  const view = studioTripBriefingDisplay(workspace);
  assert.equal(view.rows[0].preliminaryEntryRequirements?.status, 'preliminary');
  assert.equal(view.rows[0].entryRequirements, null);
  assert.deepEqual(studioCanvasTravelStatus(workspace), {
    entryLabel: 'Preliminary entry guidance ready',
    weatherLabel: 'Destination climate ready',
  });
});

test('a missing passport gates only entry, not the undated climate check', async () => {
  const workspace = early();
  workspace.brief.passportNationality = '';
  const result = await researchStudioTripBriefing(workspace, undefined, {
    researchEntry: async () => assert.fail('Passport must not be inferred from client identity'),
    researchWeather: async () => climate(),
  });
  assert.equal(result.briefing.stops[0].weather.kind, 'climate_overview');
  assert.match(result.briefing.stops[0].entryError, /passport nationality/);
  assert.equal(result.briefing.stops[0].preliminaryEntryRequirements, null);
});

test('actual early model payload uses only declared passport/geography and never assumes tourism or travel dates', async () => {
  const workspace = early();
  const calls: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body.text.format.name);
    const payload = JSON.parse(body.input[0].content);
    assert.doesNotMatch(
      body.input[0].content,
      /PRIVATE|clientName|context|dateOfBirth|photo|passportNumber/,
    );
    if (body.text.format.name === 'studio_weather_outlook') {
      assert.equal(payload.datesConfirmed, false);
      return response({
        destinationCountryCode: 'GB',
        kind: 'climate_overview',
        summary: 'Typical climate varies across seasons.',
        sources: [{ url: climateUrl, publishedAt: '' }],
      });
    }
    assert.equal(payload.trip.passportCountryCode, 'AU');
    assert.equal(payload.trip.destinationCountryCode, 'GB');
    assert.equal(payload.trip.purpose, 'undecided');
    assert.equal(payload.trip.startDate, '');
    assert.equal(payload.trip.endDate, '');
    assert.equal(payload.trip.scope, 'destination_shortlist');
    assert.equal(payload.trip.passportTypeConfirmed, false);
    return response(
      {
        passportCountryCode: 'AU',
        destinationCountryCode: 'GB',
        summary: 'Conditional ordinary-passport visitor guidance; confirm purpose and dates.',
        conditions: ['Confirm permitted visitor activities.'],
        electronicAuthorisation: 'Check the separately required ETA.',
        observations: [
          {
            category: 'visa_free',
            summary: 'Conditional visitor policy.',
            sourceUrl: visaUrl,
            kind: 'official_immigration',
            passportCountryCode: 'AU',
            destinationCountryCode: 'GB',
            publishedAt: '',
            appliesToTrip: true,
          },
        ],
        notes: [],
      },
      [visaUrl],
    );
  };
  const result = await researchStudioTripBriefing(workspace);
  assert.deepEqual(calls.sort(), ['studio_entry_requirements', 'studio_weather_outlook']);
  assert.equal(result.briefing.stops[0].preliminaryEntryRequirements?.category, 'visa_free');
  assert.equal(result.briefing.stops[0].entryRequirements, null);
  const original = studioTripBriefingInputKey(workspace);
  workspace.brief.preferredDestination = 'Paris';
  workspace.brief.destinationCountry = 'FR';
  assert.throws(
    () => mergeStudioTripBriefing(workspace, result.briefing),
    (error: unknown) => error instanceof StudioError && error.code === 'STUDIO_BRIEFING_STALE',
  );
  assert.notEqual(studioTripBriefingInputKey(workspace), original);
});

test('confirmed dated purpose supersedes preliminary guidance with a fresh full check, without approving the route', async () => {
  const workspace = early();
  const first = await researchStudioTripBriefing(workspace, undefined, {
    researchEntry: async (current) => entry(current),
    researchWeather: async () => climate(),
  });
  mergeStudioTripBriefing(workspace, first.briefing);
  Object.assign(workspace.brief, {
    startDate: '2027-05-01',
    endDate: '2027-05-04',
    tripPurpose: 'tourism',
  });
  assert.equal(studioTripBriefingDisplay(workspace).rows[0].preliminaryEntryRequirements, null);
  let fullChecks = 0;
  const next = await researchStudioTripBriefing(workspace, undefined, {
    researchEntry: async (current, _signal, stopId, shortlist) => {
      fullChecks++;
      assert.equal(shortlist, undefined);
      return entry(current, stopId);
    },
    researchWeather: async (destination) => {
      assert.equal(destination.startDate, '2027-05-01');
      return climate('seasonal_outlook');
    },
  });
  mergeStudioTripBriefing(workspace, next.briefing);
  assert.equal(fullChecks, 1);
  assert.equal(workspace.tripBriefing!.stops[0].preliminaryEntryRequirements, null);
  assert.equal(workspace.entryRequirements!.length, 1);
  assert.equal(workspace.structureAccepted, false);
});

test('pending date clarification and invalid/flexible dates trigger only climate guidance and conditional entry', async () => {
  for (const state of ['clarification', 'invalid', 'flexible']) {
    const workspace = early();
    Object.assign(workspace.brief, {
      startDate: '2027-05-01',
      endDate: state === 'invalid' ? '2027-02-30' : '2027-05-04',
      tripPurpose: 'business',
      datesFlexible: state === 'flexible',
    });
    if (state === 'clarification')
      workspace.clarification = {
        kind: 'stay_dates',
        stopId: '',
        arrivalDate: '2027-05-01',
        departureDate: '2027-05-04',
        statedNights: 2,
        proposedNights: 3,
      };
    assert.equal(studioTripBriefingReady(workspace), true);
    const result = await researchStudioTripBriefing(workspace, undefined, {
      researchEntry: async (current, _signal, stopId, shortlist) => {
        assert.ok(shortlist);
        return entry(current, stopId);
      },
      researchWeather: async (destination) => {
        assert.equal(destination.startDate, '');
        assert.equal(destination.endDate, '');
        return climate();
      },
    });
    assert.equal(result.briefing.stops[0].entryRequirements, null);
    assert.equal(result.briefing.stops[0].weather.kind, 'climate_overview');
  }
});

test('known route stops still receive early checks while an unknown country stays explicit and unqueried', async () => {
  const workspace = early();
  workspace.stops = ['London', 'Unknown stop'].map((name, index) => ({
    id: String(index),
    name,
    country: index ? '' : 'GB',
    nights: null,
    arrivalDate: '',
    departureDate: '',
    onwardTransport: 'undecided',
    neighbourhood: '',
    notes: '',
  }));
  const destinations: string[] = [];
  const result = await researchStudioTripBriefing(workspace, undefined, {
    researchEntry: async (current, _signal, id) => entry(current, id),
    researchWeather: async (destination) => {
      destinations.push(destination.destination);
      return climate();
    },
  });
  assert.deepEqual(destinations, ['London']);
  assert.equal(result.briefing.stops[0].preliminaryEntryRequirements?.passportCountryCode, 'AU');
  assert.equal(result.briefing.stops[1].preliminaryEntryRequirements, null);
  assert.match(result.briefing.stops[1].entryError, /country/);
});

test('undated weather searches primary destination climate without private details or guessed travel months', async () => {
  const destination = studioTripBriefingDestinations(early())[0];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const payload = JSON.parse(body.input[0].content);
    assert.equal(payload.startDate, '');
    assert.equal(payload.endDate, '');
    assert.equal(payload.datesConfirmed, false);
    assert.match(body.instructions, /Never choose an arrival month/);
    assert.doesNotMatch(body.input[0].content, /PRIVATE|passport|clientName|context/);
    return response({
      destinationCountryCode: 'GB',
      kind: 'climate_overview',
      summary:
        'London has variable rainfall across the year. Seasonal differences require travel-month confirmation.',
      sources: [{ url: climateUrl, publishedAt: '' }],
    });
  };
  const result = await researchStudioWeatherOutlook(destination);
  assert.equal(result.kind, 'climate_overview');
  assert.equal(result.sources[0].url, climateUrl);
  assert.deepEqual(result.days, []);
});

test('undated climate fails closed on invented sources, wrong countries, date-scope changes or forecasts', async () => {
  const destination = studioTripBriefingDestinations(early())[0];
  for (const change of [
    { destinationCountryCode: 'JP' },
    { kind: 'seasonal_outlook' },
    { summary: 'It will be sunny on May 1.' },
    { sources: [{ url: 'https://invented.example/climate', publishedAt: '' }] },
  ]) {
    globalThis.fetch = async () =>
      response({
        destinationCountryCode: 'GB',
        kind: 'climate_overview',
        summary: 'Typical climate varies across seasons.',
        sources: [{ url: climateUrl, publishedAt: '' }],
        ...change,
      });
    await assert.rejects(
      researchStudioWeatherOutlook(destination),
      (error: unknown) => error instanceof StudioError && error.status === 502,
    );
  }
});

test('preliminary evidence expires, rejects future stamps and changes only with declared trip inputs', async () => {
  const workspace = early();
  mergeStudioTripBriefing(
    workspace,
    (
      await researchStudioTripBriefing(workspace, undefined, {
        researchEntry: async (current) => entry(current),
        researchWeather: async () => climate(),
      })
    ).briefing,
  );
  const checkedAt = Date.parse(workspace.tripBriefing!.checkedAt);
  for (const now of [checkedAt - 1, checkedAt + STUDIO_TRIP_BRIEFING_FRESH_MS])
    assert.equal(
      studioTripBriefingDisplay(workspace, now).rows[0].preliminaryEntryRequirements,
      null,
    );
  const before = studioPreliminaryEntryInputKey(workspace);
  workspace.brief.clientName = 'Other private identity';
  workspace.brief.context = 'Other private notes';
  assert.equal(studioPreliminaryEntryInputKey(workspace), before);
  workspace.brief.tripPurpose = 'study';
  assert.notEqual(studioPreliminaryEntryInputKey(workspace), before);
  assert.equal(studioTripBriefingDisplay(workspace).rows[0].preliminaryEntryRequirements, null);
  assert.match(studioTripBriefingInputKey(workspace), /"version":2/);
});
