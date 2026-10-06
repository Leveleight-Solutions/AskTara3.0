import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import { defaultStudioAgency, type StudioItem } from '../shared/studio';
import type { StudioHotelQuote, StudioHotelSearchResult } from '../shared/studio-hotels';
import type { StudioFlightQuote, StudioFlightSearchResult } from '../shared/studio-flights';
import { newStudioWorkspace } from '../server/studio-store';
import { applyStudioPatch, qualifyStudio } from '../server/studio-domain';
import { localStudioReview } from '../server/studio-local-intake';
import { syntheticTripBriefing, fulfilSyntheticTripBriefing } from './studio-trip-briefing-fixture';
import {
  studioJourneyInput,
  studioJourneyCanonicalInput,
  studioJourneyMissingFacts,
  type StudioJourneyResearch,
} from '../shared/studio-journey';

/** Clearly synthetic provider records; these do not assert real inventory or travel advice. */
async function setup(
  page: Page,
  options: {
    family?: boolean;
    missing?: boolean;
    failSave?: boolean;
    expired?: boolean;
    heldSearch?: Promise<void>;
    cruise?: boolean;
    planning?: boolean;
    modeUndecided?: boolean;
    datesUnknown?: boolean;
    heldJourney?: Promise<void>;
    unknownLocalArrival?: boolean;
    basic?: boolean;
    missingOrigin?: boolean;
  } = {},
) {
  const workspace = newStudioWorkspace(),
    agency = defaultStudioAgency();
  workspace.title = 'Synthetic chat supplier journey';
  workspace.stage = 'services';
  workspace.structureAccepted = true;
  Object.assign(workspace.brief, {
    clientName: 'Synthetic Chat Family',
    passportNationality: 'AU',
    tripPurpose: 'tourism',
    origin: 'MEL',
    departureDate: '2027-06-01',
    startDate: '2027-06-02',
    endDate: '2027-06-05',
    adults: 2,
    children: options.family ? 1 : 0,
    childAges: options.family ? [7] : [],
    currency: 'AUD',
    hotelStandard: 'Four stars',
    hotelLocation: 'City centre',
    cabin: 'Economy',
    returnTransport: 'flight',
    outboundTransport: 'flight',
  });
  workspace.stops = [
    {
      id: 'chat-london',
      name: 'London',
      country: 'United Kingdom',
      nights: 3,
      arrivalDate: '2027-06-02',
      departureDate: '2027-06-05',
      onwardTransport: 'undecided',
      neighbourhood: 'Soho',
      notes: '',
    },
  ];
  if (options.missing)
    Object.assign(workspace.brief, {
      adults: null,
      children: null,
      hotelStandard: '',
      hotelLocation: '',
    });
  if (options.planning) {
    workspace.stage = 'structure';
    workspace.structureAccepted = false;
    Object.assign(workspace.brief, {
      preferredDestination: 'London',
      startDate: '',
      endDate: '',
      tripDays: 4,
      returnDepartureDate: options.datesUnknown ? '' : '2027-06-05',
      ...(options.datesUnknown ? { departureDate: '', cabin: '' } : {}),
      ...(options.modeUndecided ? { outboundTransport: 'undecided' } : {}),
    });
    workspace.stops[0] = {
      ...workspace.stops[0],
      nights: null,
      arrivalDate: '',
      departureDate: '',
    };
    if (options.missingOrigin) {
      workspace.brief.origin = '';
      const createdAt = new Date().toISOString();
      workspace.messages.push(
        { id: 'known-destination', role: 'user', content: 'London', createdAt },
        {
          id: 'pending-transport-question',
          role: 'assistant',
          content: 'How would you like to travel there: Flight or Cruise?',
          createdAt,
        },
      );
    }
  }
  if (options.cruise)
    workspace.cruises = [
      {
        id: 'synthetic-cruise',
        name: 'Synthetic reviewed sailing',
        ship: 'Synthetic ship',
        sourceUrl: 'https://supplier-visuals.example.test/sailing',
        sourceName: 'Synthetic reviewed supplier schedule',
        extractedAt: new Date().toISOString(),
        currency: 'AUD',
        fullFare: 9000,
        disembarkAfterDay: 2,
        onwardTransport: 'flight',
        returnTransport: 'flight',
        warnings: [],
        days: ['Sydney', 'At sea', 'Melbourne'].map((port, index) => ({
          id: `cruise-day-${index}`,
          day: index + 1,
          date: `2027-06-0${index + 2}`,
          port,
          arrival: index ? '08:00' : '',
          departure: '17:00',
          details: 'Synthetic reviewed schedule.',
        })),
      },
    ];
  workspace.qualification = qualifyStudio(workspace, agency);
  const quotedAt = new Date(Date.now() - (options.expired ? 31 * 60000 : 0)).toISOString();
  const hotel: StudioHotelQuote = {
    quoteId: '81000000-0000-4000-8000-000000000001',
    hotelKey: 'synthetic-hotel',
    name: 'Synthetic supplier hotel',
    address: 'Synthetic supplier address, London',
    room: options.family ? 'Synthetic family room' : 'Synthetic double room',
    board: 'Supplier breakfast',
    price: 900,
    currency: 'AUD',
    checkin: '2027-06-02',
    checkout: '2027-06-05',
    quotedAt,
    mode: 'test',
    adults: 2,
    childAges: options.family ? [7] : [],
    photos: [
      {
        url: 'https://supplier-visuals.example.test/hotel.png',
        caption: 'Synthetic supplier exterior',
      },
    ],
    roomPhotos: [
      {
        url: 'https://supplier-visuals.example.test/room.png',
        caption: 'Synthetic mapped quoted room',
      },
    ],
    description: 'Synthetic supplier property description.',
    roomDescription: 'Synthetic supplier room description.',
    amenities: ['Wi-Fi'],
    roomAmenities: ['Air conditioning'],
    group: 'Synthetic group',
    stars: 4,
    distanceKm: 1.2,
    cancellation: 'Synthetic non-refundable rate.',
    taxes: 'Synthetic tax details.',
    detailsStatus: 'available',
  };
  const segment = (
    id: string,
    from: string,
    to: string,
    departure: string,
    arrival: string,
    duration: string,
  ) => ({
    id,
    origin: { code: from },
    destination: { code: to },
    departure,
    arrival,
    duration,
    marketingCarrier: {
      name: 'Synthetic Airways',
      code: 'ZZ',
      logoUrl: 'https://supplier-visuals.example.test/airline.png',
    },
    marketingFlightNumber: id === 'leg-1' ? '10' : '20',
  });
  const flight: StudioFlightQuote = {
    id: 'scoped-synthetic-flight',
    quoteId: '81000000-0000-4000-8000-000000000002',
    quotedAt,
    mode: 'test',
    airline: 'Synthetic Airways',
    airlineLogoUrl: 'https://supplier-visuals.example.test/airline.png',
    origin: 'MEL',
    destination: 'LHR',
    departure: '2027-06-01T22:00:00+10:00',
    arrival: '2027-06-02T13:00:00+01:00',
    duration: 'PT24H',
    stops: 1,
    price: 4200,
    currency: 'AUD',
    passengerCount: 2,
    priceScope: 'all_passengers_complete_journey',
    requestedJourneyCount: 2,
    expiresAt: new Date(Date.now() + (options.expired ? -60000 : 20 * 60000)).toISOString(),
    liveMode: false,
    journeys: [
      {
        id: 'outbound',
        origin: { code: 'MEL' },
        destination: { code: 'LHR' },
        departure: '2027-06-01T22:00:00+10:00',
        arrival: '2027-06-02T13:00:00+01:00',
        duration: 'PT24H',
        connections: 1,
        stops: 1,
        segments: [
          segment(
            'leg-1',
            'MEL',
            'DXB',
            '2027-06-01T22:00:00+10:00',
            '2027-06-02T06:00:00+04:00',
            'PT14H',
          ),
          segment(
            'leg-2',
            'DXB',
            'LHR',
            '2027-06-02T09:00:00+04:00',
            '2027-06-02T13:00:00+01:00',
            'PT7H',
          ),
        ],
      },
      {
        id: 'return',
        origin: { code: 'LHR' },
        destination: { code: 'MEL' },
        departure: '2027-06-05T20:00:00+01:00',
        arrival: '2027-06-07T06:00:00+10:00',
        duration: 'PT25H',
        connections: 0,
        stops: 0,
        segments: [
          segment(
            'leg-3',
            'LHR',
            'MEL',
            '2027-06-05T20:00:00+01:00',
            '2027-06-07T06:00:00+10:00',
            'PT25H',
          ),
        ],
      },
    ],
    connections: [
      {
        journeyId: 'outbound',
        arrivalAirport: { code: 'DXB' },
        departureAirport: { code: 'DXB' },
        arrival: '2027-06-02T06:00:00+04:00',
        departure: '2027-06-02T09:00:00+04:00',
        durationMinutes: 180,
        airportChange: false,
        overnight: false,
        kind: 'connection',
      },
    ],
    advisories: [
      {
        kind: 'transit',
        summary: 'Synthetic supplier connection: verify transit entry rules before travel.',
        basis: 'supplier_schedule',
      },
    ],
  };
  if (options.unknownLocalArrival) {
    flight.arrival = '2027-06-02T12:00:00Z';
    flight.journeys![0].arrival = flight.arrival;
    flight.journeys![0].segments.at(-1)!.arrival = flight.arrival;
  }
  let returnedFlight: StudioFlightQuote | undefined;
  const quote = (id: string, kind: 'hotel' | 'flight'): StudioItem => ({
    id,
    kind,
    title: kind === 'hotel' ? hotel.name : flight.airline,
    description: 'Synthetic supplier quote.',
    stopId: 'chat-london',
    startDate: kind === 'hotel' ? hotel.checkin : '2027-06-01',
    endDate: '2027-06-05',
    status: 'suggested',
    source: 'liteapi',
    sourceUrl: '',
    supplier: 'Synthetic supplier',
    privateReference: '',
    price: kind === 'hotel' ? hotel.price : flight.price,
    currency: 'AUD',
    priceStatus: 'sandbox',
    quotedAt,
    included: false,
    needsReview: false,
    cost: null,
    imageUrl: kind === 'hotel' ? hotel.photos[0].url : flight.airlineLogoUrl,
    presentation: kind === 'hotel' ? { kind: 'hotel', hotel } : { kind: 'flight', flight },
  });
  const hotelResult: StudioHotelSearchResult = {
    quotes: [quote(hotel.quoteId, 'hotel')],
    hotels: [hotel],
    recommendations: {
      status: 'ai',
      picks: [
        {
          quoteId: hotel.quoteId,
          reason: 'Synthetic supplier location matches the declared brief.',
        },
      ],
      message: 'Synthetic shortlist.',
    },
    inventory: {
      returnedHotels: 1,
      returnedQuotes: 1,
      limit: 150,
      hasMore: false,
      searchRadiusKm: 15,
      pagesSearched: 1,
      incomplete: false,
      nextOffset: null,
    },
    mode: 'test',
    warning: 'Synthetic sandbox prices. No reservation.',
  };
  const flightResult: StudioFlightSearchResult = {
    quotes: [quote(flight.quoteId, 'flight')],
    flights: [flight],
    mode: 'test',
    warning: 'Synthetic sandbox fares. No ticket or reservation.',
  };
  const writes: { path: string; body: Record<string, any> }[] = [],
    unexpected: string[] = [],
    aborted: string[] = [];
  const failed = new Set<string>();
  let saveAttempts = 0;
  page.on('requestfailed', (request) => {
    if (request.url().includes('/hotels/search') || request.url().endsWith('/journey/research')) {
      failed.add(request.url());
      aborted.push(request.failure()?.errorText || 'aborted');
    }
  });
  await page.route('https://supplier-visuals.example.test/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
        'base64',
      ),
    }),
  );
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname,
      method = route.request().method();
    const json = (value: unknown, status = 200) => route.fulfill({ json: value, status });
    if (path === '/api/session') return json({ user: null });
    if (path === '/api/config') return json({});
    if (path === '/api/catalog') return json(catalog);
    if (path === '/api/profile') return json({ profile: defaultTravelProfile });
    if (path === '/api/saved') return json({ items: [] });
    if (path === '/api/trips') return json({ trips: [] });
    if (path === '/api/integrations')
      return json({
        ai: Boolean(options.planning && !options.basic),
        hotels: true,
        flights: true,
        activities: false,
        mode: 'test',
      });
    if (path === '/api/studio/agency') return json({ agency });
    if (path === '/api/studio/clients' || path === '/api/studio/client-profiles')
      return json({ clients: [] });
    if (path === '/api/studio/workspaces') return json({ workspaces: [workspace] });
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'GET')
      return json({ workspace });
    if (await fulfilSyntheticTripBriefing(route, workspace)) return;
    const body = route.request().postDataJSON() || {};
    writes.push({ path, body });
    if (options.missingOrigin && path === `/api/studio/workspaces/${workspace.id}/review`) {
      if (body.revision !== workspace.revision)
        return json({ error: 'Synthetic short-answer revision changed.' }, 409);
      // Exercise the real deterministic short-answer intake; provider research stays synthetic.
      const reply = localStudioReview(workspace, String(body.message), agency);
      const createdAt = new Date().toISOString();
      workspace.messages.push(
        { id: crypto.randomUUID(), role: 'user', content: String(body.message), createdAt },
        { id: crypto.randomUUID(), role: 'assistant', content: reply, createdAt },
      );
      workspace.qualification = qualifyStudio(workspace, agency);
      workspace.revision++;
      return json({ workspace, reply, mode: 'local', nextAction: 'journey' });
    }
    if (path.endsWith('/journey/research')) {
      if (options.heldJourney) await options.heldJourney;
      if (failed.has(route.request().url())) return;
      if (body.revision !== workspace.revision)
        return json({ error: 'Synthetic journey revision changed.' }, 409);
      const direction = body.direction === 'return' ? 'return' : 'outbound';
      const input = studioJourneyInput(workspace, direction, body.mode);
      const research: StudioJourneyResearch = {
        input,
        inputKey: createHash('sha256').update(studioJourneyCanonicalInput(input)).digest('hex'),
        checkedAt: new Date().toISOString(),
        status: 'ready',
        summary: 'Synthetic published routes; schedules and fares need a dated supplier quote.',
        options: [
          {
            id: `synthetic-${direction}-${body.mode}`,
            basis: 'route_guidance',
            title:
              body.mode === 'cruise'
                ? 'Synthetic cruise route'
                : 'Synthetic connecting flight route',
            operator: body.mode === 'cruise' ? 'Synthetic Cruise Company' : 'Synthetic Airways',
            origin: input.origin,
            destination: input.destination,
            originAirportCode: body.mode === 'cruise' ? '' : direction === 'return' ? 'LHR' : 'MEL',
            destinationAirportCode:
              body.mode === 'cruise' ? '' : direction === 'return' ? 'MEL' : 'LHR',
            via: [body.mode === 'cruise' ? 'Synthetic port' : 'Dubai'],
            duration: 'Confirm the dated schedule.',
            summary: 'Synthetic sourced route guidance for testing the interface.',
            returnSummary: 'Compare the return separately; a dated schedule confirms the arrival.',
            sources: [
              {
                url: 'https://www.qantas.com/',
                label: 'Synthetic official source fixture',
                checkedAt: new Date().toISOString(),
              },
            ],
            departureDate: '',
            arrivalDate: '',
            price: null,
          },
        ],
        missingFacts: studioJourneyMissingFacts(input),
        notes: ['Synthetic route guidance, not supplier inventory.'],
      };
      workspace.journeyResearch = { ...workspace.journeyResearch, [direction]: research };
      workspace.revision++;
      return json({ workspace, research });
    }
    if (path.endsWith('/journey/select')) {
      if (body.revision !== workspace.revision)
        return json({ error: 'Synthetic selection revision changed.' }, 409);
      const direction = body.direction === 'return' ? 'return' : 'outbound';
      const research = workspace.journeyResearch?.[direction];
      const selected = research?.options.find((option) => option.id === body.optionId);
      if (!research || !selected) return json({ error: 'Synthetic guidance missing.' }, 404);
      workspace.journeySelections = {
        ...workspace.journeySelections,
        [direction]: {
          direction,
          mode: body.mode || research.input.mode,
          inputKey: research.inputKey,
          selectedAt: new Date().toISOString(),
          option: selected,
        },
      };
      workspace.revision++;
      return json({ workspace });
    }
    if (path.endsWith('/hotels/search')) {
      if (options.heldSearch) await options.heldSearch;
      if (failed.has(route.request().url())) return;
      return json(hotelResult);
    }
    if (path.endsWith('/flights/search')) {
      if (path.endsWith('/journey/flights/search') && body.direction === 'return') {
        const returning = flight.journeys![1];
        returnedFlight = {
          ...flight,
          origin: 'LHR',
          destination: 'MEL',
          departure: returning.departure,
          arrival: returning.arrival,
          journeys: [returning],
          requestedJourneyCount: 1,
          connections: [],
        };
        return json({
          ...flightResult,
          flights: [returnedFlight],
        });
      }
      return json(flightResult);
    }
    if (path.includes('/quotes/')) {
      if (body.revision !== workspace.revision)
        return json({ error: 'Synthetic current revision required.' }, 409);
      let selected = [...hotelResult.quotes, ...flightResult.quotes].find((item) =>
        path.endsWith(item.id),
      );
      if (!selected) return json({ error: 'Synthetic scoped quote missing.' }, 404);
      if (body.direction === 'return' && returnedFlight)
        selected = { ...selected, presentation: { kind: 'flight', flight: returnedFlight } };
      workspace.items.push({ ...selected, included: true });
      if (path.includes('/journey/quotes/')) {
        if (body.direction !== 'return' && !options.unknownLocalArrival) {
          workspace.brief.startDate = '2027-06-02';
          workspace.stops[0] = {
            ...workspace.stops[0],
            nights: 3,
            arrivalDate: '2027-06-02',
            departureDate: '2027-06-05',
          };
        }
        workspace.brief.endDate = '2027-06-05';
      }
      workspace.revision++;
      return json({
        workspace,
        ...(path.includes('/journey/quotes/')
          ? {
              dateResolution: {
                arrivalDate:
                  body.direction === 'return' || options.unknownLocalArrival ? null : '2027-06-02',
                returnDepartureDate: '2027-06-05',
                nights: body.direction === 'return' || options.unknownLocalArrival ? null : 3,
                notes: options.unknownLocalArrival
                  ? [
                      'The supplier did not provide an unambiguous local arrival date. Confirm arrival before setting hotel dates.',
                    ]
                  : [],
              },
            }
          : {}),
      });
    }
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'PATCH') {
      if (options.failSave && ++saveAttempts === 1)
        return json({ error: 'Synthetic save failed; your draft is unchanged.' }, 500);
      if (body.revision !== workspace.revision)
        return json({ error: 'Synthetic revision changed.' }, 409);
      applyStudioPatch(workspace, body, agency);
      workspace.revision++;
      workspace.qualification = qualifyStudio(workspace, agency);
      return json({ workspace });
    }
    unexpected.push(`${method} ${path}`);
    return json({ error: `Unexpected synthetic request ${method} ${path}` }, 500);
  });
  await page.goto(`/studio/${workspace.id}`);
  const offers = page.getByRole('region', { name: 'Supplier options in chat', exact: true });
  await expect(
    page.getByRole('region', { name: 'Tara planning actions', exact: true }),
  ).toBeVisible();
  return { workspace, offers, writes, unexpected, hotel, flight, aborted };
}

async function searchHotel(page: Page, offers: ReturnType<Page['getByRole']>) {
  await page
    .getByRole('region', { name: 'Tara planning actions', exact: true })
    .getByRole('button', { name: 'Hotels in London', exact: true })
    .click();
  const popup = page.getByRole('dialog', { name: 'Hotel options', exact: true });
  await expect(popup.getByLabel('Confirm guest nationality', { exact: true })).toHaveValue('AU');
  await popup.getByRole('button', { name: 'Search available hotels', exact: true }).click();
}
async function searchFlight(page: Page, offers: ReturnType<Page['getByRole']>) {
  await page
    .getByRole('region', { name: 'Tara planning actions', exact: true })
    .getByRole('button', { name: 'Find flights', exact: true })
    .click();
  const popup = page.getByRole('dialog', { name: 'Flight options', exact: true });
  await expect(popup.getByLabel('Origin airport code', { exact: true })).toHaveValue('MEL');
  await expect(popup.getByLabel('Flight departure date', { exact: true })).toHaveValue(
    '2027-06-01',
  );
  await expect(popup.getByLabel('Return departure date', { exact: true })).toHaveValue(
    '2027-06-05',
  );
  await popup.getByLabel('Destination airport code', { exact: true }).fill('LHR');
  await popup.getByRole('button', { name: 'Search available flights', exact: true }).click();
}
async function announce(page: Page, workspace: unknown) {
  await page.evaluate(async (value) => {
    const path = '/src/studioEvents.ts';
    const module = await import(path);
    module.emitStudioWorkspaceEvent({ type: 'updated', workspace: value });
  }, workspace);
}

test('desktop chat shows real supplied hotel and mapped room photos, family stay price, and current-revision one-click inclusion after metadata changes', async ({
  page,
}) => {
  const state = await setup(page, { family: true });
  await page
    .getByRole('region', { name: 'Tara planning actions', exact: true })
    .getByRole('button', { name: 'Hotels in London', exact: true })
    .click();
  const popup = page.getByRole('dialog', { name: 'Hotel options', exact: true });
  await expect(popup.getByLabel('Confirm guest nationality', { exact: true })).toHaveValue('AU');
  await expect(popup.getByLabel('Adults for this trip', { exact: true })).toHaveCount(0);
  await expect(popup.getByLabel('Hotel standard', { exact: true })).toHaveCount(0);
  await popup.getByRole('button', { name: 'Search available hotels', exact: true }).click();
  const card = state.offers.getByTestId('studio-chat-hotel-card');
  await expect(card).toContainText('Sandbox availability');
  await expect(card).toContainText('Full stay · 2 adults + 1 child · one room');
  await expect(card).toContainText('900');
  await expect(card).toContainText('Check-in Jun 2, 2027 · Check-out Jun 5, 2027');
  await expect(
    card.getByRole('img', { name: 'Synthetic supplier exterior', exact: true }),
  ).toHaveAttribute('src', state.hotel.photos[0].url);
  await card.getByRole('button', { name: 'Quoted room photos', exact: true }).click();
  await expect(
    card.getByRole('img', { name: 'Synthetic mapped quoted room', exact: true }),
  ).toHaveAttribute('src', state.hotel.roomPhotos[0].url);
  state.workspace.revision++;
  state.workspace.title = 'Synthetic metadata updated';
  state.workspace.tripBriefing = syntheticTripBriefing(state.workspace);
  await announce(page, state.workspace);
  await expect(
    page.getByRole('heading', { name: 'Synthetic metadata updated', exact: true }),
  ).toBeVisible();
  await expect(card.getByRole('button', { name: 'Add to proposal', exact: true })).toBeEnabled();
  await card.getByRole('button', { name: 'Add to proposal', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Added', exact: true })).toBeDisabled();
  expect(state.writes.find(({ path }) => path.includes('/quotes/'))?.body.revision).toBe(2);
  await page.reload();
  const restored = page.getByTestId('studio-chat-hotel-card');
  await expect(restored).toContainText('Synthetic family room');
  await expect(restored.getByRole('button', { name: 'Added', exact: true })).toBeDisabled();
  await restored.getByRole('button', { name: 'Quoted room photos', exact: true }).click();
  await expect(
    restored.getByRole('img', { name: 'Synthetic mapped quoted room', exact: true }),
  ).toHaveAttribute('src', state.hotel.roomPhotos[0].url);
  state.workspace.brief.adults = 3;
  state.workspace.items[0].needsReview = true;
  state.workspace.items[0].priceStatus = 'agent_estimate';
  state.workspace.revision++;
  await announce(page, state.workspace);
  await expect(restored).toContainText('Review required');
  await expect(restored).toContainText('Recorded estimate');
  await expect(restored).toContainText('Recorded full stay · 2 adults + 1 child');
  await expect(restored.getByRole('button', { name: 'Added', exact: true })).toBeDisabled();
  expect(state.writes.some(({ path }) => /booking|payment|publish|prebook/.test(path))).toBe(false);
  expect(state.unexpected).toEqual([]);
});

test('flight chat retains supplier logo, outbound/return legs, verified layover and all-party fare after quote inclusion and reload', async ({
  page,
}) => {
  const state = await setup(page);
  await searchFlight(page, state.offers);
  const card = state.offers.getByTestId('studio-chat-flight-card');
  await expect(
    card.getByRole('img', { name: 'Synthetic Airways logo', exact: true }),
  ).toHaveAttribute('src', state.flight.airlineLogoUrl!);
  await expect(card).toContainText('Sandbox fare');
  await expect(card).toContainText('Total for 2 travellers · outbound + return');
  await expect(
    card.getByRole('region', { name: 'Outbound flight legs', exact: true }),
  ).toContainText('MEL');
  await expect(
    card.getByRole('region', { name: 'Outbound flight legs', exact: true }),
  ).toContainText('DXB');
  await expect(card).toContainText('Layover at DXB · 3h 0m');
  await expect(card.getByRole('region', { name: 'Return flight legs', exact: true })).toContainText(
    'LHR',
  );
  await card.getByRole('button', { name: 'Add to proposal', exact: true }).click();
  await expect(card.getByRole('button', { name: 'Added', exact: true })).toBeDisabled();
  const flightSearch = state.writes.find(({ path }) => path.endsWith('/flights/search'))!;
  expect(flightSearch.body).toMatchObject({
    origin: 'MEL',
    destination: 'LHR',
    departureDate: '2027-06-01',
    returnDate: '2027-06-05',
    adults: 2,
    cabinClass: 'economy',
  });
  await page.reload();
  const restored = page.getByTestId('studio-chat-flight-card');
  await expect(restored).toContainText('Layover at DXB · 3h 0m');
  await expect(
    restored.getByRole('img', { name: 'Synthetic Airways logo', exact: true }),
  ).toHaveAttribute('src', state.flight.airlineLogoUrl!);
  expect(state.workspace.items[0].presentation?.kind).toBe('flight');
  expect(state.unexpected).toEqual([]);
});

test('missing party and hotel facts save explicitly before searching at the returned revision, and a failed save keeps the popup draft', async ({
  page,
}) => {
  const state = await setup(page, { missing: true, failSave: true });
  await page
    .getByRole('region', { name: 'Tara planning actions', exact: true })
    .getByRole('button', { name: 'Hotels in London', exact: true })
    .click();
  const popup = page.getByRole('dialog', { name: 'Hotel options', exact: true });
  await popup.getByLabel('Adults for this trip', { exact: true }).fill('2');
  await popup.getByRole('button', { name: 'No children', exact: true }).click();
  await popup.getByLabel('Hotel standard', { exact: true }).fill('Four stars');
  await popup.getByLabel('Hotel location', { exact: true }).fill('City centre');
  await popup.getByRole('button', { name: 'Search available hotels', exact: true }).click();
  await expect(popup.getByRole('alert')).toContainText(/not saved|could not be saved/);
  await expect(popup.getByLabel('Adults for this trip', { exact: true })).toHaveValue('2');
  await expect(
    popup.getByRole('button', { name: 'Search available hotels', exact: true }),
  ).toBeEnabled();
  expect(state.writes.filter(({ path }) => path.endsWith('/hotels/search'))).toEqual([]);
  await popup.getByRole('button', { name: 'Search available hotels', exact: true }).click();
  await expect(state.offers.getByTestId('studio-chat-hotel-card')).toBeVisible();
  expect(state.writes.find(({ path }) => path.endsWith('/hotels/search'))?.body.revision).toBe(2);
  expect(state.workspace.brief.adults).toBe(2);
  expect(state.workspace.brief.children).toBe(0);
  expect(state.unexpected).toEqual([]);
});

test('expired hotel rates and flight fares cannot send inclusion mutations', async ({ page }) => {
  const state = await setup(page, { expired: true });
  await searchHotel(page, state.offers);
  await expect(
    state.offers
      .getByTestId('studio-chat-hotel-card')
      .getByRole('button', { name: 'Add to proposal', exact: true }),
  ).toBeDisabled();
  await searchFlight(page, state.offers);
  await expect(state.offers.getByTestId('studio-chat-flight-card')).toContainText(
    'This quote has expired',
  );
  await expect(
    state.offers
      .getByTestId('studio-chat-flight-card')
      .getByRole('button', { name: 'Add to proposal', exact: true }),
  ).toBeDisabled();
  expect(state.writes.filter(({ path }) => path.includes('/quotes/'))).toEqual([]);
  expect(state.workspace.items).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('changed actual trip criteria abort pending supplier work and a late response cannot restore stale options', async ({
  page,
}) => {
  let release!: () => void;
  const heldSearch = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = await setup(page, { heldSearch });
  try {
    await searchHotel(page, state.offers);
    await expect
      .poll(() => state.writes.filter(({ path }) => path.endsWith('/hotels/search')).length)
      .toBe(1);
    state.workspace.brief.hotelLocation = 'Bloomsbury';
    state.workspace.revision++;
    await announce(page, state.workspace);
    await expect.poll(() => state.aborted.length).toBe(1);
    release();
    await expect(
      page
        .getByRole('region', { name: 'Tara planning actions', exact: true })
        .getByRole('button', { name: 'Hotels in London', exact: true }),
    ).toBeEnabled();
    await expect(state.offers.getByTestId('studio-chat-hotel-card')).toHaveCount(0);
    expect(state.aborted[0]).toMatch(/ABORTED|aborted/i);
    expect(state.workspace.items).toEqual([]);
    expect(state.unexpected).toEqual([]);
  } finally {
    release();
  }
});

test('reviewed cruise cards preserve source, ports and full fare for partial sailing without inventing inventory', async ({
  page,
}) => {
  const state = await setup(page, { cruise: true });
  await page
    .getByRole('region', { name: 'Tara planning actions', exact: true })
    .getByRole('button', { name: 'Add cruise sailing', exact: true })
    .click();
  const card = state.offers.getByTestId('studio-chat-cruise-card');
  await expect(card).toContainText('9,000.00');
  await expect(card).toContainText('leaving early retains the full fare');
  await expect(card).toContainText('2 planned cruise days');
  await card.getByText('Ports & source', { exact: true }).click();
  await expect(
    card.getByRole('link', { name: 'Synthetic reviewed supplier schedule', exact: true }),
  ).toHaveAttribute('href', state.workspace.cruises![0].sourceUrl);
  await expect(card).toContainText('current cruise availability has not been searched');
  await expect(card.getByRole('img')).toHaveCount(0);
  await card.getByRole('button', { name: 'Review sailing', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit route', exact: true })).toBeVisible();
  await expect(page.getByLabel('Saved cruise to edit', { exact: true })).toHaveValue(
    'synthetic-cruise',
  );
  expect(state.workspace.cruises![0].fullFare).toBe(9000);
  expect(state.writes).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('one flight choice researches sourced routes before dates or party, and cached guidance survives reload without arrival guesses', async ({
  page,
}) => {
  const state = await setup(page, {
    planning: true,
    modeUndecided: true,
    datesUnknown: true,
    missing: true,
  });
  const planner = page.getByRole('region', { name: 'Journey planner', exact: true });
  const composer = page.getByRole('textbox', {
    name: 'Client request or planning notes',
    exact: true,
  });
  await composer.fill('Keep this unsent client note.');
  await planner.getByRole('button', { name: 'Flight', exact: true }).click();
  const route = planner.getByRole('article', {
    name: 'Synthetic connecting flight route',
    exact: true,
  });
  await expect(route).toBeVisible();
  await expect(route).toContainText('Via Dubai');
  await expect(route).toContainText('Arrival not confirmed');
  await expect(route).toContainText('Fare not quoted');
  await route.getByText('Return, connections & sources', { exact: true }).click();
  await expect(
    route.getByRole('link', { name: 'Synthetic official source fixture' }),
  ).toHaveAttribute('href', 'https://www.qantas.com/');
  expect(state.workspace.brief.adults).toBeNull();
  expect(state.workspace.brief.children).toBeNull();
  expect(state.workspace.brief.departureDate || '').toBe('');
  expect(state.workspace.brief.startDate).toBe('');
  expect(state.workspace.stops[0].nights).toBeNull();
  expect(state.workspace.structureAccepted).toBe(false);
  await expect(composer).toHaveValue('Keep this unsent client note.');
  expect(state.writes.filter(({ path }) => path.endsWith('/journey/research'))).toHaveLength(1);
  await page.reload();
  await expect(
    page
      .getByRole('region', { name: 'Journey planner', exact: true })
      .getByRole('article', { name: 'Synthetic connecting flight route', exact: true }),
  ).toBeVisible();
  expect(state.writes.filter(({ path }) => path.endsWith('/journey/research'))).toHaveLength(1);
  expect(state.writes.some(({ path }) => /booking|payment|publish|prebook/.test(path))).toBe(false);
  expect(state.unexpected).toEqual([]);
});

test('outward quote handoff uses sourced airports and actual supplier dates before route approval', async ({
  page,
}) => {
  const state = await setup(page, { planning: true });
  const planner = page.getByRole('region', { name: 'Journey planner', exact: true });
  await planner.getByRole('button', { name: 'Use this route', exact: true }).click();
  expect(state.workspace.stops[0].arrivalDate).toBe('');
  expect(state.workspace.stops[0].nights).toBeNull();
  await planner.getByRole('button', { name: 'Continue to flight quotes', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Flight options', exact: true });
  await expect(popup.getByLabel('Origin airport code', { exact: true })).toHaveValue('MEL');
  await expect(popup.getByLabel('Destination airport code', { exact: true })).toHaveValue('LHR');
  await expect(popup.getByLabel('Flight departure date', { exact: true })).toHaveValue(
    '2027-06-01',
  );
  await expect(popup.getByLabel('Return departure date', { exact: true })).toHaveValue(
    '2027-06-05',
  );
  await popup.getByRole('button', { name: 'Search available flights', exact: true }).click();
  const card = state.offers.getByTestId('studio-chat-flight-card');
  await expect(card).toContainText('Layover at DXB · 3h 0m');
  await card.getByRole('button', { name: 'Use flight dates', exact: true }).click();
  await expect.poll(() => state.workspace.brief.startDate).toBe('2027-06-02');
  expect(state.workspace.structureAccepted).toBe(false);
  expect(state.workspace.stops[0].nights).toBe(3);
  expect(state.workspace.brief.tripDays).toBe(4);
  expect(
    state.writes.find(({ path }) => path.endsWith('/journey/flights/search'))?.body,
  ).toMatchObject({
    direction: 'outbound',
    stopId: 'chat-london',
    origin: 'MEL',
    destination: 'LHR',
  });
  expect(state.writes.find(({ path }) => path.includes('/journey/quotes/'))?.body.direction).toBe(
    'outbound',
  );
  await page.reload();
  await expect(page.getByTestId('studio-chat-flight-card')).toContainText('Layover at DXB · 3h 0m');
  expect(state.writes.some(({ path }) => /booking|payment|publish|prebook/.test(path))).toBe(false);
  expect(state.unexpected).toEqual([]);
});

test('return route handoff opens a separate one-way search with reversed sourced airports and return departure', async ({
  page,
}) => {
  const state = await setup(page, { planning: true });
  const planner = page.getByRole('region', { name: 'Journey planner', exact: true });
  await expect(planner.getByRole('button', { name: 'Use this route', exact: true })).toBeVisible();
  await planner.getByRole('button', { name: 'Return journey', exact: true }).click();
  await expect(planner.getByLabel('From', { exact: true })).toHaveValue('London');
  await expect(planner.getByLabel('To', { exact: true })).toHaveValue('MEL');
  await planner.getByRole('button', { name: 'Use this route', exact: true }).click();
  await planner.getByRole('button', { name: 'Continue to flight quotes', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Flight options', exact: true });
  await expect(popup.getByLabel('Origin airport code', { exact: true })).toHaveValue('LHR');
  await expect(popup.getByLabel('Destination airport code', { exact: true })).toHaveValue('MEL');
  await expect(popup.getByLabel('Flight departure date', { exact: true })).toHaveValue(
    '2027-06-05',
  );
  await expect(popup.getByLabel('Flight journey', { exact: true })).toHaveValue('one_way');
  await popup.getByRole('button', { name: 'Search available flights', exact: true }).click();
  const card = state.offers.getByTestId('studio-chat-flight-card');
  await expect(card.getByRole('region', { name: 'Return flight legs', exact: true })).toContainText(
    'LHR',
  );
  const search = state.writes.find(({ path }) => path.endsWith('/journey/flights/search'))!;
  expect(search.body).toMatchObject({
    direction: 'return',
    origin: 'LHR',
    destination: 'MEL',
    departureDate: '2027-06-05',
  });
  expect(search.body).not.toHaveProperty('returnDate');
  expect(state.workspace.brief.departureDate).toBe('2027-06-01');
  expect(state.workspace.brief.startDate).toBe('');
  await card.getByRole('button', { name: 'Use flight dates', exact: true }).click();
  await expect.poll(() => state.workspace.items.length).toBe(1);
  await expect(state.offers.getByTestId('studio-chat-flight-card')).toContainText(
    'Requested journey',
  );
  expect(state.workspace.brief.startDate).toBe('');
  await page.reload();
  await expect(page.getByTestId('studio-chat-flight-card')).toContainText('Requested journey');
  await expect(page.getByTestId('studio-chat-flight-card')).not.toContainText('Outbound');
  expect(state.unexpected).toEqual([]);
});

test('family can select a researched flight route while unsupported automatic fares stay disabled', async ({
  page,
}) => {
  const state = await setup(page, { planning: true, family: true });
  const planner = page.getByRole('region', { name: 'Journey planner', exact: true });
  await planner.getByRole('button', { name: 'Use this route', exact: true }).click();
  await expect(planner).toContainText('Family routes can be planned here.');
  await planner.getByRole('button', { name: 'Continue to flight quotes', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Flight options', exact: true });
  await expect(popup).toContainText('Family flights need a reviewed supplier quote');
  await expect(
    popup.getByRole('button', { name: 'Search available flights', exact: true }),
  ).toBeDisabled();
  expect(state.workspace.brief.children).toBe(1);
  expect(state.workspace.brief.childAges).toEqual([7]);
  expect(state.writes.some(({ path }) => path.endsWith('/flights/search'))).toBe(false);
  expect(state.unexpected).toEqual([]);
});

test('one cruise choice researches real-source route guidance without inventing a dated sailing or importing a cruise', async ({
  page,
}) => {
  const state = await setup(page, { planning: true, modeUndecided: true, datesUnknown: true });
  const planner = page.getByRole('region', { name: 'Journey planner', exact: true });
  await planner.getByRole('button', { name: 'Cruise', exact: true }).click();
  const card = planner.getByRole('article', { name: 'Synthetic cruise route', exact: true });
  await expect(card).toContainText('Synthetic port');
  await card.getByRole('button', { name: 'Use this route', exact: true }).click();
  await expect(
    card.getByRole('button', { name: 'Add sailing schedule', exact: true }),
  ).toBeVisible();
  expect(state.workspace.brief.outboundTransport).toBe('cruise');
  expect(state.workspace.brief.startDate).toBe('');
  expect(state.workspace.stops[0].nights).toBeNull();
  expect(state.workspace.items).toEqual([]);
  expect(state.workspace.cruises || []).toEqual([]);
  expect(state.writes.find(({ path }) => path.endsWith('/journey/research'))?.body.mode).toBe(
    'cruise',
  );
  expect(
    state.writes.some(({ path }) => /flights\/search|booking|payment|publish|prebook/.test(path)),
  ).toBe(false);
  expect(state.unexpected).toEqual([]);
});

test('cancelled route research preserves unsent chat and does not restore late options or retry automatically', async ({
  page,
}) => {
  let release!: () => void;
  const heldJourney = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = await setup(page, { planning: true, modeUndecided: true, heldJourney });
  const planner = page.getByRole('region', { name: 'Journey planner', exact: true });
  const composer = page.getByRole('textbox', {
    name: 'Client request or planning notes',
    exact: true,
  });
  await composer.fill('Preserve my unfinished note.');
  await planner.getByRole('button', { name: 'Flight', exact: true }).click();
  await expect
    .poll(() => state.writes.filter(({ path }) => path.endsWith('/journey/research')).length)
    .toBe(1);
  await planner.getByRole('button', { name: 'Cancel', exact: true }).click();
  release();
  await expect(
    planner.getByRole('button', { name: 'Find travel options', exact: true }),
  ).toBeEnabled();
  await expect(planner.getByRole('article')).toHaveCount(0);
  await expect(composer).toHaveValue('Preserve my unfinished note.');
  expect(state.workspace.stops[0].arrivalDate).toBe('');
  expect(state.workspace.stops[0].nights).toBeNull();
  expect(state.writes.filter(({ path }) => path.endsWith('/journey/research'))).toHaveLength(1);
  expect(state.unexpected).toEqual([]);
});

test('failed preapproval flight-detail save keeps the popup draft and sends no supplier search until retry succeeds', async ({
  page,
}) => {
  const state = await setup(page, { planning: true, failSave: true });
  const planner = page.getByRole('region', { name: 'Journey planner', exact: true });
  await planner.getByRole('button', { name: 'Use this route', exact: true }).click();
  await planner.getByRole('button', { name: 'Continue to flight quotes', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Flight options', exact: true });
  await popup.getByLabel('Flight departure date', { exact: true }).fill('2027-06-03');
  await popup.getByRole('button', { name: 'Search available flights', exact: true }).click();
  await expect(popup).toContainText(/could not be saved|were not saved/);
  await expect(popup.getByLabel('Flight departure date', { exact: true })).toHaveValue(
    '2027-06-03',
  );
  expect(state.writes.some(({ path }) => path.endsWith('/journey/flights/search'))).toBe(false);
  await popup.getByRole('button', { name: 'Search available flights', exact: true }).click();
  await expect(state.offers.getByTestId('studio-chat-flight-card')).toBeVisible();
  const search = state.writes.find(({ path }) => path.endsWith('/journey/flights/search'))!;
  expect(search.body.departureDate).toBe('2027-06-03');
  expect(state.workspace.brief.startDate).toBe('');
  expect(state.unexpected).toEqual([]);
});

test('supplier UTC arrival without a timezone keeps hotel arrival unknown and exposes the resolution warning', async ({
  page,
}) => {
  const state = await setup(page, { planning: true, unknownLocalArrival: true });
  const planner = page.getByRole('region', { name: 'Journey planner', exact: true });
  await planner.getByRole('button', { name: 'Use this route', exact: true }).click();
  await planner.getByRole('button', { name: 'Continue to flight quotes', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Flight options', exact: true })
    .getByRole('button', { name: 'Search available flights', exact: true })
    .click();
  await state.offers
    .getByTestId('studio-chat-flight-card')
    .getByRole('button', { name: 'Use flight dates', exact: true })
    .click();
  await expect(state.offers.getByRole('status')).toContainText(
    'Schedule saved; local arrival still needs confirmation.',
  );
  await state.offers.getByText('Schedule review notes', { exact: true }).click();
  await expect(state.offers).toContainText('Confirm arrival before setting hotel dates.');
  expect(state.workspace.brief.startDate).toBe('');
  expect(state.workspace.stops[0].arrivalDate).toBe('');
  expect(state.workspace.stops[0].nights).toBeNull();
  expect(state.workspace.items).toHaveLength(1);
  expect(state.workspace.structureAccepted).toBe(false);
  expect(state.writes.some(({ path }) => /booking|payment|publish|prebook/.test(path))).toBe(false);
  expect(state.unexpected).toEqual([]);
});

test('basic planning saves flight and cruise preferences without AI calls and can use an explicit supplier flight schedule', async ({
  page,
}) => {
  const state = await setup(page, { planning: true, basic: true, modeUndecided: true });
  const planner = page.getByRole('region', { name: 'Journey planner', exact: true });
  await expect(planner).toContainText('Internet route research is unavailable.');
  await expect(
    planner.getByRole('button', { name: 'Add sailing schedule', exact: true }),
  ).toBeVisible();
  await planner.getByRole('button', { name: 'Cruise', exact: true }).click();
  await expect.poll(() => state.workspace.brief.outboundTransport).toBe('cruise');
  await expect(planner.getByRole('button', { name: 'Flight', exact: true })).toBeEnabled();
  await planner.getByRole('button', { name: 'Flight', exact: true }).click();
  await expect.poll(() => state.workspace.brief.outboundTransport).toBe('flight');
  await expect(
    planner.getByRole('button', { name: 'Compare supplier flights', exact: true }),
  ).toBeEnabled();
  await planner.getByRole('button', { name: 'Compare supplier flights', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Flight options', exact: true });
  await expect(popup.getByLabel('Origin airport code', { exact: true })).toHaveValue('MEL');
  await expect(popup.getByLabel('Destination airport code', { exact: true })).toHaveValue('');
  await popup.getByLabel('Destination airport code', { exact: true }).fill('LHR');
  await popup.getByRole('button', { name: 'Search available flights', exact: true }).click();
  await state.offers
    .getByTestId('studio-chat-flight-card')
    .getByRole('button', { name: 'Use flight dates', exact: true })
    .click();
  await expect.poll(() => state.workspace.brief.startDate).toBe('2027-06-02');
  expect(state.workspace.brief.adults).toBe(2);
  expect(state.workspace.brief.children).toBe(0);
  expect(state.workspace.structureAccepted).toBe(false);
  expect(state.writes.some(({ path }) => path.endsWith('/journey/research'))).toBe(false);
  expect(
    state.writes.find(({ path }) => path.endsWith('/journey/flights/search'))?.body,
  ).toMatchObject({ direction: 'outbound', origin: 'MEL', destination: 'LHR', adults: 2 });
  expect(state.writes.some(({ path }) => /booking|payment|publish|prebook/.test(path))).toBe(false);
  expect(state.unexpected).toEqual([]);
});

test('direct supplier comparison in AI mode avoids an unnecessary published-route lookup', async ({
  page,
}) => {
  const state = await setup(page, { planning: true, modeUndecided: true });
  const planner = page.getByRole('region', { name: 'Journey planner', exact: true });
  await planner.getByRole('button', { name: 'Compare supplier flights', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Flight options', exact: true });
  await popup.getByLabel('Destination airport code', { exact: true }).fill('LHR');
  await popup.getByRole('button', { name: 'Search available flights', exact: true }).click();
  await expect(state.offers.getByTestId('studio-chat-flight-card')).toBeVisible();
  expect(state.writes.some(({ path }) => path.endsWith('/journey/research'))).toBe(false);
  expect(state.workspace.brief.startDate).toBe('');
  expect(state.workspace.stops[0].nights).toBeNull();
  expect(state.unexpected).toEqual([]);
});

test('a sparse Flight choice waits for a saved origin and researches once after a short chat answer', async ({
  page,
}) => {
  const state = await setup(page, { planning: true, modeUndecided: true, missingOrigin: true });
  const planner = page.getByRole('region', { name: 'Journey planner', exact: true });
  const stopId = state.workspace.stops[0].id;
  await planner.getByRole('button', { name: 'Flight', exact: true }).click();
  await expect.poll(() => state.workspace.brief.outboundTransport).toBe('flight');
  await expect(planner).toContainText('Travel mode saved.');
  expect(state.writes.some(({ path }) => path.endsWith('/journey/research'))).toBe(false);
  await planner.getByLabel('From', { exact: true }).fill('Syd');
  await page.waitForTimeout(150);
  expect(state.workspace.brief.origin).toBe('');
  expect(state.writes.some(({ path }) => path.endsWith('/journey/research'))).toBe(false);
  await planner.getByLabel('From', { exact: true }).fill('');
  await page.locator('#studio-message').fill('Sydney');
  await page
    .locator('form')
    .filter({ has: page.locator('#studio-message') })
    .locator('button[type="submit"]')
    .click();
  await expect(
    planner.getByRole('article', { name: 'Synthetic connecting flight route', exact: true }),
  ).toBeVisible();
  await expect(planner.getByLabel('From', { exact: true })).toHaveValue('Sydney');
  expect(state.workspace.brief.origin).toBe('Sydney');
  expect(state.workspace.stops[0].id).toBe(stopId);
  expect(state.workspace.stops[0].nights).toBeNull();
  expect(state.workspace.brief.startDate).toBe('');
  expect(state.workspace.journeyResearch?.outbound?.input.origin).toBe('Sydney');
  expect(state.writes.filter(({ path }) => path.endsWith('/journey/research'))).toHaveLength(1);
  expect(state.workspace.messages.filter((message) => message.role === 'user')).toEqual([
    expect.objectContaining({ id: 'known-destination', content: 'London' }),
    expect.objectContaining({ content: 'Sydney' }),
  ]);
  expect(state.unexpected).toEqual([]);
});
