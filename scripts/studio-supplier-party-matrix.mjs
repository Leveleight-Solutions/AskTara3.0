#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

// Opt-in integration checks using fictional parties and sandbox searches only.
assert.equal(process.env.STUDIO_SUPPLIER_PARTY_MATRIX, '1', 'Set STUDIO_SUPPLIER_PARTY_MATRIX=1');
const base = new URL(process.argv[2] || 'http://localhost:3018');
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use a local test server');
const output =
  process.env.STUDIO_SUPPLIER_MATRIX_OUT || '/private/tmp/asktara-supplier-party-matrix';
await mkdir(output, { recursive: true });
const cases = [
  {
    id: 'family-orlando',
    name: 'Orlando',
    country: 'US',
    adults: 2,
    children: 2,
    childAges: [6, 10],
    currency: 'USD',
    origin: 'LHR',
    destination: 'MCO',
  },
  {
    id: 'five-friends-kathmandu',
    name: 'Kathmandu',
    country: 'NP',
    adults: 5,
    children: 0,
    childAges: [],
    currency: 'USD',
    origin: 'DEL',
    destination: 'KTM',
  },
  {
    id: 'solo-one-way-lisbon',
    name: 'Lisbon',
    country: 'PT',
    adults: 1,
    children: 0,
    childAges: [],
    currency: 'EUR',
    origin: 'DUB',
    destination: 'LIS',
  },
];
const reports = [];
for (const scenario of cases) {
  const report = {
    id: scenario.id,
    startedAt: new Date().toISOString(),
    checks: [],
    completed: false,
    workspaceDeleted: false,
  };
  const cookies = new Map();
  let workspace;
  async function request(path, method = 'GET', body, expected = 200) {
    assert(!/\/(bookings|reservations|payments|publish|prebook)(\/|$)/.test(path));
    const response = await fetch(new URL(path, base), {
      method,
      signal: AbortSignal.timeout(240_000),
      redirect: 'manual',
      headers: {
        Origin: base.origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0],
        index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const result = response.status === 204 ? {} : await response.json();
    assert.equal(
      response.status,
      expected,
      `${method} ${path.split('/').at(-1)}: ${result.error || response.status}`,
    );
    if (result.workspace) workspace = result.workspace;
    return result;
  }
  const own = (suffix = '') => `/api/studio/workspaces/${workspace.id}${suffix}`;
  const post = (suffix, fields = {}, expected = 200) =>
    request(own(suffix), 'POST', { revision: workspace.revision, ...fields }, expected);
  try {
    await request('/api/studio/workspaces', 'POST', {}, 201);
    const stopId = randomUUID();
    await request(own(), 'PATCH', {
      revision: workspace.revision,
      title: `Fictional supplier matrix: ${scenario.id}`,
      brief: {
        clientName: 'Fictional supplier test party',
        adults: scenario.adults,
        children: scenario.children,
        childAges: scenario.childAges,
        startDate: '2026-11-15',
        endDate: '2026-11-19',
        currency: scenario.currency,
        hotelStandard: '3-star',
        hotelLocation: `Central ${scenario.name}`,
        cabin: 'economy',
      },
      stops: [
        {
          id: stopId,
          name: scenario.name,
          country: scenario.country,
          nights: 4,
          arrivalDate: '2026-11-15',
          arrivalFixed: true,
          departureDate: '2026-11-19',
          onwardTransport: 'undecided',
          neighbourhood: '',
          notes: '',
        },
      ],
    });
    await post('/structure', { skipQualification: true });
    await post('/accept-structure');
    if (scenario.children) {
      const blocked = await post(
        '/flights/search',
        {
          origin: scenario.origin,
          destination: scenario.destination,
          departureDate: '2026-11-15',
          adults: scenario.adults,
          cabinClass: 'economy',
        },
        400,
      );
      assert.equal(blocked.code, 'STUDIO_FAMILY_SEARCH_UNSUPPORTED');
      report.checks.push({
        check: 'Family flights never silently quote adults only',
        passed: true,
        limitation: blocked.error,
      });
      await request(own(), 'PATCH', { revision: workspace.revision, brief: { childAges: [] } });
      await post('/accept-structure');
      const ages = await post('/hotels/search', { stopId, guestNationality: 'GB' }, 400);
      assert.equal(ages.code, 'STUDIO_CHILD_AGES_REQUIRED');
      report.checks.push({ check: 'Missing child ages block hotel search', passed: true });
      await request(own(), 'PATCH', {
        revision: workspace.revision,
        brief: { childAges: scenario.childAges },
      });
      await post('/accept-structure');
    }
    const hotels = await post('/hotels/search', { stopId, guestNationality: 'GB' });
    assert.equal(hotels.mode, 'test');
    assert(hotels.quotes.length > 0, 'A sandbox hotel quote is required to verify selection');
    for (const hotel of hotels.hotels) {
      assert.equal(hotel.adults, scenario.adults);
      assert.deepEqual(hotel.childAges, scenario.childAges);
      assert.equal(hotel.mode, 'test');
    }
    for (const quote of hotels.quotes) {
      assert.equal(quote.startDate, '2026-11-15');
      assert.equal(quote.endDate, '2026-11-19');
      assert.equal(quote.priceStatus, 'sandbox');
      assert.match(quote.description, new RegExp(`${scenario.adults} adults`));
      if (scenario.children) assert.match(quote.description, /2 children \(ages 6, 10\)/);
    }
    report.checks.push({
      check: 'Sandbox hotel search preserves complete requested party and dates',
      passed: true,
      quotes: hotels.quotes.length,
      mode: hotels.mode,
      occupancyScope: 'one room; multiple-room allocation is not implemented',
      inventory: hotels.inventory,
    });
    if (hotels.quotes.length) {
      await post(`/quotes/${hotels.quotes[0].id}`);
      const item = workspace.items.find((item) => item.kind === 'hotel' && item.included);
      assert(item);
      assert.equal(item.priceStatus, 'sandbox');
      report.checks.push({
        check: 'Hotel quote selection is saved, without a reservation',
        passed: true,
        name: item.title,
        currency: item.currency,
        amount: item.price,
      });
    }
    if (scenario.id === 'solo-one-way-lisbon') {
      const flights = await post('/flights/search', {
        origin: scenario.origin,
        destination: scenario.destination,
        departureDate: '2026-11-15',
        adults: 1,
        cabinClass: 'economy',
      });
      assert.equal(flights.mode, 'test');
      assert(flights.quotes.length > 0, 'A one-way sandbox quote was returned');
      for (const quote of flights.quotes) {
        assert.equal(quote.endDate, '');
        assert.doesNotMatch(quote.title, /return/i);
        assert.equal(quote.priceStatus, 'sandbox');
      }
      await post(`/quotes/${flights.quotes[0].id}`);
      report.checks.push({
        check: 'Actual one-way flight search and selection does not add a return leg',
        passed: true,
        quotes: flights.quotes.length,
      });
    }
    const saved = await request(own());
    assert.equal(saved.workspace.brief.adults, scenario.adults);
    assert.deepEqual(saved.workspace.brief.childAges, scenario.childAges);
    report.completed = true;
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    if (workspace?.id) {
      try {
        await request(own(), 'DELETE', undefined, 204);
        report.workspaceDeleted = true;
      } catch {
        report.cleanupError = 'Synthetic workspace cleanup failed';
        process.exitCode = 1;
      }
    }
    report.checkedAt = new Date().toISOString();
    reports.push(report);
    await writeFile(`${output}/report.json`, JSON.stringify(reports, null, 2));
    console.log(
      JSON.stringify({
        id: report.id,
        completed: report.completed,
        workspaceDeleted: report.workspaceDeleted,
        error: report.error,
        checks: report.checks.length,
      }),
    );
  }
}
