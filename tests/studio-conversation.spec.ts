import { confirmStudioStartClient, closeStudioTool, openStudioTool } from './ui-helpers';
import { test, expect, type Page } from '@playwright/test';
import type { StudioWorkspace } from '../shared/studio';

const reviewResponse = (page: Page) =>
  page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith('/review') &&
      response.request().method() === 'POST',
  );

// Exercise the actual browser session and local backend, without route mocks.
test('a greeting starts a contextual conversation and short answers update the saved route', async ({
  page,
}) => {
  const integrations = await page.request.get('/api/integrations');
  expect(integrations.status()).toBe(200);
  test.skip((await integrations.json()).ai, 'This regression exercises basic planning without AI.');
  let workspaceId: string | undefined;
  let clientId: string | undefined;
  const backgroundResearch: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === 'POST' &&
      /destinations\/|trip-briefing|\/journey\/research/.test(path)
    )
      backgroundResearch.push(path);
  });
  try {
    await page.goto('/');
    await expect(page.getByRole('note', { name: 'Basic planning mode' })).toContainText(
      'AI chat is not connected',
    );
    await page.getByRole('textbox', { name: 'Tell Tara about your trip' }).fill('hi');
    const created = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/studio/workspaces' &&
        response.request().method() === 'POST',
    );
    const greeted = reviewResponse(page);
    await page.getByRole('button', { name: 'Start planning your trip' }).click();
    clientId = await confirmStudioStartClient(page);
    const creation = await created;
    expect(creation.status()).toBe(201);
    workspaceId = ((await creation.json()).workspace as StudioWorkspace).id;
    const greeting = await greeted;
    expect(greeting.status()).toBe(200);
    const first = (await greeting.json()).workspace as StudioWorkspace;
    const firstReply = first.messages.find((message) => message.role === 'assistant')!.content;
    expect(firstReply).toMatch(/^Hi!/);
    expect(firstReply).toContain('Where would you like the client to travel?');
    expect(firstReply).not.toMatch(/saved|review the missing|edit the structure|read .*details/i);
    expect(first.stops).toEqual([]);
    expect(first.brief.request).toBe('');
    expect(first.brief.adults).toBeNull();
    expect(first.brief.startDate).toBe('');
    await expect(page).toHaveURL(`/studio/${workspaceId}`);
    await expect(page.getByRole('note', { name: 'Basic planning mode' })).toBeVisible();
    const conversation = page.getByRole('log');
    await expect(conversation).toContainText(firstReply);
    await openStudioTool(page, 'Route');
    await expect(page.getByRole('region', { name: 'Route structure' })).toContainText(
      'Your route will appear here.',
    );

    await closeStudioTool(page);
    const message = page.getByRole('textbox', { name: 'Reply or refine the route' });
    await message.fill('Paris');
    const destinationReview = reviewResponse(page);
    await page.getByRole('button', { name: 'Send to Tara' }).click();
    const destination = await destinationReview;
    expect(destination.status()).toBe(200);
    const second = (await destination.json()).workspace as StudioWorkspace;
    const secondReply = second.messages.at(-1)!.content;
    expect(secondReply).toContain('Paris');
    expect(secondReply).toContain('Flight or Cruise?');
    expect(secondReply).not.toMatch(/How many nights|When.*arriv/i);
    expect(secondReply).not.toBe(firstReply);
    expect(second.stops).toHaveLength(1);
    expect(second.stops[0]).toMatchObject({ name: 'Paris', nights: null });
    await expect(conversation).toContainText(secondReply);
    await openStudioTool(page, 'Route');
    await expect(page.getByLabel('Destination 1', { exact: true })).toHaveValue('Paris');
    await closeStudioTool(page);

    const transportMessages: string[] = [];
    async function travelAnswer(text: string) {
      await message.fill(text);
      const response = reviewResponse(page);
      await page.getByRole('button', { name: 'Send to Tara' }).click();
      const reviewed = await response;
      expect(reviewed.status()).toBe(200);
      const result = await reviewed.json();
      expect(result.mode).toBe('local');
      const current = result.workspace as StudioWorkspace;
      expect(current.stops[0]).toMatchObject({
        id: second.stops[0].id,
        name: 'Paris',
        nights: null,
      });
      expect(current.brief.startDate).toBe('');
      expect(current.brief.adults).toBeNull();
      const reply = current.messages.at(-1)!.content;
      transportMessages.push(text, reply);
      await expect(conversation).toContainText(reply);
      return { current, reply };
    }
    const outbound = await travelAnswer('Flight');
    expect(outbound.current.brief.outboundTransport).toBe('flight');
    expect(outbound.reply).toMatch(/Where will you depart from/);
    const origin = await travelAnswer('Sydney');
    expect(origin.current.brief.origin).toBe('Sydney');
    expect(origin.reply).toMatch(/departure date or flexible dates/);
    expect(origin.current.brief.passportNationality).toBe('');
    const flexible = await travelAnswer('flexible');
    expect(flexible.current.brief.datesFlexible).toBe(true);
    expect(flexible.current.brief.departureDate || '').toBe('');
    expect(flexible.reply).toMatch(/return.*flight or cruise/i);
    const returning = await travelAnswer('Flight');
    expect(returning.current.brief.returnTransport).toBe('flight');
    expect(returning.reply).toContain('How many adults are travelling on this trip?');

    await message.fill('3 nights');
    const lengthReview = reviewResponse(page);
    await page.getByRole('button', { name: 'Send to Tara' }).click();
    const length = await lengthReview;
    expect(length.status()).toBe(200);
    const third = (await length.json()).workspace as StudioWorkspace;
    const thirdReply = third.messages.at(-1)!.content;
    expect(thirdReply).toContain('Paris for 3 nights');
    expect(thirdReply).toContain('How many adults are travelling on this trip?');
    expect(thirdReply).not.toBe(secondReply);
    expect(third.stops[0]).toMatchObject({ id: second.stops[0].id, name: 'Paris', nights: 3 });
    await expect(conversation).toContainText(thirdReply);
    await openStudioTool(page, 'Route');
    await expect(page.getByLabel('Nights in Paris', { exact: true })).toHaveValue('3');

    await page.reload();
    await expect(conversation).toContainText(thirdReply);
    await openStudioTool(page, 'Route');
    await expect(page.getByLabel('Nights in Paris', { exact: true })).toHaveValue('3');
    const stored = await page.request.get(`/api/studio/workspaces/${workspaceId}`);
    expect(stored.status()).toBe(200);
    const saved = (await stored.json()).workspace as StudioWorkspace;
    expect(saved.messages.map(({ content }) => content)).toEqual([
      'hi',
      firstReply,
      'Paris',
      secondReply,
      ...transportMessages,
      '3 nights',
      thirdReply,
    ]);
    expect(saved.stops).toHaveLength(1);
    expect(saved.stops[0]).toMatchObject({ name: 'Paris', nights: 3 });
    expect(saved.brief).toMatchObject({
      origin: 'Sydney',
      outboundTransport: 'flight',
      returnTransport: 'flight',
      datesFlexible: true,
      adults: null,
      children: null,
      startDate: '',
    });
    expect(saved.destinationResearch).toBeFalsy();
    expect(saved.tripBriefing).toBeFalsy();
    expect(backgroundResearch).toEqual([]);
  } finally {
    if (clientId)
      expect((await page.request.delete(`/api/studio/client-profiles/${clientId}`)).status()).toBe(
        204,
      );
    if (workspaceId)
      expect((await page.request.delete(`/api/studio/workspaces/${workspaceId}`)).status()).toBe(
        204,
      );
  }
});
