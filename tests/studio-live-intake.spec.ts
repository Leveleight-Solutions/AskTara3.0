import { test, expect } from '@playwright/test';
import type { StudioWorkspace } from '../shared/studio';

// A new fictional brief only. No supplier search, recommendation research, imported client
// material, reservation, payment or publication. The workspace is deleted in finally.
test.use({ trace: 'off', video: 'off' });

const fictionalBrief =
  'Plan a 28-day European proposal for a fictional client: 2 adults, no children. Arrive Paris, France on 2026-11-18: Paris 9 nights, Berlin, Germany 9 nights, and London, United Kingdom 9 nights. Group budget AUD 12000. Prefer 4-star hotels near railway stations and quiet cultural visits. Start with the route only.';

test('real Studio intake preserves a 28-day route and waits for explicit acceptance', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  let workspaceId: string | undefined;
  const unwanted: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (
      /\/api\/(?:studio\/workspaces\/[^/]+\/(?:hotels\/search|flights\/search|recommendations|quotes\/)|bookings)/.test(
        new URL(request.url()).pathname,
      )
    )
      unwanted.push(new URL(request.url()).pathname);
  });
  try {
    await page.goto('/');
    const brief = page.getByRole('textbox', { name: 'Tell Tara about your trip' });
    await expect(brief).toBeVisible();
    await brief.fill(fictionalBrief);
    const createdPromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/studio/workspaces',
    );
    const reviewPromise = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/studio\/workspaces\/[^/]+\/review$/.test(new URL(response.url()).pathname),
      { timeout: 225_000 },
    );
    await page.getByRole('button', { name: 'Start planning your trip' }).click();
    const created = await createdPromise;
    expect(created.status()).toBe(201);
    workspaceId = ((await created.json()) as { workspace: StudioWorkspace }).workspace.id;
    const review = await reviewPromise;
    const reviewed = (await review.json()) as {
      workspace?: StudioWorkspace;
      mode?: string;
      model?: string;
      error?: string;
    };
    expect(
      review.status(),
      typeof reviewed.error === 'string' ? reviewed.error : 'Real intake completes',
    ).toBe(200);
    expect(reviewed.mode).toBe('live');
    expect(reviewed.model).toBe('gpt-6-astra');
    await expect(page).toHaveURL(new RegExp(`/studio/${workspaceId}$`));
    let workspace = reviewed.workspace!;
    const verify = (value: StudioWorkspace) => {
      expect(value.stops.map((stop) => stop.name)).toEqual(['Paris', 'Berlin', 'London']);
      expect(value.stops.map((stop) => stop.nights)).toEqual([9, 9, 9]);
      expect(value.stops.map((stop) => stop.arrivalDate)).toEqual([
        '2026-11-18',
        '2026-11-27',
        '2026-12-06',
      ]);
      expect(value.stops.map((stop) => stop.departureDate)).toEqual([
        '2026-11-27',
        '2026-12-06',
        '2026-12-15',
      ]);
      const totalNights = value.stops.reduce((total, stop) => total + (stop.nights || 0), 0);
      expect(totalNights).toBe(27);
      expect(
        (Date.parse(value.stops.at(-1)!.departureDate) - Date.parse(value.stops[0].arrivalDate)) /
          86_400_000 +
          1,
      ).toBe(28);
      expect(value.brief).toMatchObject({
        adults: 2,
        children: 0,
        childAges: [],
        currency: 'AUD',
        budget: 12000,
        startDate: '2026-11-18',
        origin: '',
        cabin: '',
      });
      expect(value.brief.hotelStandard).toMatch(/4|four/i);
      expect(value.brief.hotelLocation).toMatch(/rail|train|station/i);
      expect([...value.brief.interests, ...value.brief.requirements].join(' ')).toMatch(/quiet/i);
      expect(value.items).toHaveLength(0);
      expect(value.recommendations).toHaveLength(0);
      expect(value.imports).toHaveLength(0);
      expect(value.proposal).toBeNull();
    };
    verify(workspace);
    expect(workspace.structureAccepted).toBe(false);
    expect(
      workspace.messages.filter((message) => message.role === 'assistant').at(-1)!.content.length,
    ).toBeLessThanOrEqual(600);
    await expect(page.getByRole('tab', { name: 'Services', exact: true })).toBeDisabled();
    await page
      .getByRole('button', { name: /Skip questions and build structure|Build route structure/ })
      .click();
    await expect(page.getByRole('button', { name: 'Accept structure', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Accept structure', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'What would you like help with?' }),
    ).toBeVisible();
    const savedResponse = await page.request.get(`/api/studio/workspaces/${workspaceId}`);
    expect(savedResponse.status()).toBe(200);
    workspace = (await savedResponse.json()).workspace;
    expect(workspace.structureAccepted).toBe(true);
    verify(workspace);
    await page.reload();
    await page.getByRole('tab', { name: 'Structure', exact: true }).click();
    await expect(
      page.getByRole('spinbutton', { name: 'Nights in Paris', exact: true }),
    ).toHaveValue('9');
    await expect(page.getByLabel('Departure from London', { exact: true })).toHaveValue(
      '2026-12-15',
    );
    await page.screenshot({
      path: testInfo.outputPath('studio-live-28-day-route.png'),
      fullPage: true,
    });
    expect(unwanted).toEqual([]);
    expect(errors).toEqual([]);
    console.log(
      JSON.stringify({
        check: 'studio_live_intake',
        mode: reviewed.mode,
        model: reviewed.model || 'not_exposed_by_endpoint',
        stops: workspace.stops.length,
        nights: 27,
        inclusiveDays: 28,
        structureAccepted: true,
        services: 0,
        recommendations: 0,
        reloaded: true,
      }),
    );
  } finally {
    if (workspaceId) {
      const removed = await page.request.delete(`/api/studio/workspaces/${workspaceId}`);
      expect(removed.status()).toBe(204);
    }
  }
});
