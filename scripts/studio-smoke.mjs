#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Isolated fictional workspace; exercises real configured providers but never reserves,
// prepays, emails or reads an existing client's data. Every public link is revoked.
const base = new URL(process.argv[2] || 'http://127.0.0.1:3017');
assert(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password);
const cookies = new Map();
let workspace;
const failedChecks = [];
async function api(path, method = 'GET', body, expected = 200, anonymous = false) {
  const url = new URL(path, base);
  assert.equal(url.origin, base.origin);
  const response = await fetch(url, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(225000),
    headers: {
      Origin: base.origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(!anonymous && cookies.size
        ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
        : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!anonymous)
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0],
        index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  let diagnostic = '';
  if (response.status !== expected) {
    const error = await response.json().catch(() => ({}));
    if (typeof error.code === 'string' && /^[A-Za-z_]{1,60}$/.test(error.code))
      diagnostic = ` (${error.code})`;
  }
  assert.equal(
    response.status,
    expected,
    `${method} ${path.replace(/[a-f0-9-]{30,}/g, '<id>')} HTTP ${response.status}${diagnostic}`,
  );
  if (expected === 204 || expected === 404) return;
  if (response.headers.get('content-type')?.includes('application/pdf')) {
    const pdf = Buffer.from(await response.arrayBuffer());
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert(pdf.length > 2000);
    return pdf.length;
  }
  const result = await response.json();
  if (!anonymous && result.workspace) workspace = result.workspace;
  return result;
}
const own = (suffix = '') => `/api/studio/workspaces/${workspace.id}${suffix}`;
const post = (suffix, body = {}, expected = 200) =>
  api(own(suffix), 'POST', { revision: workspace.revision, ...body }, expected);
try {
  await api('/api/health');
  await api('/api/studio/workspaces', 'POST', {}, 201);
  const stopId = randomUUID();
  await api(own(), 'PATCH', {
    revision: workspace.revision,
    title: 'Fictional Studio verification',
    brief: {
      ...workspace.brief,
      clientName: 'Fictional client',
      context: 'Private fixture context must stay private.',
      startDate: '2026-11-18',
      adults: 2,
      children: 0,
      budget: 12000,
      currency: 'AUD',
      hotelStandard: '4-star',
      hotelLocation: 'Near railway stations',
      origin: 'Sydney',
      cabin: 'economy',
      interests: ['quiet cultural visits'],
      requirements: ['vegetarian food'],
    },
    stops: [
      {
        id: stopId,
        name: 'Paris',
        country: 'France',
        nights: 4,
        arrivalDate: '',
        departureDate: '',
        arrivalFixed: false,
        onwardTransport: 'undecided',
        neighbourhood: '',
        notes: '',
      },
    ],
  });
  await post('/structure', { skipQualification: true });
  await post('/accept-structure');
  assert.equal(workspace.structureAccepted, true);
  console.log('PASS route approval and date calculation');

  const imported = await post('/import', {
    kind: 'text',
    name: 'Fictional tour confirmation',
    text: 'FICTIONAL TEST ONLY. Riverlight walking tour in Paris, France, on 2026-11-19 for 2 adults. Supplier: Fictional Riverlight Tours. Group customer price AUD 120. Booking reference: TEST-STUDIO-9042. This fictional arrangement is supplied for software testing.',
  });
  assert.equal(workspace.items.length, 0);
  await post(`/imports/${imported.import.id}/extract`, { requestId: randomUUID() });
  const draft = workspace.items.find((item) => item.source === 'import');
  assert(draft && !draft.included && draft.needsReview);
  assert.equal(draft.price, 120);
  console.log('PASS real OpenAI import extraction; draft excluded pending review');

  const hotels = await post('/hotels/search', { stopId, guestNationality: 'AU' });
  assert.equal(hotels.mode, 'test');
  assert(hotels.quotes.length > 0);
  assert(hotels.quotes.every((quote) => quote.priceStatus === 'sandbox'));
  await post(`/quotes/${hotels.quotes[0].id}`);
  console.log(`PASS LiteAPI sandbox hotels: ${hotels.quotes.length} options and selection`);
  try {
    const flights = await post('/flights/search', {
      origin: 'SYD',
      destination: 'CDG',
      departureDate: '2026-11-17',
      returnDate: '2026-11-23',
      adults: 2,
      cabinClass: 'economy',
    });
    assert.equal(flights.mode, 'test');
    assert(flights.quotes.length > 0);
    assert(flights.quotes.every((quote) => quote.priceStatus === 'sandbox'));
    await post(`/quotes/${flights.quotes[0].id}`);
    console.log(`PASS LiteAPI sandbox flights: ${flights.quotes.length} options and selection`);
  } catch {
    failedChecks.push('LiteAPI sandbox flight search/selection');
    console.log(
      'FAIL LiteAPI sandbox flight search/selection; continuing independent proposal checks',
    );
  }

  await post('/recommendations', {
    requestId: randomUUID(),
    category: 'food',
    stopIds: [stopId],
    interests:
      'Two to four vegetarian-friendly places with calmer seating; state what the agent should verify.',
  });
  assert(workspace.recommendations.length > 0 && workspace.recommendations.length <= 4);
  assert(workspace.recommendations.every((rec) => !rec.included && rec.sources.length > 0));
  console.log(
    `PASS real sourced research: ${workspace.recommendations.length} unselected food suggestions`,
  );
  await api(own(), 'PATCH', {
    revision: workspace.revision,
    items: workspace.items.map((item) =>
      item.id === draft.id ? { ...item, included: true, needsReview: false, cost: 80 } : item,
    ),
    recommendations: workspace.recommendations.map((rec, index) => ({
      ...rec,
      included: index === 0,
    })),
  });
  const preview = await api(own('/proposal/preview'));
  const publicBody = JSON.stringify(preview.proposal);
  for (const secret of [
    'TEST-STUDIO-9042',
    'Private fixture context must stay private.',
    'privateReference',
    '"cost"',
    '"imports"',
  ])
    assert(!publicBody.includes(secret));
  assert.equal(preview.proposal.recommendations.length, 1);
  const published = await post('/proposal', {}, 201);
  const token = published.proposal.token;
  const publicView = await api(`/api/studio/proposals/${token}`, 'GET', undefined, 200, true);
  assert.equal(
    publicView.proposal.items.length,
    workspace.items.filter((item) => item.included).length,
  );
  const pdfBytes = await api(`/api/studio/proposals/${token}/pdf`, 'GET', undefined, 200, true);
  await api(own('/proposal'), 'DELETE', { revision: workspace.revision });
  await api(`/api/studio/proposals/${token}`, 'GET', undefined, 404, true);
  console.log(`PASS private preview, public snapshot, PDF (${pdfBytes} bytes), revocation`);
} finally {
  if (workspace) {
    await api(own(), 'DELETE', undefined, 204);
    console.log('PASS fictional workspace cleanup; no reservations or payments made');
  }
}
assert.equal(failedChecks.length, 0, failedChecks.join('; '));
