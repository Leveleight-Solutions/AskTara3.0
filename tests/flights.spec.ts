import { test, expect } from '@playwright/test';
import type { FlightSegment } from '../shared/types';
const segment = (
  id: string,
  origin: string,
  destination: string,
  departure: string,
  arrival: string,
  carrier: string,
) => ({
  id,
  origin: {
    code: origin,
    name:
      origin === 'LHR'
        ? 'London Heathrow'
        : origin === 'DOH'
          ? 'Hamad International'
          : 'Tokyo Haneda',
  },
  destination: {
    code: destination,
    name:
      destination === 'LHR'
        ? 'London Heathrow'
        : destination === 'DOH'
          ? 'Hamad International'
          : 'Tokyo Haneda',
  },
  departure,
  arrival,
  duration: 'PT6H30M',
  marketingCarrier: { name: 'British Airways', code: 'BA' },
  marketingFlightNumber: '6324',
  operatingCarrier: { name: carrier, code: carrier === 'Japan Airlines' ? 'JL' : 'QR' },
  operatingFlightNumber: '8',
  originTerminal: '5',
  destinationTerminal: 'B',
  passengers: [
    {
      passengerId: 'p1',
      cabin: 'Economy Classic',
      baggages: [
        { type: 'checked', quantity: 1 },
        { type: 'carry_on', quantity: 1 },
      ],
    },
    { passengerId: 'p2', cabin: 'economy' },
  ],
});
const outSegments = [
  segment(
    's1',
    'LHR',
    'DOH',
    '2027-04-12T09:00:00+01:00',
    '2027-04-12T17:30:00+03:00',
    'Qatar Airways',
  ),
  segment(
    's2',
    'DOH',
    'HND',
    '2027-04-12T20:00:00+03:00',
    '2027-04-13T12:30:00+09:00',
    'Japan Airlines',
  ),
];
const returnSegments = [
  segment(
    's3',
    'HND',
    'LHR',
    '2027-04-19T10:15:00+09:00',
    '2027-04-19T17:15:00+01:00',
    'Qatar Airways',
  ),
];
const journey = (id: string, segments: FlightSegment[]) => ({
  id,
  origin: segments[0].origin,
  destination: segments.at(-1)!.destination,
  departure: segments[0].departure,
  arrival: segments.at(-1)!.arrival,
  duration: 'PT19H30M',
  stops: segments.length - 1,
  connections: segments.length - 1,
  segments,
});
const offer = {
  id: 'off_browser',
  airline: 'British Airways',
  origin: 'LHR',
  destination: 'HND',
  departure: outSegments[0].departure,
  arrival: outSegments[1].arrival,
  duration: 'PT19H30M',
  stops: 1,
  price: 1845.75,
  currency: 'GBP',
  journeys: [journey('j1', outSegments), journey('j2', returnSegments)],
  passengerCount: 2,
  requestedJourneyCount: 2,
  expiresAt: '2020-01-01T00:00:00Z',
  liveMode: false,
};

test('flight quotes show complete round trips, connected carriers and expiry in an accessible mobile-safe dialog', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/flights/search', (route) =>
    route.fulfill({
      json: {
        mode: 'test',
        offers: [offer],
        warning: 'Simulated fixture for browser verification.',
      },
    }),
  );
  await page.goto('/flights');
  await expect(page.getByRole('heading', { name: 'Find your flight', exact: true })).toBeVisible();

  await page.getByLabel('From', { exact: true }).fill('LHR');
  await page.getByLabel('To', { exact: true }).fill('HND');
  await page.getByLabel('Departure', { exact: true }).fill('2027-04-12');
  await page.getByLabel('Return', { exact: true }).fill('2027-04-19');
  await page.getByRole('combobox', { name: 'Travelers', exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Search flights', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'View flight details', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.flight-journey-summary')).toHaveCount(2);
  await page.getByRole('button', { name: 'View flight details', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Flight details', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Outbound journey', exact: true })).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Return journey', exact: true })).toBeAttached();
  await expect(
    dialog.getByText('Connection at Hamad International.', { exact: false }),
  ).toBeVisible();
  await expect(dialog.getByText('This quote has expired.', { exact: false })).toBeVisible();
  await expect(dialog.getByText('Simulated offer', { exact: true })).toBeVisible();
  await expect(dialog.getByText('£1,845.75', { exact: true })).toBeVisible();
  if (process.env.CAPTURE_SCREENSHOTS === '1')
    await page.screenshot({ path: 'docs/screenshots/flight-details-desktop.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'View flight details', exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'View flight details', exact: true }).click();
  await expect(dialog).toBeVisible();
  const overflow = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  if (overflow) throw new Error('Flight detail dialog overflows mobile viewport');
  if (process.env.CAPTURE_SCREENSHOTS === '1')
    await page.screenshot({ path: 'docs/screenshots/flight-details-mobile.png' });
  if (errors.length) throw new Error(errors.join('\n'));
});
