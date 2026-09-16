import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { gracefulShutdown, shutdownGraceMs } from '../server/shutdown.ts';

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
test('shutdown waits beyond five seconds for both HTTP and detached booking completion', async (context) => {
  let releaseHttp!: () => void, started!: () => void;
  const begun = new Promise<void>((resolve) => (started = resolve));
  const server = createServer((_request, response) => {
    releaseHttp = () => response.end('done');
    started();
  });
  const db = new DatabaseSync(':memory:');
  db.exec(
    "CREATE TABLE booking_operations(status TEXT); INSERT INTO booking_operations VALUES ('pending')",
  );
  let closed = false,
    planningStops = 0;
  const exits: number[] = [];
  const stop = gracefulShutdown(server, {
    stopPlanning: async () => {
      planningStops++;
    },
    bookingsPending: () =>
      Boolean(db.prepare("SELECT 1 FROM booking_operations WHERE status = 'pending'").get()),
    closeDatabase: () => {
      db.close();
      closed = true;
    },
    exit: (status) => exits.push(status),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const responseDone = new Promise<void>((resolve, reject) => {
    const outgoing = request(
      { hostname: '127.0.0.1', port: address.port, path: '/' },
      (response) => {
        response.resume();
        response.on('end', resolve);
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
  await begun;
  context.mock.timers.enable({ apis: ['setTimeout'] });
  stop();
  stop();
  await turn();
  context.mock.timers.tick(5001);
  await turn();
  assert.equal(planningStops, 1);
  assert.equal(closed, false);
  assert.deepEqual(exits, []);
  releaseHttp();
  await responseDone;
  await turn();
  assert.equal(server.listening, false);
  assert.equal(closed, false, 'Supplier work must survive a finished/disconnected HTTP request');
  db.prepare("UPDATE booking_operations SET status = 'done'").run();
  context.mock.timers.tick(250);
  await turn();
  assert.equal(closed, true);
  assert.deepEqual(exits, [0]);
  context.mock.timers.tick(200_000);
  assert.deepEqual(exits, [0]);
});

test('idle shutdown exits immediately while a stuck supplier is bounded by the deadline', async (context) => {
  const idle = createServer();
  await new Promise<void>((resolve) => idle.listen(0, '127.0.0.1', resolve));
  const exits: number[] = [];
  let closed = 0;
  gracefulShutdown(idle, {
    stopPlanning: async () => {},
    bookingsPending: () => false,
    closeDatabase: () => closed++,
    exit: (status) => exits.push(status),
  })();
  await turn();
  assert.deepEqual(exits, [0]);
  assert.equal(closed, 1);
  const busy = createServer();
  await new Promise<void>((resolve) => busy.listen(0, '127.0.0.1', resolve));
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const forced: number[] = [];
  gracefulShutdown(busy, {
    stopPlanning: async () => {},
    bookingsPending: () => true,
    closeDatabase: () => {
      throw new Error('Must not close while supplier is still pending');
    },
    exit: (status) => forced.push(status),
    graceMs: 1000,
  })();
  await turn();
  context.mock.timers.tick(1000);
  await turn();
  assert.deepEqual(forced, [1]);
});

test('shutdown grace defaults cover supplier requests and configuration remains bounded', () => {
  assert.equal(shutdownGraceMs(undefined), 200_000);
  assert.equal(shutdownGraceMs('130000'), 130_000);
  assert.equal(shutdownGraceMs('300000'), 300_000);
  for (const value of ['', '0', '5000', '-1', '999999999', 'NaN', '200000.5'])
    assert.equal(shutdownGraceMs(value), 200_000);
});
