import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStudioAgency, type StudioBrief, type StudioStop } from '../shared/studio.ts';
import { groundedStudioBrief } from '../server/studio-grounding.ts';
import { applyStudioPatch } from '../server/studio-domain.ts';
import { localStudioReview } from '../server/studio-local-intake.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { checkStudioEntryRequirements } from '../server/studio-travel-research.ts';
import { studioEntryPurposeDeclarations } from '../server/studio-entry-context.ts';

const originalFetch = globalThis.fetch;
const envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.OPENAI_API_KEY = 'synthetic-purpose-test-key';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => assert.fail('Unexpected external request');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of envNames)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});

const agency = defaultStudioAgency();
const officialUrl = 'https://www.gov.uk/standard-visitor/visit-on-business';
const brief = (tripPurpose?: StudioBrief['tripPurpose']) => ({
  ...newStudioWorkspace().brief,
  tripPurpose,
});
function grounded(message: string, current = brief()) {
  return groundedStudioBrief(
    current,
    { ...current, tripPurpose: 'business' },
    [{ field: 'tripPurpose', evidence: message }],
    message,
    [],
  );
}
function entryWorkspace(tripPurpose: StudioBrief['tripPurpose'] = 'business') {
  const value = newStudioWorkspace();
  Object.assign(value.brief, {
    tripPurpose,
    passportNationality: 'AU',
    preferredDestination: 'London',
    destinationCountry: 'GB',
    startDate: '2027-04-01',
    endDate: '2027-04-04',
    outboundTransport: 'flight',
    returnTransport: 'flight',
    clientName: 'PRIVATE FICTIONAL CLIENT',
    context: 'PRIVATE BUSINESS CONTEXT',
    request: 'PRIVATE CONVERSATION',
  });
  return value;
}
function mockEntry(inspect?: (body: Record<string, any>) => void) {
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.openai.com/v1/responses');
    inspect?.(JSON.parse(String(init?.body)));
    return Response.json({
      status: 'completed',
      output: [
        {
          type: 'web_search_call',
          status: 'completed',
          action: { sources: [{ url: officialUrl, title: 'Synthetic official source fixture' }] },
        },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                passportCountryCode: 'AU',
                destinationCountryCode: 'GB',
                summary: 'Synthetic fixture for permitted business visitor activities.',
                conditions: ['Check the specific intended business activities.'],
                electronicAuthorisation: 'Check electronic authorisation separately.',
                observations: [
                  {
                    category: 'visa_free',
                    summary: 'Synthetic source observation for the declared passport.',
                    sourceUrl: officialUrl,
                    kind: 'official_immigration',
                    passportCountryCode: 'AU',
                    destinationCountryCode: 'GB',
                    publishedAt: new Date().toISOString(),
                    appliesToTrip: true,
                  },
                ],
                notes: [],
              }),
            },
          ],
        },
      ],
    });
  };
}

test('literal business travel establishes purpose while business cabin wording does not', () => {
  for (const message of [
    'I want London for a business trip.',
    'London for a bussiness trip.',
    'I am travelling for business.',
    'I am attending a conference.',
  ])
    assert.equal(grounded(message).tripPurpose, 'business', message);
  for (const message of ['I want business class.', 'Fly business class to London.']) {
    assert.equal(grounded(message).tripPurpose, undefined, message);
    assert.equal(grounded(message, brief('tourism')).tripPurpose, 'tourism', message);
  }
});

test('negative and uncertain purpose statements preserve the existing purpose', () => {
  for (const message of [
    'This is not a business trip.',
    'No business meetings.',
    'I am not travelling for business.',
    'Maybe a business trip.',
    'Possibly for business.',
  ])
    assert.equal(grounded(message, brief('tourism')).tripPurpose, 'tourism', message);
});

test('unrelated negative party details do not discard a declared business trip', () => {
  const message = 'London for a business trip, one adult and no children.';
  assert.equal(grounded(message).tripPurpose, 'business');
  const value = newStudioWorkspace();
  localStudioReview(value, message, agency);
  assert.equal(value.brief.tripPurpose, 'business');
});

test('local intake retains declared travel purpose independently of cabin preference', () => {
  const value = newStudioWorkspace();
  localStudioReview(value, 'London for a holiday.', agency);
  assert.equal(value.brief.tripPurpose, 'tourism');
  localStudioReview(value, 'I would like business class.', agency);
  assert.equal(value.brief.tripPurpose, 'tourism');
  localStudioReview(value, 'This is now a business trip.', agency);
  assert.equal(value.brief.tripPurpose, 'business');
});

test('entry research uses declared business purpose without sending private client context', async () => {
  mockEntry((body) => {
    const payload = JSON.parse(body.input[0].content);
    assert.equal(payload.trip.purpose, 'business');
    assert.equal(payload.trip.passportCountryCode, 'AU');
    assert.equal(payload.trip.destinationCountryCode, 'GB');
    assert.doesNotMatch(body.input[0].content, /PRIVATE|clientName|context|request/);
    assert.match(body.instructions, /never substitute tourism for a business visit/);
    assert.match(body.instructions, /permitted visitor activities/);
  });
  const result = await checkStudioEntryRequirements(entryWorkspace());
  assert.equal(result.status, 'corroborated');
  assert.equal(JSON.parse(result.inputKey).purpose, 'business');
  assert.ok(result.notes.some((note) => note.includes('Travel purpose: business')));
});

test('missing or unclear purpose remains unverified despite a model claiming applicability', async () => {
  for (const purpose of [undefined, 'undecided', 'other'] as const) {
    const value = entryWorkspace();
    value.brief.tripPurpose = purpose;
    mockEntry();
    const result = await checkStudioEntryRequirements(value);
    assert.equal(result.status, 'unverified', String(purpose));
    assert.equal(result.category, 'unknown', String(purpose));
    assert.equal(JSON.parse(result.inputKey).purpose, purpose || 'undecided');
    assert.doesNotMatch(result.summary, /permitted business visitor/);
  }
});

test('changing purpose clears a previous entry check but an unchanged purpose retains it', async () => {
  const value = entryWorkspace();
  mockEntry();
  const entry = await checkStudioEntryRequirements(value);
  value.entryRequirements = [entry];
  applyStudioPatch(value, { revision: value.revision, brief: { tripPurpose: 'business' } }, agency);
  assert.deepEqual(value.entryRequirements, [entry]);
  applyStudioPatch(value, { revision: value.revision, brief: { tripPurpose: 'tourism' } }, agency);
  assert.deepEqual(value.entryRequirements, []);
  assert.equal(value.brief.tripPurpose, 'tourism');
});

const activityBrief = (request: string) => ({ ...brief('business'), request });
const unknownActivities = { attendingMeetings: null, localEmployment: null, paidWork: null };
const declaredBusinessVisit =
  'Check the entry requirements for this business trip using my New Zealand passport. I am only attending meetings, with no employment or paid work in the United Kingdom.';

test('entry activity declarations retain explicit meetings and work exclusions without private prose', () => {
  const value = activityBrief(declaredBusinessVisit);
  value.clientName = 'PRIVATE FICTIONAL NAME';
  value.context = 'I will do paid work. PRIVATE CONTEXT';
  assert.deepEqual(studioEntryPurposeDeclarations(value), {
    attendingMeetings: true,
    localEmployment: false,
    paidWork: false,
  });
  assert.doesNotMatch(
    JSON.stringify(studioEntryPurposeDeclarations(value)),
    /PRIVATE|passport|Zealand|Kingdom/,
  );
  assert.deepEqual(studioEntryPurposeDeclarations(activityBrief('I am only attending meetings.')), {
    ...unknownActivities,
    attendingMeetings: true,
  });
});

test('activity extraction preserves unknowns for hypothetical, policy and unrelated statements', () => {
  for (const request of [
    '',
    'Check the visa requirements for a business trip.',
    'If I do paid work, would I need another visa?',
    'I would attend meetings if invited.',
    'Can I attend meetings?',
    'The visa permits no employment or paid work.',
    'I have employment in my home country.',
    'I do not think I will attend meetings.',
  ])
    assert.deepEqual(
      studioEntryPurposeDeclarations(activityBrief(request)),
      unknownActivities,
      request,
    );
});

test('latest explicit activity revisions override earlier declarations and uncertainty clears a claim', () => {
  const initial = 'I will attend meetings. I will take up local employment. I will do paid work.';
  assert.deepEqual(studioEntryPurposeDeclarations(activityBrief(initial)), {
    attendingMeetings: true,
    localEmployment: true,
    paidWork: true,
  });
  assert.deepEqual(
    studioEntryPurposeDeclarations(
      activityBrief(`${initial}\nI am not attending meetings. No paid work or employment.`),
    ),
    {
      attendingMeetings: false,
      localEmployment: false,
      paidWork: false,
    },
  );
  assert.deepEqual(
    studioEntryPurposeDeclarations(
      activityBrief(
        `${initial}\nI may attend meetings. I am unsure whether I will take employment. I might do paid work.`,
      ),
    ),
    unknownActivities,
  );
  assert.equal(
    studioEntryPurposeDeclarations(activityBrief("I don't plan to do paid work.")).paidWork,
    false,
  );
  assert.equal(
    studioEntryPurposeDeclarations(activityBrief('No paid work.\nI will do paid work.')).paidWork,
    true,
  );
});

test('entry research receives allowlisted activity declarations and request changes invalidate cached eligibility', async () => {
  const value = entryWorkspace();
  value.brief.request = declaredBusinessVisit;
  mockEntry((body) => {
    const payload = JSON.parse(body.input[0].content);
    assert.deepEqual(payload.trip.declaredActivities, {
      attendingMeetings: true,
      localEmployment: false,
      paidWork: false,
    });
    assert.doesNotMatch(
      body.input[0].content,
      /PRIVATE|clientName|context|request|New Zealand passport/,
    );
  });
  const entry = await checkStudioEntryRequirements(value);
  value.entryRequirements = [entry];
  applyStudioPatch(
    value,
    { revision: value.revision, brief: { request: `${declaredBusinessVisit}\nThanks.` } },
    agency,
  );
  assert.deepEqual(value.entryRequirements, [entry]);
  applyStudioPatch(
    value,
    {
      revision: value.revision,
      brief: { request: `${value.brief.request}\nI will do paid work.` },
    },
    agency,
  );
  assert.deepEqual(value.entryRequirements, []);
});

test('entry research uses the final return mode and intermediate onward mode', async () => {
  const value = entryWorkspace();
  const stop = (id: string, onwardTransport: StudioStop['onwardTransport']): StudioStop => ({
    id,
    name: 'London',
    country: 'GB',
    nights: 3,
    arrivalDate: '2027-04-01',
    departureDate: '2027-04-04',
    onwardTransport,
    neighbourhood: '',
    notes: '',
  });
  value.stops = [stop('first', 'ferry'), stop('final', 'undecided')];
  const seen: string[] = [];
  mockEntry((body) => seen.push(JSON.parse(body.input[0].content).trip.departureTransport));
  await checkStudioEntryRequirements(value, undefined, 'first');
  await checkStudioEntryRequirements(value, undefined, 'final');
  assert.deepEqual(seen, ['ferry', 'flight']);
});
