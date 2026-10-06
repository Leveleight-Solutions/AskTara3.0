import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import type { StudioWorkspace } from '../shared/studio.ts';
import type { StudioCruiseDraft } from '../shared/studio-cruise.ts';
import type { StudioItinerary } from '../shared/studio-itinerary.ts';
import { redactIdentityAndPayment } from '../server/studio-imports.ts';

const originalFetch = globalThis.fetch;
const envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT', 'NODE_ENV'];
let previous: Record<string, string | undefined>;
let apps: ReturnType<typeof createApp>[] = [];
beforeEach(() => {
  previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  for (const name of envNames) delete process.env[name];
  process.env.NODE_ENV = 'test';
  globalThis.fetch = async () => assert.fail('Unexpected external request');
});
afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const app of apps) {
    await app.locals.studioActions.shutdown();
    await app.locals.planningRuns.shutdown();
    app.locals.db.close();
  }
  apps = [];
  for (const name of envNames)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});
function setup() {
  const app = createApp(':memory:');
  apps.push(app);
  return { app, client: request.agent(app), stranger: request.agent(app) };
}
type Client = ReturnType<typeof request.agent>;
const create = async (client: Client): Promise<StudioWorkspace> =>
  (await client.post('/api/studio/workspaces').send({}).expect(201)).body.workspace;
const path = (workspace: StudioWorkspace, suffix = '') =>
  `/api/studio/workspaces/${workspace.id}${suffix}`;
const patch = async (
  client: Client,
  workspace: StudioWorkspace,
  update: Record<string, unknown>,
): Promise<StudioWorkspace> =>
  (
    await client
      .patch(path(workspace))
      .send({ revision: workspace.revision, ...update })
      .expect(200)
  ).body.workspace;
const now = '2026-10-01T12:00:00.000Z';
const profileInput = () => ({
  name: 'John Example',
  country: 'Australia',
  nationality: 'New Zealand',
  dateOfBirth: '1990-02-04',
  context: 'Likes culture. Passport number: ABC123456',
  passportNationality: 'Pakistan',
  photoDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  interests: ['Culture'],
  foodPreferences: ['Vegetarian'],
  history: [
    {
      destination: 'London',
      country: 'United Kingdom',
      visitedAt: '2025-06',
      feedback: 'liked',
      experience: 'visited',
      notes: 'Enjoyed quiet museums',
      interests: ['Culture'],
    },
  ],
});
const manual = (): StudioItinerary => ({
  generatedAt: now,
  days: [
    {
      day: 1,
      date: '',
      stopIds: [],
      title: 'Agent recommendations',
      summary: '',
      activities: [
        {
          period: 'flexible',
          title: 'Personal museum recommendation',
          description: 'Ask the guide about the current exhibition.',
          sources: [
            {
              label: 'Unverified pasted citation',
              url: 'https://invented.example/guide',
              checkedAt: now,
            },
          ],
        },
      ],
    },
  ],
  notes: [],
});
const cruise = (): StudioCruiseDraft => ({
  id: 'reviewed-cruise-1',
  name: 'Pacific cruise',
  ship: 'Example ship',
  sourceUrl: '',
  sourceName: 'Agent reviewed schedule',
  extractedAt: now,
  currency: 'USD',
  fullFare: 4500,
  disembarkAfterDay: 3,
  onwardTransport: 'flight',
  returnTransport: 'cruise',
  days: ['Hong Kong', 'At sea', 'Taipei', 'Shanghai'].map((port, index) => ({
    day: index + 1,
    date: `2027-10-0${index + 1}`,
    port,
    arrival: '',
    departure: '',
    details: index === 2 ? 'Disembark and spend the night in Taipei.' : '',
  })),
  warnings: [],
});

test('client profiles support same-name identities, safe photos, private ownership and deletion', async () => {
  const { client, stranger } = setup();
  const first = (await client.post('/api/studio/client-profiles').send(profileInput()).expect(201))
    .body.client;
  const second = (
    await client
      .post('/api/studio/client-profiles')
      .send({ ...profileInput(), context: 'Second client' })
      .expect(201)
  ).body.client;
  assert.notEqual(first.id, second.id);
  assert.equal(first.passportNationality, 'PK');
  assert.equal(first.country, 'AU');
  assert.equal(first.nationality, 'NZ');
  assert.equal(first.dateOfBirth, '1990-02-04');
  assert.doesNotMatch(first.context, /ABC123456/);
  assert.equal(first.photoDataUrl, profileInput().photoDataUrl);
  assert.equal(
    (await client.get('/api/studio/client-profiles').expect(200)).body.clients.length,
    2,
  );
  assert.deepEqual(
    (await stranger.get('/api/studio/client-profiles').expect(200)).body.clients,
    [],
  );
  await stranger.patch(`/api/studio/client-profiles/${first.id}`).send(profileInput()).expect(404);
  await stranger.delete(`/api/studio/client-profiles/${first.id}`).expect(404);
  await client
    .post('/api/studio/client-profiles')
    .send({ ...profileInput(), passportNumber: 'FORBIDDEN' })
    .expect(400);
  await client
    .post('/api/studio/client-profiles')
    .send({ ...profileInput(), photoDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })
    .expect(400);
  const changed = (
    await client
      .patch(`/api/studio/client-profiles/${first.id}`)
      .send({ ...profileInput(), name: 'John Updated', photoDataUrl: '' })
      .expect(200)
  ).body.client;
  assert.equal(changed.name, 'John Updated');
  let workspace = await create(client);
  workspace = await patch(client, workspace, {
    brief: { clientId: first.id, clientName: first.name },
  });
  await client.delete(`/api/studio/client-profiles/${first.id}`).expect(204);
  const saved = (await client.get(path(workspace)).expect(200)).body.workspace;
  assert.equal(saved.brief.clientId, '');
  assert.equal(
    (await client.get('/api/studio/client-profiles').expect(200)).body.clients[0].id,
    second.id,
  );
});

test('manual plans save without AI, strip fabricated citations and survive preference changes', async () => {
  const { client, stranger } = setup();
  let workspace = await create(client);
  workspace = await patch(client, workspace, { itinerary: manual() });
  assert.equal(workspace.itineraryManual, true);
  assert.deepEqual(workspace.itinerary?.days[0].activities[0].sources, []);
  workspace = await patch(client, workspace, { brief: { interests: ['Culture', 'Shopping'] } });
  assert.equal(
    workspace.itinerary?.days[0].activities[0].title,
    manual().days[0].activities[0].title,
  );
  assert.match(workspace.itinerary?.notes.join(' ') || '', /Review the daily plan/);
  await stranger
    .patch(path(workspace))
    .send({ revision: workspace.revision, itinerary: null })
    .expect(404);
  await client
    .patch(path(workspace))
    .send({ revision: workspace.revision - 1, itinerary: null })
    .expect(409);
  const long = manual();
  long.days = Array.from({ length: 366 }, (_, index) => ({
    ...long.days[0],
    day: index + 1,
    title: `Manual day ${index + 1}`,
    activities: [],
  }));
  workspace = await patch(client, workspace, { itinerary: long });
  assert.equal(workspace.itinerary?.days.length, 366);
  const invalid = manual();
  invalid.days[0].stopIds = ['not-owned-stop'];
  await client
    .patch(path(workspace))
    .send({ revision: workspace.revision, itinerary: invalid })
    .expect(400);
  invalid.days[0].stopIds = [];
  invalid.days[0].cruiseId = 'not-owned-cruise';
  await client
    .patch(path(workspace))
    .send({ revision: workspace.revision, itinerary: invalid })
    .expect(400);
  workspace = await patch(client, workspace, { itinerary: null });
  assert.equal(workspace.itinerary, null);
});

test('reviewed cruise apply keeps full fare through early exit and reapply preserves other manual days', async () => {
  const { client, stranger } = setup();
  let workspace = await create(client);
  workspace = await patch(client, workspace, { itinerary: manual() });
  const draft = cruise();
  // A legitimate UUID can contain a long run of digits that resembles a PAN.
  draft.days[2].id = '11111111-1111-4111-8111-111111111111';
  await stranger
    .post(path(workspace, '/cruises/apply'))
    .send({ revision: workspace.revision, cruise: draft })
    .expect(404);
  const applied = await client
    .post(path(workspace, '/cruises/apply'))
    .send({ revision: workspace.revision, cruise: draft })
    .expect(200);
  workspace = applied.body.workspace;
  assert.equal(workspace.cruises?.[0].fullFare, 4500);
  assert.equal(workspace.cruises?.[0].days.length, 4);
  assert.equal(workspace.itinerary?.days.filter((day) => day.cruiseId === draft.id).length, 3);
  assert.ok(workspace.itinerary?.days.some((day) => day.title === 'Agent recommendations'));
  assert.equal(
    workspace.items.find((item) => item.kind === 'cruise' && item.price === 4500)?.currency,
    'USD',
  );
  assert.ok(workspace.items.some((item) => item.kind === 'flight'));
  assert.ok(workspace.items.some((item) => item.kind === 'cruise' && item.price === null));
  const oldRevision = workspace.revision;
  draft.days[2].details = 'A different private recommendation in Taipei.';
  workspace = (
    await client
      .post(path(workspace, '/cruises/apply'))
      .send({ revision: workspace.revision, cruise: draft })
      .expect(200)
  ).body.workspace;
  assert.equal(workspace.cruises?.length, 1);
  assert.equal(workspace.itinerary?.days.filter((day) => day.cruiseId === draft.id).length, 3);
  assert.equal(
    workspace.items.filter((item) => item.kind === 'cruise' && item.price === 4500).length,
    1,
  );
  assert.ok(workspace.itinerary?.days.some((day) => day.title === 'Agent recommendations'));
  await client
    .post(path(workspace, '/cruises/apply'))
    .send({ revision: oldRevision, cruise: draft })
    .expect(409);
  const publicPreview = (await client.get(path(workspace, '/proposal/preview')).expect(200)).body
    .proposal;
  assert.equal(
    publicPreview.items.find(
      (item: { kind: string; price: number }) => item.kind === 'cruise' && item.price === 4500,
    )?.price,
    4500,
  );
  assert.match(publicPreview.itinerary.notes.join(' '), /Full cruise fare/);
});

test('dated cruise days merge between land stays without replacing the declared origin flight', async () => {
  const { client } = setup();
  let workspace = await create(client);
  const land = manual();
  land.days = [
    { ...land.days[0], day: 1, date: '2027-09-30', title: 'Hong Kong before sailing' },
    { ...land.days[0], day: 2, date: '2027-10-04', title: 'Taipei land stay' },
  ];
  workspace = await patch(client, workspace, {
    brief: { outboundTransport: 'flight', returnTransport: 'flight' },
    itinerary: land,
  });
  const draft = { ...cruise(), returnTransport: 'undecided' as const };
  workspace = (
    await client
      .post(path(workspace, '/cruises/apply'))
      .send({ revision: workspace.revision, cruise: draft })
      .expect(200)
  ).body.workspace;
  assert.equal(workspace.brief.outboundTransport, 'flight');
  assert.equal(workspace.brief.returnTransport, 'flight');
  assert.deepEqual(
    workspace.itinerary?.days.map((day) => day.date),
    ['2027-09-30', '2027-10-01', '2027-10-02', '2027-10-03', '2027-10-04'],
  );
  assert.equal(workspace.itinerary?.days[2].title, 'At sea');
  assert.equal(workspace.items.find((item) => item.id === `cruise:${draft.id}`)?.price, 4500);
});

test('reapplying a cruise preserves edited cruise-day activities and updates the early-exit notice', async () => {
  const { client } = setup();
  let workspace = await create(client);
  const draft = { ...cruise(), disembarkAfterDay: null };
  workspace = (
    await client
      .post(path(workspace, '/cruises/apply'))
      .send({ revision: workspace.revision, cruise: draft })
      .expect(200)
  ).body.workspace;
  const plan = structuredClone(workspace.itinerary!);
  plan.days[2].activities.push({
    period: 'evening',
    title: 'Reviewed Taipei hotel transfer',
    description: 'Agent-arranged transfer details need reconfirmation.',
    sources: [],
  });
  workspace = await patch(client, workspace, { itinerary: plan });
  for (const selection of [draft, { ...draft, disembarkAfterDay: 3 }]) {
    workspace = (
      await client
        .post(path(workspace, '/cruises/apply'))
        .send({ revision: workspace.revision, cruise: selection })
        .expect(200)
    ).body.workspace;
    const day = workspace.itinerary!.days.find((day) => day.title === 'Taipei')!;
    assert.equal(
      day.activities.filter((activity) => activity.title === 'Reviewed Taipei hotel transfer')
        .length,
      1,
    );
  }
  assert.match(workspace.itinerary!.days.at(-1)!.summary, /Disembark here/);
  assert.equal(workspace.items.find((item) => item.id === `cruise:${draft.id}`)?.price, 4500);
  assert.equal(workspace.itinerary!.days.length, 3);
});

test('edited source cruise details refresh without silently deleting a manual activity', async () => {
  const { client } = setup();
  let workspace = await create(client);
  const draft = cruise();
  draft.days[2].id = '11111111-1111-4111-8111-111111111111';
  workspace = (
    await client
      .post(path(workspace, '/cruises/apply'))
      .send({ revision: workspace.revision, cruise: draft })
      .expect(200)
  ).body.workspace;
  const plan = structuredClone(workspace.itinerary!);
  plan.days[2].activities.push({
    period: 'evening',
    title: 'Manual dinner suggestion',
    description: 'Recheck after any port change.',
    sources: [],
  });
  workspace = await patch(client, workspace, { itinerary: plan });
  draft.days[2].details = 'Updated source disembarkation instructions.';
  workspace = (
    await client
      .post(path(workspace, '/cruises/apply'))
      .send({ revision: workspace.revision, cruise: draft })
      .expect(200)
  ).body.workspace;
  const activities = workspace.itinerary!.days[2].activities;
  assert.equal(activities.length, 2);
  assert.equal(activities[0].description, draft.days[2].details);
  assert.equal(activities[1].title, 'Manual dinner suggestion');
});

for (const legacy of [false, true]) {
  test(`redacted cruise row references preserve manual activities on source refresh (${legacy ? 'legacy rows' : 'stable rows'})`, async () => {
    const { app, client } = setup();
    let workspace = await create(client);
    const draft = cruise();
    draft.id = '77777777-7777-4777-8777-777777777777';
    draft.days[2].id = '11111111-1111-4111-8111-111111111111';
    workspace = (
      await client
        .post(path(workspace, '/cruises/apply'))
        .send({ revision: workspace.revision, cruise: draft })
        .expect(200)
    ).body.workspace;
    const plan = structuredClone(workspace.itinerary!);
    plan.days[2].activities.push({
      period: 'evening',
      title: 'Preserved manual dinner',
      description: 'Recheck when the source changes.',
      sources: [],
    });
    workspace = await patch(client, workspace, { itinerary: plan });
    const corrupted = structuredClone(workspace);
    corrupted.itinerary!.days[2].cruiseDayId = redactIdentityAndPayment(draft.days[2].id!);
    if (legacy) {
      for (const day of corrupted.cruises![0].days) delete day.id;
    } else {
      corrupted.itinerary!.days[2].cruiseId = redactIdentityAndPayment(draft.id);
    }
    app.locals.db
      .prepare('UPDATE studio_workspaces SET data=? WHERE id=?')
      .run(JSON.stringify(corrupted), workspace.id);
    workspace = (await client.get(path(workspace)).expect(200)).body.workspace;
    const source = structuredClone(workspace.cruises![0]);
    source.days[2].details = 'New reviewed disembarkation instructions.';
    workspace = (
      await client
        .post(path(workspace, '/cruises/apply'))
        .send({ revision: workspace.revision, cruise: source })
        .expect(200)
    ).body.workspace;
    const updated = workspace.itinerary!.days.find((day) => day.title === 'Taipei')!;
    assert.equal(updated.cruiseId, draft.id);
    assert.equal(updated.cruiseDayId, workspace.cruises![0].days[2].id);
    assert.equal(updated.activities.length, 2);
    assert.equal(updated.activities[0].description, source.days[2].details);
    assert.equal(updated.activities[1].title, 'Preserved manual dinner');
    assert.equal(workspace.items.find((item) => item.kind === 'cruise')!.price, draft.fullFare);
    assert.equal(workspace.proposal, null);
  });
}

for (const legacy of [false, true]) {
  test(`cruise reapply restores deleted and reordered rows without moving custom transfers (${legacy ? 'legacy' : 'stable identities'})`, async () => {
    const { app, client } = setup();
    let workspace = await create(client);
    workspace = (
      await client
        .post(path(workspace, '/cruises/apply'))
        .send({ revision: workspace.revision, cruise: cruise() })
        .expect(200)
    ).body.workspace;
    if (legacy) {
      // Simulate a saved workspace from before source-day identities were introduced.
      for (const day of workspace.cruises![0].days) delete day.id;
      for (const day of workspace.itinerary!.days) delete day.cruiseDayId;
      app.locals.db
        .prepare('UPDATE studio_workspaces SET data = ? WHERE id = ?')
        .run(JSON.stringify(workspace), workspace.id);
    }
    const source = structuredClone(workspace.cruises![0]);
    const edited = structuredClone(workspace.itinerary!);
    edited.days[2].activities.push({
      period: 'evening',
      title: 'Transfer to Taipei hotel',
      description: 'Separately reviewed land transfer; availability unconfirmed.',
      sources: [],
    });
    edited.days = [edited.days[2], edited.days[1]];
    workspace = await patch(client, workspace, { itinerary: edited });
    for (let attempt = 0; attempt < 2; attempt++) {
      workspace = (
        await client
          .post(path(workspace, '/cruises/apply'))
          .send({ revision: workspace.revision, cruise: source })
          .expect(200)
      ).body.workspace;
      assert.deepEqual(
        workspace.itinerary!.days.map((day) => day.title),
        ['Hong Kong', 'At sea', 'Taipei'],
      );
      assert.deepEqual(
        workspace.itinerary!.days.map((day) => day.date),
        ['2027-10-01', '2027-10-02', '2027-10-03'],
      );
      assert.deepEqual(
        workspace.itinerary!.days.flatMap((day) =>
          day.activities.some((activity) => activity.title === 'Transfer to Taipei hotel')
            ? [day.title]
            : [],
        ),
        ['Taipei'],
      );
      assert.equal(
        workspace.items.find((item) => item.kind === 'cruise' && item.price !== null)?.price,
        4500,
      );
      if (attempt === 0)
        workspace = await patch(client, workspace, {
          itinerary: { ...workspace.itinerary!, days: [...workspace.itinerary!.days].reverse() },
        });
    }
  });
}

test('source day deletion preserves the correct surviving manual activity and refreshes changed details', async () => {
  const { client } = setup();
  let workspace = await create(client);
  workspace = (
    await client
      .post(path(workspace, '/cruises/apply'))
      .send({ revision: workspace.revision, cruise: cruise() })
      .expect(200)
  ).body.workspace;
  const source = structuredClone(workspace.cruises![0]);
  const edited = structuredClone(workspace.itinerary!);
  edited.days[1].activities.push({
    period: 'flexible',
    title: 'Sea-day lunch',
    description: 'At sea only.',
    sources: [],
  });
  edited.days[2].activities.push({
    period: 'evening',
    title: 'Taipei hotel transfer',
    description: 'At Taipei only.',
    sources: [],
  });
  // A stable source identity must still find this row after its manual title/date change.
  edited.days[2].title = 'Reviewed hotel arrival';
  edited.days[2].date = '2027-10-04';
  workspace = await patch(client, workspace, { itinerary: edited });
  source.days = source.days
    .filter((_, index) => index !== 1)
    .map((day, index) => ({ ...day, day: index + 1 }));
  source.disembarkAfterDay = 2;
  source.days[1].details = 'Updated disembarkation instructions for Taipei.';
  workspace = (
    await client
      .post(path(workspace, '/cruises/apply'))
      .send({ revision: workspace.revision, cruise: source })
      .expect(200)
  ).body.workspace;
  assert.deepEqual(
    workspace.itinerary!.days.map((day) => day.title),
    ['Hong Kong', 'Taipei'],
  );
  assert.deepEqual(
    workspace.itinerary!.days[1].activities.map((activity) => activity.title),
    ['Cruise day details', 'Taipei hotel transfer'],
  );
  assert.equal(workspace.itinerary!.days[1].activities[0].description, source.days[1].details);
  assert.ok(
    !workspace.itinerary!.days.some((day) =>
      day.activities.some((activity) => activity.title === 'Sea-day lunch'),
    ),
  );
  assert.equal(workspace.itinerary!.days[1].cruiseDayId, source.days[1].id);
  assert.equal(
    workspace.items.find((item) => item.kind === 'cruise' && item.price !== null)?.price,
    4500,
  );
});

test('cruise dates without a year do not reorder an agent-reviewed manual sequence', async () => {
  const { client } = setup();
  let workspace = await create(client);
  workspace = await patch(client, workspace, { itinerary: manual() });
  const draft = cruise();
  draft.days[1].date = '2 October';
  workspace = (
    await client
      .post(path(workspace, '/cruises/apply'))
      .send({ revision: workspace.revision, cruise: draft })
      .expect(200)
  ).body.workspace;
  assert.equal(workspace.itinerary!.days[0].title, 'Agent recommendations');
  assert.deepEqual(
    workspace.itinerary!.days.slice(1).map((day) => day.title),
    ['Hong Kong', 'At sea', 'Taipei'],
  );
  assert.equal(workspace.itinerary!.days[2].date, '');
  assert.equal(workspace.brief.outboundTransport, 'undecided');
});

test('changing cruise disembarkation preserves arranged transport and requests route review', async () => {
  const { client } = setup();
  let workspace = await create(client);
  workspace = await patch(client, workspace, { itinerary: manual() });
  const draft = cruise();
  workspace = (
    await client
      .post(path(workspace, '/cruises/apply'))
      .send({ revision: workspace.revision, cruise: draft })
      .expect(200)
  ).body.workspace;
  workspace = (
    await client
      .post(path(workspace, '/accept-structure'))
      .send({ revision: workspace.revision })
      .expect(200)
  ).body.workspace;
  const flight = workspace.items.find((item) => item.kind === 'flight')!;
  Object.assign(flight, {
    title: 'Agent arranged flight',
    description: 'Transfer after cruise.',
    price: 600,
    cost: 450,
    priceStatus: 'agent_estimate',
    status: 'externally_booked',
    privateReference: 'EXTERNAL-123',
    supplier: 'Example Airline',
    startDate: '2027-10-03',
    endDate: '2027-10-03',
  });
  workspace = await patch(client, workspace, { items: workspace.items });
  const before = workspace.itinerary!.days.find((day) => !day.cruiseId)!;
  const oldStops = workspace.stops;
  draft.disembarkAfterDay = 1;
  workspace = (
    await client
      .post(path(workspace, '/cruises/apply'))
      .send({ revision: workspace.revision, cruise: draft })
      .expect(200)
  ).body.workspace;
  assert.equal(workspace.cruises?.[0].fullFare, 4500);
  assert.equal(workspace.items.find((item) => item.id === 'cruise:reviewed-cruise-1')?.price, 4500);
  assert.deepEqual(
    workspace.itinerary?.days.find((day) => !day.cruiseId),
    before,
  );
  assert.equal(workspace.itinerary?.days.filter((day) => day.cruiseId === draft.id).length, 1);
  assert.doesNotMatch(workspace.itinerary!.notes.join(' '), /Planned early disembarkation: Taipei/);
  assert.match(workspace.itinerary!.notes.join(' '), /Planned early disembarkation: Hong Kong/);
  const savedFlight = workspace.items.find((item) => item.id === flight.id)!;
  assert.equal(savedFlight.title, 'Agent arranged flight');
  assert.equal(savedFlight.price, 600);
  assert.equal(savedFlight.cost, 450);
  assert.equal(savedFlight.status, 'externally_booked');
  assert.equal(savedFlight.privateReference, 'EXTERNAL-123');
  assert.equal(savedFlight.needsReview, true);
  assert.equal(workspace.structureAccepted, false);
  assert.equal(workspace.stage, 'structure');
  assert.deepEqual(workspace.stops, oldStops);
  assert.match(workspace.itinerary!.notes.join(' '), /review|reconcile/i);
});

test('manual cruise day edits and deletions retain the full fare without claiming new source evidence', async () => {
  const { client } = setup();
  let workspace = await create(client);
  const draft = cruise();
  workspace = (
    await client
      .post(path(workspace, '/cruises/apply'))
      .send({ revision: workspace.revision, cruise: draft })
      .expect(200)
  ).body.workspace;
  const storedDraft = structuredClone(workspace.cruises?.[0]);
  const edited = structuredClone(workspace.itinerary!);
  edited.days.splice(1, 1);
  edited.days[1].activities[0].description = 'A new recommendation personally added by the agent.';
  edited.days[1].activities[0].sources = [
    { label: 'Claimed cruise source', url: 'https://cruise.example/itinerary', checkedAt: now },
  ];
  workspace = await patch(client, workspace, { itinerary: edited });
  assert.equal(workspace.itinerary?.days.length, 2);
  assert.deepEqual(workspace.itinerary?.days[1].activities[0].sources, []);
  assert.equal(
    workspace.itinerary?.days[1].activities[0].description,
    'A new recommendation personally added by the agent.',
  );
  assert.deepEqual(workspace.cruises?.[0], storedDraft);
  assert.equal(workspace.items.find((item) => item.id === 'cruise:reviewed-cruise-1')?.price, 4500);
  assert.deepEqual(
    workspace.itinerary?.days.map((day) => day.day),
    [1, 2],
  );
});

function mockOpenAI(data: unknown, urls: string[] = []) {
  return Response.json({
    status: 'completed',
    output: [
      ...(urls.length
        ? [
            {
              type: 'web_search_call',
              status: 'completed',
              action: { sources: urls.map((url) => ({ url, title: 'Research source' })) },
            },
          ]
        : []),
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
    ],
  });
}

test('cruise preview is a source-grounded draft and does not apply or book it', async () => {
  const { client } = setup();
  let workspace = await create(client);
  process.env.OPENAI_API_KEY = 'mock-builder-preview';
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(options?.body));
    assert.equal(body.text.format.name, 'studio_cruise_import');
    assert.equal(body.tools, undefined);
    assert.doesNotMatch(body.input[0].content, /ABC123456/);
    return mockOpenAI({
      name: 'Pacific cruise',
      ship: '',
      currency: 'USD',
      fullFare: 4500,
      days: [
        {
          day: 1,
          date: '2027-10-01',
          port: 'Taipei',
          arrival: '',
          departure: '17:00',
          details: '',
          sourceExcerpt: 'Day 1: 2027-10-01 Taipei departure 17:00',
        },
      ],
      warnings: [],
    });
  };
  const response = await client
    .post(path(workspace, '/cruises/preview'))
    .send({
      revision: workspace.revision,
      requestId: randomUUID(),
      input: {
        kind: 'text',
        name: 'Cruise source',
        text: 'Pacific cruise. Full fare USD 4500.\nDay 1: 2027-10-01 Taipei departure 17:00\nPassport number: ABC123456',
      },
    })
    .expect(200);
  workspace = response.body.workspace;
  assert.equal(response.body.cruise.days[0].port, 'Taipei');
  assert.equal(workspace.cruises?.length, 0);
  assert.equal(workspace.items.length, 0);
  assert.equal(workspace.itinerary, null);
});

test('research routes use private returning-client history without photo or identity and require a chosen destination for visa checks', async () => {
  const { client, stranger } = setup();
  const profile = (
    await client.post('/api/studio/client-profiles').send(profileInput()).expect(201)
  ).body.client;
  let workspace = await create(client);
  workspace = await patch(client, workspace, {
    brief: {
      clientId: profile.id,
      clientName: 'PRIVATE CLIENT NAME',
      passportNationality: 'PK',
      tripPurpose: 'tourism',
      startDate: '2027-04-01',
      endDate: '2027-04-10',
      interests: ['Culture'],
    },
  });
  await client
    .post(path(workspace, '/entry-requirements'))
    .send({ revision: workspace.revision, requestId: randomUUID() })
    .expect(400);
  process.env.OPENAI_API_KEY = 'mock-builder-research';
  const today = new Date().toISOString();
  const advisory = 'https://www.gov.uk/foreign-travel-advice/japan';
  const conditions = 'https://www.jma.go.jp/jma/en/Activities/earthquake.html';
  const immigration = 'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html';
  const calls: string[] = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://www.gov.uk/api/content/foreign-travel-advice/'))
      return Response.json({
        document_type: 'travel_advice',
        public_updated_at: today,
        details: {
          country: { name: 'Japan', slug: 'japan' },
          alert_status: [],
          summary: '<p>Read local guidance.</p>',
          reviewed_at: today,
        },
      });
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(options?.body));
    const name = body.text.format.name;
    calls.push(name);
    assert.doesNotMatch(
      body.input[0].content,
      /PRIVATE CLIENT NAME|John Example|photoDataUrl|dateOfBirth|1990-02-04|iVBOR|ABC123456/,
    );
    assert.equal(body.tools[0].type, 'web_search');
    const payload = JSON.parse(body.input[0].content);
    if (name === 'studio_destination_research') {
      assert.equal(payload.travelHistory[0].destination, 'London');
      assert.equal(payload.travelHistory[0].feedback, 'liked');
      assert.equal(payload.travelHistory[0].notes, 'Enjoyed quiet museums');
      assert.equal(payload.travelHistory[0].experience, 'visited');
      return mockOpenAI(
        {
          candidates: [
            {
              destination: 'Tokyo',
              countryCode: 'JP',
              reason: 'Culture and gardens.',
              suggestedDays: 8,
              thingsToDo: ['Explore public gardens'],
              conditions: 'Check current local notices.',
              seasonalGuidance: 'Spring seasonal guidance, not a forecast.',
              currentDisruption: false,
              conditionsVerified: true,
              advisoryUrl: advisory,
              sources: [{ url: conditions, publishedAt: today }],
            },
          ],
          notes: [],
        },
        [advisory, conditions],
      );
    }
    assert.equal(name, 'studio_entry_requirements');
    assert.equal(payload.trip.passportCountryCode, 'PK');
    assert.equal(payload.trip.destinationCountryCode, 'JP');
    return mockOpenAI(
      {
        passportCountryCode: 'PK',
        destinationCountryCode: 'JP',
        summary: 'Tourist visa required.',
        conditions: ['Confirm current permitted stay.'],
        electronicAuthorisation: '',
        observations: [
          {
            category: 'visa_required',
            summary: 'Apply before departure.',
            sourceUrl: immigration,
            kind: 'official_immigration',
            passportCountryCode: 'PK',
            destinationCountryCode: 'JP',
            publishedAt: today,
            appliesToTrip: true,
          },
        ],
        notes: [],
      },
      [immigration],
    );
  };
  await stranger
    .post(path(workspace, '/destinations/research'))
    .send({ revision: workspace.revision, requestId: randomUUID() })
    .expect(404);
  const researched = await client
    .post(path(workspace, '/destinations/research'))
    .send({ revision: workspace.revision, requestId: randomUUID() })
    .expect(200);
  workspace = researched.body.workspace;
  assert.equal(workspace.destinationResearch?.historyUsed, true);
  assert.equal(workspace.destinationResearch?.candidates[0].recommendable, true);
  assert.equal(workspace.brief.preferredDestination, '');
  assert.equal(workspace.stops.length, 0);
  workspace = await patch(client, workspace, {
    brief: { preferredDestination: 'Tokyo', destinationCountry: 'JP' },
  });
  const checked = await client
    .post(path(workspace, '/entry-requirements'))
    .send({ revision: workspace.revision, requestId: randomUUID() })
    .expect(200);
  workspace = checked.body.workspace;
  assert.equal(workspace.entryRequirements?.[0].category, 'visa_required');
  assert.deepEqual(calls, ['studio_destination_research', 'studio_entry_requirements']);
});

test('client birth date and country fields validate without changing passport nationality', async () => {
  const { client } = setup();
  for (const dateOfBirth of ['2025-02-30', '2099-01-01', 'yesterday', '1990-2-4'])
    await client
      .post('/api/studio/client-profiles')
      .send({ ...profileInput(), dateOfBirth })
      .expect(400);
  for (const field of ['country', 'nationality'])
    await client
      .post('/api/studio/client-profiles')
      .send({ ...profileInput(), [field]: 'not a country' })
      .expect(400);
  const profile = (
    await client
      .post('/api/studio/client-profiles')
      .send({ ...profileInput(), dateOfBirth: '2000-02-29', nationality: '', country: '' })
      .expect(201)
  ).body.client;
  assert.equal(profile.dateOfBirth, '2000-02-29');
  assert.equal(profile.passportNationality, 'PK');
  const listed = (await client.get('/api/studio/client-profiles').expect(200)).body.clients[0];
  assert.deepEqual(listed.dateOfBirth, profile.dateOfBirth);
});

test('recommendation history combines owned past plans with explicit feedback without assuming visits', async () => {
  const { client, stranger } = setup();
  const profile = (
    await client
      .post('/api/studio/client-profiles')
      .send({
        ...profileInput(),
        history: [
          {
            destination: 'London',
            country: 'GB',
            visitedAt: '2025-06-04',
            interests: ['Art'],
            feedback: 'liked',
            notes: 'Loved small galleries',
            experience: 'visited',
          },
        ],
      })
      .expect(201)
  ).body.client;
  const addTrip = async (name: string, country: string, startDate: string, endDate: string) => {
    let w = await create(client);
    w = await patch(client, w, {
      brief: { clientId: profile.id, startDate, endDate, interests: ['Architecture'] },
      stops: [
        {
          id: randomUUID(),
          name,
          country,
          nights: 3,
          arrivalDate: startDate,
          departureDate: endDate,
          arrivalFixed: true,
          onwardTransport: 'undecided',
          neighbourhood: '',
          notes: '',
        },
      ],
    });
    return w;
  };
  await addTrip('London', 'GB', '2025-06-01', '2025-06-04');
  await addTrip('Paris', 'FR', '2025-07-01', '2025-07-04');
  const current = await addTrip('Tokyo', 'JP', '2025-08-01', '2025-08-04');
  await addTrip('Rome', 'IT', '2099-09-01', '2099-09-04');
  const endpoint = `/api/studio/client-profiles/${profile.id}/history?workspaceId=${current.id}`;
  await stranger.get(endpoint).expect(404);
  const history = (await client.get(endpoint).expect(200)).body.history;
  assert.equal(history.length, 2);
  assert.deepEqual(
    history.find((h: any) => h.destination === 'London'),
    profile.history[0],
  );
  assert.equal(history.find((h: any) => h.destination === 'Paris').experience, 'planned');
  assert.doesNotMatch(JSON.stringify(history), /John Example|1990-02-04|iVBOR|Tokyo|Rome/);
  await client.delete(`/api/studio/client-profiles/${profile.id}`).expect(204);
  await client.get(endpoint).expect(404);
});
