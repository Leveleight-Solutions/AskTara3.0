import { test, expect, type Page } from '@playwright/test';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import { defaultStudioAgency, type StudioItem } from '../shared/studio';
import type { StudioHotelSearchResult } from '../shared/studio-hotels';
import { newStudioWorkspace } from '../server/studio-store';
import { choose } from './ui-helpers';

async function fixture(page: Page, recommend = true) {
  const workspace = newStudioWorkspace();
  workspace.stage = 'services';
  workspace.structureAccepted = true;
  workspace.brief = {
    ...workspace.brief,
    adults: 2,
    children: 1,
    childAges: [7],
    hotelStandard: 'Four stars',
    hotelLocation: 'City centre',
  };
  workspace.stops = [
    {
      id: 'hotel-stop',
      name: 'London',
      country: 'United Kingdom',
      arrivalDate: '2027-06-01',
      departureDate: '2027-06-04',
      nights: 3,
      onwardTransport: 'undecided',
      neighbourhood: '',
      notes: '',
    },
  ];
  const quotes: StudioItem[] = Array.from({ length: 5 }, (_, index) => ({
    id: `60000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    kind: 'hotel',
    title: `Supplier Hotel ${index + 1}`,
    description: 'Double room with breakfast.',
    stopId: 'hotel-stop',
    startDate: '2027-06-01',
    endDate: '2027-06-04',
    status: 'suggested',
    source: 'liteapi',
    sourceUrl: '',
    supplier: 'LiteAPI',
    privateReference: '',
    price: 500 + index * 100,
    currency: 'AUD',
    priceStatus: 'sandbox',
    quotedAt: '2026-10-01T10:00:00Z',
    included: false,
    needsReview: false,
    cost: null,
  }));
  const result: StudioHotelSearchResult = {
    quotes,
    hotels: quotes.map((quote, index) => ({
      quoteId: quote.id,
      hotelKey: `hotel-${index}`,
      name: quote.title,
      address: 'Supplier Road, London',
      room: 'Supplier double room',
      board: 'Breakfast included',
      price: quote.price!,
      currency: quote.currency,
      checkin: quote.startDate,
      checkout: quote.endDate,
      quotedAt: quote.quotedAt,
      mode: 'test',
      adults: 2,
      childAges: [7],
      photos: [
        {
          url: `https://hotel-fixture.example/exterior-${index}.png`,
          caption: 'Supplier exterior photo',
        },
        {
          url: `https://hotel-fixture.example/lobby-${index}.png`,
          caption: 'Supplier lobby photo',
        },
      ],
      roomPhotos: [
        { url: `https://hotel-fixture.example/room-${index}.png`, caption: 'Mapped quoted room' },
      ],
      description: 'Provider hotel description.',
      roomDescription: 'Provider room description.',
      amenities: index === 0 ? ['Wi-Fi', 'Pool'] : ['Wi-Fi'],
      roomAmenities: ['Air conditioning'],
      group: index < 2 ? 'Sample Group' : 'Other Group',
      stars: 4,
      distanceKm: 1.2,
      cancellation: 'Non-refundable rate.',
      taxes: 'Taxes require confirmation.',
      detailsStatus: 'available',
    })),
    recommendations: {
      status: recommend ? 'ai' : 'unavailable',
      picks: recommend
        ? quotes.slice(0, 4).map((quote) => ({
            quoteId: quote.id,
            reason: 'Supplier location and breakfast match this brief.',
          }))
        : [],
      message: recommend
        ? 'AI selected four returned hotels for review.'
        : 'AI recommendations are temporarily unavailable. Compare all returned hotels below.',
    },
    inventory: {
      returnedHotels: 5,
      returnedQuotes: 5,
      limit: 150,
      hasMore: true,
      searchRadiusKm: 15,
      pagesSearched: 3,
      incomplete: false,
      nextOffset: 150,
    },
    mode: 'test',
    warning: 'Sandbox quotes. No reservation has been made.',
  };
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  await page.route('https://hotel-fixture.example/**', (route) =>
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
    const json = (value: unknown) => route.fulfill({ json: value });
    if (path === '/api/session') return json({ user: null });
    if (path === '/api/catalog') return json(catalog);
    if (path === '/api/profile') return json({ profile: defaultTravelProfile });
    if (path === '/api/saved') return json({ items: [] });
    if (path === '/api/integrations')
      return json({ ai: true, hotels: true, flights: true, activities: false, mode: 'live' });
    if (path === '/api/studio/agency') return json({ agency: defaultStudioAgency() });
    if (path === '/api/studio/clients' || path === '/api/studio/client-profiles')
      return json({ clients: [] });
    if (path === `/api/studio/workspaces/${workspace.id}` && method === 'GET')
      return json({ workspace });
    if (method === 'POST') writes.push({ path, body: route.request().postDataJSON() });
    if (path.endsWith('/hotels/search')) {
      if (route.request().postDataJSON().offset === 150) {
        const quote = {
          ...quotes[0],
          id: '60000000-0000-4000-8000-000000000006',
          title: 'Supplier Hotel 6',
        };
        quotes.push(quote);
        return json({
          ...result,
          quotes: [quote],
          hotels: [
            { ...result.hotels[4], quoteId: quote.id, hotelKey: 'hotel-5', name: quote.title },
          ],
          recommendations: {
            status: 'unavailable',
            picks: [],
            message: 'Original shortlist covers the first batch.',
          },
          inventory: {
            ...result.inventory,
            returnedHotels: 1,
            returnedQuotes: 1,
            nextOffset: null,
            searchLimitReached: true,
          },
        });
      }
      return json(result);
    }
    if (path.includes('/quotes/')) {
      const selected = quotes.find((quote) => path.endsWith(quote.id))!;
      workspace.items.push({ ...selected, included: true });
      workspace.revision++;
      return json({ workspace });
    }
    return route.fulfill({ status: 500, json: { error: `Unexpected ${method} ${path}` } });
  });
  await page.goto(`/studio/${workspace.id}`);
  const canvas = page.getByRole('tab', { name: 'Working canvas', exact: true });
  if ((page.viewportSize()?.width || 1440) < 768) await canvas.click();
  await page.getByText('Find hotel or flight suggestions', { exact: true }).click();
  await page.getByLabel('Guest nationality · two-letter code').fill('AU');
  await page.getByRole('button', { name: 'Search hotels quotes', exact: true }).click();
  return { workspace, result, writes };
}

test('hotel shortlist, full inventory, carousel, ordinary filters and selecting a family quote work together', async ({
  page,
}) => {
  const { workspace, result, writes } = await fixture(page);
  await expect(
    page.getByTestId('hotel-recommendations').getByTestId('studio-hotel-card'),
  ).toHaveCount(4);
  const full = page.getByTestId('all-hotel-results');
  await expect(full.getByTestId('studio-hotel-card')).toHaveCount(5);
  await page.getByRole('button', { name: 'Load more available hotels', exact: true }).click();
  await expect(full.getByTestId('studio-hotel-card')).toHaveCount(6);
  await expect(
    page.getByTestId('hotel-recommendations').getByTestId('studio-hotel-card'),
  ).toHaveCount(4);
  const first = full.getByTestId('studio-hotel-card').first();
  await first.getByRole('button', { name: 'Next Supplier Hotel 1 photo', exact: true }).click();
  await expect(first.getByRole('img', { name: 'Supplier lobby photo' })).toHaveAttribute(
    'src',
    /lobby-0/,
  );
  await choose(
    page,
    page.getByRole('combobox', { name: 'Hotel group', exact: true }),
    'Sample Group',
  );
  await expect(full.getByTestId('studio-hotel-card')).toHaveCount(2);
  await page.getByText('Amenities', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Pool', exact: true }).check();
  await expect(full.getByTestId('studio-hotel-card')).toHaveCount(1);
  await first.getByText('Hotel and room details', { exact: true }).click();
  await expect(first.getByRole('img', { name: 'Mapped quoted room' })).toHaveAttribute(
    'src',
    /room-0/,
  );
  await first.getByRole('button', { name: 'Add to itinerary', exact: true }).click();
  await expect.poll(() => workspace.items.length).toBe(1);
  expect(workspace.items[0].price).toBe(result.quotes[0].price);
  expect(writes.map((write) => write.path)).toEqual([
    `/api/studio/workspaces/${workspace.id}/hotels/search`,
    `/api/studio/workspaces/${workspace.id}/hotels/search`,
    `/api/studio/workspaces/${workspace.id}/quotes/${result.quotes[0].id}`,
  ]);
});

test('mobile hotel results retain full inventory when AI recommendations are unavailable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, false);
  await expect(page.getByTestId('all-hotel-results').getByTestId('studio-hotel-card')).toHaveCount(
    5,
  );
  await expect(
    page.getByText(
      'AI recommendations are temporarily unavailable. Compare all returned hotels below.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByTestId('hotel-recommendations')).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page
    .getByTestId('all-hotel-results')
    .getByTestId('studio-hotel-card')
    .first()
    .getByRole('button', { name: 'Add to itinerary', exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/asktara-studio-hotels-mobile.png' });
});
