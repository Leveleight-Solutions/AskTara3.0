import { test, expect } from '@playwright/test';

test('Swagger can execute a Studio request and retain the application session', async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  let workspaceId: string | undefined;
  try {
    await page.goto('/api/docs');
    await expect(page.getByRole('heading', { name: 'Asktara API', exact: false })).toBeVisible();
    await page.getByRole('link', { name: 'Studio', exact: true }).click();
    await page
      .getByRole('button', {
        name: 'POST /api/studio/workspaces Create a proposal workspace, optionally for a saved client',
        exact: true,
      })
      .click();
    await page.getByRole('button', { name: 'Try it out', exact: true }).click();
    // This session-only check creates an unlinked draft; saved-client creation is tested separately.
    await page
      .getByRole('textbox')
      .filter({ hasNot: page.locator('[type="search"]') })
      .last()
      .fill('{}');
    const createdResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/studio/workspaces' &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Execute', exact: true }).click();
    const response = await createdResponse;
    expect(response.status()).toBe(201);
    const created = await response.json();
    workspaceId = created.workspace.id;
    expect(workspaceId).toBeTruthy();
    await expect(page.getByText('Server response', { exact: true })).toBeVisible();

    // Playwright's page request context shares the cookie set for Swagger. This
    // proves the POST remained in the same session and was persisted by the API.
    const saved = await page.request.get(`/api/studio/workspaces/${workspaceId}`);
    expect(saved.status()).toBe(200);
    expect((await saved.json()).workspace.id).toBe(workspaceId);
    expect(browserErrors).toEqual([]);
  } finally {
    if (workspaceId) {
      const removed = await page.request.delete(`/api/studio/workspaces/${workspaceId}`);
      expect(removed.status()).toBe(204);
    }
  }
});
