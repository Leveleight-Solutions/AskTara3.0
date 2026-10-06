import { test, expect, type Page } from '@playwright/test';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import { defaultStudioAgency, type StudioItem } from '../shared/studio';
import type { StudioHotelQuote, StudioHotelSearchResult } from '../shared/studio-hotels';
import type { StudioFlightQuote, StudioFlightSearchResult } from '../shared/studio-flights';
import { newStudioWorkspace } from '../server/studio-store';
import { applyStudioPatch, qualifyStudio } from '../server/studio-domain';
import { syntheticTripBriefing } from './studio-trip-briefing-fixture';

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
    if (request.url().includes('/hotels/search')) {
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
      return json({ ai: false, hotels: true, flights: true, activities: false, mode: 'test' });
    if (path === '/api/studio/agency') return json({ agency });
    if (path === '/api/studio/clients' || path === '/api/studio/client-profiles')
      return json({ clients: [] });
    if (path === '/api/studio/workspaces') return json({ workspaces: [workspace] });
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'GET')
      return json({ workspace });
    const body = route.request().postDataJSON() || {};
    writes.push({ path, body });
    if (path.endsWith('/hotels/search')) {
      if (options.heldSearch) await options.heldSearch;
      if (failed.has(route.request().url())) return;
      return json(hotelResult);
    }
    if (path.endsWith('/flights/search')) return json(flightResult);
    if (path.includes('/quotes/')) {
      if (body.revision !== workspace.revision)
        return json({ error: 'Synthetic current revision required.' }, 409);
      const selected = [...hotelResult.quotes, ...flightResult.quotes].find((item) =>
        path.endsWith(item.id),
      );
      if (!selected) return json({ error: 'Synthetic scoped quote missing.' }, 404);
      workspace.items.push({ ...selected, included: true });
      workspace.revision++;
      return json({ workspace });
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
