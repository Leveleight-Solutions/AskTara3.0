import {
  confirmStudioStartClient,
  closeStudioTool,
  openStudioClientDesk,
  openStudioClientProfiles,
  openStudioTool,
} from './ui-helpers';
import { expect, test, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { StudioWorkspace } from '../shared/studio';
import type { StudioHotelSearchResult } from '../shared/studio-hotels';

// Explicit opt-in: this exercises configured OpenAI and hotel sandbox services.
// It creates only fictional data and deletes its workspace, without publication or booking.
test.use({ trace: 'off', video: 'off' });

const prompts = [
  'hi',
  'My name is Demo Traveller. This is a fictional test traveller. I am from Melbourne and have a New Zealand passport.',
  'i wanna go to london for a bussiness trip for 4 days on 3rd of november 2026',
  'its my departure date',
  'i will arrive on the same date',
  '3 nights stay arrival on 3rd and going back on 8th',
  'yes',
  'One adult, no children. This is a single-destination trip. My total trip budget is AUD 6000. I prefer a 4-star hotel in central London, vegetarian food, and economy flights both ways. Keep weekday business meetings from 9 am to 5 pm free, with gentle sightseeing in the evenings and on Saturday.',
  'Check the entry requirements for this business trip using my New Zealand passport. I am only attending meetings, with no employment or paid work in the United Kingdom.',
  'Build my complete day-by-day itinerary for the confirmed London stay, 3–8 November 2026. Keep 9 am to 5 pm on Wednesday, Thursday and Friday available for business meetings. Plan vegetarian dining and a gentle Saturday sightseeing day. Use only sourced places, and do not make bookings.',
] as const;

type Turn = {
  prompt: string;
  reply: string;
  elapsedSeconds: number;
  mode?: string;
  model?: string;
  state: ReturnType<typeof snapshot>;
};

function snapshot(workspace: StudioWorkspace) {
  return {
    revision: workspace.revision,
    stage: workspace.stage,
    clientName: workspace.brief.clientName,
    origin: workspace.brief.origin,
    passportNationality: workspace.brief.passportNationality,
    tripPurpose: workspace.brief.tripPurpose,
    departureDate: workspace.brief.departureDate,
    arrivalDate: workspace.brief.startDate,
    returnDate: workspace.brief.endDate,
    adults: workspace.brief.adults,
    children: workspace.brief.children,
    budget: workspace.brief.budget,
    currency: workspace.brief.currency,
    hotelStandard: workspace.brief.hotelStandard,
    hotelLocation: workspace.brief.hotelLocation,
    foodPreferences: workspace.brief.foodPreferences,
    outboundTransport: workspace.brief.outboundTransport,
    returnTransport: workspace.brief.returnTransport,
    cabin: workspace.brief.cabin,
    stops: workspace.stops,
    clarification: workspace.clarification,
    structureAccepted: workspace.structureAccepted,
    itineraryDays: workspace.itinerary?.days.length || 0,
    includedServices: workspace.items.filter((item) => item.included).length,
  };
}

function responseFor(page: Page, ending: string, method = 'POST') {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method && new URL(response.url()).pathname.endsWith(ending),
    { timeout: 300_000 },
  );
}

function assertBusinessSchedule(workspace: StudioWorkspace) {
  const days = workspace.itinerary!.days;
  expect(days.map((day) => day.date)).toEqual([
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
    '2026-11-06',
    '2026-11-07',
    '2026-11-08',
  ]);
  for (const day of days.slice(1, 4)) {
    expect(`${day.title} ${day.summary}`).toMatch(/business|meeting|9\s*(?:am|:00)/i);
    expect(
      day.activities.filter(
        (activity) =>
          activity.sources.length > 0 &&
          (activity.period === 'morning' || activity.period === 'afternoon'),
      ),
      `No researched leisure activity during business hours on ${day.date}`,
    ).toHaveLength(0);
  }
}

test('fictional traveller completes real chat, hotel quote, itinerary and private PDF', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.STUDIO_FICTIONAL_REPLAY !== '1',
    'Set STUDIO_FICTIONAL_REPLAY=1 to run configured upstream services with fictional data.',
  );
  test.setTimeout(1_800_000);
  const artifactDirectory =
    process.env.STUDIO_REPLAY_ARTIFACT_DIR || '/private/tmp/asktara-fictional-replay';
  await mkdir(artifactDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  const turns: Turn[] = [];
  const itineraryRuns: { afterPrompt: string; itinerary: StudioWorkspace['itinerary'] }[] = [];
  const actions: { action: string; elapsedSeconds: number; result: unknown }[] = [];
  const errors: string[] = [];
  const forbiddenRequests: string[] = [];
  let workspace: StudioWorkspace | undefined;
  let profileId = '';
  let completed = false;
  let removed = false;
  let profileRemoved = false;
  const record = async () => {
    await writeFile(
      `${artifactDirectory}/transcript.json`,
      JSON.stringify(
        {
          startedAt,
          checkedAt: new Date().toISOString(),
          url: testInfo.project.use.baseURL,
          configuredModel: process.env.OPENAI_MODEL,
          configuredReasoning: process.env.OPENAI_REASONING_EFFORT,
          completed,
          workspaceDeleted: removed,
          profileDeleted: profileRemoved,
          turns,
          actions,
          itinerary: workspace?.itinerary,
          itineraryRuns,
          entryRequirements: workspace?.entryRequirements,
          recommendations: workspace?.recommendations,
          services: workspace?.items,
          browserErrors: errors,
          forbiddenRequests,
        },
        null,
        2,
      ),
    );
  };
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/(?:bookings|reservations|payments|publish)(?:\/|$)/.test(path))
      forbiddenRequests.push(`${request.method()} ${path}`);
  });

  let initialClientId: string | undefined;
  try {
    await page.goto('/');
    const integrations = await page.request.get('/api/integrations');
    expect((await integrations.json()).ai).toBe(true);
    for (let index = 0; index < prompts.length; index++) {
      const prompt = prompts[index];
      const start = Date.now();
      const reviewed = responseFor(page, '/review');
      if (index === 0) {
        const created = responseFor(page, '/api/studio/workspaces');
        await page.getByRole('textbox', { name: 'Tell Tara about your trip' }).fill(prompt);
        await page.getByRole('button', { name: 'Start planning your trip' }).click();
        initialClientId = await confirmStudioStartClient(page, 'Demo Traveller');
        const createdResponse = await created;
        expect(createdResponse.status()).toBe(201);
        workspace = (await createdResponse.json()).workspace;
      } else {
        await closeStudioTool(page);
        await page.getByRole('textbox', { name: 'Reply or refine the route' }).fill(prompt);
        await page.getByRole('button', { name: 'Send to Tara', exact: true }).click();
      }
      const response = await reviewed;
      const result = await response.json();
      if (response.status() !== 200) {
        actions.push({
          action: `Failed chat turn: ${prompt}`,
          elapsedSeconds: Math.round((Date.now() - start) / 100) / 10,
          result: { status: response.status(), error: result.error },
        });
        await record();
      }
      expect(response.status(), result.error || `Prompt ${index + 1} completes`).toBe(200);
      workspace = result.workspace as StudioWorkspace;
      if (workspace.itinerary)
        itineraryRuns.push({
          afterPrompt: prompt,
          itinerary: structuredClone(workspace.itinerary),
        });
      const reply = workspace.messages
        .filter((message) => message.role === 'assistant')
        .at(-1)!.content;
      turns.push({
        prompt,
        reply,
        elapsedSeconds: Math.round((Date.now() - start) / 100) / 10,
        mode: result.mode,
        model: result.model,
        state: snapshot(workspace),
      });
      await record();
      console.log(JSON.stringify({ step: index + 1, ...turns.at(-1) }));
      await expect(page.getByRole('log')).toContainText(reply);
      expect(result.mode).toBe('live');
      // A saved yes/no confirmation is resolved deterministically without another model call.
      if (index !== 6) expect(result.model).toBe(process.env.OPENAI_MODEL || 'gpt-6-astra');
      if (index === 0) expect(reply).not.toMatch(/saved the details|review the missing/i);
      if (index >= 1) {
        expect(workspace.brief.clientName).toBe('Demo Traveller');
        expect(workspace.brief.origin).toMatch(/Melbourne/i);
        expect(workspace.brief.passportNationality).toBe('NZ');
      }
      if (index >= 2) {
        expect(workspace.stops[0].name).toBe('London');
        expect(workspace.brief.tripPurpose).toBe('business');
      }
      if (index === 3) expect(workspace.brief.departureDate).toBe('2026-11-03');
      if (index >= 4) expect(workspace.brief.startDate).toBe('2026-11-03');
      if (index === 5) {
        expect(workspace.clarification).toMatchObject({
          kind: 'stay_dates',
          statedNights: 3,
          proposedNights: 5,
          arrivalDate: '2026-11-03',
          departureDate: '2026-11-08',
        });
        await expect(page.getByRole('group', { name: 'Resolve trip dates' })).toBeVisible();
      }
      if (index >= 6) {
        expect(workspace.clarification).toBeNull();
        expect(workspace.stops[0].nights).toBe(5);
        expect(workspace.brief.endDate).toBe('2026-11-08');
      }
      if (index >= 7) {
        expect(workspace.brief).toMatchObject({
          adults: 1,
          children: 0,
          budget: 6000,
          currency: 'AUD',
          tripType: 'single',
          outboundTransport: 'flight',
          returnTransport: 'flight',
        });
        expect(workspace.brief.hotelStandard).toMatch(/4|four/i);
        expect(workspace.brief.hotelLocation).toMatch(/central|centre/i);
        expect(workspace.brief.foodPreferences?.join(' ')).toMatch(/vegetarian/i);
        expect(workspace.brief.cabin).toMatch(/economy/i);
      }
      if (index === 6) {
        await page.reload();
        await expect(page.getByRole('log')).toContainText(reply);
        await expect(page.getByRole('group', { name: 'Resolve trip dates' })).toHaveCount(0);
      }
      if (index === 8) {
        expect(workspace.entryRequirements).toHaveLength(1);
        expect(workspace.entryRequirements![0].passportCountryCode).toBe('NZ');
        expect(workspace.entryRequirements![0].destinationCountryCode).toBe('GB');
        expect(workspace.entryRequirements![0].sources.length).toBeGreaterThan(0);
      }
      if (index === 7) {
        await openStudioClientDesk(page);
        await openStudioClientProfiles(page, 'Client profiles · new or returning');
        await page.getByRole('button', { name: 'New client profile', exact: true }).click();
        const form = page.getByRole('form', { name: 'Client profile', exact: true });
        await expect(form.getByRole('textbox', { name: 'Profile name', exact: true })).toHaveValue(
          'Demo Traveller',
        );
        await expect(
          form.getByRole('textbox', { name: 'Background and preferences', exact: true }),
        ).toHaveValue(workspace.brief.context);
        await form.getByLabel('Profile country of residence', { exact: true }).selectOption('AU');
        await form.getByLabel('Profile nationality', { exact: true }).selectOption('NZ');
        await form.getByLabel('Profile passport nationality', { exact: true }).selectOption('NZ');
        await form.getByLabel('Profile date of birth', { exact: true }).fill('1990-02-04');
        await form
          .getByRole('textbox', { name: 'Interests · comma separated', exact: true })
          .fill('culture, quiet gardens');
        await form
          .getByRole('textbox', { name: 'Food preferences · comma separated', exact: true })
          .fill('vegetarian');
        await form.getByRole('button', { name: 'Add past trip', exact: true }).click();
        await form.getByLabel('Past trip 1 destination', { exact: true }).fill('Kyoto');
        await form.getByLabel('Past trip 1 country', { exact: true }).selectOption('JP');
        await form.getByLabel('Past trip 1 status', { exact: true }).selectOption('visited');
        await form.getByLabel('Past trip 1 date', { exact: true }).fill('2025-04-05');
        await form
          .getByLabel('Past trip 1 interests', { exact: true })
          .fill('quiet gardens, vegetarian food');
        await form.getByLabel('Past trip 1 feedback', { exact: true }).selectOption('liked');
        await form
          .getByLabel('Past trip 1 notes', { exact: true })
          .fill('Liked quiet gardens and vegetarian dining.');
        const createdProfile = responseFor(page, '/api/studio/client-profiles');
        const linkedWorkspace = responseFor(
          page,
          `/api/studio/workspaces/${workspace.id}`,
          'PATCH',
        );
        await form.getByRole('button', { name: 'Save client profile', exact: true }).click();
        const profileResponse = await createdProfile;
        expect(profileResponse.status()).toBe(201);
        const profile = (await profileResponse.json()).client;
        profileId = profile.id;
        const linkedResponse = await linkedWorkspace;
        expect(linkedResponse.status()).toBe(200);
        workspace = (await linkedResponse.json()).workspace;
        expect(workspace!.brief.clientId).toBe(profileId);
        expect(workspace!.brief.tripPurpose).toBe('business');
        expect(workspace!.stops[0].nights).toBe(5);
        actions.push({
          action:
            'After chat turn 8: Client profiles → New client profile → Save client profile, then reload and view travel history',
          elapsedSeconds: 0,
          result: {
            name: profile.name,
            countryOfResidence: profile.country,
            nationality: profile.nationality,
            passportNationality: profile.passportNationality,
            dateOfBirth: profile.dateOfBirth,
            interests: profile.interests,
            foodPreferences: profile.foodPreferences,
            history: profile.history,
            linked: workspace!.brief.clientId === profile.id,
          },
        });
        await record();
        await expect(form).not.toBeVisible();
        await page.reload();
        await openStudioClientDesk(page);
        await openStudioClientProfiles(page, 'Client profiles · Demo Traveller');
        await page.getByText('View travel history (1)', { exact: true }).click();
        const history = page.getByRole('region', { name: 'Saved travel history', exact: true });
        await expect(history).toContainText('Kyoto');
        await expect(history).toContainText('Liked quiet gardens and vegetarian dining.');
        await expect(history).toContainText('Visited');
        await page.screenshot({
          path: `${artifactDirectory}/00-client-profile-history.png`,
          fullPage: true,
        });
      }
    }
    expect(workspace!.structureAccepted).toBe(true);
    assertBusinessSchedule(workspace!);
    expect(workspace!.itinerary!.days.some((day) => day.activities.length > 0)).toBe(true);
    await page.screenshot({
      path: `${artifactDirectory}/01-conversation-and-itinerary.png`,
      fullPage: true,
    });

    await openStudioTool(page, 'Accommodation');
    await page.getByText('Find hotel or flight suggestions', { exact: true }).click();
    await page.getByLabel('Guest nationality · two-letter code').fill('NZ');
    let start = Date.now();
    const hotelResponse = responseFor(page, '/hotels/search');
    await page.getByRole('button', { name: 'Search hotels quotes', exact: true }).click();
    const hotelHttpResponse = await hotelResponse;
    const hotelResult = (await hotelHttpResponse.json()) as StudioHotelSearchResult & {
      error?: string;
    };
    actions.push({
      action:
        'Accommodation → Find hotel or flight suggestions → guest nationality NZ → Search hotels quotes',
      elapsedSeconds: Math.round((Date.now() - start) / 100) / 10,
      result: {
        status: hotelHttpResponse.status(),
        mode: hotelResult.mode,
        quotes: hotelResult.quotes?.length,
        hotels: hotelResult.hotels?.length,
        recommendations: hotelResult.recommendations,
        error: hotelResult.error,
      },
    });
    await record();
    expect(hotelHttpResponse.status(), hotelResult.error).toBe(200);
    expect(hotelResult.mode).toBe('test');
    expect(hotelResult.hotels.length).toBeGreaterThan(0);
    const matchesHotelBrief = (hotel: StudioHotelSearchResult['hotels'][number]) =>
      hotel.stars === 4 && hotel.distanceKm !== null && hotel.distanceKm <= 3;
    const recommendedHotel = hotelResult.recommendations.picks
      .map((pick) => hotelResult.hotels.find((hotel) => hotel.quoteId === pick.quoteId))
      .find((hotel) => hotel && matchesHotelBrief(hotel));
    const chosenHotel = recommendedHotel || hotelResult.hotels.find(matchesHotelBrief);
    actions.push({
      action: 'Review hotel star rating and destination-centre distance before selecting',
      elapsedSeconds: 0,
      result: chosenHotel
        ? {
            name: chosenHotel.name,
            stars: chosenHotel.stars,
            address: chosenHotel.address,
            distanceKm: chosenHotel.distanceKm,
            room: chosenHotel.room,
            price: chosenHotel.price,
            currency: chosenHotel.currency,
            rationale: recommendedHotel
              ? hotelResult.recommendations.picks.find(
                  (pick) => pick.quoteId === chosenHotel.quoteId,
                )?.reason
              : 'Selected from the returned inventory: supplied 4-star rating, within 3 km of the destination centre.',
          }
        : {
            limitation:
              'No returned hotel has a supplied 4-star rating and a known distance within 3 km of the destination centre.',
          },
    });
    await record();
    expect(chosenHotel, 'A quote must match the four-star central London preference').toBeDefined();
    expect(chosenHotel!.checkin).toBe('2026-11-03');
    expect(chosenHotel!.checkout).toBe('2026-11-08');
    const chosenHotelCard = page
      .getByTestId('all-hotel-results')
      .getByTestId('studio-hotel-card')
      .nth(hotelResult.hotels.findIndex((hotel) => hotel.quoteId === chosenHotel!.quoteId));
    await expect(chosenHotelCard).toBeVisible();
    await page.screenshot({ path: `${artifactDirectory}/02-hotel-search.png`, fullPage: true });
    const selectedQuote = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/quotes\/[^/]+$/.test(new URL(response.url()).pathname),
    );
    await chosenHotelCard.getByRole('button', { name: 'Add to itinerary', exact: true }).click();
    const selectedResponse = await selectedQuote;
    expect(selectedResponse.status()).toBe(200);
    workspace = (await selectedResponse.json()).workspace;
    expect(
      workspace!.items.some(
        (item) => item.kind === 'hotel' && item.priceStatus === 'sandbox' && item.included,
      ),
    ).toBe(true);
    actions.push({
      action: `Add the reviewed hotel quote for ${chosenHotel!.name} to the itinerary`,
      elapsedSeconds: 0,
      result: workspace!.items.map((item) => ({
        title: item.title,
        price: item.price,
        currency: item.currency,
        priceStatus: item.priceStatus,
        status: item.status,
      })),
    });
    await record();

    await page.getByRole('combobox', { name: 'Search for', exact: true }).click();
    await page.getByRole('option', { name: 'Flights', exact: true }).click();
    await page.getByRole('combobox', { name: 'Cabin for this search', exact: true }).click();
    await page.getByRole('option', { name: 'Economy', exact: true }).click();
    await page.getByLabel('Origin airport code', { exact: true }).fill('MEL');
    await page.getByLabel('Destination airport code', { exact: true }).fill('LHR');
    await page.getByLabel('Flight departure date', { exact: true }).fill('2026-11-03');
    await page.getByLabel('Return date · optional', { exact: true }).fill('2026-11-08');
    start = Date.now();
    const flightResponse = responseFor(page, '/flights/search');
    await page.getByRole('button', { name: 'Search flights quotes', exact: true }).click();
    const flightHttpResponse = await flightResponse;
    const flightResult = await flightHttpResponse.json();
    actions.push({
      action:
        'Accommodation → Flights → Economy → MEL to LHR → depart 3 November 2026 → return 8 November 2026 → Search flights quotes',
      elapsedSeconds: Math.round((Date.now() - start) / 100) / 10,
      result: {
        status: flightHttpResponse.status(),
        mode: flightResult.mode,
        quotes: flightResult.quotes,
        warning: flightResult.warning,
        error: flightResult.error,
      },
    });
    await record();
    expect(flightHttpResponse.status(), flightResult.error).toBe(200);
    expect(flightResult.mode).toBe('test');
    expect(flightResult.quotes.length).toBeGreaterThan(0);
    const matchingFlightIndex = flightResult.quotes.findIndex(
      (quote: StudioWorkspace['items'][number]) =>
        /MEL\s*→\s*LHR:\s*2026-11-03[^\n]*?–\s*2026-11-03/.test(quote.description) &&
        /LHR\s*→\s*MEL:\s*2026-11-08/.test(quote.description),
    );
    actions.push({
      action:
        'Review flight journeys against the supplied same-day London arrival and 8 November departure',
      elapsedSeconds: 0,
      result:
        matchingFlightIndex >= 0
          ? flightResult.quotes[matchingFlightIndex]
          : {
              limitation:
                'No returned quote matches arrival in London on 3 November and departure from London on 8 November. Do not silently change the stay dates.',
            },
    });
    await record();
    expect(
      matchingFlightIndex,
      'Flight journey dates must match the confirmed hotel stay',
    ).toBeGreaterThanOrEqual(0);
    const flightSelected = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/quotes\/[^/]+$/.test(new URL(response.url()).pathname),
    );
    await page
      .getByRole('button', { name: 'Add quote to proposal', exact: true })
      .nth(matchingFlightIndex)
      .click();
    const flightSelectedResponse = await flightSelected;
    expect(flightSelectedResponse.status()).toBe(200);
    workspace = (await flightSelectedResponse.json()).workspace;
    expect(
      workspace!.items.some(
        (item) => item.kind === 'flight' && item.priceStatus === 'sandbox' && item.included,
      ),
    ).toBe(true);
    await record();
    await page.screenshot({ path: `${artifactDirectory}/03-flight-quote.png`, fullPage: true });

    await openStudioTool(page, 'Optional ideas');
    await page.getByRole('combobox', { name: 'Recommendation type' }).click();
    await page.getByRole('option', { name: 'Places to eat', exact: true }).click();
    const foodQuery =
      'Three vegetarian-friendly restaurants in central London suitable for a solo business traveller. Use official restaurant sources and avoid assuming opening hours for November.';
    await page.getByLabel('What would suit this client?').fill(foodQuery);
    start = Date.now();
    const recommendationResponse = responseFor(page, '/recommendations');
    await page.getByRole('button', { name: 'Research recommendations', exact: true }).click();
    const recommendationHttp = await recommendationResponse;
    const researched = await recommendationHttp.json();
    expect(recommendationHttp.status(), researched.error).toBe(200);
    workspace = researched.workspace;
    actions.push({
      action: `Optional ideas → Places to eat → ${foodQuery}`,
      elapsedSeconds: Math.round((Date.now() - start) / 100) / 10,
      result: workspace!.recommendations,
    });
    await record();
    expect(workspace!.recommendations.length).toBeGreaterThan(0);
    expect(
      workspace!.recommendations.every((recommendation) => recommendation.sources.length > 0),
    ).toBe(true);
    const firstRecommendation = workspace!.recommendations[0];
    const inclusion = responseFor(page, `/api/studio/workspaces/${workspace!.id}`, 'PATCH');
    await page
      .getByRole('checkbox', {
        name: `Include ${firstRecommendation.name} in client proposal`,
        exact: true,
      })
      .check();
    const includedResponse = await inclusion;
    expect(includedResponse.status()).toBe(200);
    workspace = (await includedResponse.json()).workspace;
    await page.screenshot({
      path: `${artifactDirectory}/03-dining-recommendations.png`,
      fullPage: true,
    });

    const regenerationPrompt =
      'Update the complete day-by-day itinerary to include my selected hotel and return flight quotes and my included vegetarian restaurant recommendation. Keep the London stay 3–8 November 2026, Wednesday to Friday 9 am to 5 pm free for business meetings, gentle sightseeing in the evenings and on Saturday, and flexible arrival and departure days. These are sandbox quotes, not bookings; use only sourced places and do not reserve anything.';
    start = Date.now();
    const regeneratedResponse = responseFor(page, '/review');
    await closeStudioTool(page);
    await page.getByRole('textbox', { name: 'Reply or refine the route' }).fill(regenerationPrompt);
    await page.getByRole('button', { name: 'Send to Tara', exact: true }).click();
    const regeneratedHttp = await regeneratedResponse;
    const regenerated = await regeneratedHttp.json();
    if (regeneratedHttp.status() !== 200) {
      actions.push({
        action: `Failed chat turn: ${regenerationPrompt}`,
        elapsedSeconds: Math.round((Date.now() - start) / 100) / 10,
        result: { status: regeneratedHttp.status(), error: regenerated.error },
      });
      await record();
    }
    expect(regeneratedHttp.status(), regenerated.error).toBe(200);
    workspace = regenerated.workspace;
    itineraryRuns.push({
      afterPrompt: regenerationPrompt,
      itinerary: structuredClone(workspace!.itinerary),
    });
    turns.push({
      prompt: regenerationPrompt,
      reply: workspace!.messages.filter((message) => message.role === 'assistant').at(-1)!.content,
      elapsedSeconds: Math.round((Date.now() - start) / 100) / 10,
      mode: regenerated.mode,
      model: regenerated.model,
      state: snapshot(workspace!),
    });
    await record();
    assertBusinessSchedule(workspace!);

    await page.reload();
    const saved = await page.request.get(`/api/studio/workspaces/${workspace!.id}`);
    expect(saved.status()).toBe(200);
    workspace = (await saved.json()).workspace;
    expect(workspace!.itinerary?.days).toHaveLength(6);
    expect(workspace!.stops[0].nights).toBe(5);
    expect(
      workspace!.recommendations.find((item) => item.id === firstRecommendation.id)?.included,
    ).toBe(true);
    await openStudioTool(page, 'Proposal');
    await page.getByRole('button', { name: 'Preview client proposal', exact: true }).click();
    const proposal = page.getByTestId('client-proposal');
    await expect(proposal).toBeVisible();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download draft PDF', exact: true }).click();
    const pdfPath = `${artifactDirectory}/fictional-london-proposal.pdf`;
    await (await downloaded).saveAs(pdfPath);
    const pdf = await readFile(pdfPath);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    await expect(proposal).toContainText('Demo Traveller');
    await expect(proposal).toContainText(firstRecommendation.name);
    await expect(proposal).toContainText(workspace!.itinerary!.days[0].title);
    for (const item of workspace!.items.filter((item) => item.included))
      await expect(proposal).toContainText(item.title);
    await expect(proposal).toContainText('No confirmed priced items.');
    await expect(proposal).toContainText('2 services use sandbox test rates.');
    await expect(proposal).toContainText(
      'These rates are illustrative and excluded from item totals.',
    );
    await expect(proposal).toContainText('AUD');
    await expect(proposal).toContainText('USD');
    await page.screenshot({ path: `${artifactDirectory}/04-private-proposal.png`, fullPage: true });
    actions.push({
      action: 'Reload saved workspace → Proposal → Preview client proposal → Download draft PDF',
      elapsedSeconds: 0,
      result: {
        bytes: pdf.length,
        privatePreview: true,
        itineraryDays: workspace!.itinerary!.days.length,
        includedRecommendation: firstRecommendation.name,
        published: workspace!.proposal !== null,
      },
    });
    expect(workspace!.proposal).toBeNull();
    expect(forbiddenRequests).toEqual([]);
    expect(errors).toEqual([]);
    completed = true;
    await record();
  } finally {
    if (initialClientId)
      expect(
        (await page.request.delete(`/api/studio/client-profiles/${initialClientId}`)).status(),
      ).toBe(204);
    if (workspace?.id) {
      const deleted = await page.request.delete(`/api/studio/workspaces/${workspace.id}`);
      removed = deleted.status() === 204;
    }
    if (profileId) {
      const deleted = await page.request.delete(`/api/studio/client-profiles/${profileId}`);
      profileRemoved = deleted.status() === 204;
    }
    await record();
    expect(removed, 'The fictional workspace is deleted after the test').toBe(true);
    if (profileId)
      expect(profileRemoved, 'The fictional profile is deleted after the test').toBe(true);
  }
});
