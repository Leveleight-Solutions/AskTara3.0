import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultStudioAgency } from '../shared/studio.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { reviewStudioBrief } from '../server/studio-models.ts';

test('a configured AI greeting uses the model reply without inventing trip facts', async (t) => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'unit-test-key-not-a-real-credential';
  const workspace = newStudioWorkspace();
  const initial = structuredClone(workspace.brief);
  const reply = 'Hi! Where would your client like to travel?';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const request = JSON.parse(String(options.body));
    const input = JSON.parse(request.input[0].content);
    assert.equal(input.workflow, 'agent_studio');
    assert.equal(input.request, 'hi');
    assert.deepEqual(input.current.brief, initial);
    assert.deepEqual(input.current.route, []);
    return Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                reply,
                brief: initial,
                facts: [],
                route: [],
                routeEvidence: '',
              }),
            },
          ],
        },
      ],
    });
  });
  try {
    const result = await reviewStudioBrief(workspace, 'hi', defaultStudioAgency());
    assert.equal(calls, 1);
    assert.equal(result.mode, 'live');
    assert.equal(result.reply, reply);
    assert.deepEqual(workspace.brief, { ...initial, request: 'hi' });
    assert.deepEqual(workspace.stops, []);
    assert.equal(workspace.structureAccepted, false);
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});
