import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { destinations } from '../shared/catalog.ts';
import { filterHotelQuotes } from '../shared/studio-hotels.ts';
import { searchHotels } from '../server/integrations.ts';
import { hotelDetails, publicHotelQuote, recommendStudioHotels } from '../server/studio-hotels.ts';
import { newStudioWorkspace } from '../server/studio-store.ts';

const originalFetch = globalThis.fetch;
const originalEnvironment = Object.fromEntries(
  ['LITEAPI_API_KEY', 'LITEAPI_MODE', 'OPENAI_API_KEY'].map((key) => [key, process.env[key]]),
);
beforeEach(() => {
  process.env.LITEAPI_API_KEY = 'sand_fixture';
  delete process.env.OPENAI_API_KEY;
  delete process.env.LITEAPI_MODE;
  globalThis.fetch = async () => {
    throw new Error('Unexpected network request');
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnvironment))
    value === undefined ? delete process.env[key] : (process.env[key] = value);
});
const destination = destinations[0];
const input = {
  destinationId: destination.id,
  checkin: '2027-11-18',
  checkout: '2027-11-22',
  adults: 2,
  childAges: [7],
  guestNationality: 'AU',
  currency: 'AUD',
};
function hotelRate(hotelId: string, offerId = `offer-${hotelId}`, amount: unknown = 350) {
  return {
    hotelId,
    roomTypes: [
      {
        offerId,
        rates: [
          {
            name: 'Supplier double room',
            mappedRoomId: 22,
            boardName: 'Breakfast included',
            cancellationPolicies: { refundableTag: 'NRFN' },
            retailRate: {
              total: [{ amount, currency: 'AUD' }],
              taxesAndFees: [{ included: false }],
            },
          },
        ],
      },
    ],
  };
}
const detail = {
  name: 'Supplier Hotel',
  address: 'Supplier Road',
  chain: 'Example Group',
  hotelDescription: '<p>Provider description.</p>',
  starRating: 4,
  location: { latitude: destination.coordinates[0], longitude: destination.coordinates[1] },
  hotelFacilities: ['Wi-Fi', 'Pool'],
  hotelImages: [
    { url: 'https://example.com/hotel-1.jpg', caption: 'Exterior' },
    { url: 'https://example.com/hotel-2.jpg', caption: 'Lobby' },
    { url: 'javascript:alert(1)' },
  ],
  rooms: [
    {
      id: 22,
      description: 'The mapped room.',
      photos: [{ url: 'https://example.com/room-22.jpg' }],
      roomAmenities: [{ name: 'Air conditioning' }],
    },
    { id: 33, photos: [{ url: 'https://example.com/wrong-room.jpg' }] },
  ],
};

test('Studio queries bounded candidate pages, keeps every returned quote, passes exact family occupancy and maps hotel/room details', async () => {
  const offsets: number[] = [],
    lookedUp: string[] = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/hotels/rates')) {
      const body = JSON.parse(String(options?.body));
      offsets.push(body.offset);
      assert.deepEqual(body.occupancies, [{ adults: 2, children: [7] }]);
      assert.equal(body.currency, 'AUD');
      assert.equal(body.roomMapping, true);
      assert.equal(body.limit, 50);
      return Response.json({
        data: Array.from({ length: 6 }, (_, index) => hotelRate(`hotel-${body.offset + index}`)),
        hotels: [],
        sandbox: true,
      });
    }
    const hotelId = new URL(String(url)).searchParams.get('hotelId')!;
    lookedUp.push(hotelId);
    return Response.json({ data: { ...detail, id: hotelId } });
  };
  const result = await searchHotels(input, undefined, destination, { expanded: true });
  assert.deepEqual(
    offsets.sort((a, b) => a - b),
    [0, 50, 100],
  );
  assert.equal(result.offers.length, 18, 'Must not truncate to the old twelve results');
  assert.equal(lookedUp.length, 18);
  assert.equal(result.mode, 'test');
  assert.equal(
    result.inventory?.hasMore,
    true,
    'Short rate pages cannot prove candidate inventory is exhausted',
  );
  assert.equal(result.inventory?.returnedHotels, 18);
  assert.equal(result.inventory?.nextOffset, 150);
  const offer = result.offers[0];
  assert.equal(offer.price, 350);
  assert.equal(offer.currency, 'AUD');
  assert.equal(
    offer.room,
    'Supplier double room',
    'Keep supplier room name, never replace with generic mapped name',
  );
  assert.deepEqual(
    offer.details?.roomPhotos.map((photo) => photo.url),
    ['https://example.com/room-22.jpg'],
  );
  assert.equal(offer.details?.photos.length, 2);
  assert.equal(offer.details?.distanceKm, 0);
  assert.equal(offer.details?.description, 'Provider description.');
  assert.match(offer.details!.taxes, /separately/);
  assert.match(offer.details!.cancellation, /Non-refundable/);
});

test('empty early page does not hide later availability and failed pages/details are explicitly incomplete', async () => {
  globalThis.fetch = async (url, options) => {
    if (!String(url).endsWith('/hotels/rates')) return new Response('', { status: 503 });
    const { offset } = JSON.parse(String(options?.body));
    if (offset === 0) return Response.json({ data: [] });
    if (offset === 50) return new Response('', { status: 503 });
    return Response.json({
      data: [hotelRate('late-hotel'), hotelRate('late-hotel')],
      hotels: [
        { id: 'late-hotel', name: 'Late Hotel', main_photo: 'https://example.com/main.jpg' },
      ],
    });
  };
  const result = await searchHotels(input, undefined, destination, { expanded: true });
  assert.equal(result.offers.length, 1);
  assert.equal(result.inventory?.incomplete, true);
  assert.equal(result.inventory?.pagesSearched, 2);
  assert.equal(result.offers[0].details?.detailsStatus, 'unavailable');
  assert.equal(result.offers[0].image, 'https://example.com/main.jpg');
  assert.match(result.warning, /Some availability pages/);
});

test('subsequent inventory batches advance candidate offsets without treating empty rates as exhaustion', async () => {
  const offsets: number[] = [];
  globalThis.fetch = async (_url, options) => {
    offsets.push(JSON.parse(String(options?.body)).offset);
    return Response.json({ data: [] });
  };
  const result = await searchHotels(input, undefined, destination, { expanded: true, offset: 150 });
  assert.deepEqual(
    offsets.sort((a, b) => a - b),
    [150, 200, 250],
  );
  assert.equal(result.inventory?.nextOffset, 300);
  assert.equal(result.inventory?.hasMore, true);
  const capped = await searchHotels(input, undefined, destination, {
    expanded: true,
    offset: 4950,
  });
  assert.equal(capped.inventory?.nextOffset, null);
  assert.equal(capped.inventory?.searchLimitReached, true);
  assert.equal(
    capped.inventory?.hasMore,
    true,
    'Application cap is not proof of complete provider inventory',
  );
});

test('hotel room images are never borrowed from an unmatched room; unsafe image URLs and invalid money never become offers', async () => {
  const safe = hotelDetails(detail, { mappedRoomId: 999 }, destination.coordinates);
  assert.deepEqual(safe.roomPhotos, []);
  assert.equal(safe.photos.length, 2);
  globalThis.fetch = async (url) =>
    String(url).includes('/data/hotel')
      ? Response.json({ data: detail })
      : Response.json({ data: [hotelRate('invalid', 'bad', null)] });
  await assert.rejects(
    searchHotels(input, undefined, destination, { expanded: true }),
    /no valid rates/,
  );
});

function quotes() {
  return Array.from({ length: 5 }, (_, index) =>
    publicHotelQuote(
      {
        id: `private-${index}`,
        hotelId: `private-hotel-${index}`,
        name: `Hotel ${index}`,
        image: '',
        address: 'Example road',
        room: 'Double room',
        board: 'Breakfast',
        price: 100 + index * 50,
        currency: 'AUD',
        checkin: input.checkin,
        checkout: input.checkout,
        details: hotelDetails(
          { ...detail, chain: index === 0 ? 'Other group' : 'Example Group' },
          { mappedRoomId: 22 },
          destination.coordinates,
        ),
      },
      `quote-${index}`,
      new Date().toISOString(),
      'test',
      2,
      [7],
    ),
  );
}
test('hotel group and amenity filters are deterministic; public results exclude supplier credentials and offer IDs', () => {
  const hotels = quotes();
  assert.doesNotMatch(JSON.stringify(hotels), /private-hotel|private-\d/);
  assert.equal(
    filterHotelQuotes(hotels, { group: 'Example Group', amenities: ['Wi-Fi', 'Pool'], search: '' })
      .length,
    4,
  );
  assert.equal(
    filterHotelQuotes(hotels, { group: '', amenities: ['Invented amenity'], search: '' }).length,
    0,
  );
  assert.equal(
    filterHotelQuotes(hotels, { group: '', amenities: [], search: 'hotel 0' }).length,
    1,
  );
});
test('AI shortlist ranks only returned quotes, contains exactly four distinct hotels and sends no client identifiers', async () => {
  process.env.OPENAI_API_KEY = 'fixture';
  const workspace = newStudioWorkspace();
  workspace.brief.clientName = 'Private Person';
  workspace.brief.context = 'Private context';
  workspace.brief.budget = 3000;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    assert.equal(body.text.format.name, 'studio_hotel_recommendations');
    assert.doesNotMatch(body.input[0].content, /Private Person|Private context/);
    assert.match(body.instructions, /entire trip/);
    return Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                picks: [3, 1, 0, 4].map((index) => ({
                  quoteId: `quote-${index}`,
                  reason: 'Quoted breakfast and supplier location details suit the request.',
                })),
              }),
            },
          ],
        },
      ],
    });
  };
  const recommendations = await recommendStudioHotels(workspace, quotes());
  assert.equal(recommendations.status, 'ai');
  assert.deepEqual(
    recommendations.picks.map((pick) => pick.quoteId),
    ['quote-3', 'quote-1', 'quote-0', 'quote-4'],
  );
});
test('unknown, duplicate or missing AI recommendations never fabricate a top four and preserve the results', async () => {
  process.env.OPENAI_API_KEY = 'fixture';
  for (const ids of [
    ['quote-0', 'quote-0', 'quote-1', 'quote-2'],
    ['quote-0', 'invented', 'quote-1', 'quote-2'],
    ['quote-0'],
  ]) {
    globalThis.fetch = async () =>
      Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  picks: ids.map((quoteId) => ({ quoteId, reason: 'Test reason' })),
                }),
              },
            ],
          },
        ],
      });
    const result = await recommendStudioHotels(newStudioWorkspace(), quotes());
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.picks, []);
  }
  delete process.env.OPENAI_API_KEY;
  assert.equal((await recommendStudioHotels(newStudioWorkspace(), quotes())).status, 'unavailable');
});
