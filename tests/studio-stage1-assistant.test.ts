import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { runStudioAssistant } from '../server/studio-assistant.ts';
import { studioReviewSchema } from '../server/studio-models.ts';
import { groundedStudioBrief } from '../server/studio-grounding.ts';
import { applyStudioPatch } from '../server/studio-domain.ts';
import type {
  StudioDestinationResearch,
  StudioEntryRequirements,
} from '../shared/studio-travel-research.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { defaultStudioAgency, type StudioWorkspace } from '../shared/studio.ts';

const originalFetch = globalThis.fetch;
const names = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let prior: Record<string, string | undefined>;
beforeEach(() => {
  prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.OPENAI_API_KEY = 'test-stage1-assistant';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => assert.fail('Unexpected external call');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of names)
    prior[name] === undefined ? delete process.env[name] : (process.env[name] = prior[name]);
});
function response(data: unknown, urls: string[] = []) {
  return Response.json({
    status: 'completed',
    output: [
      ...(urls.length
        ? [
            {
              type: 'web_search_call',
              status: 'completed',
              action: { sources: urls.map((url) => ({ url, title: 'Test source' })) },
            },
          ]
        : []),
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
    ],
  });
}
function review(value: StudioWorkspace, action: string) {
  return {
    action,
    reply: 'I will check the current guidance.',
    brief: value.brief,
    facts: [],
    route: value.stops.map(({ id: _id, departureDate: _departure, ...stop }) => ({
      ...stop,
      arrivalFixed: stop.arrivalFixed || false,
    })),
    routeEvidence: '',
  };
}
const agency = defaultStudioAgency();

test('assistant destination action researches supplied returning history and exposes the source-checked result', async () => {
  const value = newStudioWorkspace();
  value.brief.clientId = 'returning-profile';
  value.brief.interests = ['gardens'];
  const advisory = 'https://www.gov.uk/foreign-travel-advice/japan';
  const conditions = 'https://www.jma.go.jp/jma/en/Activities/earthquake.html';
  const asOf = new Date().toISOString();
  const models: string[] = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://www.gov.uk/api/content/foreign-travel-advice/japan')
      return Response.json({
        document_type: 'travel_advice',
        public_updated_at: asOf,
        details: {
          country: { name: 'Japan', slug: 'japan' },
          alert_status: [],
          summary: 'Read current guidance.',
          reviewed_at: asOf,
        },
      });
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    const payload = JSON.parse(body.input[0].content);
    models.push(body.text.format.name);
    if (body.text.format.name === 'studio_brief_review')
      return response(review(value, 'destinations'));
    assert.equal(body.text.format.name, 'studio_destination_research');
    assert.deepEqual(payload.travelHistory[0].destination, 'Kyoto');
    assert.doesNotMatch(body.input[0].content, /PRIVATE_PHOTO|clientId/);
    return response(
      {
        candidates: [
          {
            destination: 'Tokyo',
            countryCode: 'JP',
            reason: 'Consider another garden-focused visit.',
            suggestedDays: 5,
            thingsToDo: ['Explore public gardens'],
            conditions: 'Review earthquake updates.',
            seasonalGuidance: 'Spring is usually mild.',
            currentDisruption: false,
            conditionsVerified: true,
            advisoryUrl: advisory,
            sources: [{ url: conditions, publishedAt: asOf }],
          },
        ],
        notes: [],
      },
      [advisory, conditions],
    );
  };
  const result = await runStudioAssistant(
    value,
    'Recommend destinations based on previous trips',
    agency,
    undefined,
    [{ destination: 'Kyoto', country: 'Japan', visitedAt: '2025-03-01' }],
  );
  assert.deepEqual(models, ['studio_brief_review', 'studio_destination_research']);
  assert.ok('nextAction' in result);
  assert.equal(result.nextAction, 'structure');
  assert.equal(value.destinationResearch?.historyUsed, true);
  assert.equal(value.destinationResearch?.candidates[0].status, 'checked');
  assert.deepEqual(value.stops, []);
  assert.equal(value.brief.clientId, 'returning-profile');
});

test('assistant entry action asks for nationality without sending a speculative visa lookup', async () => {
  const value = newStudioWorkspace();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.text.format.name, 'studio_brief_review');
    return response(review(value, 'entry_check'));
  };
  const result = await runStudioAssistant(value, 'Check whether a visa is needed', agency);
  assert.equal(calls, 1);
  assert.match(result.reply, /country issued.*passport/);
  assert.deepEqual(value.entryRequirements, []);
});

test('assistant entry action checks the first selected stop and directs the agent to other destination controls', async () => {
  const value = newStudioWorkspace();
  value.brief.passportNationality = 'PK';
  value.brief.startDate = '2027-04-01';
  value.stops = ['Tokyo', 'Paris'].map((name, index) => ({
    id: name,
    name,
    country: index ? 'FR' : 'JP',
    nights: 3,
    arrivalDate: '',
    departureDate: '',
    onwardTransport: 'flight' as const,
    neighbourhood: '',
    notes: '',
  }));
  const lookedUp: string[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const payload = JSON.parse(body.input[0].content);
    if (body.text.format.name === 'studio_brief_review')
      return response(review(value, 'entry_check'));
    assert.equal(body.text.format.name, 'studio_entry_requirements');
    const trip = payload.trip;
    lookedUp.push(trip.destinationCountryCode);
    assert.equal(trip.passportCountryCode, 'PK');
    const url =
      trip.destinationCountryCode === 'JP'
        ? 'https://www.mofa.go.jp/visa/'
        : 'https://france-visas.gouv.fr/visa/';
    return response(
      {
        passportCountryCode: 'PK',
        destinationCountryCode: trip.destinationCountryCode,
        summary: 'Apply before departure.',
        conditions: [],
        electronicAuthorisation: 'Check with the authority.',
        observations: [
          {
            category: 'visa_required',
            summary: 'Visa required.',
            sourceUrl: url,
            kind: 'official_immigration',
            passportCountryCode: 'PK',
            destinationCountryCode: trip.destinationCountryCode,
            publishedAt: '',
            appliesToTrip: true,
          },
        ],
        notes: [],
      },
      [url],
    );
  };
  const result = await runStudioAssistant(value, 'Check visas for the selected route', agency);
  assert.match(result.reply, /Entry research for Tokyo/);
  assert.match(result.reply, /destination selector.*each other country/);
  assert.deepEqual(lookedUp, ['JP']);
  assert.deepEqual(
    value.entryRequirements?.map((result) => [
      result.stopId,
      result.destinationCountryCode,
      result.category,
    ]),
    [['Tokyo', 'JP', 'visa_required']],
  );
});

test('new review fields remain required in every strict Structured Outputs object', () => {
  const schema = z.toJSONSchema(studioReviewSchema);
  const inspect = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    if (object.type === 'object') {
      assert.equal(object.additionalProperties, false);
      assert.deepEqual(
        new Set(object.required as string[]),
        new Set(Object.keys(object.properties as object)),
      );
    }
    Object.values(object).forEach(inspect);
  };
  inspect(schema);
});

test('passport grounding accepts explicit declarations and contextual answers without inferring nationality from residence or origin', () => {
  const current = newStudioWorkspace().brief;
  for (const [message, expected] of [
    ['We live in London and depart from the UK.', ''],
    ['Born in Pakistan, living in Australia.', ''],
    ['Our origin is Australia.', ''],
    ['The client holds a Pakistani passport.', 'PK'],
    ['Passport nationality: Burkina Faso', 'BF'],
    ['Nationality: AU', 'AU'],
    ['I’m Australian, living in London.', 'AU'],
    ['I am British.', 'GB'],
    ['We hold a North Korean passport.', 'KP'],
    ['The client does not hold a British passport.', ''],
    ['I hold a British passport and a Pakistani passport.', ''],
  ]) {
    const result = groundedStudioBrief(
      current,
      { ...current, passportNationality: 'US' },
      [{ field: 'passportNationality', evidence: message }],
      message,
      [],
    );
    assert.equal(result.passportNationality, expected, message);
  }
  const contextual = groundedStudioBrief(
    current,
    { ...current, passportNationality: 'US' },
    [{ field: 'passportNationality', evidence: 'Pakistani' }],
    'Pakistani',
    [],
    {
      messages: [{ role: 'assistant', content: 'Which country issued the passport held?' }],
    },
  );
  assert.equal(contextual.passportNationality, 'PK');
});

test('unchanged full brief/route patches keep research while relevant nationality, dates, transport, preferences or client changes invalidate it', () => {
  const value = newStudioWorkspace();
  value.brief.passportNationality = 'PK';
  const entry = { stopId: '', summary: 'Existing check' } as StudioEntryRequirements;
  const research = { notes: ['Existing research'] } as StudioDestinationResearch;
  const seed = () => {
    value.entryRequirements = [entry];
    value.destinationResearch = research;
  };
  seed();
  applyStudioPatch(
    value,
    {
      revision: value.revision,
      brief: { ...value.brief, request: 'Hello' },
      stops: [...value.stops],
    },
    agency,
  );
  assert.equal(value.entryRequirements?.length, 1);
  assert.equal(value.destinationResearch, research);
  for (const update of [
    { passportNationality: 'AU' },
    { startDate: '2027-05-01' },
    { outboundTransport: 'cruise' as const },
    { returnTransport: 'flight' as const },
  ]) {
    seed();
    applyStudioPatch(value, { revision: value.revision, brief: update }, agency);
    assert.deepEqual(value.entryRequirements, [], JSON.stringify(update));
  }
  for (const update of [
    { interests: ['gardens'] },
    { clientId: 'another-client' },
    { budget: 4000 },
  ]) {
    seed();
    applyStudioPatch(value, { revision: value.revision, brief: update }, agency);
    assert.equal(value.destinationResearch, null, JSON.stringify(update));
  }
});
