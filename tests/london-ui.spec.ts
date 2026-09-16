import { test, expect, type Page } from '@playwright/test';
import type { Trip } from '../shared/types';
import type { PlanningRun } from '../shared/planning';
import { findDestination } from '../shared/destinations';

const londonPrompt =
  'Plan 4 days in London starting November 18, 2026, for 2 adults. We prefer vegetarian food, step-free access, and quiet places. for 2 travelers';
const osakaFollowUp =
  'Change this trip to Osaka for 6 days starting December 1, 2026. We still prefer vegetarian food.';

async function readTrip(page: Page, tripId: string): Promise<Trip> {
  const response = await page.request.get(`/api/trips/${tripId}`);
  expect(response.status()).toBe(200);
  return (await response.json()).trip as Trip;
}

async function completeRun(page: Page, runId: string) {
  let completed: PlanningRun | undefined;
  let lastProgress = '';
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/planning/runs/${runId}`);
        expect(response.status()).toBe(200);
        const { run } = (await response.json()) as { run: PlanningRun };
        completed = run;
        const latest = run.events.at(-1);
        const progress = `${run.status}:${latest?.agent}:${latest?.status}`;
        if (progress !== lastProgress) {
          console.log(
            `Planning check: ${run.status}${latest ? ` — ${latest.label}: ${latest.status}` : ''}`,
          );
          lastProgress = progress;
        }
        if (run.status === 'failed' || run.status === 'cancelled')
          throw new Error(run.error || `Planning ${run.status}`);
        return run.status;
      },
      {
        timeout: 360_000,
        intervals: [500, 1000, 2000],
        message: 'The real planning run completes',
      },
    )
    .toBe('completed');
  await expect(page.getByRole('textbox', { name: 'Message Tara' })).toBeEnabled({
    timeout: 360_000,
  });
  await expect(page.getByRole('button', { name: 'Edit trip details' })).toBeEnabled();
  return completed!;
}

function expectLondon(trip: Trip) {
  expect(trip.destinationId).toBe('london');
  expect(trip.startDate).toBe('2026-11-18');
  expect(trip.days).toBe(4);
  expect(trip.travelers).toBe(2);
  expect(trip.itinerary).toHaveLength(4);
  expect(trip.itinerary.map((day) => day.destinationId)).toEqual([
    'london',
    'london',
    'london',
    'london',
  ]);
  expect(trip.itinerary.flatMap((day) => day.items).length).toBeGreaterThan(0);
  expect(trip.brief?.destinationStops).toEqual([{ destinationId: 'london', days: 4 }]);
  const notes = trip.brief?.notes.join(' ') || '';
  expect(notes).toMatch(/vegetarian/i);
  expect(notes).toMatch(/step[- ]free/i);
  expect(notes).toMatch(/quiet/i);
  expect(trip.brief?.includeFlights).toBe(false);
  expect(trip.brief?.includeHotels).toBe(false);
}

function expectGlobalOsaka(trip: Trip) {
  expect(findDestination(trip.destinationId, trip)?.name).toMatch(/^Osaka$/i);
  expect(trip.destinationId).not.toBe('london');
  expect(trip.startDate).toBe('2026-12-01');
  expect(trip.days).toBe(6);
  expect(trip.travelers).toBe(2);
  expect(trip.itinerary).toHaveLength(6);
  expect(trip.itinerary.every((day) => day.destinationId === trip.destinationId)).toBe(true);
  expect(trip.brief?.destinationStops).toEqual([{ destinationId: trip.destinationId, days: 6 }]);
  expect(trip.brief?.notes.join(' ')).toMatch(/vegetarian/i);
  expect(trip.planning?.mode).toBe('live');
  expect(trip.planning?.model).toBe('gpt-6-astra');
  expect(trip.planning?.agentIds).toContain('verification');
  expect(
    trip.planning?.sources.some(
      (source) => source.kind === 'web' && source.url?.startsWith('https://'),
    ),
  ).toBe(true);
  expect(
    trip.itinerary.flatMap((day) => day.items).some((item) => item.placeId?.startsWith('web-')),
  ).toBe(true);
  expect(trip.brief?.includeFlights).toBe(false);
  expect(trip.brief?.includeHotels).toBe(false);
}

test('the exact London request persists and Osaka switches globally when AI is connected', async ({
  page,
}, testInfo) => {
  // This journey uses the actual API and any configured planning model. It never searches
  // flight/hotel offers or creates bookings, and deletes only the trip it creates.
  test.setTimeout(800_000);
  let tripId: string | undefined;
  try {
    await page.goto('/chat');
    await expect(page.getByRole('textbox', { name: 'Message Tara' })).toBeVisible();
    const integrationResponse = await page.request.get('/api/integrations');
    expect(integrationResponse.status()).toBe(200);
    const integrations = (await integrationResponse.json()) as { ai: boolean };
    await page.getByRole('textbox', { name: 'Message Tara' }).fill(londonPrompt);
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/planning/runs',
    );
    await page.getByRole('button', { name: 'Send message' }).click();
    const created = await createdResponse;
    expect(created.status()).toBe(202);
    const { run } = (await created.json()) as { run: PlanningRun };
    tripId = run.tripId;
    expect(created.request().postDataJSON().message).toBe(londonPrompt);
    await expect(page).toHaveURL(new RegExp(`/chat/${tripId}$`));
    await completeRun(page, run.id);
    const consultation = await readTrip(page, tripId);
    expect(consultation.itinerary).toHaveLength(0);
    expect(consultation.brief?.consultation?.services.flights.status).toBe('unknown');
    expect(consultation.brief?.consultation?.services.hotels.status).toBe('unknown');
    expect(consultation.planning?.questions.map((entry) => entry.field)).toEqual([
      'flights',
      'hotels',
    ]);
    const firstReply =
      consultation.messages.filter((message) => message.role === 'assistant').at(-1)?.content || '';
    expect(firstReply.length).toBeLessThan(450);
    expect(firstReply).not.toMatch(
      /no flights needed|flights (?:are )?(?:not needed|unnecessary)|1,500/i,
    );
    await page.screenshot({ path: testInfo.outputPath('london-consultation.png') });
    await page
      .getByRole('textbox', { name: 'Message Tara' })
      .fill(
        'Please plan the itinerary only. No flights or hotels needed. Our total group budget is AUD 3000 for activities, meals and local transport.',
      );
    const answeredResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/planning/runs',
    );
    await page.getByRole('button', { name: 'Send message' }).click();
    const answered = await answeredResponse;
    expect(answered.status()).toBe(202);
    const completed = await completeRun(page, (await answered.json()).run.id);
    await expect(
      page.getByRole('group', { name: 'Itinerary days' }).getByRole('button'),
    ).toHaveCount(4);
    const original = await readTrip(page, tripId);
    expectLondon(original);
    expect(original.messages.filter((message) => message.role === 'user')).toHaveLength(2);
    expect(original.brief?.consultation?.currency).toBe('AUD');
    expect(original.budget).toBe(3000);
    expect(original.brief?.consultation?.services.flights.status).toBe('not_needed');
    expect(original.planning?.budget.targetCurrency).toBe('AUD');
    expect(original.planning?.issues.some((issue) => issue.code === 'over_budget')).toBe(false);
    expect(original.messages.find((message) => message.role === 'user')?.content).toBe(
      londonPrompt,
    );
    expect(
      original.messages.filter((message) => message.role === 'assistant').at(-1)?.content,
    ).toMatch(/London/i);
    expect(
      original.messages.filter((message) => message.role === 'assistant').at(-1)?.content,
    ).not.toMatch(/A few places come to mind|Bali|Marrakech|Istanbul/i);
    if (integrations.ai) {
      expect(completed.result?.mode).toBe('live');
      expect(completed.result?.warning).toBeFalsy();
      expect(original.planning?.mode, 'Configured AI must actually complete this plan').toBe(
        'live',
      );
      expect(original.planning?.issues.map((issue) => issue.code)).not.toContain('intake_fallback');
      expect(original.planning?.issues.map((issue) => issue.code)).not.toContain(
        'composition_fallback',
      );
      expect(original.planning?.model).toBe('gpt-6-astra');
      expect(original.planning?.sources.some((source) => source.kind === 'web')).toBe(true);
      expect(original.planning?.agentIds).toContain('verification');
      expect(
        completed.events.some(
          (event) => event.agent === 'verification' && event.status === 'completed',
        ),
      ).toBe(true);
    }

    await page.reload();
    await expect(page.getByRole('button', { name: 'Edit trip details' })).toBeEnabled();
    const reloaded = await readTrip(page, tripId);
    expectLondon(reloaded);
    expect(reloaded.itinerary).toEqual(original.itinerary);
    expect(reloaded.brief).toEqual(original.brief);
    await page.getByRole('button', { name: 'Edit trip details' }).click();
    const settings = page.getByRole('dialog', { name: 'Make it your kind of trip' });
    await expect(settings.getByLabel('Start date', { exact: true })).toHaveValue('2026-11-18');
    await expect(settings.getByLabel('Number of days', { exact: true })).toHaveValue('4');
    await expect(settings.getByLabel('Travelers', { exact: true })).toHaveValue('2');
    await expect(settings.getByLabel('Anything to keep in mind?')).toHaveValue(/vegetarian/i);
    await expect(settings.getByLabel('Anything to keep in mind?')).toHaveValue(/step[- ]free/i);
    await expect(settings.getByLabel('Anything to keep in mind?')).toHaveValue(/quiet/i);
    await settings.getByRole('button', { name: 'Close dialog' }).click();
    await page.screenshot({ path: testInfo.outputPath('london-after-reload.png') });
    if (new URL(page.url()).hostname === 'asktara-production-58de.up.railway.app') {
      await page.screenshot({ path: 'docs/screenshots/london-fixed-railway.png' });
    }

    await page.getByRole('textbox', { name: 'Message Tara' }).fill(osakaFollowUp);
    const followUpResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/planning/runs',
    );
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const submitted = await followUpResponse;
    expect(submitted.status()).toBe(202);
    const followUp = (await submitted.json()) as { run: PlanningRun };
    expect(followUp.run.tripId).toBe(tripId);
    const completedFollowUp = await completeRun(page, followUp.run.id);
    const reply = page.getByTestId('assistant-message').last();
    await expect(reply).toContainText('Osaka');
    await expect(reply).not.toContainText(/A few places come to mind/i);
    const updated = await readTrip(page, tripId);
    if (integrations.ai) {
      expect(completedFollowUp.result?.mode).toBe('live');
      expect(
        completedFollowUp.events.some(
          (event) => event.agent === 'verification' && event.status === 'completed',
        ),
      ).toBe(true);
      expectGlobalOsaka(updated);
      await expect(reply).not.toContainText(/not covered|not supported|unsupported/i);
      await expect(
        page.getByRole('group', { name: 'Itinerary days' }).getByRole('button'),
      ).toHaveCount(6);
    } else {
      await expect(reply).toContainText(/not covered|not supported|unsupported/i);
      expectLondon(updated);
      expect(updated.itinerary).toEqual(original.itinerary);
      expect(updated.title).toBe(original.title);
      expect(updated.brief).toEqual(original.brief);
    }
    expect(updated.messages.filter((message) => message.role === 'user').at(-1)?.content).toBe(
      osakaFollowUp,
    );
    await page.reload();
    await expect(page.getByRole('button', { name: 'Edit trip details' })).toBeEnabled();
    await expect(page.getByTestId('assistant-message').last()).toContainText('Osaka');
    await expect(
      page.getByRole('group', { name: 'Itinerary days' }).getByRole('button'),
    ).toHaveCount(integrations.ai ? 6 : 4);
    const finalTrip = await readTrip(page, tripId);
    expect(finalTrip.itinerary).toEqual(updated.itinerary);
    if (integrations.ai) {
      expectGlobalOsaka(finalTrip);
      await page.screenshot({ path: testInfo.outputPath('global-osaka-railway.png') });
      if (new URL(page.url()).hostname === 'asktara-production-58de.up.railway.app')
        await page.screenshot({ path: 'docs/screenshots/global-osaka-railway.png' });
    } else {
      expectLondon(finalTrip);
      await page.screenshot({ path: testInfo.outputPath('london-after-unsupported-city.png') });
    }
  } finally {
    if (tripId) {
      // The server also cancels active work for this owned trip if an earlier assertion failed.
      const deleted = await page.request.delete(`/api/trips/${tripId}`);
      expect(deleted.status(), 'Remove this regression test’s synthetic trip').toBe(204);
    }
  }
});
