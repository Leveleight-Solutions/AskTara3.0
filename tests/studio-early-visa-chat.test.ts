import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { runStudioAssistant } from '../server/studio-assistant.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { defaultStudioAgency, type StudioWorkspace } from '../shared/studio.ts';
import { studioTripBriefingDisplay } from '../src/components/studioTripBriefingView.ts';

const originalFetch = globalThis.fetch;
const envKeys = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.OPENAI_API_KEY = 'unit-test-early-visa-chat';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys)
    previous[key] === undefined ? delete process.env[key] : (process.env[key] = previous[key]);
});
const visaUrl = 'https://www.gov.uk/eta';
const climateUrl =
  'https://www.metoffice.gov.uk/research/climate/maps-and-data/uk-climate-averages';
function trip() {
  const workspace = newStudioWorkspace();
  Object.assign(workspace.brief, {
    passportNationality: 'AU',
    preferredDestination: 'London',
    destinationCountry: 'GB',
    clientName: 'FICTIONAL_PRIVATE_NAME',
    context: 'FICTIONAL_PRIVATE_NOTES',
  });
  workspace.stops = [
    {
      id: 'london',
      name: 'London',
      country: 'GB',
      nights: null,
      arrivalDate: '',
      departureDate: '',
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
  return workspace;
}
function response(data: unknown, urls: string[] = []) {
  return Response.json({
    status: 'completed',
    output: [
      ...(urls.length
        ? [
            {
              type: 'web_search_call',
              status: 'completed',
              action: { sources: urls.map((url) => ({ url, title: 'Official test evidence' })) },
            },
          ]
        : []),
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
    ],
  });
}
function mock(workspace: StudioWorkspace, entryDefect?: 'guarantee' | 'unsearched_source') {
  const calls: { name: string; payload: Record<string, unknown> }[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    const name = body.text.format.name;
    const payload = JSON.parse(body.input[0].content);
    calls.push({ name, payload });
    if (name === 'studio_brief_review')
      return response({
        action: 'entry_check',
        reply: 'I will check the relevant official guidance.',
        brief: workspace.brief,
        facts: [],
        routeEvidence: '',
        route: workspace.stops.map(({ id: _id, departureDate: _date, ...stop }) => ({
          ...stop,
          arrivalFixed: stop.arrivalFixed || false,
        })),
      });
    assert.doesNotMatch(
      body.input[0].content,
      /FICTIONAL_PRIVATE_NAME|FICTIONAL_PRIVATE_NOTES|clientName|dateOfBirth|profilePicture/,
    );
    if (name === 'studio_weather_outlook')
      return response(
        {
          destinationCountryCode: 'GB',
          kind: payload.datesConfirmed ? 'seasonal_outlook' : 'climate_overview',
          summary:
            'Usual climate varies by season. Confirm travel months for more specific packing guidance.',
          sources: [{ url: climateUrl, publishedAt: '' }],
        },
        [climateUrl],
      );
    assert.equal(name, 'studio_entry_requirements');
    assert.equal(payload.trip.scope, 'destination_shortlist');
    assert.equal(payload.trip.passportCountryCode, 'AU');
    assert.equal(payload.trip.destinationCountryCode, 'GB');
    assert.equal(payload.trip.purpose, 'undecided');
    assert.equal(payload.trip.passportTypeConfirmed, false);
    assert.equal(payload.trip.suggestedStayConfirmed, false);
    return response(
      {
        passportCountryCode: 'AU',
        destinationCountryCode: 'GB',
        summary:
          entryDefect === 'guarantee'
            ? 'Guaranteed entry is available.'
            : 'Conditional short-visit guidance applies only when the official visitor conditions are met.',
        conditions: ['Confirm permitted activities, passport type and length of stay.'],
        electronicAuthorisation:
          'An ETA may be required separately; check the official rules before travel.',
        observations: [
          {
            category: 'visa_free',
            summary: 'Conditional visitor guidance for the declared passport.',
            sourceUrl:
              entryDefect === 'unsearched_source' ? 'https://www.gov.uk/check-uk-visa' : visaUrl,
            kind: 'official_immigration',
            passportCountryCode: 'AU',
            destinationCountryCode: 'GB',
            publishedAt: new Date().toISOString(),
            appliesToTrip: true,
          },
        ],
        notes: ['The itinerary and ordinary passport type are not yet confirmed.'],
      },
      [visaUrl],
    );
  };
  return calls;
}

test('an explicit visa chat request before dates runs conditional entry and climate without promoting eligibility or approving the route', async () => {
  const workspace = trip();
  const calls = mock(workspace);
  const result = await runStudioAssistant(
    workspace,
    'Check visa requirements for London please',
    defaultStudioAgency(),
  );
  assert.deepEqual(
    calls.map((call) => call.name).sort(),
    ['studio_brief_review', 'studio_entry_requirements', 'studio_weather_outlook'].sort(),
  );
  const payload = calls.find((call) => call.name === 'studio_entry_requirements')!.payload
    .trip as Record<string, unknown>;
  assert.equal(payload.startDate, '');
  assert.equal(payload.endDate, '');
  const row = workspace.tripBriefing!.stops[0];
  assert.equal(row.entryRequirements, null);
  assert.equal(row.preliminaryEntryRequirements!.scope, 'preliminary_trip');
  assert.equal(row.preliminaryEntryRequirements!.status, 'preliminary');
  assert.ok(
    row.preliminaryEntryRequirements!.missingFacts.includes(
      'Travel purpose and permitted activities',
    ),
  );
  assert.ok(
    row.preliminaryEntryRequirements!.missingFacts.includes(
      'Confirmed arrival and departure dates',
    ),
  );
  assert.ok(
    row.preliminaryEntryRequirements!.missingFacts.includes(
      'Passport type (ordinary passport assumed)',
    ),
  );
  assert.equal(row.weather.kind, 'climate_overview');
  assert.equal(workspace.brief.startDate, '');
  assert.equal(workspace.stops[0].nights, null);
  assert.equal(workspace.structureAccepted, false);
  assert.deepEqual(workspace.entryRequirements, []);
  const view = studioTripBriefingDisplay(workspace);
  assert.equal(view.rows[0].entryRequirements, null);
  assert.equal(view.rows[0].preliminaryEntryRequirements?.status, 'preliminary');
  assert.match(result.reply, /preliminary travel checks/);
  assert.doesNotMatch(
    result.reply,
    /\b(?:eligible|approved|guaranteed)\b|what date|how many nights/i,
  );
  assert.equal('nextAction' in result ? result.nextAction : '', 'journey');
});

test('a known brief-only destination supports explicit early visa chat without inventing a route stop', async () => {
  const workspace = trip();
  workspace.stops = [];
  const calls = mock(workspace);
  const result = await runStudioAssistant(workspace, 'visa?', defaultStudioAgency());
  assert.ok(calls.some((call) => call.name === 'studio_entry_requirements'));
  assert.ok(calls.some((call) => call.name === 'studio_weather_outlook'));
  assert.deepEqual(workspace.stops, []);
  assert.equal(workspace.tripBriefing!.stops[0].stopId, '');
  assert.equal(workspace.tripBriefing!.stops[0].destination, 'London');
  assert.equal(
    workspace.tripBriefing!.stops[0].preliminaryEntryRequirements?.status,
    'preliminary',
  );
  assert.deepEqual(workspace.entryRequirements, []);
  assert.match(result.reply, /preliminary travel checks/);
  assert.doesNotMatch(result.reply, /choose a destination first/i);
});

test('known travel dates with undeclared purpose still produce conditional entry while weather uses the declared date scope', async () => {
  const workspace = trip();
  workspace.brief.startDate = '2027-05-01';
  workspace.brief.endDate = '2027-05-05';
  workspace.stops[0] = {
    ...workspace.stops[0],
    arrivalDate: '2027-05-01',
    departureDate: '2027-05-05',
    arrivalFixed: true,
    nights: 4,
  };
  mock(workspace);
  await runStudioAssistant(workspace, 'visa?', defaultStudioAgency());
  const row = workspace.tripBriefing!.stops[0];
  assert.equal(row.preliminaryEntryRequirements?.status, 'preliminary');
  assert.equal(row.entryRequirements, null);
  assert.deepEqual(workspace.entryRequirements, []);
  assert.equal(row.weather.kind, 'seasonal_outlook');
  assert.ok(
    row.preliminaryEntryRequirements!.missingFacts.includes(
      'Travel purpose and permitted activities',
    ),
  );
});

test('early visa chat fails closed on positive guarantees or unsearched immigration sources while retaining independently sourced climate', async () => {
  for (const defect of ['guarantee', 'unsearched_source'] as const) {
    const workspace = trip();
    mock(workspace, defect);
    await runStudioAssistant(workspace, 'Check the visa please', defaultStudioAgency());
    const row = workspace.tripBriefing!.stops[0];
    assert.equal(row.entryRequirements, null);
    assert.equal(row.preliminaryEntryRequirements, null);
    assert.match(row.entryError, /could not be checked/i);
    assert.deepEqual(workspace.entryRequirements, []);
    assert.equal(row.weather.kind, 'climate_overview');
    assert.equal(workspace.tripBriefing!.status, 'partial');
  }
});
