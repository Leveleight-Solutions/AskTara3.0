import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { scrubStudioAIInput, scrubStudioPrivateData } from '../server/studio-privacy.ts';
import {
  initializeStudioStorage,
  newStudioWorkspace,
  StudioStore,
} from '../server/studio-store.ts';
import { reviewStudioBrief, studioReviewSchema } from '../server/studio-models.ts';
import { defaultStudioAgency } from '../shared/studio.ts';
import { applyStudioPatch, qualifyStudio } from '../server/studio-domain.ts';
import { parseStudioImport } from '../server/studio-imports.ts';

const originalFetch = globalThis.fetch;
const envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.OPENAI_API_KEY = 'unit-test-studio-privacy';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => assert.fail('Unexpected external provider call');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of envNames)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});
const secret = 'Passport number AB1234567';
const payment = 'Card number 4111 1111 1111 1111';
const assertScrubbed = (value: unknown) =>
  assert.doesNotMatch(JSON.stringify(value), /AB1234567|4111[ -]?1111[ -]?1111[ -]?1111/);

test('recursive privacy scrub removes identity/payment prose while preserving IDs, links, photos and agent contact details', () => {
  const original = {
    id: '1234567890123456',
    stopIds: ['1234567890123456'],
    brief: { request: `${secret}. ${payment}. Email agent@example.com`, requirements: [secret] },
    sourceUrl: 'https://supplier.example/1234567890123456',
    photoDataUrl: 'data:image/png;base64,1234567890123456',
    linkedText: `Reference https://supplier.example/1234567890123456 then ${secret}.`,
    passportNumber: 'AB1234567',
  };
  const scrubbed = scrubStudioPrivateData(original);
  assertScrubbed(scrubbed);
  assert.equal(original.brief.requirements[0], secret);
  assert.equal(scrubbed.id, original.id);
  assert.deepEqual(scrubbed.stopIds, original.stopIds);
  assert.equal(scrubbed.sourceUrl, original.sourceUrl);
  assert.equal(scrubbed.photoDataUrl, original.photoDataUrl);
  assert.match(scrubbed.linkedText, /https:\/\/supplier\.example\/1234567890123456/);
  assert.match(scrubbed.brief.request, /agent@example.com/);
  const startsWithUrl = scrubStudioPrivateData(`https://supplier.example/path ${secret}`);
  assertScrubbed(startsWithUrl);
  assert.match(startsWithUrl, /^https:/);
});

test('text-only AI input excludes profile image fields and embedded image data without modifying stored photos', () => {
  const value = {
    photoDataUrl: 'data:image/png;base64,SECRET_IMAGE_BYTES',
    context: 'Agent image data:image/png;base64,SECRET_IMAGE_BYTES',
    profile: { avatarUrl: 'https://private.example/portrait' },
  };
  assert.equal(scrubStudioPrivateData(value).photoDataUrl, value.photoDataUrl);
  const input = scrubStudioAIInput(value);
  assert.doesNotMatch(
    JSON.stringify(input),
    /SECRET_IMAGE_BYTES|private\.example|photoDataUrl|avatarUrl/,
  );
});

test('passport and payment query parameters are removed without changing ordinary source URLs or supplier IDs', () => {
  const url =
    'https://official.example/entry?destination=JP&passport_number=AB1234567&cardNumber=4111111111111111&id=1234567890123456';
  const scrubbed = scrubStudioPrivateData({ sourceUrl: url, text: `See ${url}` });
  assertScrubbed(scrubbed);
  assert.match(scrubbed.sourceUrl, /destination=JP/);
  assert.match(scrubbed.sourceUrl, /id=1234567890123456/);
  assert.doesNotMatch(scrubbed.sourceUrl, /passport_number|cardNumber/);
  assert.equal(
    scrubStudioPrivateData('https://official.example/entry?passport=PK'),
    'https://official.example/entry?passport=PK',
  );
});

test('workspace create, manual patch/save and reads do not return or write passport/payment prose', () => {
  const db = new DatabaseSync(':memory:');
  initializeStudioStorage(db);
  const store = new StudioStore(db);
  try {
    const workspace = newStudioWorkspace();
    workspace.brief.request = `${secret}. ${payment}`;
    store.create('owner', workspace);
    assertScrubbed(workspace);
    let row = db.prepare('SELECT data FROM studio_workspaces WHERE id=?').get(workspace.id)!;
    assertScrubbed(row.data);
    applyStudioPatch(
      workspace,
      { revision: workspace.revision, brief: { context: secret, requirements: [payment] } },
      defaultStudioAgency(),
    );
    store.save('owner', workspace, workspace.revision);
    assertScrubbed(workspace);
    assertScrubbed(store.require('owner', workspace.id));
    row = db.prepare('SELECT data FROM studio_workspaces WHERE id=?').get(workspace.id)!;
    assertScrubbed(row.data);
    // Legacy rows are scrubbed on read, before their text can be used in model context.
    const legacy = newStudioWorkspace();
    legacy.brief.context = secret;
    db.prepare('UPDATE studio_workspaces SET data=? WHERE id=?').run(
      JSON.stringify({ ...legacy, id: workspace.id }),
      workspace.id,
    );
    assertScrubbed(store.require('owner', workspace.id));
    assertScrubbed(store.list('owner'));
  } finally {
    db.close();
  }
});

test('text imports remove sensitive details while retaining travel facts', async () => {
  const imported = await parseStudioImport(
    { kind: 'text', name: 'Brief', text: `Visit Tokyo for 4 nights. ${secret}. ${payment}.` },
    defaultStudioAgency(),
  );
  assertScrubbed(imported);
  assert.match(imported.text, /Tokyo for 4 nights/);
});

test('brief review sanitizes request, old messages, imports and model reply before persistence or output', async () => {
  const workspace = newStudioWorkspace();
  workspace.brief.context = secret;
  workspace.messages = [
    { id: 'message', role: 'user', content: payment, createdAt: new Date().toISOString() },
  ];
  workspace.imports = [
    {
      id: 'import',
      kind: 'text',
      name: 'Brief',
      text: `${secret}. data:image/png;base64,SECRET_IMAGE_BYTES`,
      createdAt: new Date().toISOString(),
      sourceUrl: '',
      warnings: [],
    },
  ];
  globalThis.fetch = async (_address, init) => {
    const body = JSON.parse(String(init?.body));
    const input = JSON.parse(body.input[0].content);
    assertScrubbed(input);
    assert.doesNotMatch(body.input[0].content, /SECRET_IMAGE_BYTES/);
    return Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                reply: `Noted. ${secret}`,
                brief: input.current.brief,
                facts: [],
                route: [],
                routeEvidence: '',
              }),
            },
          ],
        },
      ],
    });
  };
  const result = await reviewStudioBrief(
    workspace,
    `Please review. ${secret}`,
    defaultStudioAgency(),
  );
  assertScrubbed(result);
  assertScrubbed(workspace);
});

test('brief actions separate destination and entry research from plain conversational extraction', () => {
  const workspace = newStudioWorkspace();
  for (const action of ['destinations', 'entry_check'])
    assert.ok(
      studioReviewSchema.safeParse({
        action,
        reply: 'I will research the current advice.',
        brief: workspace.brief,
        facts: [],
        route: [],
        routeEvidence: '',
      }).success,
    );
});

test('Stage 1 qualification records declared passport, trip scope and independent arrival/return choices', () => {
  const value = newStudioWorkspace();
  const questions = qualifyStudio(value, defaultStudioAgency()).questions;
  for (const id of ['passportNationality', 'tripType', 'outboundTransport', 'returnTransport'])
    assert.ok(questions.some((question) => question.id === id && !question.required));
  Object.assign(value.brief, {
    passportNationality: 'PK',
    tripType: 'multiple',
    outboundTransport: 'cruise',
    returnTransport: 'flight',
  });
  const qualified = qualifyStudio(value, defaultStudioAgency());
  assert.equal(
    qualified.known.find((fact) => fact.id === 'passportNationality')?.value,
    'Pakistan',
  );
  assert.equal(qualified.known.find((fact) => fact.id === 'outboundTransport')?.value, 'Cruise');
  assert.equal(qualified.known.find((fact) => fact.id === 'returnTransport')?.value, 'Flight');
  assert.ok(!qualified.questions.some((question) => question.id === 'tripType'));
});
