import { test, expect, type Page, type Route } from '@playwright/test';
import { catalog } from '../shared/catalog';
import { defaultTravelProfile } from '../shared/account';
import type { Booking, BookingOfferView, ConfirmBookingInput } from '../shared/bookings';
import { choose } from './ui-helpers';

const offerId = '10000000-0000-4000-8000-000000000001';
const bookingId = '20000000-0000-4000-8000-000000000001';
const future = '2099-01-01T12:00:00Z';
const hotelOffer = (): BookingOfferView => ({
  id: offerId,
  kind: 'hotel',
  name: 'Garden House Sandbox',
  description: 'One room, two adults, breakfast included.',
  price: 199.99,
  currency: 'USD',
  adults: 2,
  startDate: '2030-04-10',
  endDate: '2030-04-12',
  location: 'Kyoto, Japan',
  room: 'Garden double',
  expiresAt: future,
  mode: 'test',
  confirmationAvailable: true,
});
function checkout(offer: BookingOfferView): Booking {
  return {
    id: bookingId,
    kind: offer.kind,
    mode: 'test',
    status: 'checkout',
    offer,
    quote: {
      version: 'quote-1',
      price: 219.49,
      currency: 'USD',
      originalPrice: offer.price,
      priceChanged: true,
      expiresAt: future,
      terms: ['Breakfast included. Sandbox inventory only.'],
      cancellationPolicies: [
        {
          description: 'Free cancellation before the stated deadline.',
          until: future,
          amount: 0,
          currency: 'USD',
        },
      ],
    },
    paymentStatus: 'not_charged',
    createdAt: '2026-09-13T12:00:00Z',
    updatedAt: '2026-09-13T12:00:00Z',
  };
}
type Fixture = {
  offer: BookingOfferView;
  booking: Booking | null;
  prebook: { offerId: string; requestId: string }[];
  confirms: ConfirmBookingInput[];
  refreshes: number;
  cancels: { requestId: string; acceptCancellation: boolean }[];
  unexpected: string[];
  abortPrebookOnce?: boolean;
  confirmFailure?: 'price-change-then-network' | 'safe-rejection-once';
  cancelFailureOnce?: 'failed' | 'review_required';
  releaseConfirm?: Promise<void>;
};
async function mockBookings(page: Page, options: Partial<Fixture> = {}): Promise<Fixture> {
  const state: Fixture = {
    offer: hotelOffer(),
    booking: null,
    prebook: [],
    confirms: [],
    refreshes: 0,
    cancels: [],
    unexpected: [],
    ...options,
  };
  await page.route('**/api/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    const json = (value: unknown, status = 200) => route.fulfill({ status, json: value });
    if (path === '/session') return json({ user: null });
    if (path === '/catalog') return json(catalog);
    if (path === '/saved') return json({ items: [] });
    if (path === '/profile') return json({ profile: defaultTravelProfile });
    if (path === '/integrations')
      return json({ ai: false, hotels: true, flights: true, activities: false, mode: 'test' });
    if (path === '/hotels/search')
      return json({
        mode: 'test',
        offers: [
          {
            id: 'hotel-rate-1',
            hotelId: 'hotel-1',
            name: state.offer.name,
            address: state.offer.location,
            room: state.offer.room,
            board: 'Breakfast',
            price: state.offer.price,
            currency: state.offer.currency,
            checkin: state.offer.startDate,
            checkout: state.offer.endDate,
            bookingOfferId: state.offer.id,
          },
        ],
      });
    if (path === `/bookings/offers/${offerId}`) return json({ offer: state.offer });
    if (path === '/bookings/prebook') {
      state.prebook.push(route.request().postDataJSON());
      if (state.abortPrebookOnce && state.prebook.length === 1) return route.abort('failed');
      state.booking ||= checkout(state.offer);
      return json({ booking: state.booking });
    }
    if (path === '/bookings') return json({ bookings: state.booking ? [state.booking] : [] });
    if (path === `/bookings/${bookingId}` && method === 'GET')
      return json({ booking: state.booking });
    if (path === `/bookings/${bookingId}/confirm`) {
      state.confirms.push(route.request().postDataJSON());
      if (state.releaseConfirm) await state.releaseConfirm;
      if (state.confirmFailure === 'safe-rejection-once' && state.confirms.length === 1) {
        state.booking!.message =
          'The provider rejected the request before submission. Review the details and try again.';
        return json({ booking: state.booking });
      }
      if (state.confirmFailure === 'price-change-then-network' && state.confirms.length === 1) {
        state.booking!.quote = {
          ...state.booking!.quote,
          price: 237.81,
          version: 'quote-2',
          terms: ['Revised breakfast rate. Please review the new total.'],
        };
        return json(
          {
            error: 'The provider changed this quote. Review the latest total.',
            code: 'QUOTE_CHANGED',
          },
          409,
        );
      }
      if (state.confirmFailure === 'price-change-then-network') {
        state.booking!.status = 'unknown';
        return route.abort('failed');
      }
      state.booking!.status = 'pending';
      state.booking!.message =
        'The provider received your request and is processing the test reservation.';
      return json({ booking: state.booking });
    }
    if (path === `/bookings/${bookingId}/refresh`) {
      state.refreshes++;
      if (['pending', 'unknown'].includes(state.booking!.status)) {
        state.booking!.status = 'confirmed';
        state.booking!.confirmationCode = 'SANDBOX-GARDEN-1';
        state.booking!.paymentStatus = 'simulated';
        state.booking!.message = 'The provider confirmed this sandbox reservation.';
      }
      return json({ booking: state.booking });
    }
    if (path === `/bookings/${bookingId}/cancel`) {
      state.cancels.push(route.request().postDataJSON());
      if (state.cancelFailureOnce && state.cancels.length === 1) {
        state.booking!.cancellation = { status: state.cancelFailureOnce };
        state.booking!.message =
          'The provider rejected cancellation. The sandbox reservation remains active.';
        return json({ booking: state.booking });
      }
      state.booking!.status = 'cancelled';
      state.booking!.message = 'The provider cancelled this sandbox reservation.';
      state.booking!.cancellation = { status: 'cancelled', fee: 0, currency: 'USD' };
      return json({ booking: state.booking });
    }
    state.unexpected.push(`${method} ${path}`);
    return json({ error: `No mocked API for ${method} ${path}` }, 501);
  });
  return state;
}
async function fillHolder(page: Page, flight = false) {
  await page.getByRole('textbox', { name: 'First name', exact: true }).fill('Taylor');
  await page.getByRole('textbox', { name: 'Last name', exact: true }).fill('Example');
  await page.getByLabel('Email address', { exact: true }).fill('taylor@example.invalid');
  if (flight) await page.getByLabel('Phone country calling code').fill('44');
  await page
    .getByLabel('Phone number', { exact: true })
    .fill(flight ? '7700900123' : '+44 7700 900123');
}
async function acceptQuote(page: Page) {
  await page.getByRole('checkbox', { name: /I accept the current total/ }).check();
  await page.getByRole('checkbox', { name: /I understand this is a sandbox reservation/ }).check();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

for (const mobile of [false, true]) {
  test(`sandbox hotel search to saved reservation, reconciliation and explicit cancellation (${mobile ? 'mobile' : 'desktop'})`, async ({
    page,
  }, testInfo) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let release!: () => void;
    const state = await mockBookings(page, {
      abortPrebookOnce: true,
      releaseConfirm: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    await page.goto('/stays');
    await page.getByLabel('Check-in', { exact: true }).fill('2030-04-10');
    await page.getByLabel('Check-out', { exact: true }).fill('2030-04-12');
    await page.getByLabel('Guest nationality', { exact: true }).fill('GB');
    await page.getByRole('button', { name: 'Check hotel rates', exact: true }).click();
    await page.getByRole('link', { name: 'Review sandbox booking', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Let’s check the details.' })).toBeVisible();
    await page.getByRole('button', { name: 'Check price & terms', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/fetch/i);
    await page.getByRole('button', { name: 'Check price & terms', exact: true }).click();
    await expect(page).toHaveURL(`/bookings/${bookingId}`);
    expect(state.prebook).toHaveLength(2);
    expect(state.prebook[1].requestId).toBe(state.prebook[0].requestId);
    await expect(page.getByRole('status')).toContainText('The price changed during verification');
    await expect(page.getByLabel('Booking summary')).toContainText('$219.49');
    await expect(
      page.getByRole('button', { name: 'Confirm sandbox booking', exact: true }),
    ).toBeDisabled();
    await fillHolder(page);
    await acceptQuote(page);
    await expect(page.getByLabel(/card number/i)).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`sandbox-checkout-${mobile ? 'mobile' : 'desktop'}.png`),
      fullPage: true,
    });
    // Two immediate clicks exercise the synchronous in-flight guard as well as the disabled UI.
    await page
      .getByRole('button', { name: 'Confirm sandbox booking', exact: true })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    await expect(page.getByRole('button', { name: 'Confirming with provider…' })).toBeDisabled();
    expect(state.confirms).toHaveLength(1);
    expect(state.confirms[0]).toMatchObject({
      quoteVersion: 'quote-1',
      acceptedPrice: 219.49,
      acceptedCurrency: 'USD',
      acceptTerms: true,
      acceptSandbox: true,
      holder: { phone: '+44 7700 900123' },
    });
    expect(state.confirms[0].guests).toEqual([
      { firstName: 'Taylor', lastName: 'Example', email: 'taylor@example.invalid' },
    ]);
    release();
    await expect(
      page.getByRole('heading', { name: 'Awaiting provider confirmation', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Your sandbox booking is confirmed.' }),
    ).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Awaiting provider confirmation', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Check booking status', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Your sandbox booking is confirmed.' }),
    ).toBeVisible();
    await expect(page.getByText('SANDBOX-GARDEN-1', { exact: true })).toBeVisible();
    expect(state.confirms).toHaveLength(1);
    await page.getByRole('button', { name: 'Cancel sandbox booking', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(
      dialog.getByRole('button', { name: 'Confirm cancellation', exact: true }),
    ).toBeDisabled();
    await dialog.getByRole('checkbox', { name: /I accept the cancellation terms/ }).check();
    await dialog.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Your sandbox booking is cancelled.' }),
    ).toBeVisible();
    expect(state.cancels).toHaveLength(1);
    expect(state.cancels[0].acceptCancellation).toBe(true);
    await page.getByRole('link', { name: 'Your bookings', exact: true }).click();
    await expect(page).toHaveURL('/bookings');
    await expect(page.getByRole('heading', { name: 'Your bookings, in one place.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: state.offer.name, exact: true })).toBeVisible();
    await expect(page.getByText('Sandbox cancelled', { exact: true })).toBeVisible();
    await noOverflow(page);
    expect(state.unexpected).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('changed quotes require renewed acceptance, and interrupted confirmation only offers reconciliation', async ({
  page,
}) => {
  const offer = hotelOffer();
  const state = await mockBookings(page, {
    offer,
    booking: checkout(offer),
    confirmFailure: 'price-change-then-network',
  });
  await page.goto(`/bookings/${bookingId}`);
  await fillHolder(page);
  await acceptQuote(page);
  await page.getByRole('button', { name: 'Confirm sandbox booking', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Review the latest total');
  await expect(page.getByLabel('Booking summary')).toContainText('$237.81');
  await expect(
    page.getByRole('checkbox', { name: /I accept the current total/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: /I understand this is a sandbox reservation/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Confirm sandbox booking', exact: true }),
  ).toBeDisabled();
  expect(state.confirms).toHaveLength(1);
  await acceptQuote(page);
  await page.getByRole('button', { name: 'Confirm sandbox booking', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'The booking outcome needs checking' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm sandbox booking', exact: true }),
  ).toHaveCount(0);
  expect(state.confirms).toHaveLength(2);
  expect(state.confirms[1]).toMatchObject({ quoteVersion: 'quote-2', acceptedPrice: 237.81 });
  expect(state.confirms[1].requestId).not.toBe(state.confirms[0].requestId);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Status needs checking', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Check booking status', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your sandbox booking is confirmed.' }),
  ).toBeVisible();
  expect(state.confirms).toHaveLength(2);
  expect(state.refreshes).toBe(1);
  expect(state.unexpected).toEqual([]);
});

test('flight account capability blocks guest collection while preserving the verified quote', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const offer: BookingOfferView = {
    ...hotelOffer(),
    kind: 'flight',
    name: 'London to Tokyo',
    location: 'LHR → HND',
    room: undefined,
    confirmationAvailable: false,
    unavailableReason:
      'Flight sandbox confirmation is not enabled for this account. You can review verified prices and terms.',
  };
  const state = await mockBookings(page, { offer });
  await page.goto(`/bookings/new?offer=${offerId}`);
  await expect(page.getByText(offer.unavailableReason!, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check price & terms', exact: true }).click();
  await expect(page).toHaveURL(`/bookings/${bookingId}`);
  await expect(page.getByText(offer.unavailableReason!, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Booking summary')).toContainText('$219.49');
  await expect(
    page.getByRole('heading', { name: 'Cancellation terms', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'First name', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Confirm sandbox booking', exact: true }),
  ).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('sandbox-flight-unavailable-mobile.png'),
    fullPage: true,
  });
  expect(state.confirms).toHaveLength(0);
  expect(state.unexpected).toEqual([]);
});

test('enabled flight checkout requires a separate passport and contact country for every adult', async ({
  page,
}) => {
  const offer: BookingOfferView = {
    ...hotelOffer(),
    kind: 'flight',
    name: 'London to Tokyo',
    location: 'LHR → HND',
    room: undefined,
  };
  const state = await mockBookings(page, { offer, booking: checkout(offer) });
  await page.goto(`/bookings/${bookingId}`);
  await fillHolder(page, true);
  for (let i = 0; i < 2; i++) {
    const passenger = page.getByTestId('booking-passenger').nth(i);
    await passenger
      .getByLabel(`Traveler ${i + 1} first name`, { exact: true })
      .fill(i ? 'Jordan' : 'Taylor');
    await passenger.getByLabel(`Traveler ${i + 1} last name`, { exact: true }).fill('Example');
    await passenger.getByLabel('Date of birth', { exact: true }).fill('1990-04-10');
    await choose(
      page,
      passenger.getByRole('combobox', { name: 'Gender on travel document', exact: true }),
      'Female',
    );
    await passenger.getByLabel('Nationality (2-letter code)', { exact: true }).fill('GB');
    await passenger.getByLabel('Passport number', { exact: true }).fill(`TEST0000${i}`);
    await passenger.getByLabel('Passport expiry', { exact: true }).fill('2035-04-10');
    await passenger
      .getByLabel('Passport issuing country (2-letter code)', { exact: true })
      .fill('CA');
  }
  await acceptQuote(page);
  await page.getByRole('button', { name: 'Confirm sandbox booking', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Awaiting provider confirmation', exact: true }),
  ).toBeVisible();
  expect(state.confirms).toHaveLength(1);
  expect(state.confirms[0].holder).toMatchObject({ phone: '7700900123', phoneCountryCode: '44' });
  expect(state.confirms[0].guests).toHaveLength(2);
  for (const guest of state.confirms[0].guests)
    expect(guest).toMatchObject({
      nationality: 'GB',
      passportIssueCountry: 'CA',
      dateOfBirth: '1990-04-10',
      passportExpiry: '2035-04-10',
    });
  expect(state.unexpected).toEqual([]);
});

test('incomplete and expired checkout quotes never enable confirmation', async ({ page }) => {
  const offer = hotelOffer();
  const pending = checkout(offer);
  pending.quote.version = '';
  const state = await mockBookings(page, { offer, booking: pending });
  await page.goto(`/bookings/${bookingId}`);
  await expect(page.getByText('Preparing quote', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm sandbox booking', exact: true }),
  ).toHaveCount(0);
  state.booking!.quote.version = 'expired-quote';
  state.booking!.quote.expiresAt = '2020-01-01T00:00:00Z';
  await page.getByRole('button', { name: 'Check booking status', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'This quote has expired.' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Confirm sandbox booking', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Search again', exact: true })).toBeVisible();
  expect(state.confirms).toHaveLength(0);
  expect(state.unexpected).toEqual([]);
});

for (const cancellationFailure of ['failed', 'review_required'] as const) {
  test(`cancellation ${cancellationFailure} preserves confirmation and permits a new explicit request`, async ({
    page,
  }) => {
    const offer = hotelOffer();
    const booking = checkout(offer);
    booking.status = 'confirmed';
    const state = await mockBookings(page, {
      offer,
      booking,
      cancelFailureOnce: cancellationFailure,
    });
    await page.goto(`/bookings/${bookingId}`);
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole('button', { name: 'Cancel sandbox booking', exact: true }).click();
      const dialog = page.getByRole('alertdialog');
      await dialog.getByRole('checkbox', { name: /I accept the cancellation terms/ }).check();
      await dialog.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      if (attempt === 0) {
        await expect(
          page.getByRole('heading', { name: 'Your sandbox booking is confirmed.' }),
        ).toBeVisible();
        await expect(
          page.getByText(
            'The provider rejected cancellation. The sandbox reservation remains active.',
            { exact: true },
          ),
        ).toBeVisible();
      }
    }
    await expect(
      page.getByRole('heading', { name: 'Your sandbox booking is cancelled.' }),
    ).toBeVisible();
    expect(state.cancels).toHaveLength(2);
    expect(state.cancels[1].requestId).not.toBe(state.cancels[0].requestId);
    expect(state.unexpected).toEqual([]);
  });
}

test('a safe pre-dispatch confirmation rejection requires renewed consent and a fresh request key', async ({
  page,
}) => {
  const offer = hotelOffer();
  const state = await mockBookings(page, {
    offer,
    booking: checkout(offer),
    confirmFailure: 'safe-rejection-once',
  });
  await page.goto(`/bookings/${bookingId}`);
  await fillHolder(page);
  await acceptQuote(page);
  await page.getByRole('button', { name: 'Confirm sandbox booking', exact: true }).click();
  await expect(
    page.getByText(
      'The provider rejected the request before submission. Review the details and try again.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: /I accept the current total/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: /I understand this is a sandbox reservation/ }),
  ).not.toBeChecked();
  expect(state.confirms).toHaveLength(1);
  await acceptQuote(page);
  await page.getByRole('button', { name: 'Confirm sandbox booking', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Awaiting provider confirmation', exact: true }),
  ).toBeVisible();
  expect(state.confirms).toHaveLength(2);
  expect(state.confirms[1].requestId).not.toBe(state.confirms[0].requestId);
  expect(state.confirms[1].quoteVersion).toBe(state.confirms[0].quoteVersion);
  expect(state.unexpected).toEqual([]);
});
