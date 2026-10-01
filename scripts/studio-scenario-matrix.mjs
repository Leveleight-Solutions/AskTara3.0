#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Opt-in integration runner: real model research, fictional private workspaces only.
// No supplier search, reservation, payment, publication or existing client data access.
// Example: STUDIO_SCENARIO_MATRIX=1 node scripts/studio-scenario-matrix.mjs --base http://localhost:3018
const options = {
  base: 'http://localhost:3018',
  fixtures: fileURLToPath(new URL('./fixtures/studio-scenarios.json', import.meta.url)),
  out: '/private/tmp/asktara-scenario-matrix',
  concurrency: 2,
  case: '',
};
for (let index = 2; index < process.argv.length; index++) {
  const name = process.argv[index].replace(/^--/, '');
  assert(Object.hasOwn(options, name), `Unknown option: ${name}`);
  assert(process.argv[index + 1], `Missing value for --${name}`);
  options[name] = process.argv[++index];
}
assert.equal(process.env.STUDIO_SCENARIO_MATRIX, '1', 'Set STUDIO_SCENARIO_MATRIX=1 to opt in.');
const base = new URL(options.base);
assert(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'Use a local test API.');
assert.equal(base.protocol, 'http:');
assert(!base.username && !base.password);
const concurrency = Number(options.concurrency);
assert(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 2);
const loaded = JSON.parse(await readFile(resolve(options.fixtures), 'utf8'));
const requested = String(options.case).split(',').filter(Boolean);
const scenarios = (Array.isArray(loaded) ? loaded : loaded.scenarios).filter(
  (scenario) => !requested.length || requested.includes(scenario.id),
);
assert(scenarios.length, 'No matching scenarios.');
for (const scenario of scenarios) {
  assert(/^[a-z0-9_-]+$/.test(scenario.id), 'Scenario ids must be safe file names.');
  assert(scenario.turns.length && scenario.expected && scenario.itineraryPrompt);
}
await mkdir(resolve(options.out), { recursive: true });
const startedAt = new Date().toISOString();
const results = [];

function safeError(error) {
  return String(error?.message || error)
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted credential]')
    .slice(0, 1600);
}
function snapshot(workspace) {
  return {
    revision: workspace.revision,
    stage: workspace.stage,
    brief: workspace.brief,
    stops: workspace.stops,
    clarification: workspace.clarification ?? null,
    structureAccepted: workspace.structureAccepted,
    itinerary: workspace.itinerary ?? null,
    services: workspace.items.length,
    published: workspace.proposal !== null,
  };
}
function isoDates(start, end) {
  const dates = [];
  for (let date = Date.parse(start); date <= Date.parse(end); date += 86400000)
    dates.push(new Date(date).toISOString().slice(0, 10));
  return dates;
}
function markdown(result) {
  const lines = [
    `# ${result.title}`,
    '',
    `Status: ${result.status}. Duration: ${result.elapsedSeconds ?? 'in progress'} seconds.`,
    '',
    'Fictional local test using real configured AI. No reservations, payments or publication.',
    '',
  ];
  result.turns.forEach((turn, index) => {
    lines.push(`## Turn ${index + 1}`, '', '```text', turn.prompt, '```', '');
    if (turn.reply) lines.push(...turn.reply.split('\n').map((line) => `> ${line}`), '');
    lines.push(
      `HTTP ${turn.status}; ${turn.elapsedSeconds}s; model: ${turn.model || 'not returned'}.`,
      '',
    );
  });
  lines.push(
    '## Checks',
    '',
    ...result.checks.map((check) => `- ${check.passed ? 'PASS' : 'FAIL'}: ${check.label}`),
    '',
  );
  if (result.errors.length)
    lines.push('## Errors', '', ...result.errors.map((error) => `- ${error}`), '');
  for (const day of result.finalState?.itinerary?.days || []) {
    lines.push(`## ${day.date}: ${day.title}`, '', day.summary, '');
    for (const activity of day.activities)
      lines.push(`- ${activity.period}: ${activity.title}. ${activity.description}`);
    lines.push('');
  }
  lines.push(
    `Workspace deleted: ${result.workspaceDeleted}. Private PDF bytes: ${result.pdfBytes || 0}.`,
    '',
  );
  return lines.join('\n');
}

async function runScenario(spec) {
  const started = Date.now();
  const cookies = new Map();
  let workspace;
  const result = {
    id: spec.id,
    title: spec.title,
    startedAt: new Date().toISOString(),
    status: 'running',
    turns: [],
    actions: [],
    checks: [],
    errors: [],
    workspaceDeleted: false,
  };
  const directory = resolve(options.out, spec.id);
  await mkdir(directory, { recursive: true });
  async function record() {
    if (workspace) result.finalState = snapshot(workspace);
    await writeFile(resolve(directory, 'result.json'), JSON.stringify(result, null, 2));
    await writeFile(resolve(directory, 'walkthrough.md'), markdown(result));
  }
  function check(label, condition, details) {
    result.checks.push({
      label,
      passed: Boolean(condition),
      ...(details === undefined ? {} : { details }),
    });
  }
  function verify(expected, phase) {
    if (!expected) return;
    for (const [key, value] of Object.entries(expected.brief || {}))
      check(
        `${phase}: brief.${key}`,
        JSON.stringify(workspace.brief[key]) === JSON.stringify(value),
        {
          expected: value,
          actual: workspace.brief[key],
        },
      );
    if (expected.stops) {
      check(`${phase}: stop count/order`, workspace.stops.length === expected.stops.length);
      expected.stops.forEach((stop, index) => {
        for (const [key, value] of Object.entries(stop)) {
          if (key === 'nameAliases') continue;
          const matches =
            key === 'name'
              ? [value, ...(stop.nameAliases || [])].includes(workspace.stops[index]?.name)
              : workspace.stops[index]?.[key] === value;
          check(`${phase}: stop ${index + 1} ${key}`, matches, {
            expected: value,
            actual: workspace.stops[index]?.[key],
          });
        }
      });
    }
    const preferences = [
      workspace.brief.context,
      workspace.brief.hotelStandard,
      workspace.brief.hotelLocation,
      ...workspace.brief.interests,
      ...workspace.brief.requirements,
      ...(workspace.brief.foodPreferences || []),
    ].join(' ');
    for (const preference of expected.preferences || [])
      check(`${phase}: preserves ${preference}`, new RegExp(preference, 'i').test(preferences));
  }
  async function api(path, method = 'GET', body, expectedStatus = 200) {
    assert(!/\/(?:bookings|reservations|payments|publish)(?:\/|$)/.test(path));
    const began = Date.now();
    const response = await fetch(new URL(path, base), {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(320000),
      headers: {
        Origin: base.origin,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookies.size
          ? { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const action = {
      method,
      path: path.replace(/workspaces\/[^/]+/, 'workspaces/<id>'),
      status: response.status,
      elapsedSeconds: Math.round((Date.now() - began) / 100) / 10,
    };
    result.actions.push(action);
    if (response.status !== expectedStatus) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `${method} ${action.path}: HTTP ${response.status}: ${safeError(error.error || 'Unexpected response')}`,
      );
    }
    if (response.status === 204) return;
    if (response.headers.get('content-type')?.includes('application/pdf'))
      return Buffer.from(await response.arrayBuffer());
    const data = await response.json();
    if (data.workspace) workspace = data.workspace;
    return data;
  }
  const own = (suffix = '') => `/api/studio/workspaces/${workspace.id}${suffix}`;
  async function chat(prompt) {
    const began = Date.now();
    const turn = { prompt, elapsedSeconds: 0, status: 0 };
    result.turns.push(turn);
    await record();
    try {
      const data = await api(own('/review'), 'POST', {
        revision: workspace.revision,
        requestId: randomUUID(),
        message: prompt,
      });
      Object.assign(turn, {
        status: 200,
        reply:
          workspace.messages.filter((message) => message.role === 'assistant').at(-1)?.content ||
          '',
        mode: data.mode,
        model: data.model,
        state: snapshot(workspace),
      });
      check(`Turn ${result.turns.length}: live AI response`, data.mode === 'live');
    } finally {
      turn.elapsedSeconds = Math.round((Date.now() - began) / 100) / 10;
      if (!turn.status) turn.status = result.actions.at(-1)?.status || 0;
      await record();
    }
  }
  console.log(`START ${spec.id}`);
  try {
    const integrations = await api('/api/integrations');
    assert.equal(integrations.ai, true, 'Configured AI must be available.');
    await api('/api/studio/workspaces', 'POST', {}, 201);
    for (const turn of spec.turns) {
      await chat(turn.prompt);
      verify(turn.expected, `After turn ${result.turns.length}`);
      await record();
    }
    verify(spec.expected, 'Completed brief');
    check('No unresolved date clarification', workspace.clarification == null);
    await api(own('/structure'), 'POST', { revision: workspace.revision, skipQualification: true });
    await api(own('/accept-structure'), 'POST', { revision: workspace.revision });
    await chat(spec.itineraryPrompt);
    verify(spec.expected, 'Generated itinerary');
    const days = workspace.itinerary?.days || [];
    const expectedDates = isoDates(spec.expected.brief.startDate, spec.expected.brief.endDate);
    check(
      'Complete inclusive itinerary dates',
      JSON.stringify(days.map((day) => day.date)) === JSON.stringify(expectedDates),
      { expected: expectedDates, actual: days.map((day) => day.date) },
    );
    const sourced = days
      .flatMap((day) => day.activities)
      .filter((activity) => activity.sources.length > 0);
    check('Itinerary includes sourced researched activities', sourced.length > 0);
    check(
      'Research citations include HTTP URLs and check dates',
      sourced.every((activity) =>
        activity.sources.every(
          (source) => /^https?:\/\//.test(source.url) && Boolean(source.checkedAt),
        ),
      ),
    );
    for (const date of spec.expected.businessDates || []) {
      const day = days.find((value) => value.date === date);
      check(
        `Business hours free of researched leisure on ${date}`,
        Boolean(day) &&
          !day.activities.some(
            (activity) =>
              ['morning', 'afternoon'].includes(activity.period) && activity.sources.length > 0,
          ),
      );
    }
    check('No supplier services created without selecting quotes', workspace.items.length === 0);
    check('No publication', workspace.proposal === null);
    const generatedItinerary = JSON.stringify(workspace.itinerary);
    await api(own());
    verify(spec.expected, 'Reload');
    check(
      'Saved itinerary survives reload',
      JSON.stringify(workspace.itinerary) === generatedItinerary,
    );
    const preview = await api(own('/proposal/preview'));
    result.privatePreview = preview.proposal;
    check(
      'Private preview retains itinerary days',
      preview.proposal.itinerary?.days.length === expectedDates.length,
    );
    const pdf = await api(own('/proposal/preview/pdf'));
    check('Private PDF has a PDF header', pdf.subarray(0, 5).toString() === '%PDF-');
    check('Private PDF is nonempty', pdf.length > 2000);
    await writeFile(resolve(directory, 'proposal.pdf'), pdf);
    result.pdfBytes = pdf.length;
  } catch (error) {
    result.errors.push(safeError(error));
  } finally {
    if (workspace) {
      try {
        await api(own(), 'DELETE', undefined, 204);
        result.workspaceDeleted = true;
      } catch (error) {
        result.errors.push(`Cleanup failed: ${safeError(error)}`);
      }
    }
    check('Fictional workspace deleted', result.workspaceDeleted);
    result.elapsedSeconds = Math.round((Date.now() - started) / 100) / 10;
    result.completedAt = new Date().toISOString();
    result.status =
      result.errors.length || result.checks.some((item) => !item.passed) ? 'failed' : 'passed';
    await record();
    console.log(
      `${result.status.toUpperCase()} ${spec.id}: ${result.elapsedSeconds}s; ${result.checks.filter((item) => !item.passed).length} failed checks; ${result.errors.join(' | ')}`,
    );
    results.push(result);
    const ordered = scenarios
      .map((scenario) => results.find((value) => value.id === scenario.id))
      .filter(Boolean);
    await writeFile(
      resolve(options.out, 'matrix.json'),
      JSON.stringify({ startedAt, base: base.origin, results: ordered }, null, 2),
    );
    await writeFile(
      resolve(options.out, 'matrix.md'),
      [
        '# Fictional travel scenario matrix',
        '',
        '| Scenario | Result | Seconds | Checks | Private PDF | Cleanup |',
        '|---|---|---:|---:|---:|---|',
        ...ordered.map(
          (value) =>
            `| ${value.title} | ${value.status} | ${value.elapsedSeconds} | ${value.checks.filter((item) => item.passed).length}/${value.checks.length} | ${value.pdfBytes || 0} bytes | ${value.workspaceDeleted} |`,
        ),
        '',
        'Each scenario directory contains exact prompts/replies, state checks, a full itinerary, private PDF and any failures. No booking, payment or publication endpoints are used.',
        '',
      ].join('\n'),
    );
  }
}
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, scenarios.length) }, async () => {
    while (next < scenarios.length) await runScenario(scenarios[next++]);
  }),
);
process.exitCode = results.every((result) => result.status === 'passed') ? 0 : 1;
