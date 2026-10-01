import test from 'node:test';
import assert from 'node:assert/strict';
import { breakDownConditions, isAction, sentences } from '../src/components/conditionsText';

const conditions =
  "Checked 1 October 2026: FCDO warns of violent crime, kidnapping and attacks on Table Mountain visitors. An official 20 August report confirms Kruger road closures; today's exact affected routes remain unverified. September SANParks evidence also identifies storm damage at People's Trail Hut. These do not establish a nationwide shutdown. Use arranged transfers and confirm park access before booking.";
const season =
  "Usual seasonal patterns, not a forecast: October is spring. Cape Town generally becomes milder, though rain and strong winds remain possible. Kruger's dry winter transitions toward hotter, wetter summer conditions; wildlife visibility varies with rainfall. Weather and access for travel from 6 October must be checked nearer departure.";

test('the South Africa research splits into facts, season and a before-booking list', () => {
  const result = breakDownConditions(conditions, season);
  assert.deepEqual(result.now, [
    'FCDO warns of violent crime, kidnapping and attacks on Table Mountain visitors.',
    "An official 20 August report confirms Kruger road closures; today's exact affected routes remain unverified.",
    "September SANParks evidence also identifies storm damage at People's Trail Hut.",
    'These do not establish a nationwide shutdown.',
  ]);
  assert.deepEqual(result.season, [
    'October is spring.',
    'Cape Town generally becomes milder, though rain and strong winds remain possible.',
    "Kruger's dry winter transitions toward hotter, wetter summer conditions; wildlife visibility varies with rainfall.",
  ]);
  assert.deepEqual(result.actions, [
    'Use arranged transfers and confirm park access before booking.',
    'Weather and access for travel from 6 October must be checked nearer departure.',
  ]);
});

test('every sentence lands in exactly one list, word for word', () => {
  const result = breakDownConditions(conditions, season);
  const all = [...sentences(conditions), ...sentences(season)].sort();
  assert.deepEqual([...result.now, ...result.season, ...result.actions].sort(), all);
});

test('statements about advice are not mistaken for instructions', () => {
  assert.equal(
    isAction('FCDO advises against all but essential travel to parts of the north.'),
    false,
  );
  assert.equal(isAction('Park roads are confirmed open.'), false);
  assert.equal(isAction('Avoid demonstrations and large gatherings.'), true);
  assert.equal(isAction('Visitors should be confirmed with the operator in advance.'), true);
});

test('empty prose gives empty lists', () => {
  assert.deepEqual(breakDownConditions('', ''), { now: [], season: [], actions: [] });
});
