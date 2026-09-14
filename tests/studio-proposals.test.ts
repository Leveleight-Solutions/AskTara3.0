import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { defaultStudioAgency, type StudioItem } from '../shared/studio.ts';
import { studioProposalIsStale } from '../shared/studio-proposals.ts';
import {
  buildStudioClientProposal,
  initializeStudioProposalStorage,
  installStudioProposalRoutes,
  studioProposalPdf,
} from '../server/studio-proposals.ts';
import {
  initializeStudioStorage,
  newStudioWorkspace,
  StudioStore,
} from '../server/studio-store.ts';

const databases: DatabaseSync[] = [];
after(() => {
  for (const db of databases) db.close();
});
function fixture() {
  const workspace = newStudioWorkspace();
  workspace.title = 'A considered European journey';
  workspace.structureAccepted = true;
  workspace.brief.clientName = 'Fictional client';
  workspace.brief.context = 'PRIVATE_CONTEXT medically confidential details';
  workspace.brief.request = 'PRIVATE_REQUEST';
  workspace.brief.requirements = ['PRIVATE_MEDICAL_NOTE'];
  workspace.brief.startDate = '2026-11-18';
  workspace.brief.endDate = '2026-11-24';
  workspace.brief.adults = 2;
  workspace.stops = [
    {
      id: 'paris',
      name: 'Paris',
      country: 'France',
      nights: 6,
      arrivalDate: '2026-11-18',
      departureDate: '2026-11-24',
      onwardTransport: 'undecided',
      neighbourhood: 'Left Bank',
      notes: 'PRIVATE_STOP_NOTE',
    },
  ];
  workspace.imports = [
    {
      id: 'i1',
      kind: 'text',
      name: 'PRIVATE_IMPORT_NAME',
      text: 'PRIVATE_IMPORT_DOCUMENT',
      createdAt: '2026-09-14',
      sourceUrl: 'https://supplier.example/reservation/SECRET123',
      warnings: [],
    },
  ];
  workspace.messages = [
    { id: 'm1', role: 'user', content: 'PRIVATE_CHAT', createdAt: '2026-09-14' },
  ];
  workspace.items = [item()];
  return workspace;
}
function item(overrides: Partial<StudioItem> = {}): StudioItem {
  return {
    id: 'h1',
    kind: 'hotel',
    title: 'A quiet boutique hotel',
    description: 'Breakfast included. Booking reference: SECRET123',
    stopId: 'paris',
    startDate: '2026-11-18',
    endDate: '2026-11-24',
    status: 'suggested',
    source: 'manual',
    sourceUrl: 'https://supplier.example/booking/SECRET123?auth=PRIVATE_AUTH',
    supplier: 'PRIVATE_SUPPLIER',
    privateReference: 'SECRET123',
    price: 1600,
    currency: 'AUD',
    priceStatus: 'agent_estimate',
    quotedAt: '2026-09-14T12:00:00.000Z',
    included: true,
    needsReview: false,
    cost: 1253.17,
    ...overrides,
  };
}
function server() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec('PRAGMA foreign_keys = ON');
  initializeStudioStorage(db);
  initializeStudioProposalStorage(db);
  const store = new StudioStore(db),
    app = express();
  app.use(express.json());
  const workspace = store.create('alice', fixture());
  app.use((req, res, next) => {
    res.locals.owner = req.get('x-owner') || 'alice';
    next();
  });
  installStudioProposalRoutes(app, {
    db,
    store,
    session: (res) => ({ owner_id: res.locals.owner }),
    requireActiveSession: () => {},
  });
  app.use(
    (error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(error.status || 400).json({ error: error.message });
    },
  );
  return { app, db, store, workspace };
}

test('client snapshot excludes private workspace and supplier fields; selected descriptions redact references', () => {
  const workspace = fixture(),
    agency = {
      ...defaultStudioAgency(),
      customQuestions: ['PRIVATE_QUESTION'],
      gds: 'sabre' as const,
      paymentCostPercent: 2.7,
    };
  workspace.pricing.marginPercent = 38.2;
  workspace.items.push(item({ id: 'hidden', title: 'PRIVATE_UNSELECTED', included: false }));
  workspace.recommendations = [
    {
      id: 'r1',
      stopId: 'paris',
      name: 'A riverside walk',
      category: 'activity',
      description: 'Enjoy the city at your own pace.',
      included: true,
      sources: [
        {
          label: 'Official visitor information',
          url: 'https://paris.example/visit?tracking=PRIVATE_TRACKING',
          checkedAt: '2026-09-14',
        },
        {
          label: 'Private supplier portal',
          url: 'https://supplier.example/reservation/SECRET123',
          checkedAt: '2026-09-14',
        },
      ],
    },
  ];
  const proposal = buildStudioClientProposal(workspace, agency, new Date('2026-09-14T12:00:00Z'));
  const serialised = JSON.stringify(proposal);
  assert.doesNotMatch(
    serialised,
    /PRIVATE_|SECRET123|1253\.17|38\.2|paymentCostPercent|privateReference|childAges|customQuestions|cost|messages|imports|gds/,
  );
  assert.equal(proposal.items.length, 1);
  assert.match(proposal.items[0].description, /removed/);
  assert.equal(proposal.recommendations[0].sources.length, 1);
  assert.equal(proposal.recommendations[0].sources[0].url, 'https://paris.example/visit');
});

test('pricing never mixes currencies or counts sandbox rates as live totals', () => {
  const workspace = fixture();
  workspace.items = [
    item({ price: 1600 }),
    item({ id: 'eur', currency: 'EUR', price: 200, priceStatus: 'supplier_quote' }),
    item({ id: 'test', currency: 'AUD', price: 999999, priceStatus: 'sandbox' }),
    item({ id: 'unknown', price: null, priceStatus: 'unpriced' }),
  ];
  const proposal = buildStudioClientProposal(
    workspace,
    defaultStudioAgency(),
    new Date('2026-09-14T12:00:00Z'),
  );
  assert.deepEqual(proposal.pricing.totals, [
    { currency: 'AUD', amount: 1600, containsEstimates: true },
    { currency: 'EUR', amount: 200, containsEstimates: false },
  ]);
  assert.equal(proposal.pricing.sandboxCount, 1);
  assert.equal(proposal.pricing.unpricedCount, 1);
  workspace.pricing = { ...workspace.pricing, mode: 'package', packagePrice: 18500 };
  const packaged = buildStudioClientProposal(workspace, defaultStudioAgency());
  assert.equal(packaged.pricing.packagePrice, 18500);
  assert.deepEqual(packaged.pricing.totals, []);
  assert.ok(packaged.items.every((service) => service.price === null));
  assert.equal(packaged.pricing.sandboxCount, 1);
});

test('default validity is 48 hours and old or undated supplier quotes are not refreshed by publication', () => {
  const workspace = fixture(),
    now = new Date('2026-09-14T12:00:00Z');
  let proposal = buildStudioClientProposal(workspace, defaultStudioAgency(), now);
  assert.equal(proposal.validUntil, '2026-09-16T12:00:00.000Z');
  assert.equal(studioProposalIsStale(proposal, now.getTime()), false);
  assert.equal(studioProposalIsStale(proposal, Date.parse(proposal.validUntil)), true);
  workspace.items[0].priceStatus = 'supplier_quote';
  workspace.items[0].quotedAt = '2026-09-10T12:00:00Z';
  proposal = buildStudioClientProposal(workspace, defaultStudioAgency(), now);
  assert.equal(studioProposalIsStale(proposal, now.getTime()), true);
  workspace.items[0].quotedAt = '';
  assert.equal(
    studioProposalIsStale(
      buildStudioClientProposal(workspace, defaultStudioAgency(), now),
      now.getTime(),
    ),
    true,
  );
});

test('publication is explicit, owner isolated, immutable, version checked and revocable', async () => {
  const { app, workspace, store, db } = server(),
    path = `/api/studio/workspaces/${workspace.id}/proposal`;
  await request(app).get(`${path}/preview`).set('x-owner', 'bob').expect(404);
  await request(app)
    .post(path)
    .set('x-owner', 'bob')
    .send({ revision: workspace.revision })
    .expect(404);
  const preview = await request(app).get(`${path}/preview`).expect(200);
  assert.equal(preview.body.proposal.title, workspace.title);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM studio_proposals').get()?.n, 0);
  const published = await request(app)
    .post(path)
    .send({ revision: workspace.revision })
    .expect(201);
  const token = published.body.proposal.token,
    publicPath = `/api/studio/proposals/${token}`;
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.match(published.body.proposal.url, /^\/proposal\/asktara\//);
  await request(app).get(publicPath).set('x-owner', 'bob').expect(200);
  const saved = store.require('alice', workspace.id);
  saved.title = 'Edited privately';
  store.save('alice', saved, saved.revision);
  const stillOld = await request(app).get(publicPath).expect(200);
  assert.equal(stillOld.body.proposal.title, workspace.title);
  await request(app).delete(path).send({ revision: 1 }).expect(409);
  await request(app).get(publicPath).expect(200);
  await request(app).post(path).send({ revision: 1 }).expect(409);
  const republished = await request(app).post(path).send({ revision: saved.revision }).expect(201);
  assert.notEqual(republished.body.proposal.token, token);
  await request(app).get(publicPath).expect(404);
  const newPath = `/api/studio/proposals/${republished.body.proposal.token}`;
  assert.equal(
    (await request(app).get(newPath).expect(200)).body.proposal.title,
    'Edited privately',
  );
  await request(app)
    .delete(path)
    .set('x-owner', 'bob')
    .send({ revision: republished.body.workspace.revision })
    .expect(404);
  await request(app)
    .delete(path)
    .send({ revision: republished.body.workspace.revision })
    .expect(200);
  await request(app).get(newPath).expect(404);
  await request(app).get(`${newPath}/pdf`).expect(404);
});

test('publishing blocks unaccepted structures, unreviewed imports and missing package totals', async () => {
  const { app, workspace, store } = server(),
    path = `/api/studio/workspaces/${workspace.id}/proposal`;
  let saved = store.require('alice', workspace.id);
  saved.structureAccepted = false;
  store.save('alice', saved, saved.revision);
  await request(app).post(path).send({ revision: saved.revision }).expect(400);
  saved.structureAccepted = true;
  saved.items[0].needsReview = true;
  store.save('alice', saved, saved.revision);
  await request(app).post(path).send({ revision: saved.revision }).expect(400);
  saved.items[0].needsReview = false;
  saved.pricing.mode = 'package';
  store.save('alice', saved, saved.revision);
  await request(app).post(path).send({ revision: saved.revision }).expect(400);
  assert.equal(store.require('alice', workspace.id).proposal, null);
});

test('real PDF output contains multiple pages when needed and works through public and private routes', async () => {
  const { app, workspace, store } = server(),
    path = `/api/studio/workspaces/${workspace.id}/proposal`;
  const saved = store.require('alice', workspace.id);
  saved.title = 'A thoughtful trip to 京都 and São Paulo';
  saved.items = Array.from({ length: 25 }, (_, index) =>
    item({
      id: `h${index}`,
      title: `Selected hotel ${index}`,
      description: 'A detailed and carefully selected service for this trip. '.repeat(6),
    }),
  );
  store.save('alice', saved, saved.revision);
  const proposal = buildStudioClientProposal(saved, defaultStudioAgency());
  const pdf = await studioProposalPdf(proposal);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.subarray(-80).toString(), /%%EOF/);
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length > 1);
  assert.doesNotMatch(pdf.toString('latin1'), /PRIVATE_CONTEXT|PRIVATE_IMPORT_DOCUMENT|SECRET123/);
  const download = await request(app)
    .get(`${path}/preview/pdf`)
    .expect(200)
    .expect('Content-Type', /application\/pdf/);
  assert.match(download.headers['content-disposition'], /attachment/);
  const published = await request(app).post(path).send({ revision: saved.revision }).expect(201);
  await request(app)
    .get(`/api/studio/proposals/${published.body.proposal.token}/pdf`)
    .set('x-owner', 'bob')
    .expect(200)
    .expect('Content-Type', /application\/pdf/);
  store.delete('alice', workspace.id);
  await request(app).get(`/api/studio/proposals/${published.body.proposal.token}`).expect(404);
});

test('publication failure rolls back the old link revocation', async () => {
  const { app, workspace, db } = server(),
    path = `/api/studio/workspaces/${workspace.id}/proposal`;
  const published = await request(app)
    .post(path)
    .send({ revision: workspace.revision })
    .expect(201);
  db.exec(
    "CREATE TRIGGER reject_proposal_insert BEFORE INSERT ON studio_proposals BEGIN SELECT RAISE(ABORT, 'Synthetic transaction failure'); END;",
  );
  await request(app).post(path).send({ revision: published.body.workspace.revision }).expect(400);
  await request(app).get(`/api/studio/proposals/${published.body.proposal.token}`).expect(200);
});
