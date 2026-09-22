import { test, expect, type Page } from '@playwright/test';
import type { StudioWorkspace } from '../shared/studio';

const reviewResponse = (page: Page) =>
  page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith('/review') &&
      response.request().method() === 'POST',
  );

// Exercise the actual Vite proxy, browser session and local backend, without route mocks.
test('a greeting starts a contextual conversation and short answers update the saved route', async ({
  page,
}) => {
  const integrations = await page.request.get('/api/integrations');
  expect(integrations.status()).toBe(200);
  test.skip((await integrations.json()).ai, 'This regression exercises basic planning without AI.');
  let workspaceId: string | undefined;
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
    await expect(page.getByRole('region', { name: 'Route structure' })).toContainText(
      'Your route will appear here.',
    );

    const message = page.getByRole('textbox', { name: 'Reply or refine the route' });
    await message.fill('Paris');
    const destinationReview = reviewResponse(page);
    await page.getByRole('button', { name: 'Send to Tara' }).click();
    const destination = await destinationReview;
    expect(destination.status()).toBe(200);
    const second = (await destination.json()).workspace as StudioWorkspace;
    const secondReply = second.messages.at(-1)!.content;
    expect(secondReply).toContain('Paris');
    expect(secondReply).toContain('How many nights would you like in Paris?');
    expect(secondReply).not.toBe(firstReply);
    expect(second.stops).toHaveLength(1);
    expect(second.stops[0]).toMatchObject({ name: 'Paris', nights: null });
    await expect(conversation).toContainText(secondReply);
    await expect(page.getByLabel('Destination 1', { exact: true })).toHaveValue('Paris');

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
    await expect(page.getByLabel('Nights in Paris', { exact: true })).toHaveValue('3');

    await page.reload();
    await expect(conversation).toContainText(thirdReply);
    await expect(page.getByLabel('Nights in Paris', { exact: true })).toHaveValue('3');
    const stored = await page.request.get(`/api/studio/workspaces/${workspaceId}`);
    expect(stored.status()).toBe(200);
    const saved = (await stored.json()).workspace as StudioWorkspace;
    expect(saved.messages.map(({ content }) => content)).toEqual([
      'hi',
      firstReply,
      'Paris',
      secondReply,
      '3 nights',
      thirdReply,
    ]);
    expect(saved.stops).toHaveLength(1);
    expect(saved.stops[0]).toMatchObject({ name: 'Paris', nights: 3 });
  } finally {
    if (workspaceId)
      expect((await page.request.delete(`/api/studio/workspaces/${workspaceId}`)).status()).toBe(
        204,
      );
  }
});
