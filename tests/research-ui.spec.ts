import { test, expect } from '@playwright/test';
import { catalog } from '../shared/catalog';
import type { Destination, Trip } from '../shared/types';

const osaka: Destination = {
  id: 'osaka',
  name: 'Osaka',
  country: 'Japan',
  region: 'Asia',
  description: 'An unhurried city escape.',
  longDescription: 'A destination researched for this trip.',
  image: '/images/destination-placeholder.svg',
  vibe: 'City escapes',
  tags: ['Food', 'Culture'],
  bestTime: 'Check conditions for your dates',
  dailyBudget: 100,
  coordinates: [34.6937, 135.5023],
  highlights: [],
};
const nara: Destination = { ...osaka, id: 'nara', name: 'Nara', coordinates: [34.6851, 135.8048] };
function researchedTrip(): Trip {
  const date = '2026-09-12T12:00:00Z';
  return {
    id: '10000000-0000-4000-8000-000000000001',
    title: 'Osaka & Nara, at your pace',
    destinationId: 'osaka',
    destinations: [osaka, nara],
    startDate: '2027-04-10',
    days: 2,
    travelers: 2,
    budget: 1000,
    interests: ['Food', 'Culture'],
    status: 'draft',
    revision: 1,
    shareToken: 'research-demo',
    createdAt: date,
    updatedAt: date,
    brief: {
      pace: 'relaxed',
      destinationStops: [
        { destinationId: 'osaka', days: 1 },
        { destinationId: 'nara', days: 1 },
      ],
      originAirport: '',
      arrivalAirport: '',
      guestNationality: 'PK',
      includeHotels: false,
      includeFlights: false,
      notes: ['Vegetarian meals and step-free access.'],
    },
    messages: [
      {
        id: 'message-user',
        role: 'user',
        content: 'Two quiet days in Osaka and Nara, with vegetarian food and step-free access.',
        createdAt: date,
      },
      {
        id: 'message-tara',
        role: 'assistant',
        content:
          '## Your trip, thoughtfully paced\n\nI have left room between your stops.\n\n1. **Osaka:** take an unhurried morning in the garden.\n2. **Nara:** explore at your own pace.\n\nCheck the [official Osaka guide](https://example.org/osaka) and confirm access before you go.',
        createdAt: date,
      },
    ],
    itinerary: [osaka, nara].map((destination, index) => ({
      day: index + 1,
      destinationId: destination.id,
      title: `A quiet day in ${destination.name}`,
      items: [
        {
          id: `stop-${index}`,
          placeId: `web-${destination.id}-garden`,
          sourceId: 'official-guide',
          title: `${destination.name} garden`,
          description: 'Leave time to pause. Confirm current access and opening hours directly.',
          time: '10:00',
          location: `${destination.name}, Japan`,
          category: 'sight',
          cost: 10,
          completed: false,
          durationMinutes: 90,
        },
      ],
    })),
    planning: {
      generatedAt: date,
      mode: 'live',
      model: 'Research assistant',
      summary: 'Two days with room to enjoy each stop.',
      researchSummary:
        'A gentle route, grounded in the [official Osaka guide](https://example.org/osaka).',
      destinations: [osaka, nara],
      assumptions: [],
      questions: [],
      issues: [],
      agentIds: ['intake', 'destinations', 'places', 'itinerary', 'review'],
      sources: [
        {
          id: 'official-guide',
          kind: 'web',
          label: 'Official Osaka guide',
          url: 'https://example.org/osaka',
          checkedAt: date,
          status: 'live',
        },
        {
          id: 'hotel-provider',
          kind: 'liteapi',
          label: 'Hotel rate search',
          checkedAt: date,
          status: 'test',
        },
      ],
      places: [osaka, nara].map((destination) => ({
        id: `web-${destination.id}-garden`,
        name: `${destination.name} garden`,
        destinationId: destination.id,
        address: `${destination.name}, Japan`,
        category: 'sight',
        durationMinutes: 90,
        estimatedCost: 10,
        sourceId: 'official-guide',
        description: 'An outdoor break between city stops.',
        evidenceUrls: ['https://example.org/osaka'],
        suitability: ['Allow a quiet morning; confirm the step-free entrance directly.'],
      })),
      stays: [
        {
          id: 'stay-test',
          destinationId: 'osaka',
          name: 'Sample garden hotel',
          description: 'Simulated provider result.',
          image: '',
          price: 160,
          currency: 'USD',
          basis: 'stay',
          sourceId: 'hotel-provider',
        },
      ],
      flights: [],
      budget: {
        currency: 'USD',
        target: 1000,
        activities: 40,
        accommodation: 160,
        flights: null,
        total: 200,
        unpriced: ['Transport'],
      },
    },
  };
}

test('researched destinations render in chat, settings, maps, hotel searches and shared copies', async ({
  page,
}, testInfo) => {
  const trip = researchedTrip();
  const cloneId = '10000000-0000-4000-8000-000000000002';
  const unexpected: string[] = [];
  const hotelRequests: Record<string, unknown>[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let json: unknown;
    if (path === '/api/session') json = { user: null };
    else if (path === '/api/catalog') json = catalog;
    else if (path === '/api/integrations')
      json = { ai: true, hotels: true, flights: false, activities: false, mode: 'live' };
    else if (path === '/api/saved') json = { items: [] };
    else if (path === '/api/profile') json = { profile: null };
    else if (path === '/api/config') json = {};
    else if (path === '/api/trips') json = { trips: [trip] };
    else if (path === `/api/trips/${trip.id}`) json = { trip };
    else if (path === `/api/trips/${cloneId}`) json = { trip: { ...trip, id: cloneId } };
    else if (path.endsWith('/runs')) json = { runs: [] };
    else if (path === '/api/shared/research-demo')
      json = { trip: { ...trip, messages: [], brief: undefined } };
    else if (path === '/api/shared/research-demo/clone' && method === 'POST')
      json = { trip: { ...trip, id: cloneId } };
    else if (path === '/api/hotels/search' && method === 'POST') {
      hotelRequests.push(route.request().postDataJSON());
      json = { offers: [], mode: 'test' };
    } else {
      unexpected.push(`${method} ${path}`);
      await route.fulfill({ status: 500, json: { error: 'Unexpected fixture request' } });
      return;
    }
    await route.fulfill({ json });
  });
  await page.goto(`/chat/${trip.id}`);
  await expect(page.getByRole('heading', { name: trip.title, exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Illustrated landscape for Osaka' })).toBeVisible();
  await expect(page.locator('.message-text ol')).toHaveCount(1);
  await expect(
    page.locator('.message-text').getByRole('link', { name: 'official Osaka guide' }),
  ).toHaveAttribute('href', 'https://example.org/osaka');
  await expect(page.getByRole('link', { name: 'Osaka garden', exact: true })).toHaveAttribute(
    'href',
    /google\.com\/maps\/search/,
  );
  await page.screenshot({ path: testInfo.outputPath('global-trip-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Place details' }).click();
  const place = page.getByRole('dialog', { name: 'Osaka garden' });
  await expect(place).toContainText('How this fits your trip');
  await expect(place).toContainText('confirm the step-free entrance directly');
  await expect(place.getByRole('link', { name: 'example.org' })).toHaveAttribute(
    'href',
    'https://example.org/osaka',
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edit trip details' }).click();
  const settings = page.getByRole('dialog', { name: 'Make it your kind of trip' });
  await settings.getByText('Plan more than one destination', { exact: true }).click();
  await expect(settings.getByRole('combobox', { name: 'Destination 1' })).toHaveValue('osaka');
  await expect(settings.getByRole('combobox', { name: 'Destination 2' })).toHaveValue('nara');
  await page.keyboard.press('Escape');
  await page.getByRole('group', { name: 'Itinerary days' }).getByRole('button').nth(1).click();
  await expect(page.getByRole('heading', { name: 'Nara garden', exact: true })).toBeVisible();
  await expect(page.locator('.itinerary-map')).toContainText('Nara');
  await page.getByRole('button', { name: 'Stays & details', exact: true }).click();
  await page.getByText('Assumptions & sources', { exact: true }).click();
  await expect(page.locator('.plan-sources')).toContainText('Web research');
  await expect(page.locator('.plan-sources')).toContainText('Published information may change');
  await page.getByText('Places to stay (1)', { exact: true }).click();
  await expect(page.locator('.research-stays')).toContainText('Sandbox rate');
  await expect(
    page.locator('.hotel-search').getByRole('combobox', { name: 'Destination', exact: true }),
  ).toHaveValue('osaka');
  await page.getByRole('button', { name: 'Check hotel rates', exact: true }).click();
  await expect(
    page.getByText('Test rates are simulated and do not establish real room availability.'),
  ).toBeVisible();
  expect(hotelRequests).toHaveLength(1);
  expect(hotelRequests[0]).toMatchObject({
    tripId: trip.id,
    destinationId: 'osaka',
    checkin: '2027-04-10',
    adults: 2,
    guestNationality: 'PK',
  });
  await page.getByRole('link', { name: 'Explore with Tara', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/chat/${trip.id}\\?q=`));
  await expect(page.getByRole('textbox', { name: 'Message Tara' })).toHaveValue(
    /Help me plan a trip to Osaka/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /Your itinerary/ }).click();
  await page.screenshot({
    path: testInfo.outputPath('global-trip-mobile-details.png'),
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Itinerary', exact: true }).click();
  await page.locator('.plan-panel').evaluate((element) => (element.scrollTop = 0));
  await page.screenshot({
    path: testInfo.outputPath('global-trip-mobile-itinerary.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/shared/research-demo');
  await expect(page.getByRole('heading', { name: trip.title, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Osaka garden', exact: true })).toHaveAttribute(
    'href',
    /google\.com\/maps\/search/,
  );
  await page.getByRole('button', { name: 'Make this trip mine' }).click();
  await expect(page).toHaveURL(`/chat/${cloneId}`);
  await expect(page.getByRole('heading', { name: trip.title, exact: true })).toBeVisible();
  await page.goto('/trips');
  await expect(page.locator('.trip-card')).toContainText('Osaka · Japan');
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
