/**
 * Opt-in synthetic cruise integration checks against a running local API.
 * ASKTARA_RUN_LIVE_CRUISES=1 node scripts/test-live-cruise-scenarios.mjs
 * Optional: ASKTARA_CRUISE_BROWSER=1 (local frontend defaults to port 5175).
 * Optional: ASKTARA_CRUISE_CASE=asia-early-disembarkation (defaults to both cases).
 * Uses the app's configured AI for source extraction. Never books, pays or publishes.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

if (process.env.ASKTARA_RUN_LIVE_CRUISES !== '1') {
  console.log('Set ASKTARA_RUN_LIVE_CRUISES=1 to run the two fictional live cruise scenarios.');
  process.exit(0);
}
const base = process.env.ASKTARA_CRUISE_BASE_URL || 'http://localhost:3018';
const frontend = process.env.ASKTARA_CRUISE_FRONTEND_URL || 'http://localhost:5175';
for (const address of [base, frontend])
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(address).hostname),
    'Use a local test server.',
  );
const output = process.env.ASKTARA_CRUISE_OUTPUT || '/private/tmp/asktara-live-cruise-scenarios';
await mkdir(output, { recursive: true });
const stamp = () => new Date().toISOString();
const stop = (name, country, date, nights, transport = 'other') => ({
  id: crypto.randomUUID(),
  name,
  country,
  nights,
  arrivalDate: date,
  arrivalFixed: true,
  departureDate: '',
  onwardTransport: transport,
  neighbourhood: '',
  notes: '',
});
const day = (date, title, stopIds = []) => ({
  day: 1,
  date,
  stopIds,
  title,
  summary: 'Fictional agent-reviewed planning time; arrangements are unconfirmed.',
  activities: [
    {
      period: 'flexible',
      title: 'Flexible land time',
      description:
        'Keep time available for the stated trip preferences. No reservation has been made.',
      sources: [],
    },
  ],
});
const service = (kind, title, startDate, endDate, currency, stopId = '') => ({
  id: crypto.randomUUID(),
  kind,
  title,
  description: 'Unpriced planning placeholder. Dates, availability and fare require confirmation.',
  stopId,
  startDate,
  endDate,
  status: 'placeholder',
  source: 'manual',
  sourceUrl: '',
  supplier: '',
  privateReference: '',
  price: null,
  currency,
  priceStatus: 'unpriced',
  quotedAt: '',
  included: true,
  needsReview: false,
  cost: null,
});
const cases = [
  {
    id: 'mediterranean-honeymoon',
    name: 'Fictional Mediterranean Honeymoon Cruise',
    ship: 'Example Aurora',
    currency: 'EUR',
    fare: 3800,
    start: '2027-05-01',
    end: '2027-05-08',
    early: null,
    source: `Fictional Mediterranean Honeymoon Cruise aboard Example Aurora.
Full cruise fare EUR 3800 for two adults. This is an authored test schedule, not a booking or supplier offer.
Day 1: 2027-05-03 Barcelona departure 18:00
Day 2: 2027-05-04 Marseille arrival 08:00 departure 17:00
Day 3: 2027-05-05 At sea
Day 4: 2027-05-06 Civitavecchia arrival 07:00`,
    ports: ['Barcelona', 'Marseille', 'At sea', 'Civitavecchia'],
    dates: ['2027-05-03', '2027-05-04', '2027-05-05', '2027-05-06'],
  },
  {
    id: 'asia-early-disembarkation',
    name: 'Fictional Asian Discovery Cruise',
    ship: 'Example Pacific',
    currency: 'USD',
    fare: 4500,
    start: '2027-10-01',
    end: '2027-10-07',
    early: 3,
    source: `Fictional Asian Discovery Cruise aboard Example Pacific.
Full cruise fare USD 4500 for two adults. This is an authored test schedule, not a booking or supplier offer.
Day 1: 2027-10-01 Hong Kong departure 18:00
Day 2: 2027-10-02 At sea
Day 3: 2027-10-03 Keelung arrival 08:00 departure 17:00
Day 4: 2027-10-04 Kagoshima arrival 10:00 departure 18:00
Day 5: 2027-10-05 Shanghai arrival 09:00`,
    ports: ['Hong Kong', 'At sea', 'Keelung', 'Kagoshima', 'Shanghai'],
    dates: ['2027-10-01', '2027-10-02', '2027-10-03', '2027-10-04', '2027-10-05'],
  },
];
const requestedCase = process.env.ASKTARA_CRUISE_CASE?.trim();
const selectedCases = requestedCase
  ? cases.filter((fixture) => fixture.id === requestedCase)
  : cases;
assert.ok(
  selectedCases.length,
  `ASKTARA_CRUISE_CASE must be one of: ${cases.map((fixture) => fixture.id).join(', ')}.`,
);

function pdfText(buffer) {
  const raw = buffer.toString('latin1');
  const objects = new Map(
    [...raw.matchAll(/(\d+) 0 obj\b([\s\S]*?)\nendobj/g)].map((match) => [match[1], match[2]]),
  );
  const streamOf = (body) => {
    const match = /stream\r?\n([\s\S]*?)\r?\nendstream/.exec(body || '');
    if (!match) return '';
    let stream = Buffer.from(match[1], 'latin1');
    if (/\/FlateDecode\b/.test(body)) stream = inflateSync(stream);
    return stream.toString('latin1');
  };
  // PDFKit writes ligatures as spaced UTF-16 code units (for example <0066 0069>).
  const unicode = (hex) => Buffer.from(hex.replace(/\s+/g, ''), 'hex').swap16().toString('utf16le');
  const fonts = new Map();
  for (const [id, body] of objects) {
    const reference = /\/ToUnicode (\d+) 0 R/.exec(body)?.[1];
    if (!reference) continue;
    const cmap = streamOf(objects.get(reference));
    const glyphs = new Map();
    for (const range of cmap.matchAll(/<([\da-f]+)>\s*<([\da-f]+)>\s*\[([\s\S]*?)\]/gi)) {
      const start = parseInt(range[1], 16);
      for (const [index, character] of [...range[3].matchAll(/<([\da-f\s]+)>/gi)].entries())
        glyphs.set(start + index, unicode(character[1]));
    }
    for (const section of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
      for (const pair of section[1].matchAll(/<([\da-f]+)>\s*<([\da-f\s]+)>/gi))
        glyphs.set(parseInt(pair[1], 16), unicode(pair[2]));
    fonts.set(id, glyphs);
  }
  const aliases = new Map();
  for (const [alias, id] of [...raw.matchAll(/\/(F\d+) (\d+) 0 R/g)].map((match) => match.slice(1)))
    if (fonts.has(id)) aliases.set(alias, fonts.get(id));
  let result = '';
  for (const body of objects.values()) {
    const stream = streamOf(body);
    if (!/\bBT\b/.test(stream)) continue;
    let glyphs;
    for (const token of stream.matchAll(/\/(F\d+)\s+[\d.]+\s+Tf|<([\da-f]+)>/gi)) {
      if (token[1]) glyphs = aliases.get(token[1]);
      else if (glyphs)
        result += (token[2].match(/.{4}/g) || [])
          .map((code) => glyphs.get(parseInt(code, 16)) || '')
          .join('');
      else result += Buffer.from(token[2], 'hex').toString('latin1');
    }
  }
  return result;
}
const report = { startedAt: stamp(), base, scenarios: [] };
for (const fixture of selectedCases) {
  const result = { id: fixture.id, checks: [], failures: [], workarounds: [], cleanup: false };
  report.scenarios.push(result);
  const cookies = new Map();
  let workspace;
  const check = (label, verify) => {
    try {
      verify();
      result.checks.push(label);
    } catch (error) {
      result.failures.push({ check: label, error: error.message.slice(0, 700) });
    }
  };
  async function api(path, data, method = 'POST', bytes = false) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      signal: AbortSignal.timeout(300_000),
      headers: {
        Origin: frontend,
        'Content-Type': 'application/json',
        ...(cookies.size
          ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') }
          : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    for (const value of response.headers.getSetCookie()) {
      const [pair] = value.split(';');
      const index = pair.indexOf('=');
      cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(`${method} ${path}: ${response.status} ${body.error || 'Request failed'}`);
    }
    if (bytes) return Buffer.from(await response.arrayBuffer());
    return response.status === 204 ? {} : response.json();
  }
  const patch = async (changes) => {
    ({ workspace } = await api(
      `/studio/workspaces/${workspace.id}`,
      { revision: workspace.revision, ...changes },
      'PATCH',
    ));
  };
  try {
    ({ workspace } = await api('/studio/workspaces', {}));
    const privateMarker = `PRIVATE_${fixture.id.replaceAll('-', '_').toUpperCase()}_CONTEXT`;
    await patch({
      title:
        fixture.id === 'mediterranean-honeymoon'
          ? 'Fictional Mediterranean honeymoon'
          : 'Fictional Asian cruise and Taiwan stay',
      brief: {
        clientName: 'Fictional Cruise Travellers',
        context: privateMarker,
        adults: 2,
        children: 0,
        childAges: [],
        startDate: fixture.start,
        endDate: fixture.end,
        currency: fixture.currency,
        budget: 9000,
        outboundTransport: 'flight',
        returnTransport: 'flight',
        tripPurpose: 'tourism',
        interests: fixture.early
          ? ['food', 'culture', 'rail travel']
          : ['honeymoon', 'quiet gardens', 'romantic evenings'],
      },
    });
    let landStops;
    if (!fixture.early) {
      landStops = [
        stop('Barcelona', 'Spain', '2027-05-01', 2),
        stop('Marseille', 'France', '2027-05-04', 0),
        stop('Civitavecchia', 'Italy', '2027-05-06', 0),
        stop('Rome', 'Italy', '2027-05-06', 2),
      ];
      const landDays = [
        day('2027-05-01', 'Barcelona honeymoon arrival', [landStops[0].id]),
        day('2027-05-02', 'Barcelona honeymoon day', [landStops[0].id]),
        day('2027-05-07', 'Rome honeymoon day', [landStops[3].id]),
        day('2027-05-08', 'Depart Rome', [landStops[3].id]),
      ];
      await patch({
        stops: landStops,
        itinerary: {
          generatedAt: stamp(),
          days: landDays.map((value, index) => ({ ...value, day: index + 1 })),
          notes: [],
        },
      });
    }
    const beforePreview = structuredClone(workspace);
    const preview = await api(`/studio/workspaces/${workspace.id}/cruises/preview`, {
      revision: workspace.revision,
      requestId: crypto.randomUUID(),
      input: { kind: 'text', name: `${fixture.name} authored fixture`, text: fixture.source },
    });
    workspace = preview.workspace;
    const cruise = preview.cruise;
    check('live AI extraction preserves every literal port, sea day, date and full fare', () => {
      assert.deepEqual(
        cruise.days.map((value) => value.port),
        fixture.ports,
      );
      assert.deepEqual(
        cruise.days.map((value) => value.date),
        fixture.dates,
      );
      assert.equal(cruise.fullFare, fixture.fare);
      assert.equal(cruise.currency, fixture.currency);
      assert.deepEqual(workspace.stops, beforePreview.stops);
      assert.deepEqual(workspace.itinerary, beforePreview.itinerary);
      assert.equal(workspace.cruises.length, 0);
    });
    cruise.disembarkAfterDay = fixture.early;
    cruise.onwardTransport = fixture.early ? 'flight' : 'undecided';
    cruise.returnTransport = fixture.early ? 'undecided' : 'flight';
    ({ workspace } = await api(`/studio/workspaces/${workspace.id}/cruises/apply`, {
      revision: workspace.revision,
      cruise,
    }));
    result.imported = {
      ports: cruise.days.map((value) => value.port),
      dates: cruise.days.map((value) => value.date),
      fullFare: cruise.fullFare,
      currency: cruise.currency,
      selectedCruiseDays: fixture.early || cruise.days.length,
    };
    check('cruise import preserves explicitly supplied outbound and return flights', () => {
      assert.equal(workspace.brief.outboundTransport, 'flight');
      assert.equal(workspace.brief.returnTransport, 'flight');
    });
    check('cruise daily rows preserve selected ports, sea day and full fare', () => {
      assert.deepEqual(
        workspace.itinerary.days
          .filter((value) => value.cruiseId === cruise.id)
          .map((value) => value.title),
        fixture.ports.slice(0, fixture.early || fixture.ports.length),
      );
      assert.equal(
        workspace.items.find((value) => value.id === `cruise:${cruise.id}`).price,
        fixture.fare,
      );
      assert.ok(workspace.itinerary.days.some((value) => value.title === 'At sea'));
      assert.ok(!workspace.stops.some((value) => value.name === 'At sea'));
    });
    if (!fixture.early) {
      check('importing a cruise between existing land days keeps calendar order', () => {
        const actual = workspace.itinerary.days.map((value) => value.date);
        assert.deepEqual(actual, [...actual].sort());
      });
      const sorted = [...workspace.itinerary.days].sort((a, b) => a.date.localeCompare(b.date));
      if (JSON.stringify(sorted) !== JSON.stringify(workspace.itinerary.days)) {
        result.workarounds.push(
          'Manually reordered reviewed itinerary dates after recording the import-order failure.',
        );
        await patch({
          itinerary: {
            ...workspace.itinerary,
            days: sorted.map((value, index) => ({ ...value, day: index + 1 })),
          },
        });
      }
      const cruiseService = workspace.items.find((value) => value.id === `cruise:${cruise.id}`);
      const returnFlight = workspace.items.find(
        (value) => value.id === `cruise-return:${cruise.id}`,
      );
      await patch({
        items: [
          {
            ...cruiseService,
            privateReference: 'PRIVATE-MED-CRUISE-REF',
            cost: 2900,
            needsReview: false,
          },
          { ...returnFlight, startDate: fixture.end, needsReview: false },
          service(
            'hotel',
            'Barcelona honeymoon hotel',
            fixture.start,
            '2027-05-03',
            fixture.currency,
            landStops[0].id,
          ),
          service(
            'hotel',
            'Rome honeymoon hotel',
            '2027-05-06',
            fixture.end,
            fixture.currency,
            landStops[3].id,
          ),
          service(
            'transfer',
            'Civitavecchia to Rome transfer',
            '2027-05-06',
            '2027-05-06',
            fixture.currency,
            landStops[3].id,
          ),
        ],
      });
    } else {
      check('early exit excludes later ports without reducing the full voyage fare', () => {
        assert.equal(workspace.cruises[0].days.length, 5);
        assert.equal(workspace.itinerary.days.length, 3);
        assert.ok(
          !workspace.itinerary.days.some((value) => /Kagoshima|Shanghai/.test(value.title)),
        );
        assert.deepEqual(
          workspace.stops.map((value) => value.name),
          ['Hong Kong', 'Keelung'],
        );
        assert.match(workspace.itinerary.notes.join(' '), /Full cruise fare.*retained/i);
      });
      const taipei = stop('Taipei', 'Taiwan', '2027-10-03', 2, 'train');
      const taichung = stop('Taichung', 'Taiwan', '2027-10-05', 2, 'flight');
      landStops = [
        ...workspace.stops.map((value) => ({
          ...value,
          country: value.name === 'Hong Kong' ? 'Hong Kong' : 'Taiwan',
        })),
        taipei,
        taichung,
      ];
      const cruiseDays = structuredClone(workspace.itinerary.days);
      cruiseDays.at(-1).activities.push({
        period: 'evening',
        title: 'Transfer to the Taipei hotel',
        description:
          'Tentative land extension after approved disembarkation; arrange the transfer and hotel separately.',
        sources: [],
      });
      const landDays = [
        day('2027-10-04', 'Taipei cultural day', [taipei.id]),
        day('2027-10-05', 'Planned train to Taichung', [taipei.id, taichung.id]),
        day('2027-10-06', 'Taichung land stay', [taichung.id]),
        day('2027-10-07', 'Depart Taiwan', [taichung.id]),
      ];
      await patch({
        stops: landStops,
        itinerary: {
          ...workspace.itinerary,
          days: [...cruiseDays, ...landDays].map((value, index) => ({ ...value, day: index + 1 })),
        },
      });
      const cruiseService = workspace.items.find((value) => value.id === `cruise:${cruise.id}`);
      const flight = workspace.items.find((value) => value.id === `cruise-onward:${cruise.id}`);
      await patch({
        items: [
          {
            ...cruiseService,
            privateReference: 'PRIVATE-ASIA-CRUISE-REF',
            cost: 3500,
            needsReview: false,
          },
          {
            ...flight,
            title: 'Flight after Taiwan land stay',
            startDate: fixture.end,
            needsReview: false,
          },
          service(
            'hotel',
            'Taipei post-cruise hotel',
            '2027-10-03',
            '2027-10-05',
            fixture.currency,
            taipei.id,
          ),
          service(
            'hotel',
            'Taichung hotel',
            '2027-10-05',
            fixture.end,
            fixture.currency,
            taichung.id,
          ),
          service(
            'other',
            'Taipei to Taichung train',
            '2027-10-05',
            '2027-10-05',
            fixture.currency,
            taipei.id,
          ),
          service(
            'transfer',
            'Keelung to Taipei transfer',
            '2027-10-03',
            '2027-10-03',
            fixture.currency,
            taipei.id,
          ),
        ],
      });
    }
    // Explicit human review corrects transport from the fixed brief if the import replaced it.
    if (workspace.brief.outboundTransport !== 'flight') {
      result.workarounds.push(
        'Restored the explicitly supplied outbound flight after recording its replacement by cruise.',
      );
      await patch({ brief: { outboundTransport: 'flight' } });
    }
    ({ workspace } = await api(`/studio/workspaces/${workspace.id}/accept-structure`, {
      revision: workspace.revision,
    }));
    const landBefore = workspace.itinerary.days.filter((value) => !value.cruiseId);
    ({ workspace } = await api(`/studio/workspaces/${workspace.id}/cruises/apply`, {
      revision: workspace.revision,
      cruise,
    }));
    check('reapplying a cruise preserves explicitly supplied outbound and return flights', () => {
      assert.equal(workspace.brief.outboundTransport, 'flight');
      assert.equal(workspace.brief.returnTransport, 'flight');
    });
    check('reapplying a reviewed cruise preserves all land days and the full fare', () => {
      assert.deepEqual(
        workspace.itinerary.days.filter((value) => !value.cruiseId),
        landBefore,
      );
      assert.equal(workspace.items.filter((value) => value.id === `cruise:${cruise.id}`).length, 1);
      assert.equal(
        workspace.items.find((value) => value.id === `cruise:${cruise.id}`).price,
        fixture.fare,
      );
      assert.equal(
        workspace.items.find((value) => value.id === `cruise:${cruise.id}`).cost,
        fixture.early ? 3500 : 2900,
      );
    });
    if (fixture.early)
      check(
        'reapplying the same cruise preserves the reviewed disembarkation land activity',
        () => {
          assert.ok(
            workspace.itinerary.days
              .find((value) => value.date === '2027-10-03')
              .activities.some((value) => value.title === 'Transfer to the Taipei hotel'),
          );
        },
      );
    const beforeGeneration = structuredClone(workspace);
    try {
      ({ workspace } = await api(`/studio/workspaces/${workspace.id}/itinerary`, {
        revision: workspace.revision,
        requestId: crypto.randomUUID(),
        instructions:
          'Build the complete trip itinerary. Preserve the reviewed cruise ports, dates, sea days, early disembarkation and separately reviewed hotel transfer. Research suitable land activities from official visitor sources for the stated interests. Keep hotels and transport as unconfirmed planning placeholders, and retain the full cruise fare. Do not make bookings or claim reservations.',
      }));
      check(
        'live AI generation preserves all reviewed cruise rows and their manual activities',
        () => {
          const before = beforeGeneration.itinerary.days.filter((value) => value.cruiseId);
          const after = workspace.itinerary.days.filter((value) => value.cruiseId);
          assert.equal(after.length, before.length);
          for (const original of before) {
            const updated = after.find((value) => value.cruiseDayId === original.cruiseDayId);
            assert.ok(updated, `Missing reviewed cruise day ${original.date}.`);
            assert.equal(updated.cruiseId, original.cruiseId);
            assert.equal(updated.title, original.title);
            assert.equal(updated.date, original.date);
            for (const activity of original.activities)
              assert.ok(
                updated.activities.some(
                  (value) => JSON.stringify(value) === JSON.stringify(activity),
                ),
                `Lost reviewed activity on ${original.date}.`,
              );
          }
          assert.ok(after.some((value) => value.title === 'At sea'));
          assert.deepEqual(workspace.stops, beforeGeneration.stops);
          assert.deepEqual(workspace.items, beforeGeneration.items);
          assert.equal(workspace.cruises[0].fullFare, fixture.fare);
        },
      );
      check(
        'live AI researches source-backed land activities across the complete trip dates',
        () => {
          const days = workspace.itinerary.days;
          assert.equal(days.length, fixture.early ? 7 : 8);
          assert.equal(days[0].date, fixture.start);
          assert.equal(days.at(-1).date, fixture.end);
          const researchDates = fixture.early
            ? ['2027-10-04', '2027-10-06']
            : ['2027-05-02', '2027-05-07'];
          for (const date of researchDates) {
            const researched = days.find((value) => value.date === date);
            assert.ok(
              researched?.activities.some((activity) => activity.sources.length),
              `No verified land activity on ${date}.`,
            );
          }
        },
      );
      result.researchedLandSources = [
        ...new Set(
          workspace.itinerary.days
            .filter((value) => !value.cruiseId)
            .flatMap((value) =>
              value.activities.flatMap((activity) => activity.sources.map((source) => source.url)),
            ),
        ),
      ];
      await writeFile(
        `${output}/${fixture.id}-generated-itinerary.json`,
        JSON.stringify(workspace.itinerary, null, 2),
      );
      check('AI-generated mixed plans retain protection for reviewed cruise rows', () => {
        assert.equal(workspace.itineraryManual, true);
      });
      const reviewedDays = structuredClone(workspace.itinerary.days);
      await patch({ brief: { interests: [...workspace.brief.interests, 'unhurried pace'] } });
      check('a later preference change keeps the regenerated cruise and land days', () => {
        assert.deepEqual(workspace.itinerary.days, reviewedDays);
      });
    } catch (error) {
      result.failures.push({
        check: 'live AI mixed-trip generation',
        error: error.message.slice(0, 700),
      });
    }
    const proposal = (
      await api(`/studio/workspaces/${workspace.id}/proposal/preview`, undefined, 'GET')
    ).proposal;
    const publicJson = JSON.stringify(proposal);
    check(
      'customer preview has correct dates, full fare, private-field removal and no confirmed reservations',
      () => {
        assert.equal(proposal.trip.startDate, fixture.start);
        assert.equal(proposal.trip.endDate, fixture.end);
        assert.ok(
          proposal.items.some((value) => value.kind === 'cruise' && value.price === fixture.fare),
        );
        assert.doesNotMatch(
          publicJson,
          /PRIVATE_|PRIVATE-|privateReference|"cost"|"passportNationality"/,
        );
        assert.ok(workspace.items.every((value) => value.status !== 'externally_booked'));
        assert.equal(workspace.proposal, null);
        assert.equal(proposal.itinerary.days.length, fixture.early ? 7 : 8);
        assert.deepEqual(
          proposal.itinerary.days.map((value) => value.date),
          [...proposal.itinerary.days.map((value) => value.date)].sort(),
        );
        if (fixture.early)
          assert.ok(
            proposal.itinerary.days
              .find((value) => value.date === '2027-10-03')
              .activities.some((value) => value.title === 'Transfer to the Taipei hotel'),
            'The customer preview must retain the reviewed disembarkation transfer.',
          );
      },
    );
    check('onward hotel, transfer and flight placeholders remain unpriced', () => {
      const placeholders = workspace.items.filter((value) => value.kind !== 'cruise');
      for (const kind of ['hotel', 'transfer', 'flight'])
        assert.ok(placeholders.some((value) => value.kind === kind));
      if (fixture.early) assert.ok(placeholders.some((value) => /train/i.test(value.title)));
      assert.ok(
        placeholders.every(
          (value) =>
            value.price === null &&
            value.priceStatus === 'unpriced' &&
            value.status === 'placeholder',
        ),
      );
    });
    const pdf = await api(
      `/studio/workspaces/${workspace.id}/proposal/preview/pdf`,
      undefined,
      'GET',
      true,
    );
    const decoded = pdfText(pdf);
    check(
      'private draft PDF renders the cruise and excludes private reference/context data',
      () => {
        assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
        assert.ok(pdf.length > 2000);
        assert.ok(decoded.includes(fixture.name), 'The PDF text must contain the cruise name.');
        assert.ok(
          decoded.includes(
            fixture.fare.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }),
          ),
          'The PDF text must retain the full cruise fare.',
        );
        if (fixture.early) {
          assert.match(decoded, /Full fare retained; no segment refund/);
          assert.ok(
            decoded.includes('Transfer to the Taipei hotel'),
            'The PDF must retain the reviewed disembarkation transfer.',
          );
        }
        assert.doesNotMatch(decoded, /PRIVATE_|PRIVATE-/);
      },
    );
    await writeFile(`${output}/${fixture.id}.pdf`, pdf);
    await writeFile(`${output}/${fixture.id}-proposal.json`, JSON.stringify(proposal, null, 2));
    result.pdfBytes = pdf.length;
    if (process.env.ASKTARA_CRUISE_BROWSER === '1' && fixture.early) {
      const { chromium } = await import('@playwright/test');
      const browser = await chromium.launch({ channel: 'chrome', headless: true });
      try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addCookies(
          [...cookies].map(([name, value]) => ({
            name,
            value,
            url: frontend,
            httpOnly: true,
            sameSite: 'Lax',
          })),
        );
        const page = await context.newPage();
        const forbiddenActions = [];
        await page.route('**/api/**', async (route) => {
          const request = route.request();
          const path = new URL(request.url()).pathname;
          if (
            /\/(?:bookings?|orders?|payments?|prebook)(?:\/|$)/.test(path) ||
            (request.method() !== 'GET' && /\/proposal$/.test(path))
          ) {
            forbiddenActions.push(path);
            await route.abort();
          } else await route.continue();
        });
        await page.goto(`${frontend}/studio/${workspace.id}`);
        await page
          .getByTestId('studio-trip-board')
          .getByRole('button', { name: 'Preview proposal', exact: true })
          .click();
        const tools = page.getByRole('dialog').filter({
          has: page.getByRole('tablist', { name: 'Plan details', exact: true }),
        });
        await tools.getByRole('button', { name: 'Preview client proposal', exact: true }).click();
        await page
          .getByTestId('client-proposal')
          .getByText(fixture.name, { exact: true })
          .waitFor();
        assert.deepEqual(forbiddenActions, [], 'Private preview must not publish, book or pay.');
        await page.screenshot({ path: `${output}/${fixture.id}-browser.png`, fullPage: true });
        result.checks.push('real browser displays private cruise-and-land proposal preview');
      } finally {
        await browser.close();
      }
    }
    const stored = (await api(`/studio/workspaces/${workspace.id}`, undefined, 'GET')).workspace;
    check('saved workspace reload preserves reviewed itinerary and never publishes', () => {
      assert.deepEqual(stored.itinerary, workspace.itinerary);
      assert.equal(stored.proposal, null);
    });
  } catch (error) {
    result.failures.push({ check: 'scenario completion', error: error.message.slice(0, 700) });
  } finally {
    if (workspace?.id) {
      try {
        await api(`/studio/workspaces/${workspace.id}`, undefined, 'DELETE');
        result.cleanup = true;
      } catch (error) {
        result.failures.push({ check: 'own workspace cleanup', error: error.message });
      }
    }
    console.log(JSON.stringify({ ...result, imported: result.imported }));
    await writeFile(
      `${output}/report.json`,
      JSON.stringify({ ...report, updatedAt: stamp() }, null, 2),
    );
  }
}
if (report.scenarios.some((value) => value.failures.length)) process.exitCode = 1;
