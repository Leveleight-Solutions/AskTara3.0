import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { newTrip } from '../server/planner.ts';
import { defaultBrief } from '../server/agents/schedule.ts';
import {
  researchDestinations,
  researchSchema,
  type DestinationResearchInput,
} from '../server/agents/research.ts';
import { defaultConsultation } from '../shared/consultation.ts';
import { structuredResponse, OpenAIPlanningError } from '../server/agents/openai.ts';

const originalFetch = globalThis.fetch;
const names = ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_REASONING_EFFORT'];
let previous: Record<string, string | undefined>;
beforeEach(() => {
  previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.OPENAI_API_KEY = 'unit-only-key';
  delete process.env.OPENAI_MODEL;
  delete process.env.OPENAI_REASONING_EFFORT;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of names)
    previous[name] === undefined ? delete process.env[name] : (process.env[name] = previous[name]);
});
const sourceUrl = 'https://osaka-info.jp/en/spot/osaka-castle/';
function input(): DestinationResearchInput {
  return {
    trip: { ...newTrip(), days: 3 },
    message: 'Three quiet days in Osaka with vegetarian food and step-free access.',
    brief: { ...defaultBrief(), notes: ['Vegetarian food and step-free access.'] },
    destinationRequests: [{ name: 'Osaka, Japan', days: 3 }],
    intent: 'plan',
  };
}
function researchData() {
  return {
    reply: `Consider Osaka Castle for its museum and park. [Visitor information](${sourceUrl})`,
    summary: `Osaka Castle is a researched option. [Visitor information](${sourceUrl})`,
    questions: [],
    destinations: [
      {
        requestIndex: 0,
        requestedName: 'Osaka, Japan',
        name: 'Osaka',
        country: 'Japan',
        region: 'Asia',
        description: 'Osaka is a city in the Kansai region of Japan.',
        bestTime: 'Check weather for travel dates.',
        dailyBudget: 120,
        coordinates: { latitude: 34.6937, longitude: 135.5023 },
        tags: ['City sights'],
        vibe: 'City escapes',
        sourceUrls: [sourceUrl],
      },
    ],
    places: [
      {
        destinationIndex: 0,
        name: 'Osaka Castle',
        address: 'Osaka Castle, Osaka, Japan',
        category: 'sight',
        description: 'A castle museum with surrounding parkland.',
        suitability: [
          'Access is not confirmed accessible; this suggestion is not allergy-safe certification.',
        ],
        durationMinutes: 90,
        estimatedCost: 15,
        coordinates: null,
        sourceUrls: [sourceUrl],
      },
    ],
  };
}
function response(
  value: unknown,
  sources = [{ url: sourceUrl, title: 'Osaka official visitor guide' }],
  search = true,
) {
  return Response.json({
    status: 'completed',
    output: [
      ...(search ? [{ type: 'web_search_call', status: 'completed', action: { sources } }] : []),
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] },
    ],
  });
}

test('global research forces GPT-6 web search, retains verified links and reuses saved destination IDs', async () => {
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'gpt-6-astra');
    assert.deepEqual(body.reasoning, { effort: 'low' });
    assert.deepEqual(body.tools, [{ type: 'web_search', external_web_access: true }]);
    assert.equal(body.tool_choice, 'required');
    assert.deepEqual(body.include, ['web_search_call.action.sources']);
    assert.equal(body.max_tool_calls, 4);
    assert.equal(body.store, false);
    assert.ok(init?.signal);
    return response(researchData());
  };
  const first = await researchDestinations(input());
  assert.equal(first.destinations[0].id, 'osaka-japan');
  assert.equal(first.destinations[0].image, '/images/destination-placeholder.svg');
  assert.equal(first.places[0].coordinates, undefined);
  assert.deepEqual(first.places[0].evidenceUrls, [sourceUrl]);
  assert.equal(first.places[0].sourceId, first.sources[0].id);
  assert.equal(first.sources[0].kind, 'web');
  assert.match(first.places[0].suitability!.join(' '), /Confirm dietary and accessibility/);
  const again = input();
  again.trip.destinations = [{ ...first.destinations[0], id: 'saved-osaka-id' }];
  assert.equal((await researchDestinations(again)).destinations[0].id, 'saved-osaka-id');
  assert.equal(calls, 2);
});

test('research rejects invented source URLs and output without a completed search', async () => {
  globalThis.fetch = async () => response(researchData(), [], false);
  await assert.rejects(researchDestinations(input()), /no verifiable search sources/);
  globalThis.fetch = async () => {
    const data = researchData();
    data.places[0].sourceUrls = ['https://invented.example/unsearched'];
    return response(data);
  };
  await assert.rejects(researchDestinations(input()), /outside its returned search sources/);
});

test('completed page visits count as actual evidence and bounded search results preserve cited and opened URLs', async () => {
  const request = {
    name: 'source_evidence_probe',
    schema: z.object({ ok: z.boolean() }).strict(),
    instructions: 'Test source metadata',
    payload: {},
    webSearch: true,
  };
  const visited = 'https://www.muhca.gov.co/';
  const cited = 'https://example.com/cited-last';
  const message = {
    type: 'message',
    content: [
      {
        type: 'output_text',
        text: '{"ok":true}',
        annotations: [{ type: 'url_citation', url: cited, title: 'Explicitly cited page' }],
      },
    ],
  };
  for (const type of ['open_page', 'find_in_page']) {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            { type: 'web_search_call', status: 'completed', action: { type, url: visited } },
            { type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] },
          ],
        }),
      );
    const result = await structuredResponse(request);
    assert.deepEqual(
      result.sources.map((source) => source.url),
      [visited],
    );
  }
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          {
            type: 'web_search_call',
            status: 'completed',
            action: {
              type: 'search',
              sources: Array.from({ length: 520 }, (_, index) => ({
                url: `https://example.com/result-${index}`,
              })),
            },
          },
          {
            type: 'web_search_call',
            status: 'completed',
            action: { type: 'open_page', url: visited },
          },
          message,
        ],
      }),
    );
  const result = await structuredResponse(request);
  assert.equal(result.sources.length, 500);
  assert.ok(result.sources.some((source) => source.url === visited));
  assert.ok(result.sources.some((source) => source.url === cited));
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        status: 'completed',
        output: [
          {
            type: 'web_search_call',
            status: 'failed',
            action: { type: 'open_page', url: visited },
          },
          message,
        ],
      }),
    );
  await assert.rejects(structuredResponse(request), /no verifiable search sources/);
});

test('entity references discard unsearched extras while requiring independent supporting evidence and strict prose citations', async () => {
  const extra = 'https://fortificacionescartagena.com.co/en/';
  const data = researchData();
  data.destinations[0].sourceUrls = [extra, sourceUrl];
  data.places[0].sourceUrls = [sourceUrl, extra];
  globalThis.fetch = async () => response(data);
  const result = await researchDestinations(input());
  assert.deepEqual(result.places[0].evidenceUrls, [sourceUrl]);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, sourceUrl);
  assert.equal(JSON.stringify(result).includes(extra), false);
  for (const entity of ['destinations', 'places'] as const) {
    const unsupported = structuredClone(data);
    unsupported[entity][0].sourceUrls = [extra];
    globalThis.fetch = async () => response(unsupported);
    await assert.rejects(
      researchDestinations(input()),
      /outside its returned search sources for an entity/,
    );
  }
  const unsafeProse = structuredClone(data);
  unsafeProse.places[0].description = `See [more information](${extra}).`;
  globalThis.fetch = async () => response(unsafeProse);
  await assert.rejects(researchDestinations(input()), /outside its returned search sources/);
});

test('research rejects partial routes and copied request names that hide city or country substitution', async () => {
  const route = input();
  route.destinationRequests.push({ name: 'Kyoto, Japan', days: 2 });
  globalThis.fetch = async () => response(researchData());
  await assert.rejects(researchDestinations(route), /complete requested route/);
  globalThis.fetch = async () => {
    const data = researchData();
    data.destinations[0].name = 'Bali';
    data.destinations[0].country = 'Indonesia';
    return response(data);
  };
  await assert.rejects(researchDestinations(input()), /substituted a different city/);
  globalThis.fetch = async () => {
    const data = researchData();
    data.destinations[0].country = 'Canada';
    return response(data);
  };
  await assert.rejects(researchDestinations(input()), /substituted a different city/);
});

test('ambiguous research produces an explicit question and no partial replacement', async () => {
  globalThis.fetch = async () =>
    response({
      reply: 'Which state or country is Springfield in?',
      summary: 'Which Springfield do you mean?',
      questions: ['Which state or country is Springfield in?'],
      destinations: [],
      places: [],
    });
  const result = await researchDestinations({
    ...input(),
    destinationRequests: [{ name: 'Springfield', days: 3 }],
  });
  assert.deepEqual(result.destinations, []);
  assert.deepEqual(result.places, []);
  assert.match(result.questions[0], /state or country/);
});

test('research excludes private profile text from public city metadata and rejects positive suitability guarantees', async () => {
  globalThis.fetch = async () => {
    const data = researchData();
    data.destinations[0].description = 'Osaka is ideal for your private dietary needs.';
    return response(data);
  };
  await assert.rejects(researchDestinations(input()), /private personalization/);
  globalThis.fetch = async () => {
    const data = researchData();
    data.places[0].suitability = ['This venue is guaranteed accessible.'];
    return response(data);
  };
  await assert.rejects(researchDestinations(input()), /unsupported suitability guarantee/);
});

test('cautious suitability language is accepted while unrelated negation cannot hide a positive guarantee', async () => {
  for (const text of [
    'Allergy-safe dining cannot be guaranteed.',
    'Fully accessible routes are not guaranteed.',
    'Avoid describing restaurants as allergy-safe.',
    'We cannot guarantee that this venue is fully accessible.',
    'Access is not confirmed accessible; please check directly.',
  ]) {
    const data = researchData();
    data.places[0].suitability = [text];
    globalThis.fetch = async () => response(data);
    const result = await researchDestinations(input());
    assert.ok(result.places[0].suitability?.includes(text));
  }
  for (const text of [
    'The venue is not cheap but fully accessible.',
    'The venue is not cheap and fully accessible.',
    'The venue is fully accessible; allergy-safe dining cannot be guaranteed.',
    'Access is not confirmed; however the restaurant is allergy-safe.',
  ]) {
    const data = researchData();
    data.places[0].suitability = [text];
    globalThis.fetch = async () => response(data);
    await assert.rejects(researchDestinations(input()), /unsupported suitability guarantee/);
  }
});

test('all shared destination text and derived highlights reject private personalization', async () => {
  const mutations: ((data: ReturnType<typeof researchData>) => void)[] = [
    (data) => {
      data.destinations[0].bestTime = 'November suits your wheelchair needs.';
    },
    (data) => {
      data.destinations[0].tags = ['Your dietary preferences'];
    },
    (data) => {
      data.destinations[0].region = 'Near your private appointment';
    },
    (data) => {
      data.places[0].name = 'Our private medical appointment';
    },
    (data) => {
      data.destinations[0].bestTime = 'Vegetarian food and step-free access.';
    },
    (data) => {
      data.destinations[0].bestTime =
        'Check conditions for your dates around the private medical appointment.';
    },
  ];
  for (const mutate of mutations) {
    globalThis.fetch = async () => {
      const data = researchData();
      mutate(data);
      return response(data);
    };
    await assert.rejects(researchDestinations(input()), /private personalization/);
  }
  globalThis.fetch = async () => response(researchData());
  const result = await researchDestinations(input());
  assert.deepEqual(result.destinations[0].highlights, ['Osaka Castle']);
  assert.deepEqual(result.destinations[0].tags, ['City sights']);
});

test('generic visitor guidance in public metadata does not disclose private customer preferences', async () => {
  const data = researchData();
  data.destinations[0].bestTime =
    'Confirm seasonal conditions for your dates. Check opening times before your visit.';
  data.destinations[0].description =
    'A city to explore at your own pace, with a castle museum and parkland.';
  data.destinations[0].tags = ['Plan your visit'];
  globalThis.fetch = async () => response(data);
  const result = await researchDestinations(input());
  assert.equal(result.destinations[0].bestTime, data.destinations[0].bestTime);
  assert.equal(result.destinations[0].description, data.destinations[0].description);
  assert.deepEqual(result.destinations[0].tags, ['Plan your visit']);
});

test('upstream quota and network failures are safe retryable errors without provider body disclosure', async () => {
  const request = {
    name: 'unit_probe',
    schema: z.object({ ok: z.boolean() }).strict(),
    instructions: 'Test',
    payload: {},
  };
  globalThis.fetch = async () =>
    new Response('private-key-value and request text', { status: 429 });
  await assert.rejects(
    structuredResponse(request),
    (error: unknown) =>
      error instanceof OpenAIPlanningError &&
      error.status === 503 &&
      /saved trip is unchanged/.test(error.message) &&
      !/private-key-value/.test(error.message),
  );
  globalThis.fetch = async () => {
    throw new Error('secret network details');
  };
  await assert.rejects(
    structuredResponse(request),
    (error: unknown) => error instanceof OpenAIPlanningError && !error.message.includes('secret'),
  );
});

test('cancelled research preserves the caller abort and never supplies replacement data', async () => {
  const controller = new AbortController();
  const reason = new DOMException('User cancelled', 'AbortError');
  globalThis.fetch = async (_url, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true }),
    );
  const pending = researchDestinations(input(), controller.signal);
  controller.abort(reason);
  await assert.rejects(pending, (error: unknown) => error === reason);
});

test('incomplete or invalid structured responses fail rather than becoming a fabricated plan', async () => {
  const request = {
    name: 'unit_probe',
    schema: z.object({ ok: z.boolean() }).strict(),
    instructions: 'Test',
    payload: {},
  };
  globalThis.fetch = async () => Response.json({ status: 'incomplete', output: [] });
  await assert.rejects(structuredResponse(request), /did not complete/);
  globalThis.fetch = async () => response({ ok: 'not a boolean' });
  await assert.rejects(structuredResponse(request), /failed validation/);
});

test('long seasonal guidance remains bounded without discarding valid destination research', async () => {
  const season =
    'December through April generally has drier conditions, while afternoons can remain hot and humid. The transition months may bring showers, and festival dates can change crowds and room prices. Confirm current forecasts and local events for the actual travel dates.';
  assert.ok(season.length > 160 && season.length <= 500);
  globalThis.fetch = async () => {
    const data = researchData();
    data.destinations[0].bestTime = season;
    return response(data);
  };
  const result = await researchDestinations(input());
  assert.equal(result.destinations[0].bestTime, season);
  assert.equal(result.destinations[0].id, 'osaka-japan');
});

test('informational research receives the saved itinerary and its evidence instead of guessing plan contents', async () => {
  const request = input();
  request.intent = 'answer';
  request.message = 'Which places in my plan need their accessibility checked?';
  request.trip.itinerary = [
    {
      day: 1,
      title: 'Castle day',
      destinationId: 'osaka-japan',
      items: [
        {
          id: 'saved-stop',
          time: '10:00',
          title: 'My saved castle visit',
          description: 'Private discussion omitted from payload.',
          location: 'Osaka Castle',
          category: 'sight',
          cost: 15,
          completed: false,
          placeId: 'saved-place',
        },
      ],
    },
  ];
  request.trip.planning = {
    generatedAt: new Date().toISOString(),
    mode: 'live',
    summary: 'Saved plan',
    assumptions: [],
    questions: [],
    issues: [],
    destinations: [],
    stays: [],
    flights: [],
    agentIds: [],
    budget: {
      currency: 'USD',
      target: 1000,
      activities: 15,
      accommodation: 0,
      flights: null,
      total: 15,
      unpriced: [],
    },
    sources: [
      {
        id: 'saved-source',
        kind: 'web',
        label: 'Official guide',
        url: sourceUrl,
        status: 'live',
        checkedAt: new Date().toISOString(),
      },
    ],
    places: [
      {
        id: 'saved-place',
        name: 'Osaka Castle',
        destinationId: 'osaka-japan',
        address: 'Osaka',
        category: 'sight',
        durationMinutes: 90,
        estimatedCost: 15,
        sourceId: 'saved-source',
        evidenceUrls: [sourceUrl],
        description: 'A castle museum.',
      },
    ],
  };
  const original = structuredClone(request.trip);
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const payload = JSON.parse(body.input[0].content);
    assert.equal(payload.currentPlan.itinerary[0].items[0].title, 'My saved castle visit');
    assert.equal(payload.currentPlan.itinerary[0].items[0].placeId, 'saved-place');
    assert.equal(payload.currentPlan.itinerary[0].items[0].description, undefined);
    assert.equal(payload.currentPlan.places[0].sourceId, 'saved-source');
    assert.equal(payload.currentPlan.sources[0].url, sourceUrl);
    assert.match(body.instructions, /authoritative record of what is actually saved/);
    return response(researchData());
  };
  await researchDestinations(request);
  assert.deepEqual(request.trip, original);
});

test('a general sourced answer needs no destination and still retains its cited evidence', async () => {
  const url = 'https://www.heathrow.com/at-the-airport/accessibility-and-mobility-help';
  globalThis.fetch = async () =>
    response(
      {
        reply: `Arrange assistance with the operator and confirm pickup access. [Airport assistance](${url})`,
        summary: `Arrange assistance with the operator and confirm pickup access. [Airport assistance](${url})`,
        questions: [],
        destinations: [],
        places: [],
      },
      [{ url, title: 'Airport accessibility information' }],
    );
  const result = await researchDestinations({
    ...input(),
    intent: 'answer',
    destinationRequests: [],
    message: 'How do step-free airport transfers usually work?',
  });
  assert.deepEqual(result.destinations, []);
  assert.deepEqual(result.places, []);
  assert.equal(result.sources[0].url, url);
  assert.match(result.summary, /Airport assistance/);
  globalThis.fetch = async () =>
    response({
      reply: 'An answer without any citation.',
      summary: 'An answer without any citation.',
      questions: [],
      destinations: [],
      places: [],
    });
  await assert.rejects(
    researchDestinations({ ...input(), intent: 'answer', destinationRequests: [] }),
    /did not cite a verifiable source/,
  );
});

test('same-country official name extensions resolve without accepting unrelated substrings', async () => {
  const request = { ...input(), destinationRequests: [{ name: 'Cartagena, Colombia', days: 3 }] };
  globalThis.fetch = async () => {
    const data = researchData();
    Object.assign(data.destinations[0], {
      requestedName: 'Cartagena, Colombia',
      name: 'Cartagena de Indias',
      country: 'Colombia',
      description: 'Cartagena de Indias is a coastal city in Colombia.',
    });
    return response(data);
  };
  const result = await researchDestinations(request);
  assert.equal(result.destinations[0].name, 'Cartagena de Indias');
  const existing = {
    ...request,
    trip: {
      ...request.trip,
      destinations: [{ ...result.destinations[0], id: 'saved-cartagena', name: 'Cartagena' }],
    },
  };
  assert.equal((await researchDestinations(existing)).destinations[0].id, 'saved-cartagena');
  globalThis.fetch = async () => {
    const data = researchData();
    Object.assign(data.destinations[0], {
      requestedName: 'York, United Kingdom',
      name: 'Yorkshire',
      country: 'United Kingdom',
    });
    return response(data);
  };
  await assert.rejects(
    researchDestinations({
      ...input(),
      destinationRequests: [{ name: 'York, United Kingdom', days: 3 }],
    }),
    /substituted a different city/,
  );
});

test('chat replies stay separate from detailed sourced preparation and cards', async () => {
  const airportUrl = 'https://www.kansai-airport.or.jp/en/access';
  const data = researchData();
  data.reply = `For a quiet Osaka visit, keep the first afternoon flexible and group nearby stops. Check the transfer option that suits your arrival time, then confirm access with each venue before committing. [Airport transport](${airportUrl})`;
  data.summary = `An arrival-day buffer leaves room for immigration, luggage collection and travel into Osaka. Compare the official rail and bus options for the chosen neighbourhood and actual arrival time. [Airport transport](${airportUrl})\n\nOsaka Castle's museum and surrounding park offer different ways to spend the day. Check the dated calendar and official access information before choosing a route; the place card retains its separate details. [Visitor information](${sourceUrl})\n\nSeasonal climate is useful for packing, but it is not a forecast for a distant travel date. Check any advance admission requirements and confirm dietary needs directly with food venues.`;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.ok(body.text.format.schema.required.includes('reply'));
    assert.equal(body.text.format.schema.properties.reply.maxLength, 900);
    return response(data, [
      { url: sourceUrl, title: 'Visitor guide' },
      { url: airportUrl, title: 'Airport transport' },
    ]);
  };
  const result = await researchDestinations({
    ...input(),
    intent: 'discover',
    destinationRequests: [],
  });
  assert.equal(result.reply, data.reply);
  assert.equal(result.summary, data.summary);
  assert.ok(result.summary.length > result.reply.length * 2);
  assert.equal(result.places[0].description, data.places[0].description);
  assert.ok(result.sources.some((source) => source.url === airportUrl));
  assert.ok(!result.destinations[0].description.includes('arrival-day'));
  const { reply: _omitted, ...missingReply } = data;
  assert.equal(researchSchema.safeParse(missingReply).success, false);
});

test('explicitly detailed answers return the full sourced research while brief questions retain their short reply', async () => {
  const data = {
    ...researchData(),
    destinations: [],
    places: [],
    reply: `Confirm the specific entrance and surfaces before visiting. [Visitor information](${sourceUrl})`,
    summary: `The detailed access review distinguishes getting to the grounds from entering the museum. Check step-free routes, lift service and any temporary restrictions directly with the operator. Allow time for the transfer and choose an alternative if the route is unsuitable. [Visitor information](${sourceUrl})`,
  };
  for (const [message, detailed] of [
    ['Explain the access arrangements in detail.', true],
    ['Give me a detailed comparison of the access options.', true],
    ['Keep it brief: what details should I check before visiting?', false],
    ['Which passport details would be needed later?', false],
  ] as const) {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(JSON.parse(body.input[0].content).responseStyle.detailedAnswer, detailed);
      return response(data);
    };
    const result = await researchDestinations({
      ...input(),
      intent: 'answer',
      destinationRequests: [],
      message,
    });
    assert.equal(result.reply, detailed ? data.summary : data.reply);
    assert.equal(result.summary, data.summary);
  }
});

test('a sourced deep answer cannot conceal an uncited or unsearched chat answer', async () => {
  const data = { ...researchData(), destinations: [], places: [] };
  data.reply = 'The entrance is usually manageable; check before visiting.';
  globalThis.fetch = async () => response(data);
  await assert.rejects(
    researchDestinations({ ...input(), intent: 'answer', destinationRequests: [] }),
    /chat answer did not cite/,
  );
  data.reply = 'Check [the access guide](https://unsearched.example/access).';
  globalThis.fetch = async () => response(data);
  await assert.rejects(
    researchDestinations({ ...input(), intent: 'answer', destinationRequests: [] }),
    /outside its returned search sources/,
  );
});

test('AUD consultation budgets remain separate from USD estimates and hotel nationality is not a passport declaration', async () => {
  const request = input();
  request.trip.budget = 3000;
  request.brief.originAirport = 'SYD';
  request.brief.guestNationality = 'AU';
  request.brief.consultation = defaultConsultation();
  request.brief.consultation.facts.budget = {
    source: 'message',
    valueState: 'specified',
    evidence: 'AUD 3000 total excluding flights',
  };
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const payload = JSON.parse(body.input[0].content);
    assert.equal(payload.trip.budget, 3000);
    assert.equal(payload.trip.budgetCurrency, 'AUD');
    assert.equal(payload.trip.estimateCurrency, 'USD');
    assert.equal(payload.trip.canCompareBudgetToEstimates, false);
    assert.equal(payload.trip.budgetEvidence, 'AUD 3000 total excluding flights');
    assert.equal(payload.preparation.originAirport, 'SYD');
    assert.equal(payload.preparation.hotelGuestNationality, 'AU');
    assert.equal(payload.preparation.passportNationality, undefined);
    assert.match(payload.preparation.identityContext, /rate searches only/);
    return response(researchData());
  };
  const result = await researchDestinations(request);
  assert.equal(result.places[0].estimatedCost, 15);
  assert.equal(result.destinations[0].dailyBudget, 120);
  assert.ok(!JSON.stringify(result.destinations).includes('AUD 3000'));
});

test('unconfirmed or flexible consultation budgets do not expose seeded amounts as usable research budgets', async () => {
  for (const flexible of [false, true]) {
    const request = input();
    request.brief.consultation = defaultConsultation();
    if (flexible)
      request.brief.consultation.facts.budget = {
        source: 'message',
        valueState: 'flexible',
        evidence: 'I have not set a budget yet',
      };
    globalThis.fetch = async (_url, init) => {
      const payload = JSON.parse(JSON.parse(String(init?.body)).input[0].content);
      assert.equal(payload.trip.budget, null);
      assert.equal(payload.trip.budgetKnown, false);
      assert.equal(payload.trip.canCompareBudgetToEstimates, false);
      return response(researchData());
    };
    await researchDestinations(request);
  }
});

const intakeRetryRequest = {
  name: 'travel_intake',
  schema: z.object({ ok: z.boolean() }).strict(),
  instructions: 'Test bounded intake recovery.',
  payload: { message: 'Change this fictional trip to Osaka for six days.' },
  maxTokens: 10000,
};

test('intake retries a token-limited response once with more reasoning space and the same request', async () => {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return bodies.length === 1
      ? Response.json({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [],
        })
      : response({ ok: true }, [], false);
  };
  const result = await structuredResponse(intakeRetryRequest);
  assert.deepEqual(result.data, { ok: true });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].max_output_tokens, 10000);
  assert.deepEqual(bodies[1], { ...bodies[0], max_output_tokens: 12000 });
});

test('intake token recovery is bounded and never retries content-filtered or unknown incompleteness', async () => {
  for (const reason of ['max_output_tokens', 'content_filter', undefined]) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({
        status: 'incomplete',
        incomplete_details: reason ? { reason } : null,
        output: [],
      });
    };
    await assert.rejects(structuredResponse(intakeRetryRequest), /did not complete/);
    assert.equal(calls, reason === 'max_output_tokens' ? 2 : 1);
  }
});

test('an intake cancellation prevents the retry and preserves the caller reason', async () => {
  const controller = new AbortController();
  const reason = new Error('Fictional caller cancelled.');
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    controller.abort(reason);
    return Response.json({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [],
    });
  };
  await assert.rejects(
    structuredResponse({ ...intakeRetryRequest, signal: controller.signal }),
    (error) => error === reason,
  );
  assert.equal(calls, 1);
});

test('other model stages do not inherit intake token retries', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [],
    });
  };
  await assert.rejects(
    structuredResponse({ ...intakeRetryRequest, name: 'itinerary_composition' }),
    /did not complete/,
  );
  assert.equal(calls, 1);
});
