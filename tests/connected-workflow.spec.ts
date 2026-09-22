import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { choose, chooseSetting } from './ui-helpers';

// These journeys use the real local API and persistence, without API route mocks.
test('home brief reaches Studio, route and services persist, and the proposal exports', async ({
  page,
}, testInfo) => {
  let workspaceId: string | undefined;
  const integrations = await page.request.get('/api/integrations');
  expect(integrations.status()).toBe(200);
  test.skip((await integrations.json()).ai, 'This regression exercises the no-key local planner.');
  try {
    await page.goto('/');
    await page
      .getByRole('textbox', { name: 'Tell Tara about your trip' })
      .fill(
        'Plan a proposal for a fictional client: 2 adults, no children, arrive Paris on 2027-06-01 for 3 nights. Budget AUD 3000. Prefer 4-star hotels. Start with the route only.',
      );
    await page.getByRole('button', { name: 'Start planning your trip' }).click();
    await expect(page).toHaveURL(/\/studio\/[a-f0-9-]+(?:\?.*)?$/);
    workspaceId = new URL(page.url()).pathname.split('/').at(-1);
    await expect(page.getByLabel('Nights in Paris', { exact: true })).toHaveValue('3');
    await expect(page.getByLabel('Arrival in Paris', { exact: true })).toHaveValue('2027-06-01');
    await page.getByRole('button', { name: 'Increase nights in Paris' }).click();
    await page.getByRole('button', { name: 'Save route changes' }).click();
    await page
      .getByRole('button', { name: /^(Build route structure|Skip questions and build structure)$/ })
      .click();
    await page.getByRole('button', { name: 'Accept structure', exact: true }).click();
    await page.getByRole('tab', { name: 'Services', exact: true }).click();
    await page.getByRole('button', { name: 'Add a service', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a service to the proposal' });
    await choose(page, dialog.getByRole('combobox', { name: 'Service type' }), 'Insurance');
    await dialog.getByLabel('Service name').fill('Fictional integration test estimate');
    await dialog.getByLabel('Client price', { exact: true }).fill('150');
    await dialog.getByRole('button', { name: 'Save service' }).click();
    await expect(dialog).not.toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('region', { name: 'Proposal services', exact: true }),
    ).toContainText('Fictional integration test estimate');
    const saved = await page.request.get(`/api/studio/workspaces/${workspaceId}`);
    expect(saved.status()).toBe(200);
    const workspace = (await saved.json()).workspace;
    expect(workspace.structureAccepted).toBe(true);
    expect(workspace.stops[0]).toMatchObject({
      name: 'Paris',
      nights: 4,
      arrivalDate: '2027-06-01',
    });
    expect(workspace.items[0]).toMatchObject({
      title: 'Fictional integration test estimate',
      price: 150,
    });
    await page.getByRole('tab', { name: 'Proposal', exact: true }).click();
    await page.getByRole('button', { name: 'Preview client proposal', exact: true }).click();
    await expect(page.getByTestId('client-proposal')).toContainText(
      'Fictional integration test estimate',
    );
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download draft PDF', exact: true }).click();
    const output = testInfo.outputPath('connected-proposal.pdf');
    await (await download).saveAs(output);
    expect((await readFile(output)).subarray(0, 5).toString()).toBe('%PDF-');
  } finally {
    if (workspaceId)
      expect((await page.request.delete(`/api/studio/workspaces/${workspaceId}`)).status()).toBe(
        204,
      );
  }
});

test('guest favorites transfer on signup and return after signing in again', async ({ page }) => {
  const credentials = {
    email: `connection-${randomUUID()}@example.test`,
    password: 'Only-a-local-integration-test-42!',
  };
  let registered = false;
  try {
    await page.goto('/explore?q=Kyoto');
    await page.getByRole('button', { name: 'Save Kyoto', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unsave Kyoto', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Create an account', exact: true }).click();
    const auth = page.getByRole('dialog');
    await auth.getByLabel('Your name').fill('Fictional Integration Tester');
    await auth.getByLabel('Email address').fill(credentials.email);
    await auth.getByLabel('Password', { exact: true }).fill(credentials.password);
    const registration = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/auth/register' &&
        response.request().method() === 'POST',
    );
    await auth.getByRole('button', { name: 'Create your account' }).click();
    const response = await registration;
    registered = response.status() === 201;
    expect(response.status()).toBe(201);
    await expect(auth).not.toBeVisible();
    await page.goto('/saved');
    await expect(page.getByRole('button', { name: 'Unsave Kyoto', exact: true })).toBeVisible();
    await chooseSetting(page, 'Sign out');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await auth.getByLabel('Email address').fill(credentials.email);
    await auth.getByLabel('Password', { exact: true }).fill(credentials.password);
    await auth.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(auth).not.toBeVisible();
    await page.goto('/saved');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Unsave Kyoto', exact: true })).toBeVisible();
  } finally {
    if (registered) {
      expect((await page.request.post('/api/auth/login', { data: credentials })).status()).toBe(
        200,
      );
      expect(
        (
          await page.request.delete('/api/account', {
            data: { currentPassword: credentials.password, confirmation: 'DELETE' },
          })
        ).status(),
      ).toBe(200);
    }
  }
});

test('attached client notes are saved and reviewed through the real local backend', async ({
  page,
}) => {
  let workspaceId: string | undefined;
  const integrations = await page.request.get('/api/integrations');
  expect(integrations.status()).toBe(200);
  test.skip((await integrations.json()).ai, 'This regression exercises the no-key local planner.');
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Bring in a source', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Paste an email or PNR' }).click();
    await page
      .getByPlaceholder('Paste your source here. Tara will read it before anything is added.')
      .fill(
        'Fictional client notes: 3 nights in Paris for 2 adults, no children, starting 2027-07-01. Budget AUD 2500.',
      );
    await page.getByRole('button', { name: 'Add source', exact: true }).click();
    await page.getByRole('button', { name: 'Start planning your trip' }).click();
    await expect(page).toHaveURL(/\/studio\/[a-f0-9-]+(?:\?.*)?$/);
    workspaceId = new URL(page.url()).pathname.split('/').at(-1);
    await expect(page.getByLabel('Nights in Paris', { exact: true })).toHaveValue('3');
    await expect(page.getByLabel('Arrival in Paris', { exact: true })).toHaveValue('2027-07-01');
    const saved = await page.request.get(`/api/studio/workspaces/${workspaceId}`);
    const workspace = (await saved.json()).workspace;
    expect(workspace.imports).toHaveLength(1);
    expect(workspace.brief).toMatchObject({
      adults: 2,
      children: 0,
      budget: 2500,
      currency: 'AUD',
    });
  } finally {
    if (workspaceId)
      expect((await page.request.delete(`/api/studio/workspaces/${workspaceId}`)).status()).toBe(
        204,
      );
  }
});
