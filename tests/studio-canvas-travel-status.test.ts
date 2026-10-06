import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newStudioWorkspace } from '../server/studio-store';
import { STUDIO_TRIP_BRIEFING_FRESH_MS } from '../shared/studio-trip-briefing';
import { studioCanvasTravelStatus } from '../src/components/studioCanvasTravelStatus';
import { syntheticTripBriefing } from './studio-trip-briefing-fixture';

function fixture() {
  const workspace = newStudioWorkspace();
  Object.assign(workspace.brief, {
    passportNationality: 'AU',
    tripPurpose: 'tourism',
    startDate: '2027-04-01',
    endDate: '2027-04-05',
  });
  workspace.stops = [
    {
      id: 'canvas-kyoto',
      name: 'Kyoto',
      country: 'JP',
      nights: 4,
      arrivalDate: '2027-04-01',
      departureDate: '2027-04-05',
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
  workspace.tripBriefing = syntheticTripBriefing(workspace);
  return workspace;
}
test('completed provider entry failure is a review task while sourced seasonal weather remains ready', () => {
  const workspace = fixture(),
    row = workspace.tripBriefing!.stops[0];
  row.entryRequirements = null;
  row.entryError = 'Official entry evidence could not be corroborated.';
  workspace.tripBriefing!.status = 'partial';
  assert.deepEqual(studioCanvasTravelStatus(workspace), {
    entryLabel: 'Entry advice needs review',
    weatherLabel: 'Seasonal outlook ready',
  });
});
test('final unverified/conflicting and blank completed entry responses are not pending or checked', () => {
  for (const status of ['unverified', 'conflicting', 'empty'] as const) {
    const workspace = fixture(),
      row = workspace.tripBriefing!.stops[0];
    if (status === 'empty') row.entryRequirements = null;
    else {
      row.entryRequirements!.status = status;
      row.entryRequirements!.category = 'unknown';
    }
    const result = studioCanvasTravelStatus(workspace);
    assert.equal(result.entryLabel, 'Entry advice needs review', status);
    assert.equal(result.weatherLabel, 'Seasonal outlook ready', status);
  }
});
test('missing passport is explicit while unknown purpose and dates queue preliminary checks', () => {
  const workspace = fixture();
  workspace.brief.passportNationality = '';
  workspace.tripBriefing = syntheticTripBriefing(workspace);
  assert.equal(studioCanvasTravelStatus(workspace).entryLabel, 'Add passport nationality');
  workspace.brief.passportNationality = 'AU';
  workspace.brief.tripPurpose = 'undecided';
  assert.equal(studioCanvasTravelStatus(workspace).entryLabel, 'Entry checks need refreshing');
  workspace.brief.tripPurpose = 'tourism';
  workspace.stops[0].arrivalDate = '';
  assert.equal(studioCanvasTravelStatus(workspace).entryLabel, 'Entry checks need refreshing');
  assert.equal(
    studioCanvasTravelStatus(workspace).weatherLabel,
    'Weather guidance needs refreshing',
  );
  workspace.tripBriefing = null;
  assert.deepEqual(studioCanvasTravelStatus(workspace), {
    entryLabel: 'Entry checks pending',
    weatherLabel: 'Weather guidance pending',
  });
});
test('pending describes only eligible checks without a completed snapshot', () => {
  const workspace = fixture();
  workspace.tripBriefing = null;
  assert.deepEqual(studioCanvasTravelStatus(workspace), {
    entryLabel: 'Entry checks pending',
    weatherLabel: 'Weather guidance pending',
  });
});
test('expired, future and mismatched snapshots cannot become checked or terminal current evidence', () => {
  for (const kind of ['expired', 'future', 'mismatched']) {
    const workspace = fixture();
    const checkedAt = Date.parse(workspace.tripBriefing!.checkedAt);
    const now =
      kind === 'expired'
        ? checkedAt + STUDIO_TRIP_BRIEFING_FRESH_MS
        : kind === 'future'
          ? checkedAt - 1
          : checkedAt + 100;
    if (kind === 'mismatched') workspace.brief.passportNationality = 'GB';
    assert.deepEqual(
      studioCanvasTravelStatus(workspace, now),
      {
        entryLabel: 'Entry checks need refreshing',
        weatherLabel: 'Weather guidance needs refreshing',
      },
      kind,
    );
  }
});
test('current independent entry evidence still bridges a refresh and a later contradiction requires review', () => {
  const workspace = fixture();
  workspace.entryRequirements = [workspace.tripBriefing!.stops[0].entryRequirements!];
  workspace.tripBriefing = null;
  assert.equal(studioCanvasTravelStatus(workspace).entryLabel, 'Entry sources checked');
  workspace.entryRequirements[0].status = 'unverified';
  assert.equal(studioCanvasTravelStatus(workspace).entryLabel, 'Entry advice needs review');
});
test('terminal unavailable weather and mixed route failures require review while forecasts are labelled correctly', () => {
  const workspace = fixture(),
    row = workspace.tripBriefing!.stops[0];
  row.weather.kind = 'unavailable';
  assert.equal(studioCanvasTravelStatus(workspace).weatherLabel, 'Weather guidance needs review');
  row.weather.kind = 'forecast';
  assert.equal(studioCanvasTravelStatus(workspace).weatherLabel, 'Weather forecast ready');
  assert.equal(studioCanvasTravelStatus(workspace).entryLabel, 'Entry sources checked');
  const second = { ...workspace.stops[0], id: 'second-kyoto' };
  workspace.stops.push(second);
  workspace.tripBriefing = syntheticTripBriefing(workspace);
  workspace.tripBriefing.stops[1].entryRequirements = null;
  workspace.tripBriefing.stops[1].entryError = 'Provider unavailable for this stop.';
  workspace.tripBriefing.stops[1].weather.kind = 'unavailable';
  assert.deepEqual(studioCanvasTravelStatus(workspace), {
    entryLabel: 'Entry advice needs review',
    weatherLabel: 'Weather guidance needs review',
  });
});
