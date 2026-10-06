import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { STUDIO_TRIP_BRIEFING_FRESH_MS } from '../shared/studio-trip-briefing.ts';
import { studioTripBriefingDisplay } from '../src/components/studioTripBriefingView.ts';
import { syntheticTripBriefing } from './studio-trip-briefing-fixture.ts';

function checkedWorkspace() {
  const workspace = newStudioWorkspace();
  Object.assign(workspace.brief, {
    passportNationality: 'PK',
    tripPurpose: 'tourism',
    startDate: '2027-04-01',
    endDate: '2027-04-09',
  });
  workspace.stops = [
    {
      id: 'first',
      name: 'Vienna',
      country: 'Austria',
      arrivalDate: '2027-04-01',
      departureDate: '2027-04-05',
      nights: 4,
      onwardTransport: 'flight',
      neighbourhood: '',
      notes: '',
    },
    {
      id: 'second',
      name: 'Kyoto',
      country: 'Japan',
      arrivalDate: '2027-04-06',
      departureDate: '2027-04-09',
      nights: 3,
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
  workspace.tripBriefing = syntheticTripBriefing(workspace);
  workspace.entryRequirements = workspace.tripBriefing.stops.flatMap((stop) =>
    stop.entryRequirements ? [stop.entryRequirements] : [],
  );
  return workspace;
}

test('the panel presents a visa and seasonal outlook for every current route stop', () => {
  const workspace = checkedWorkspace();
  const view = studioTripBriefingDisplay(workspace);
  assert.equal(view.fresh, true);
  assert.equal(view.ready, true);
  assert.deepEqual(
    view.rows.map((stop) => stop.destination),
    ['Vienna', 'Kyoto'],
  );
  assert.ok(view.rows.every((stop) => stop.entryRequirements?.category === 'visa_required'));
  assert.ok(view.rows.every((stop) => stop.weather?.kind === 'seasonal_outlook'));
});

test('changing the passport removes old entry evidence and weather keyed to the previous briefing', () => {
  const workspace = checkedWorkspace();
  workspace.brief.passportNationality = 'CA';
  const view = studioTripBriefingDisplay(workspace);
  assert.equal(view.fresh, false);
  assert.equal(view.rows.length, 2);
  assert.ok(view.rows.every((stop) => !stop.entryRequirements && !stop.weather));
});

test('a date correction keeps the current route labels and hides evidence for the previous stay', () => {
  const workspace = checkedWorkspace();
  workspace.stops[0].arrivalDate = '2027-04-02';
  const view = studioTripBriefingDisplay(workspace);
  assert.equal(view.fresh, false);
  assert.equal(view.rows[0].startDate, '2027-04-02');
  assert.equal(view.rows[0].entryRequirements, null);
  assert.ok(view.rows.every((stop) => !stop.weather));
  // The other stop's matching standalone entry check remains useful during the new check.
  assert.ok(view.rows[1].entryRequirements);
});

test('the panel expires evidence after six hours and never accepts future checked times', () => {
  const workspace = checkedWorkspace();
  const checkedAt = Date.parse(workspace.tripBriefing!.checkedAt);
  for (const now of [checkedAt + STUDIO_TRIP_BRIEFING_FRESH_MS, checkedAt - 1]) {
    const view = studioTripBriefingDisplay(workspace, now);
    assert.equal(view.fresh, false);
    assert.ok(view.rows.every((stop) => !stop.entryRequirements && !stop.weather));
  }
});

test('fresh matching standalone entry checks bridge a pending briefing without inventing weather', () => {
  const workspace = checkedWorkspace();
  workspace.tripBriefing = null;
  const view = studioTripBriefingDisplay(workspace);
  assert.equal(view.fresh, false);
  assert.ok(view.rows.every((stop) => stop.entryRequirements && !stop.weather));
  workspace.entryRequirements![0].inputKey = 'previous trip';
  assert.equal(studioTripBriefingDisplay(workspace).rows[0].entryRequirements, null);
});

test('missing passport keeps sourced seasonal weather visible and leaves visa checks pending', () => {
  const workspace = checkedWorkspace();
  workspace.brief.passportNationality = '';
  workspace.tripBriefing = syntheticTripBriefing(workspace);
  const view = studioTripBriefingDisplay(workspace);
  assert.equal(view.fresh, true);
  assert.ok(view.rows.every((stop) => !stop.entryRequirements && stop.weather));
  assert.ok(view.rows.every((stop) => /passport nationality/.test(stop.entryError)));
});

test('unresolved dates suppress cached full checks while allowing a fresh preliminary briefing', () => {
  const workspace = checkedWorkspace();
  workspace.clarification = {
    kind: 'stay_dates',
    stopId: 'first',
    arrivalDate: '2027-04-01',
    departureDate: '2027-04-05',
    statedNights: 3,
    proposedNights: 4,
  };
  const view = studioTripBriefingDisplay(workspace);
  assert.equal(view.ready, true);
  assert.equal(view.fresh, false);
  assert.ok(view.rows.every((stop) => !stop.entryRequirements && !stop.weather));
});

test('a newer conflicting or unverified standalone entry check replaces cached corroborated advice', () => {
  for (const status of ['conflicting', 'unverified'] as const) {
    const workspace = checkedWorkspace();
    const cached = workspace.tripBriefing!.stops[0].entryRequirements!;
    const checkedAt = Date.parse(cached.checkedAt);
    const recheck = {
      ...cached,
      checkedAt: new Date(checkedAt + 1000).toISOString(),
      category: 'unknown' as const,
      status,
      summary: 'The latest independent recheck needs review.',
    };
    workspace.entryRequirements![0] = recheck;
    const view = studioTripBriefingDisplay(workspace, checkedAt + 2000);
    assert.equal(view.rows[0].entryRequirements, recheck);
    assert.equal(view.rows[0].entryRequirements!.status, status);
    assert.ok(view.rows[0].weather);
    assert.equal(view.rows[1].entryRequirements!.status, 'corroborated');
  }
});

test('an older standalone entry check never displaces a newer matching cached check', () => {
  const workspace = checkedWorkspace();
  const cached = workspace.tripBriefing!.stops[0].entryRequirements!;
  const checkedAt = Date.parse(cached.checkedAt);
  workspace.entryRequirements![0] = {
    ...cached,
    checkedAt: new Date(checkedAt - 60_000).toISOString(),
    status: 'unverified',
  };
  assert.equal(
    studioTripBriefingDisplay(workspace, checkedAt + 1000).rows[0].entryRequirements,
    cached,
  );
});

test('a mismatched, expired or future standalone entry check cannot replace current cached evidence', () => {
  for (const kind of ['mismatched', 'expired', 'future']) {
    const workspace = checkedWorkspace();
    const cached = workspace.tripBriefing!.stops[0].entryRequirements!;
    const checkedAt = Date.parse(cached.checkedAt);
    const now = checkedAt + 2000;
    workspace.entryRequirements![0] = {
      ...cached,
      inputKey: kind === 'mismatched' ? 'another passport or trip' : cached.inputKey,
      checkedAt: new Date(
        kind === 'expired'
          ? now - STUDIO_TRIP_BRIEFING_FRESH_MS
          : kind === 'future'
            ? now + 1000
            : checkedAt + 1000,
      ).toISOString(),
      status: 'conflicting',
    };
    assert.equal(studioTripBriefingDisplay(workspace, now).rows[0].entryRequirements, cached);
  }
});

test('a standalone recheck wins when timestamps tie, including new unverified evidence', () => {
  const workspace = checkedWorkspace();
  const cached = workspace.tripBriefing!.stops[0].entryRequirements!;
  const recheck = {
    ...cached,
    status: 'unverified' as const,
    summary: 'The direct recheck needs review.',
  };
  workspace.entryRequirements![0] = recheck;
  assert.equal(studioTripBriefingDisplay(workspace).rows[0].entryRequirements, recheck);
});
