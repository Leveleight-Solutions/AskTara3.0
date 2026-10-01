import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Express, Request, RequestHandler, Response } from 'express';
import { defaultStudioAgency, type StudioBrief, type StudioItem } from '../shared/studio.ts';
import { applyStudioPatch } from '../server/studio-domain.ts';
import { groundedStudioBrief } from '../server/studio-grounding.ts';
import { installStudioSupplierRoutes, studioQuoteFingerprint } from '../server/studio-suppliers.ts';
import {
  initializeStudioStorage,
  newStudioWorkspace,
  StudioError,
  StudioStore,
} from '../server/studio-store.ts';

// Exercise the registered quote-selection handler against actual persisted
// quote rows, without a provider request or a listening network socket.
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const agency = defaultStudioAgency();
function item(kind: StudioItem['kind']): StudioItem {
  return {
    id: randomUUID(),
    kind,
    title: `Synthetic ${kind}`,
    description: 'Fictional test service',
    stopId: 'lisbon',
    startDate: '2027-04-10',
    endDate: '2027-04-15',
    status: 'suggested',
    source: kind === 'flight' || kind === 'hotel' ? 'liteapi' : 'manual',
    sourceUrl: '',
    supplier: 'Test supplier',
    privateReference: '',
    price: 100,
    currency: 'AUD',
    priceStatus: 'sandbox',
    quotedAt: new Date().toISOString(),
    included: true,
    needsReview: false,
    cost: null,
  };
}
function setup() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  initializeStudioStorage(db);
  const store = new StudioStore(db);
  const workspace = newStudioWorkspace();
  applyStudioPatch(
    workspace,
    {
      revision: workspace.revision,
      brief: {
        origin: 'Sydney',
        cabin: 'Economy',
        adults: 1,
        children: 0,
        startDate: '2027-04-10',
        endDate: '2027-04-15',
        departureDate: '2027-04-09',
        outboundTransport: 'flight',
        returnTransport: 'flight',
      },
      stops: [
        {
          id: 'lisbon',
          name: 'Lisbon',
          country: 'Portugal',
          nights: 5,
          arrivalDate: '',
          departureDate: '',
          onwardTransport: 'undecided',
          neighbourhood: '',
          notes: '',
        },
      ],
    },
    agency,
  );
  workspace.structureAccepted = true;
  workspace.items = (['flight', 'cruise', 'transfer', 'hotel', 'tour', 'insurance'] as const).map(
    item,
  );
  store.create('owner', workspace);
  const handlers = new Map<string, RequestHandler>();
  const app = {
    post: (path: string, handler: RequestHandler) => handlers.set(path, handler),
  } as unknown as Express;
  let activeChecks = 0;
  installStudioSupplierRoutes(app, {
    db,
    store,
    session: () => ({ owner_id: 'owner' }),
    requireActiveSession: () => {
      activeChecks++;
    },
  });
  function cache(kind: StudioItem['kind']) {
    const quote = { ...item(kind), included: false };
    db.prepare(
      'INSERT INTO studio_quotes(id,owner_id,workspace_id,structure,data,created_at) VALUES(?,?,?,?,?,?)',
    ).run(
      quote.id,
      'owner',
      workspace.id,
      JSON.stringify({
        fingerprint: studioQuoteFingerprint(workspace),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
      JSON.stringify(quote),
      new Date().toISOString(),
    );
    return quote;
  }
  async function select(quote: StudioItem) {
    let body: unknown;
    const handler = handlers.get('/api/studio/workspaces/:id/quotes/:quoteId')!;
    await handler(
      {
        params: { id: workspace.id, quoteId: quote.id },
        body: { revision: workspace.revision },
      } as unknown as Request,
      {
        json: (value: unknown) => {
          body = value;
        },
      } as Response,
      (error?: unknown) => {
        if (error) throw error;
      },
    );
    return body;
  }
  function patch(brief: Partial<StudioBrief>) {
    applyStudioPatch(workspace, { revision: workspace.revision, brief }, agency);
    store.save('owner', workspace, workspace.revision);
  }
  return { workspace, store, cache, select, patch, activeChecks: () => activeChecks };
}

for (const [name, brief, cabinOnly] of [
  ['origin', { origin: 'Melbourne' }, false],
  ['origin departure date', { departureDate: '2027-04-08' }, false],
  ['outbound mode', { outboundTransport: 'cruise' }, false],
  ['return mode', { returnTransport: 'undecided' }, false],
  ['flight cabin', { cabin: 'Business' }, true],
] as const)
  test(`transport correction invalidates selected services and persisted quotes after changing ${name}`, async () => {
    const { workspace, cache, select, patch, activeChecks } = setup();
    const quote = cache('flight');
    const route = structuredClone(workspace.stops);
    patch(brief);
    assert.equal(workspace.items.find((entry) => entry.kind === 'flight')?.needsReview, true);
    for (const kind of ['cruise', 'transfer'])
      assert.equal(workspace.items.find((entry) => entry.kind === kind)?.needsReview, !cabinOnly);
    for (const kind of ['hotel', 'tour', 'insurance'])
      assert.equal(workspace.items.find((entry) => entry.kind === kind)?.needsReview, false);
    assert.deepEqual(workspace.stops, route);
    assert.equal(workspace.structureAccepted, true);
    assert.ok(
      workspace.items.every((entry) => entry.included),
      'Existing selections remain visible for explicit review.',
    );
    await assert.rejects(
      () => select(quote),
      (error: unknown) =>
        error instanceof StudioError && error.status === 409 && /changed/.test(error.message),
    );
    assert.equal(activeChecks(), 0, 'An invalidated cached quote cannot be selected.');
  });

test('a grounded one-way correction marks an existing return-flight service for review', () => {
  const { workspace, patch } = setup();
  const message = 'Make this one way. No return flight.';
  const next = groundedStudioBrief(
    workspace.brief,
    { ...workspace.brief, returnTransport: 'undecided' },
    [{ field: 'returnTransport', evidence: message }],
    message,
    [],
  );
  patch(next);
  assert.equal(workspace.brief.returnTransport, 'undecided');
  assert.equal(workspace.items.find((entry) => entry.kind === 'flight')?.needsReview, true);
  assert.equal(workspace.items.find((entry) => entry.kind === 'hotel')?.needsReview, false);
});

test('ordinary interests and idempotent transport edits retain reviewed services and cached hotel quote eligibility', async () => {
  const { workspace, cache, select, patch, store, activeChecks } = setup();
  const quote = cache('hotel');
  const before = studioQuoteFingerprint(workspace);
  patch({
    interests: ['gentle gardens'],
    origin: workspace.brief.origin,
    departureDate: workspace.brief.departureDate,
    outboundTransport: 'flight',
    returnTransport: 'flight',
    cabin: 'Economy',
  });
  assert.equal(studioQuoteFingerprint(workspace), before);
  assert.ok(workspace.items.every((entry) => !entry.needsReview));
  await select(quote);
  assert.equal(activeChecks(), 1);
  const selected = store
    .require('owner', workspace.id)
    .items.find((entry) => entry.id === quote.id);
  assert.equal(selected?.included, true);
  assert.equal(selected?.needsReview, false);
});
