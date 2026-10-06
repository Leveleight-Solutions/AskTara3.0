import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newStudioWorkspace } from '../server/studio-store';
import type { StudioDestinationCandidate } from '../shared/studio-travel-research';
import { studioCandidateEntryInputKey } from '../shared/studio-travel-research';
import {
  studioCandidateEntryLabel,
  studioClientEntryKey,
  studioClientInspirationKey,
} from '../src/components/studioClientInspirationState';

function fixture() {
  const workspace = newStudioWorkspace();
  workspace.brief.passportNationality = 'AU';
  const candidate: StudioDestinationCandidate = {
    destination: 'Kyoto',
    country: 'Japan',
    countryCode: 'JP',
    reason: 'Gardens.',
    suggestedDays: 5,
    thingsToDo: [],
    conditions: '',
    seasonalGuidance: '',
    status: 'checked',
    advisory: '',
    recommendable: true,
    sources: [],
  };
  workspace.destinationResearch = {
    checkedAt: new Date().toISOString(),
    inputKey: 'synthetic',
    historyUsed: true,
    candidates: [candidate],
    notes: [],
  };
  candidate.entryRequirements = {
    scope: 'destination_shortlist',
    inputKey: studioCandidateEntryInputKey(workspace, candidate),
    checkedAt: new Date().toISOString(),
    passportCountry: 'Australia',
    passportCountryCode: 'AU',
    destinationCountryCode: 'JP',
    category: 'visa_free',
    status: 'preliminary',
    summary: 'Synthetic guidance.',
    conditions: [],
    electronicAuthorisation: '',
    sources: [],
    missingFacts: ['trip purpose', 'arrival date'],
    notes: [],
  };
  return { workspace, candidate };
}
test('preliminary category remains conditional and stale/mismatched categories disappear', () => {
  const { workspace, candidate } = fixture();
  assert.equal(studioCandidateEntryLabel(workspace, candidate).label, 'Visa-free · conditional');
  const before = studioClientInspirationKey(workspace);
  const entryBefore = studioClientEntryKey(workspace);
  workspace.brief.passportNationality = 'PK';
  assert.equal(studioClientInspirationKey(workspace), before);
  assert.notEqual(studioClientEntryKey(workspace), entryBefore);
  assert.equal(
    studioCandidateEntryLabel(workspace, candidate).label,
    'Visa check needs refreshing',
  );
  assert.equal(studioCandidateEntryLabel(workspace, candidate).current, false);
});
test('residence/name/nationality never substitute for a passport and missing differs from unchecked', () => {
  const { workspace, candidate } = fixture();
  workspace.brief.passportNationality = '';
  workspace.brief.clientName = 'Australian traveller';
  workspace.brief.context = 'Lives in Australia';
  assert.equal(
    studioCandidateEntryLabel(workspace, candidate).label,
    'Add passport nationality for visa advice',
  );
  workspace.brief.passportNationality = 'AU';
  delete candidate.entryRequirements;
  assert.equal(studioCandidateEntryLabel(workspace, candidate).label, 'Visa check pending');
});
test('unavailable, unverified and conflicting results never expose stored visa-free categories', () => {
  const { workspace, candidate } = fixture();
  for (const status of ['unavailable', 'unverified', 'conflicting'] as const) {
    candidate.entryRequirements!.status = status;
    const view = studioCandidateEntryLabel(workspace, candidate);
    assert.equal(view.current, true);
    assert.equal(view.state, 'review');
    assert.ok(!view.label.includes('Visa-free'));
  }
});
test('future, malformed and expired evidence never count as current', () => {
  const { workspace, candidate } = fixture();
  const now = Date.now();
  for (const checkedAt of [
    new Date(now + 1).toISOString(),
    new Date(now - 21600000).toISOString(),
    'invalid',
  ]) {
    candidate.entryRequirements!.checkedAt = checkedAt;
    assert.equal(studioCandidateEntryLabel(workspace, candidate, now).current, false);
  }
});
test('entry identity includes purpose, dates, flexibility, duration, transport and pending clarification', () => {
  for (const update of [
    { tripPurpose: 'business' },
    { startDate: '2027-04-01' },
    { endDate: '2027-04-05' },
    { datesFlexible: true },
    { departureDate: '2027-03-31' },
    { outboundTransport: 'cruise' },
    { returnTransport: 'flight' },
  ]) {
    const { workspace, candidate } = fixture();
    const before = studioClientEntryKey(workspace);
    Object.assign(workspace.brief, update);
    assert.notEqual(studioClientEntryKey(workspace), before, JSON.stringify(update));
    assert.equal(studioCandidateEntryLabel(workspace, candidate).current, false);
  }
  const { workspace, candidate } = fixture();
  const before = studioClientEntryKey(workspace);
  candidate.suggestedDays++;
  assert.notEqual(studioClientEntryKey(workspace), before);
  const durationKey = studioClientEntryKey(workspace);
  workspace.clarification = {
    kind: 'stay_dates',
    stopId: 'pending',
    arrivalDate: '2027-04-01',
    departureDate: '2027-04-05',
    statedNights: 3,
    proposedNights: 4,
  };
  assert.notEqual(studioClientEntryKey(workspace), durationKey);
  workspace.clarification = null;
  workspace.brief.request = 'I will do paid work.';
  assert.notEqual(studioClientEntryKey(workspace), durationKey);
});
