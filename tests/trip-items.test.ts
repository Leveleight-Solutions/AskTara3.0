import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../server/app.ts';
import { experiences, stays } from '../shared/catalog.ts';
import type { Trip } from '../shared/types.ts';

delete process.env.OPENAI_API_KEY;
delete process.env.GOOGLE_PLACES_API_KEY;
const experience = experiences.find((e) => e.destinationId === 'kyoto')!;
async function setup(destination = 'Kyoto') {
  const app = createApp(':memory:');
  const client = request.agent(app);
  await client.get('/api/session').expect(200);
  const initial = (
    await client
      .post('/api/chat')
      .send({
        message: `Plan 3 days in ${destination} starting 2027-11-18 for 2 adults. Total budget USD 2500. I enjoy food and culture. No flights needed. No hotels needed.`,
      })
      .expect(200)
  ).body.trip as Trip;
  assert.equal(initial.itinerary.length, 3, 'Catalog insertion fixtures require a built itinerary');
  const trip = (
    await client
      .patch(`/api/trips/${initial.id}`)
      .send({
        revision: initial.revision,
        itinerary: initial.itinerary.map((day) => ({ ...day, items: [] })),
      })
      .expect(200)
  ).body.trip as Trip;
  const body = {
    kind: 'experience',
    itemId: experience.id,
    day: 1,
    time: '10:00',
    revision: trip.revision,
    requestId: randomUUID(),
  };
  return { app, client, trip, body };
}

test('adding catalog inspiration updates the existing trip, protects the stop, refreshes its budget and deduplicates retries', async () => {
  const { app, client, trip, body } = await setup();
  try {
    const first = (await client.post(`/api/trips/${trip.id}/items`).send(body).expect(201)).body;
    assert.equal(first.item.title, experience.name);
    assert.equal(first.item.locked, true);
    assert.equal(first.item.cost, experience.price);
    assert.equal(first.trip.planning.budget.activities, experience.price * trip.travelers);
    assert.equal(first.trip.revision, trip.revision! + 1);
    const repeated = (await client.post(`/api/trips/${trip.id}/items`).send(body).expect(201)).body;
    assert.equal(repeated.alreadyAdded, true);
    assert.equal(repeated.trip.revision, first.trip.revision);
    assert.equal(repeated.trip.itinerary[0].items.length, 1);
    assert.equal((await client.get('/api/trips')).body.trips.length, 1);
    const history = (await client.get(`/api/trips/${trip.id}/revisions`)).body.revisions;
    assert.ok(history.some((r: { reason: string }) => r.reason.includes('experience')));
  } finally {
    app.locals.db.close();
  }
});

test('a five-hour catalog experience keeps its full duration and travel buffer', async () => {
  const { app, client, trip, body } = await setup('Dolomites');
  try {
    const hike = experiences.find((item) => item.destinationId === 'dolomites')!;
    const added = (
      await client
        .post(`/api/trips/${trip.id}/items`)
        .send({
          ...body,
          itemId: hike.id,
        })
        .expect(201)
    ).body;
    assert.equal(added.item.durationMinutes, 300);
    const stay = stays.find((item) => item.destinationId === 'dolomites')!;
    const reminder = {
      ...body,
      kind: 'stay',
      itemId: stay.id,
      revision: added.trip.revision,
      requestId: randomUUID(),
    };
    await client
      .post(`/api/trips/${trip.id}/items`)
      .send({ ...reminder, time: '14:30' })
      .expect(409);
    await client
      .post(`/api/trips/${trip.id}/items`)
      .send({ ...reminder, time: '15:15' })
      .expect(201);
  } finally {
    app.locals.db.close();
  }
});

test('inspiration insertion rejects other owners, stale versions, wrong destinations and altered retry payloads', async () => {
  const { app, client, trip, body } = await setup();
  try {
    const stranger = request.agent(app);
    await stranger.get('/api/session');
    await stranger.post(`/api/trips/${trip.id}/items`).send(body).expect(404);
    await client
      .post(`/api/trips/${trip.id}/items`)
      .send({ ...body, revision: 0 })
      .expect(409);
    const foreign = experiences.find((e) => e.destinationId !== 'kyoto')!;
    await client
      .post(`/api/trips/${trip.id}/items`)
      .send({ ...body, itemId: foreign.id })
      .expect(400);
    await client.post(`/api/trips/${trip.id}/items`).send(body).expect(201);
    await client
      .post(`/api/trips/${trip.id}/items`)
      .send({ ...body, time: '11:00' })
      .expect(409);
    assert.equal(
      (await client.get(`/api/trips/${trip.id}`)).body.trip.itinerary[0].items.length,
      1,
    );
  } finally {
    app.locals.db.close();
  }
});

test('adding a stay idea preserves room-pricing scope and rejects overlapping stops', async () => {
  const { app, client, trip, body } = await setup();
  try {
    const added = (await client.post(`/api/trips/${trip.id}/items`).send(body).expect(201)).body;
    const stay = stays.find((s) => s.destinationId === 'kyoto')!;
    const next = {
      ...body,
      kind: 'stay',
      itemId: stay.id,
      revision: added.trip.revision,
      requestId: randomUUID(),
    };
    await client.post(`/api/trips/${trip.id}/items`).send(next).expect(409);
    const response = (
      await client
        .post(`/api/trips/${trip.id}/items`)
        .send({ ...next, time: '18:00' })
        .expect(201)
    ).body;
    assert.equal(response.item.category, 'stay');
    assert.equal(response.item.cost, 0);
    assert.match(response.item.description, /room allowance.*per night/);
    assert.equal(response.trip.planning.budget.activities, added.trip.planning.budget.activities);
    assert.equal(
      response.trip.planning.budget.accommodation,
      added.trip.planning.budget.accommodation,
    );
    assert.equal(response.trip.itinerary[0].items.length, 2);
  } finally {
    app.locals.db.close();
  }
});
