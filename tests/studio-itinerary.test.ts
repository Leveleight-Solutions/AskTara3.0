import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStudioItinerarySlots, generateStudioItinerary } from '../server/studio-itinerary.ts';
import { newStudioWorkspace, StudioError } from '../server/studio-store.ts';
import { studioItinerarySchema } from '../shared/studio-itinerary.ts';
import type { StudioItem, StudioStop, StudioWorkspace } from '../shared/studio.ts';

const originalFetch = globalThis.fetch;
const envNames = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  process.env.OPENAI_API_KEY = 'unit-test-itinerary-key';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
  globalThis.fetch = async () => assert.fail('Unexpected external provider call');
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of envNames)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});

const url = 'https://tourism.example/river-park';
const source = { url, title: 'Official river park guide' };
function stop(id: string, nights: number | null, arrivalDate = ''): StudioStop {
  return {
    id,
    name: id,
    country: 'France',
    nights,
    arrivalDate,
    arrivalFixed: Boolean(arrivalDate),
    departureDate: '',
    onwardTransport: 'undecided',
    neighbourhood: '',
    notes: '',
  };
}
function workspace(stops = [stop('Paris', 2)]): StudioWorkspace {
  const result = newStudioWorkspace();
  result.structureAccepted = true;
  result.stops = stops;
  result.brief.startDate = '2027-11-01';
  result.brief.interests = ['Art'];
  return result;
}
function activity() {
  return {
    period: 'morning',
    kind: 'research',
    title: 'A stroll through the river park',
    description:
      'Explore the public park at your own pace; check local visitor information before travelling.',
    sourceUrls: [url],
    serviceId: '',
  };
}
function answer(value: StudioWorkspace) {
  return {
    days: buildStudioItinerarySlots(value).map(({ day, date, stopIds, kind }) => ({
      day,
      date,
      stopIds,
      title: `Day ${day}: ${stopIds.join(' and ')}`,
      summary: 'A flexible day tailored to your preferences.',
      activities: [
        kind === 'gap' ? { ...activity(), kind: 'free_time', sourceUrls: [] } : activity(),
      ],
    })),
    notes: ['No bookings are confirmed.'],
  };
}
function response(data: unknown, sources = [source]) {
  return Response.json({
    status: 'completed',
    output: [
      { type: 'web_search_call', status: 'completed', action: { sources } },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
    ],
  });
}
const rejectsWith = (status: number, message: RegExp) => (error: unknown) =>
  error instanceof StudioError && error.status === status && message.test(error.message);

test('daily slots share transfer days, preserve zero-night visits and cover a 28-day route', () => {
  const value = workspace([stop('Paris', 9), stop('Berlin', 9), stop('London', 9)]);
  const slots = buildStudioItinerarySlots(value);
  assert.equal(slots.length, 28);
  assert.equal(slots[0].date, '2027-11-01');
  assert.equal(slots.at(-1)!.date, '2027-11-28');
  assert.deepEqual(slots[9].stopIds, ['Paris', 'Berlin']);
  assert.deepEqual(slots[18].stopIds, ['Berlin', 'London']);
  assert.deepEqual(
    slots.map((day) => day.day),
    Array.from({ length: 28 }, (_, i) => i + 1),
  );
  const zeroNights = buildStudioItinerarySlots(
    workspace([stop('Airport', 0), stop('Paris', 2), stop('Rouen', 0), stop('Lyon', 1)]),
  );
  assert.equal(zeroNights.length, 4);
  assert.deepEqual(zeroNights[0].stopIds, ['Airport', 'Paris']);
  assert.deepEqual(zeroNights[2].stopIds, ['Paris', 'Rouen', 'Lyon']);
});

test('fixed arrival gaps remain calendar days, while earlier unknown dates stay unknown', () => {
  const slots = buildStudioItinerarySlots(
    workspace([stop('Paris', 2), stop('Lyon', 1, '2027-11-06')]),
  );
  assert.deepEqual(
    slots.map((slot) => slot.date),
    [
      '2027-11-01',
      '2027-11-02',
      '2027-11-03',
      '2027-11-04',
      '2027-11-05',
      '2027-11-06',
      '2027-11-07',
    ],
  );
  assert.deepEqual(
    slots.filter((slot) => slot.kind === 'gap').map((slot) => slot.day),
    [3, 4, 5],
  );
  const undated = workspace([stop('Paris', 2), stop('Lyon', 1, '2027-11-06')]);
  undated.brief.startDate = '';
  assert.deepEqual(
    buildStudioItinerarySlots(undated).map((slot) => slot.date),
    ['', '', '2027-11-06', '2027-11-07'],
  );
  undated.stops[1].arrivalDate = '';
  assert.ok(buildStudioItinerarySlots(undated).every((slot) => slot.date === ''));
});

test('unapproved routes, unknown nights and oversized plans fail before any provider request', async () => {
  const unapproved = workspace();
  unapproved.structureAccepted = false;
  await assert.rejects(
    generateStudioItinerary(unapproved, ''),
    rejectsWith(409, /Accept the route/),
  );
  await assert.rejects(
    generateStudioItinerary(workspace([stop('Paris', null)]), ''),
    rejectsWith(400, /number of nights/),
  );
  await assert.rejects(
    generateStudioItinerary(workspace([stop('Paris', 35)]), ''),
    rejectsWith(400, /up to 35 days/),
  );
  await assert.rejects(
    generateStudioItinerary(workspace([stop('Paris', 1), stop('Lyon', 1, '2028-01-01')]), ''),
    rejectsWith(400, /up to 35 days/),
  );
});

test('generation researches and preserves every day, uses existing preferences and never mutates saved state', async () => {
  const value = workspace([stop('Paris', 9), stop('Berlin', 9), stop('London', 9)]);
  value.brief.budget = 2000;
  value.brief.currency = 'GBP';
  const original = structuredClone(value);
  let calls = 0;
  globalThis.fetch = async (address, init) => {
    calls++;
    assert.equal(String(address), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    const payload = JSON.parse(body.input[0].content);
    assert.equal(body.text.format.name, 'studio_daily_itinerary');
    assert.equal(body.max_output_tokens, 12000);
    assert.equal(body.tools[0].type, 'web_search');
    assert.equal(body.tool_choice, 'required');
    assert.equal(payload.request, 'Keep afternoons relaxed');
    assert.deepEqual(payload.preferences.interests, ['Art']);
    assert.equal(payload.preferences.budget, 2000);
    assert.equal(payload.preferences.currency, 'GBP');
    assert.equal(payload.slots.length, 28);
    assert.equal(payload.currentItinerary, null);
    return response(answer(value));
  };
  const generated = await generateStudioItinerary(value, 'Keep afternoons relaxed');
  assert.equal(calls, 1);
  assert.equal(generated.days.length, 28);
  assert.deepEqual(generated.days[0].activities[0].sources[0], {
    label: source.title,
    url,
    checkedAt: generated.generatedAt,
  });
  assert.ok(studioItinerarySchema.safeParse(generated).success);
  assert.deepEqual(value, original);
  value.itinerary = generated;
  globalThis.fetch = async (_address, init) => {
    const payload = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
    assert.deepEqual(payload.currentItinerary, generated);
    return response(answer(value));
  };
  await generateStudioItinerary(value, 'Make the third day quieter');
});

test('partial, reordered, misdated and destination-changing model outputs are rejected', async () => {
  const value = workspace();
  for (const change of [
    (data: ReturnType<typeof answer>) => data.days.pop(),
    (data: ReturnType<typeof answer>) => data.days.reverse(),
    (data: ReturnType<typeof answer>) => {
      data.days[1].date = '2027-11-09';
    },
    (data: ReturnType<typeof answer>) => {
      data.days[1].stopIds = ['London'];
    },
    (data: ReturnType<typeof answer>) => {
      data.days[1].day = 1;
    },
  ]) {
    const data = answer(value);
    change(data);
    globalThis.fetch = async () => response(data);
    await assert.rejects(
      generateStudioItinerary(value, ''),
      rejectsWith(502, /every trip day|accepted route/),
    );
  }
});

test('one corrected draft can replace an unsupported claim while preserving all validation', async () => {
  const value = workspace();
  const original = structuredClone(value);
  let calls = 0;
  globalThis.fetch = async (_address, init) => {
    calls++;
    const payload = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
    const data = answer(value);
    if (calls === 1) {
      assert.equal(payload.validationFeedback, '');
      data.days[0].summary = 'The visit costs AUD 100.';
    } else {
      assert.match(payload.validationFeedback, /unsupported monetary amount.*days\[0\]/);
      assert.doesNotMatch(payload.validationFeedback, /AUD 100/);
    }
    return response(data);
  };
  const generated = await generateStudioItinerary(value, 'Keep the daily plan relaxed.');
  assert.equal(calls, 2);
  assert.equal(generated.days.length, 3);
  assert.doesNotMatch(JSON.stringify(generated), /AUD 100/);
  assert.deepEqual(value, original);
});

test('itinerary history keeps feedback and planned-versus-visited context without profile identity', async () => {
  const value = workspace();
  value.brief.adults = 1;
  value.brief.children = 0;
  const history = [
    {
      destination: 'Paris',
      country: 'FR',
      visitedAt: '2025-03',
      interests: ['Quiet galleries'],
      feedback: 'liked' as const,
      experience: 'visited' as const,
      notes: 'Enjoyed independent museum visits.',
      clientName: 'PRIVATE_CLIENT_NAME',
      photoDataUrl: 'PRIVATE_PHOTO_DATA',
      dateOfBirth: 'PRIVATE_BIRTH_DATE',
      adults: 4,
    },
    {
      destination: 'Amsterdam',
      country: 'NL',
      visitedAt: '2027-01',
      interests: ['Crowded nightlife'],
      feedback: 'disliked' as const,
      experience: 'planned' as const,
      notes: 'Avoid busy clubs. Contact traveller@example.com.',
    },
  ];
  globalThis.fetch = async (_address, init) => {
    const body = JSON.parse(String(init?.body));
    const payload = JSON.parse(body.input[0].content);
    assert.equal(payload.preferences.adults, 1);
    assert.equal(payload.preferences.children, 0);
    assert.deepEqual(payload.returningClientHistory[0], {
      destination: 'Paris',
      country: 'France',
      visitedAt: '2025-03',
      interests: ['Quiet galleries'],
      feedback: 'liked',
      experience: 'visited',
      notes: 'Enjoyed independent museum visits.',
    });
    assert.equal(payload.returningClientHistory[1].feedback, 'disliked');
    assert.equal(payload.returningClientHistory[1].experience, 'planned');
    assert.match(payload.returningClientHistory[1].notes, /Avoid busy clubs/);
    assert.doesNotMatch(
      JSON.stringify(payload),
      /PRIVATE_CLIENT_NAME|PRIVATE_PHOTO_DATA|PRIVATE_BIRTH_DATE|traveller@example\.com/,
    );
    assert.match(body.instructions, /current trip request takes precedence/i);
    assert.match(body.instructions, /planned trips from places actually visited/i);
    return response(answer(value));
  };
  const generated = await generateStudioItinerary(
    value,
    'Keep this visit relaxed.',
    undefined,
    history,
  );
  assert.equal(generated.days.length, 3);
});

test('a second unsupported draft fails after two calls and leaves the workspace unchanged', async () => {
  const value = workspace();
  const original = structuredClone(value);
  const data = answer(value);
  data.notes = ['Your hotel is booked.'];
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return response(data);
  };
  await assert.rejects(generateStudioItinerary(value, ''), rejectsWith(502, /unsupported/));
  assert.equal(calls, 2);
  assert.deepEqual(value, original);
});

test('cancelling the corrected draft stops the operation without saving either draft', async () => {
  const value = workspace();
  const original = structuredClone(value);
  const controller = new AbortController();
  const cancelled = new Error('Fictional itinerary test cancelled');
  let calls = 0;
  globalThis.fetch = async (_address, init) => {
    calls++;
    const data = answer(value);
    if (calls === 1) data.notes = ['Your hotel is booked.'];
    else {
      assert.equal(init?.signal?.aborted, false);
      controller.abort(cancelled);
      assert.equal(init?.signal?.aborted, true);
    }
    return response(data);
  };
  await assert.rejects(generateStudioItinerary(value, '', controller.signal), cancelled);
  assert.equal(calls, 2);
  assert.deepEqual(value, original);
});

test('a corrected draft cannot extend the original generation time budget', async (context) => {
  const value = workspace();
  let now = Date.now();
  context.mock.method(Date, 'now', () => now);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    now += 149500;
    const data = answer(value);
    data.notes = ['Your hotel is booked.'];
    return response(data);
  };
  await assert.rejects(generateStudioItinerary(value, ''), rejectsWith(502, /unsupported/));
  assert.equal(calls, 1);
});

test('named research needs actual search evidence, including URLs hidden in prose', async () => {
  const value = workspace();
  for (const modify of [
    (entry: ReturnType<typeof activity>) => {
      entry.sourceUrls = ['https://invented.example/place'];
    },
    (entry: ReturnType<typeof activity>) => {
      entry.sourceUrls = [];
    },
    (entry: ReturnType<typeof activity>) => {
      entry.description += ' https://invented.example/place';
    },
  ]) {
    const data = answer(value);
    modify(data.days[0].activities[0]);
    globalThis.fetch = async () => response(data);
    await assert.rejects(generateStudioItinerary(value, ''), rejectsWith(502, /unverified source/));
  }
  globalThis.fetch = async () => response(answer(value), []);
  await assert.rejects(generateStudioItinerary(value, ''), /no verifiable search sources/);
});

test('generated public text rejects private context, identifiers and unsupported claims', async () => {
  const value = workspace();
  value.brief.clientName = 'Ann';
  value.brief.context = 'The client is recovering from a confidential medical procedure.';
  for (const description of [
    'A special day for Ann.',
    value.brief.context,
    'Contact private@example.com for details.',
    'Passport number: ABC123456',
    'This activity costs AUD 100.',
    'Your tickets are confirmed.',
    'This venue is fully accessible and allergy-safe.',
  ]) {
    const data = answer(value);
    data.days[0].activities[0].description = description;
    globalThis.fetch = async () => response(data);
    await assert.rejects(
      generateStudioItinerary(value, ''),
      rejectsWith(502, /private client|unsupported/),
    );
  }
  const data = answer(value);
  data.days[0].summary = 'A day of relaxed planning.';
  globalThis.fetch = async () => response(data);
  await generateStudioItinerary(value, '');
});

test('ordinary unconfirmed logistics and meeting disclaimers do not block a business itinerary', async () => {
  const value = workspace();
  const descriptions = [
    'Arrange arrival logistics once the flight, arrival airport and accommodation are confirmed. Keep the day clear of appointments until arrival timing is known.',
    'Allow room for discussions to run over and complete essential follow-up before finishing work. No meeting venue or workspace is reserved.',
    'Keep the morning available for outstanding meetings or project work. Finalise the order only after meeting locations and participants are confirmed.',
    'Business hours are reserved for meetings. Keep sightseeing optional in the evening.',
    'Your weekday working hours are reserved for business meetings.',
    '9 am–5 pm is reserved for business meetings; no venue has been chosen.',
    '09:00–17:00 is reserved for business meetings.',
    'Nothing has been reserved, purchased or ticketed.',
    'Nothing is booked.',
    'Check the November menu and availability for one; no table has been reserved.',
    'None of the flights or restaurant tables are booked.',
  ];
  for (const description of descriptions) {
    const data = answer(value);
    data.days[0].activities[0].description = description;
    globalThis.fetch = async () => response(data);
    const generated = await generateStudioItinerary(value, 'Keep business time flexible.');
    assert.equal(generated.days[0].activities[0].description, description);
  }
});

test('a negative or conditional clause cannot hide a separate unsupported reservation claim', async () => {
  const value = workspace();
  for (const description of [
    'No meeting room is reserved, but your hotel is confirmed.',
    'Once meetings are confirmed, we have booked your flight.',
    'No flight is booked and your hotel is reserved.',
    'Once the flight is confirmed, your hotel is reserved.',
    'After checking flights, your hotel is booked.',
    'Your flights are confirmed after the meeting.',
    'No meeting room is reserved. Your hotel is confirmed.',
    'No hotel is booked; this activity costs AUD 100.',
    'No flights are booked. The venue is fully accessible and allergy-safe.',
    'Business hours are reserved for meetings, but your hotel is booked.',
    'Your hotel room and business hours are reserved.',
    'Your meeting room is reserved for business hours.',
    'Business hours are reserved for meetings. Your tickets are confirmed.',
    'Nothing is booked, your tickets are confirmed.',
    'Nothing has been reserved but your hotel is confirmed.',
    'No table has been reserved. Your flights are booked.',
    'Nothing says your hotel is booked.',
    'None of the flights are booked and your hotel is confirmed.',
  ]) {
    const data = answer(value);
    data.days[0].activities[0].description = description;
    globalThis.fetch = async () => response(data);
    await assert.rejects(
      generateStudioItinerary(value, ''),
      rejectsWith(502, /unsupported price, booking or suitability claim/),
      description,
    );
  }
});

test('free-time descriptions come from the server and gaps cannot become fabricated researched stays', async () => {
  const value = workspace([stop('Paris', 1), stop('Lyon', 1, '2027-11-04')]);
  const data = answer(value);
  const gap = data.days.find((day) => day.day === 2)!;
  gap.activities[0] = {
    ...activity(),
    kind: 'free_time',
    sourceUrls: [],
    title: 'Invented venue',
    description: 'Invented attraction details.',
  };
  globalThis.fetch = async () => response(data);
  const generated = await generateStudioItinerary(value, '');
  assert.equal(generated.days[1].activities[0].title, 'Flexible time');
  assert.doesNotMatch(JSON.stringify(generated), /Invented/);
  assert.ok(generated.notes.some((note) => /between stays/.test(note)));
  gap.activities[0] = activity();
  await assert.rejects(generateStudioItinerary(value, ''), rejectsWith(502, /unresolved gap/));
});

test('discarded logistics prose cannot leak or block safe server-owned activity text', async () => {
  const value = workspace();
  value.brief.clientName = 'Demo Person';
  for (const kind of ['arrival', 'departure', 'transfer', 'free_time']) {
    const data = answer(value);
    data.days[0].activities = [
      {
        ...activity(),
        kind,
        title: 'Demo Person has a confirmed booking',
        description:
          'Your tickets are confirmed for AUD 100 at private@example.com. The venue is allergy-safe. https://invented.example',
        sourceUrls: [],
      },
    ];
    globalThis.fetch = async () => response(data);
    const generated = await generateStudioItinerary(value, '');
    assert.doesNotMatch(
      JSON.stringify(generated),
      /Demo Person|tickets are confirmed|AUD 100|private@example|allergy-safe|invented\.example/,
    );
    assert.deepEqual(generated.days[0].activities[0].sources, []);
  }
});

test('displayed day titles, summaries and notes still reject unsupported claims', async () => {
  const value = workspace();
  for (const modify of [
    (data: ReturnType<typeof answer>) => {
      data.days[0].title = 'Your hotel is booked';
    },
    (data: ReturnType<typeof answer>) => {
      data.days[0].summary = 'The ticket costs AUD 100.';
    },
    (data: ReturnType<typeof answer>) => {
      data.notes = ['The venue is fully accessible and allergy-safe.'];
    },
  ]) {
    const data = answer(value);
    modify(data);
    globalThis.fetch = async () => response(data);
    await assert.rejects(generateStudioItinerary(value, ''), rejectsWith(502, /unsupported/));
  }
});

test('only included reviewed services can appear, with their real details on the correct days', async () => {
  const value = workspace();
  const service: StudioItem = {
    id: 'museum-tour',
    kind: 'tour',
    title: 'Agent selected museum tour',
    description: 'Meet the guide at the entrance.',
    stopId: 'Paris',
    startDate: '2027-11-02',
    endDate: '2027-11-02',
    status: 'externally_booked',
    source: 'manual',
    sourceUrl: '',
    supplier: 'Test supplier',
    privateReference: 'PRIVATE123',
    price: 100,
    currency: 'AUD',
    priceStatus: 'agent_estimate',
    quotedAt: '',
    included: true,
    needsReview: false,
    cost: 70,
  };
  value.items = [service];
  const data = answer(value);
  data.days[1].activities = [
    {
      ...activity(),
      kind: 'service',
      serviceId: service.id,
      sourceUrls: [],
      title: 'Model rewritten service title',
      description: 'Your tickets are confirmed for AUD 100. Contact private@example.com.',
    },
  ];
  globalThis.fetch = async (_address, init) => {
    const payload = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
    assert.doesNotMatch(JSON.stringify(payload.selectedServices), /PRIVATE123|"cost"|"price"/);
    return response(data);
  };
  const result = await generateStudioItinerary(value, '');
  assert.equal(result.days[1].activities[0].title, service.title);
  assert.match(
    result.days[1].activities[0].description,
    /Reported as externally booked by your agent/,
  );
  assert.deepEqual(result.days[1].activities[0].sources, []);
  data.days[0].activities = data.days[1].activities;
  await assert.rejects(
    generateStudioItinerary(value, ''),
    rejectsWith(502, /misplaced a selected service/),
  );
  data.days[0].activities = [activity()];
  service.included = false;
  await assert.rejects(
    generateStudioItinerary(value, ''),
    rejectsWith(502, /misplaced a selected service/),
  );
});
