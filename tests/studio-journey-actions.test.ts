import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newStudioWorkspace } from '../server/studio-store.ts';
import {
  buildStudioAssistantActions,
  buildStudioGuidedQuestions,
} from '../shared/studio-assistant.ts';
import { defaultStudioAgency } from '../shared/studio.ts';
import { qualifyStudio } from '../server/studio-domain.ts';

function trip() {
  const workspace = newStudioWorkspace();
  workspace.brief.preferredDestination = 'London';
  workspace.brief.origin = 'Sydney';
  workspace.brief.passportNationality = 'AU';
  workspace.brief.adults = 2;
  workspace.brief.children = 0;
  workspace.stops = [
    {
      id: 'london',
      name: 'London',
      country: 'GB',
      nights: null,
      arrivalDate: '',
      departureDate: '',
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
  workspace.qualification = qualifyStudio(workspace, defaultStudioAgency());
  return workspace;
}

test('outward flight and cruise research is offered before arrival, stay nights or route approval', () => {
  const workspace = trip();
  const actions = buildStudioAssistantActions(workspace);
  assert.equal(actions[0].kind, 'journey');
  assert.equal(actions[0].direction, 'outbound');
  assert.equal(actions[0].mode, 'flight');
  assert.equal(actions[1].mode, 'cruise');
  assert.ok(actions.findIndex((action) => action.questionId === 'startDate') > 1);
  assert.ok(actions.findIndex((action) => action.questionId === 'nights') > 1);
  assert.deepEqual(
    workspace.stops.map((stop) => [stop.nights, stop.arrivalDate]),
    [[null, '']],
  );
  assert.equal(workspace.structureAccepted, false);
});

test('a named destination can research transport before creating a route, without an invalid approval action', () => {
  const workspace = trip();
  workspace.stops = [];
  const actions = buildStudioAssistantActions(workspace);
  assert.equal(actions[0].kind, 'journey');
  assert.ok(actions.some((action) => action.questionId === 'route'));
  assert.ok(!actions.some((action) => action.kind === 'approve_route'));
  assert.deepEqual(workspace.stops, []);
});

test('a declared cruise is the primary outward option and returning by flight is a separate choice', () => {
  const workspace = trip();
  workspace.brief.outboundTransport = 'cruise';
  workspace.brief.returnTransport = 'flight';
  const actions = buildStudioAssistantActions(workspace);
  assert.equal(actions[0].mode, 'cruise');
  const home = actions.find((action) => action.direction === 'return');
  assert.equal(home?.mode, 'flight');
  assert.equal(workspace.brief.startDate, '');
});

test('family route research is available while automatic adult-only fares remain separate', () => {
  const workspace = trip();
  workspace.brief.children = 2;
  workspace.brief.childAges = [6, 10];
  assert.ok(
    buildStudioAssistantActions(workspace).some(
      (action) => action.kind === 'journey' && action.mode === 'flight',
    ),
  );
  workspace.structureAccepted = true;
  workspace.stops[0].nights = 4;
  assert.ok(!buildStudioAssistantActions(workspace).some((action) => action.kind === 'flights'));
  assert.ok(buildStudioAssistantActions(workspace).some((action) => action.kind === 'hotels'));
});

test('external flights do not trigger a new outward transport intake unless a cruise was requested', () => {
  const workspace = trip();
  workspace.brief.request = 'Our flights are already booked separately.';
  assert.ok(!buildStudioAssistantActions(workspace).some((action) => action.kind === 'journey'));
  assert.ok(
    !buildStudioGuidedQuestions(workspace).some((question) =>
      ['origin', 'departureDate'].includes(question.id),
    ),
  );
  workspace.brief.returnTransport = 'cruise';
  const actions = buildStudioAssistantActions(workspace);
  assert.ok(actions.some((action) => action.direction === 'return' && action.mode === 'cruise'));
  assert.ok(!actions.some((action) => action.kind === 'journey' && action.mode === 'flight'));
});

test('guided intake asks mode, origin and origin departure before arrival and does not repeat known party or passport', () => {
  const workspace = trip();
  workspace.brief.origin = '';
  workspace.qualification = qualifyStudio(workspace, defaultStudioAgency());
  const ids = buildStudioGuidedQuestions(workspace).map((question) => question.id);
  assert.ok(ids.indexOf('outboundTransport') < ids.indexOf('origin'));
  assert.ok(ids.indexOf('origin') < ids.indexOf('departureDate'));
  for (const id of ['startDate', 'nights'])
    if (ids.includes(id)) assert.ok(ids.indexOf('departureDate') < ids.indexOf(id));
  for (const known of ['adults', 'children', 'childAges', 'passportNationality'])
    assert.ok(!ids.includes(known), known);
});

test('known departure is never reused as arrival, even if qualification still contains stale known questions', () => {
  const workspace = trip();
  workspace.brief.outboundTransport = 'flight';
  workspace.brief.departureDate = '2027-04-01';
  for (const id of ['origin', 'departureDate', 'passportNationality', 'adults', 'children'])
    workspace.qualification.questions.push({ id, label: id, reason: '', required: true });
  const ids = buildStudioGuidedQuestions(workspace).map((question) => question.id);
  for (const known of ['origin', 'departureDate', 'passportNationality', 'adults', 'children'])
    assert.ok(!ids.includes(known), known);
  assert.equal(workspace.brief.startDate, '');
  assert.equal(workspace.stops[0].arrivalDate, '');
});

test('explicit flexible dates bypass date questions while an unanswered agency question is retained once', () => {
  const workspace = trip();
  workspace.brief.datesFlexible = true;
  workspace.qualification.questions.push({
    id: 'dietaryConsent',
    label: 'Any dietary restrictions?',
    reason: 'The agency needs this detail.',
    required: false,
  });
  const questions = buildStudioGuidedQuestions(workspace);
  assert.ok(!questions.some((question) => ['departureDate', 'startDate'].includes(question.id)));
  assert.equal(questions.filter((question) => question.id === 'dietaryConsent').length, 1);
  assert.equal(workspace.brief.departureDate || '', '');
  assert.equal(workspace.brief.startDate, '');
});

test('a declared day duration offers an explicit stay choice only after arrival is known', () => {
  const workspace = trip();
  workspace.brief.tripDays = 4;
  assert.ok(
    !buildStudioAssistantActions(workspace).find((action) => action.questionId === 'nights')
      ?.choices,
  );
  workspace.stops[0].arrivalDate = '2027-04-02';
  const nights = buildStudioAssistantActions(workspace).find(
    (action) => action.questionId === 'nights',
  );
  assert.deepEqual(nights?.choices, [
    { label: '4 days at destination · 3 nights', message: 'Use 3 nights in London.' },
  ]);
  assert.equal(workspace.stops[0].nights, null);
  assert.equal(workspace.brief.endDate, '');
});

test('confirmed manual stay dates prioritize unanswered party details ahead of optional transport', () => {
  const workspace = trip();
  workspace.brief.startDate = '2027-04-02';
  workspace.brief.adults = null;
  workspace.brief.children = null;
  workspace.brief.origin = '';
  workspace.stops[0] = { ...workspace.stops[0], nights: 3, arrivalDate: '2027-04-02' };
  workspace.qualification = qualifyStudio(workspace, defaultStudioAgency());
  const before = structuredClone(workspace);
  let ids = buildStudioGuidedQuestions(workspace).map((question) => question.id);
  assert.equal(ids[0], 'adults');
  assert.equal(ids[1], 'children');
  for (const id of ['outboundTransport', 'origin', 'departureDate'])
    assert.ok(ids.indexOf(id) > ids.indexOf('children'), id);
  assert.deepEqual(workspace, before);
  workspace.brief.adults = 2;
  workspace.qualification = qualifyStudio(workspace, defaultStudioAgency());
  ids = buildStudioGuidedQuestions(workspace).map((question) => question.id);
  assert.equal(ids[0], 'children');
  assert.ok(!ids.includes('startDate'));
  assert.ok(!ids.includes('nights'));
});

test('external flights prioritize party and stay facts while preserving a requested cruise as optional travel', () => {
  const workspace = trip();
  workspace.brief.request = 'Our flights are already booked separately.';
  workspace.brief.adults = null;
  workspace.brief.children = null;
  workspace.brief.returnTransport = 'cruise';
  workspace.qualification = qualifyStudio(workspace, defaultStudioAgency());
  const ids = buildStudioGuidedQuestions(workspace).map((question) => question.id);
  assert.equal(ids[0], 'adults');
  assert.equal(ids[1], 'children');
  assert.ok(ids.indexOf('nights') > ids.indexOf('children'));
  assert.ok(ids.indexOf('outboundTransport') > ids.indexOf('nights'));
  assert.equal(workspace.brief.startDate, '');
  assert.equal(workspace.stops[0].nights, null);
});
