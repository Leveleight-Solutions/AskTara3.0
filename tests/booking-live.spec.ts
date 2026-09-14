import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import type { Booking, BookingOfferView } from '../shared/bookings';

// This test creates and cancels a real provider SANDBOX hotel reservation.
// It is deliberately opt-in and never invokes flight booking or real payment.
test.skip(
  process.env.ASKTARA_TEST_SANDBOX_BOOKING !== '1',
  'Set ASKTARA_TEST_SANDBOX_BOOKING=1 only for an approved sandbox hotel check.',
);

function sandboxHotel(booking: Booking) {
  expect(booking.kind).toBe('hotel');
  expect(booking.mode).toBe('test');
  expect(booking.offer.kind).toBe('hotel');
  expect(booking.offer.mode).toBe('test');
  return booking;
}
async function savedBooking(page: Page, id: string) {
  const response = await page.request.get(`/api/bookings/${id}`, { timeout: 45_000 });
  expect(response.status()).toBe(200);
  return sandboxHotel((await response.json()).booking as Booking);
}
async function settleThroughUI(page: Page, id: string, status: 'confirmed' | 'cancelled') {
  let current = await savedBooking(page, id);
  await expect
    .poll(
      async () => {
        if (current.status === status || current.status === 'failed') return current.status;
        const responsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === `/api/bookings/${id}/refresh`,
          { timeout: 150_000 },
        );
        await page.getByRole('button', { name: 'Check booking status', exact: true }).click();
        const response = await responsePromise;
        expect(response.status()).toBe(200);
        current = sandboxHotel((await response.json()).booking as Booking);
        return current.status;
      },
      {
        timeout: 150_000,
        intervals: [2000, 5000, 10_000],
        message: `Sandbox provider reports ${status}`,
      },
    )
    .toBe(status);
  return current;
}
async function cleanOwnedSandboxAccount(
  page: Page,
  credentials: { email: string; password: string },
  testInfo: TestInfo,
) {
  // A fresh Playwright context and unique registration own every record below.
  // Preserve the account if a provider outcome cannot be reconciled; deleting it
  // would lose the reference needed to cancel the outstanding test reservation.
  try {
    const response = await page.request.get('/api/bookings', { timeout: 45_000 });
    expect(response.status()).toBe(200);
    const bookings = (await response.json()).bookings as Booking[];
    for (const initial of bookings) {
      let booking = sandboxHotel(initial);
      let cancelSent = false;
      const cancellationId = randomUUID();
      await expect
        .poll(
          async () => {
            if (['cancelled', 'failed', 'expired', 'checkout'].includes(booking.status))
              return true;
            if (booking.status === 'confirmed' && !cancelSent) {
              cancelSent = true;
              const cancelled = await page.request.post(`/api/bookings/${booking.id}/cancel`, {
                data: { requestId: cancellationId, acceptCancellation: true },
                timeout: 150_000,
              });
              if (cancelled.ok())
                booking = sandboxHotel((await cancelled.json()).booking as Booking);
            } else {
              const refreshed = await page.request.post(`/api/bookings/${booking.id}/refresh`, {
                data: {},
                timeout: 150_000,
              });
              if (refreshed.ok())
                booking = sandboxHotel((await refreshed.json()).booking as Booking);
            }
            return ['cancelled', 'failed', 'expired'].includes(booking.status);
          },
          {
            timeout: 150_000,
            intervals: [2000, 5000, 10_000],
            message: 'Clean up this test account’s sandbox reservation',
          },
        )
        .toBe(true);
    }
    const deleted = await page.request.delete('/api/account', {
      data: { currentPassword: credentials.password, confirmation: 'DELETE' },
      timeout: 45_000,
    });
    expect(deleted.status()).toBe(200);
  } catch (error) {
    await writeFile(
      testInfo.outputPath('private-sandbox-account-recovery.json'),
      JSON.stringify({ baseUrl: testInfo.project.use.baseURL, ...credentials }, null, 2),
      { mode: 0o600 },
    );
    throw new Error(
      `Sandbox cleanup did not complete; the test account is preserved. Its recovery details are in the private test-output file. ${error instanceof Error ? error.message : 'Check the provider status.'}`,
    );
  }
}

test('deployed sandbox hotel checkout confirms, persists and cancels through the website', async ({
  page,
}, testInfo) => {
  test.setTimeout(720_000);
  const credentials = {
    email: `sandbox-ui-${randomUUID()}@example.invalid`,
    password: `Sandbox-check-${randomUUID()}`,
  };
  let registered = false;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const registration = await page.request.post('/api/auth/register', {
      data: { ...credentials, name: 'Sandbox Traveler' },
      timeout: 45_000,
    });
    expect(registration.status()).toBe(201);
    registered = true;
    await page.goto('/stays');
    await page.getByRole('combobox', { name: 'Destination', exact: true }).selectOption('lisbon');
    await page
      .getByLabel('Check-in', { exact: true })
      .fill(process.env.ASKTARA_TEST_HOTEL_CHECKIN || '2026-11-18');
    await page
      .getByLabel('Check-out', { exact: true })
      .fill(process.env.ASKTARA_TEST_HOTEL_CHECKOUT || '2026-11-20');
    await page.getByRole('combobox', { name: 'Guests', exact: true }).selectOption('2');
    await page.getByLabel('Guest nationality', { exact: true }).fill('US');
    const searchPromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/hotels/search',
      { timeout: 90_000 },
    );
    await page.getByRole('button', { name: 'Check hotel rates', exact: true }).click();
    const searched = await searchPromise;
    expect(searched.status()).toBe(200);
    const search = (await searched.json()) as {
      mode: string;
      offers: { bookingOfferId?: string }[];
    };
    expect(search.mode, 'Never proceed with production hotel inventory').toBe('test');
    const reference = search.offers.find((offer) => offer.bookingOfferId)?.bookingOfferId;
    expect(reference, 'A server-issued sandbox booking reference is required').toBeTruthy();
    const offerResponse = await page.request.get(`/api/bookings/offers/${reference}`);
    expect(offerResponse.status()).toBe(200);
    const offer = (await offerResponse.json()).offer as BookingOfferView;
    expect(offer.mode).toBe('test');
    expect(offer.kind).toBe('hotel');
    expect(offer.confirmationAvailable).not.toBe(false);
    await page.getByRole('link', { name: 'Review sandbox booking', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Let’s check the details.' })).toBeVisible();
    const prebookPromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/bookings/prebook',
      { timeout: 150_000 },
    );
    await page.getByRole('button', { name: 'Check price & terms', exact: true }).click();
    const prepared = await prebookPromise;
    expect(prepared.ok()).toBe(true);
    const checkout = sandboxHotel((await prepared.json()).booking as Booking);
    expect(checkout.status).toBe('checkout');
    expect(checkout.quote.version).not.toBe('');
    expect(checkout.quote.price).toBeGreaterThan(0);
    expect(checkout.quote.terms.length).toBeGreaterThan(0);
    expect(checkout.paymentStatus).toBe('not_charged');
    await expect(page).toHaveURL(new RegExp(`/bookings/${checkout.id}$`));
    await page.getByRole('textbox', { name: 'First name', exact: true }).fill('Taylor');
    await page.getByRole('textbox', { name: 'Last name', exact: true }).fill('Example');
    await page
      .getByLabel('Email address', { exact: true })
      .fill('sandbox-traveler@example.invalid');
    await page.getByLabel('Phone number', { exact: true }).fill('+1 202 555 0147');
    await page.getByRole('checkbox', { name: /I accept the current total/ }).check();
    await page
      .getByRole('checkbox', { name: /I understand this is a sandbox reservation/ })
      .check();
    const confirmPromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/bookings/${checkout.id}/confirm`,
      { timeout: 150_000 },
    );
    await page.getByRole('button', { name: 'Confirm sandbox booking', exact: true }).click();
    const confirmation = await confirmPromise;
    expect(confirmation.status()).toBe(200);
    sandboxHotel((await confirmation.json()).booking as Booking);
    const confirmed = await settleThroughUI(page, checkout.id, 'confirmed');
    expect(confirmed.paymentStatus).toBe('simulated');
    expect(confirmed.confirmationCode || confirmed.providerBookingId).toBeTruthy();
    await expect(
      page.getByRole('heading', { name: 'Your sandbox booking is confirmed.' }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('sandbox-hotel-confirmed-desktop.png'),
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Your sandbox booking is confirmed.' }),
    ).toBeVisible();
    expect((await savedBooking(page, checkout.id)).providerBookingId).toBe(
      confirmed.providerBookingId,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('sandbox-hotel-confirmed-mobile.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Cancel sandbox booking', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel this sandbox booking?' });
    await expect(
      dialog.getByRole('button', { name: 'Confirm cancellation', exact: true }),
    ).toBeDisabled();
    await dialog.getByRole('checkbox', { name: /I accept the cancellation terms/ }).check();
    const cancelPromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/api/bookings/${checkout.id}/cancel`,
      { timeout: 150_000 },
    );
    await dialog.getByRole('button', { name: 'Confirm cancellation', exact: true }).click();
    const cancellation = await cancelPromise;
    expect(cancellation.status()).toBe(200);
    sandboxHotel((await cancellation.json()).booking as Booking);
    await settleThroughUI(page, checkout.id, 'cancelled');
    await expect(
      page.getByRole('heading', { name: 'Your sandbox booking is cancelled.' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Your bookings', exact: true }).click();
    await expect(page).toHaveURL('/bookings');
    await expect(page.getByRole('heading', { name: 'Your bookings, in one place.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: offer.name, exact: true })).toBeVisible();
    await expect(page.getByText('Sandbox cancelled', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    if (registered) await cleanOwnedSandboxAccount(page, credentials, testInfo);
  }
});
