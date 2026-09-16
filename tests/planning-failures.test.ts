import test from 'node:test';
import assert from 'node:assert/strict';
import { planningFailureReason } from '../server/agents/failures.ts';

test('planning diagnostics identify validation failures without exposing arbitrary error content', () => {
  assert.equal(
    planningFailureReason(new Error('Destination metadata included private personalization.')),
    'research_privacy',
  );
  assert.equal(
    planningFailureReason(new Error('OpenAI returned travel data that failed validation.')),
    'model_schema',
  );
  assert.equal(
    planningFailureReason(new Error('Private customer note or provider credential')),
    'internal',
  );
  assert.equal(planningFailureReason({ message: 'Private provider body' }), 'internal');
});
