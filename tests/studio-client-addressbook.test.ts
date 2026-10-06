import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StudioClientProfile } from '../shared/studio-clients.ts';
import {
  clientProfileDraft,
  filterStudioClients,
  clientListValues,
} from '../src/components/studioClientAddressBook.ts';

const client: StudioClientProfile = {
  id: 'client',
  name: 'Fictional Noor',
  country: 'AU',
  nationality: 'CA',
  dateOfBirth: '1988-07-12',
  passportNationality: 'NZ',
  photoDataUrl: 'private-photo',
  context: 'A quiet pace.',
  interests: ['Gardens', 'Architecture'],
  foodPreferences: ['Vegetarian'],
  history: [{ destination: 'Kyoto', country: 'JP', feedback: 'liked', notes: 'Quiet gardens.' }],
  updatedAt: '2026-10-01T00:00:00Z',
  previousTripCount: 2,
};
test('client edit drafts preserve independent identity/private fields without API-only metadata', () => {
  const draft = clientProfileDraft(client);
  assert.equal(draft.country, 'AU');
  assert.equal(draft.nationality, 'CA');
  assert.equal(draft.passportNationality, 'NZ');
  assert.equal(draft.dateOfBirth, '1988-07-12');
  assert.equal(draft.photoDataUrl, 'private-photo');
  assert.ok(!('id' in draft));
  assert.ok(!('updatedAt' in draft));
  assert.ok(!('previousTripCount' in draft));
  draft.history[0].notes = 'Edited feedback';
  draft.interests.push('Art');
  assert.equal(client.history[0].notes, 'Quiet gardens.');
  assert.equal(client.interests.length, 2);
});
test('new client drafts contain no copied history or invented travel party/date data', () => {
  const draft = clientProfileDraft();
  assert.equal(draft.name, '');
  assert.equal(draft.passportNationality, '');
  assert.deepEqual(draft.history, []);
  assert.ok(!('adults' in draft));
  assert.ok(!('startDate' in draft));
});
test('addressbook search combines case-insensitive name, country, interests and previous destinations', () => {
  for (const query of ['NOOR', 'australia gardens', 'Canada architecture', 'Kyoto'])
    assert.deepEqual(filterStudioClients([client], query), [client]);
  assert.deepEqual(filterStudioClients([client], 'Kyoto beaches'), []);
  assert.deepEqual(filterStudioClients([client], ''), [client]);
  assert.deepEqual(clientListValues('Gardens, , architecture\nArt'), [
    'Gardens',
    'architecture',
    'Art',
  ]);
});
