import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StudioBrief } from '../shared/studio.ts';
import {
  studioClientDeskAfterProfileChange,
  studioClientDeskError,
  studioClientDeskPatch,
  studioClientDeskValue,
} from '../src/components/studioClientDeskDraft.ts';

const blankBrief = (): StudioBrief => ({
  clientName: '',
  context: '',
  request: '',
  startDate: '',
  endDate: '',
  datesFlexible: false,
  adults: null,
  children: null,
  childAges: [],
  budget: null,
  currency: 'USD',
  origin: '',
  hotelStandard: '',
  hotelLocation: '',
  cabin: '',
  interests: [],
  requirements: [],
  output: 'structure',
});

test('the desk leaves unspecified travellers and dates unknown and patches only edited fields', () => {
  const brief = { ...blankBrief(), clientId: 'linked-client', passportNationality: 'CA' };
  assert.deepEqual(studioClientDeskPatch(brief, {}), {});
  assert.equal(studioClientDeskValue(brief, {}, 'adults'), '');
  assert.equal(studioClientDeskValue(brief, {}, 'children'), '');
  assert.equal(studioClientDeskValue(brief, {}, 'startDate'), '');
  assert.deepEqual(studioClientDeskPatch(brief, { clientName: 'Trip contact' }), {
    clientName: 'Trip contact',
  });
  assert.deepEqual(studioClientDeskPatch(brief, { passportNationality: 'NZ' }), {
    passportNationality: 'NZ',
  });
  assert.equal(brief.clientId, 'linked-client');
});

test('saving a local edit retains unrelated facts that arrived from the conversation', () => {
  const draft = { origin: 'Karachi' };
  const freshBrief = {
    ...blankBrief(),
    adults: 3,
    startDate: '2027-02-01',
    interests: ['Gardens'],
  };
  const updated = { ...freshBrief, ...studioClientDeskPatch(freshBrief, draft) };
  assert.equal(updated.origin, 'Karachi');
  assert.equal(updated.adults, 3);
  assert.equal(updated.startDate, '2027-02-01');
  assert.deepEqual(updated.interests, ['Gardens']);
  assert.deepEqual(studioClientDeskPatch(updated, draft), {});
});

test('an explicit no-children answer clears old ages without inventing an adult count', () => {
  const brief = { ...blankBrief(), children: 2, childAges: [5, 12] };
  assert.deepEqual(studioClientDeskPatch(brief, { children: '0' }), {
    children: 0,
    childAges: [],
  });
  assert.deepEqual(studioClientDeskPatch(brief, { children: '' }), { children: null });
  assert.deepEqual(studioClientDeskPatch(brief, { children: '0', childAges: '5,12' }), {
    children: 0,
    childAges: [],
  });
});

test('the desk accepts incomplete ages for later qualification but rejects extra or invalid ages', () => {
  const brief = { ...blankBrief(), children: 2 };
  assert.equal(studioClientDeskError(brief, { childAges: [5] }), '');
  assert.match(studioClientDeskError(brief, { childAges: [5, 6, 7] }), /more ages than children/);
  assert.match(studioClientDeskError(brief, { childAges: [18] }), /between 0 and 17/);
  const invalid = studioClientDeskPatch(brief, { adults: 'invalid' });
  assert.match(studioClientDeskError(brief, invalid), /between 1 and 100 adults/);
  assert.match(studioClientDeskError(brief, { adults: 0 }), /between 1 and 100 adults/);
});

test('list parsing drops empty interests while preserving commas within requirement sentences', () => {
  const brief = blankBrief();
  assert.deepEqual(
    studioClientDeskPatch(brief, {
      interests: 'Gardens, , food\nArt',
      foodPreferences: 'Halal,',
      requirements: 'Step-free rooms, near a lift\nSlow pace',
      currency: 'pkr',
    }),
    {
      interests: ['Gardens', 'food', 'Art'],
      foodPreferences: ['Halal'],
      requirements: ['Step-free rooms, near a lift', 'Slow pace'],
      currency: 'PKR',
    },
  );
});

test('switching saved clients replaces private background drafts while retaining current trip edits', () => {
  assert.deepEqual(
    studioClientDeskAfterProfileChange({
      clientName: 'Previous client',
      passportNationality: 'AU',
      context: 'Previous context',
      interests: 'Previous interests',
      foodPreferences: 'Previous food',
      adults: '3',
      startDate: '2027-03-01',
      origin: 'Lahore',
      budget: '4500',
    }),
    {
      adults: '3',
      startDate: '2027-03-01',
      origin: 'Lahore',
      budget: '4500',
    },
  );
});

test('the desk catches invalid budgets, currencies and reversed arrival/end dates before saving', () => {
  const brief = blankBrief();
  assert.match(studioClientDeskError(brief, { budget: -1 }), /total budget/);
  assert.match(studioClientDeskError(brief, { currency: 'US' }), /three-letter/);
  assert.match(
    studioClientDeskError(brief, {
      startDate: '2027-03-10',
      endDate: '2027-03-01',
    }),
    /end date must follow arrival/,
  );
  assert.equal(studioClientDeskError(brief, { budget: 0 }), '');
});
