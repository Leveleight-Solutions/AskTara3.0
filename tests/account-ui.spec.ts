import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { choose, chooseSetting, expectChosen } from './ui-helpers';

test('preferences move from a guest into an account, and account name, password and export work', async ({
  page,
}) => {
  const email = `profile-${Date.now()}@example.com`;
  await page.goto('/');
  await chooseSetting(page, 'Travel preferences');
  let preferences = page.getByRole('dialog', { name: 'Your kind of travel' });
  await choose(
    page,
    preferences.getByRole('combobox', { name: 'Your pace' }),
    'Slow and unhurried',
  );
  await preferences.getByLabel('Food', { exact: true }).check();
  await preferences.getByText('Dietary preferences', { exact: true }).click();
  await preferences.getByLabel('Nut allergy', { exact: true }).check();
  await preferences.getByText('Accessibility preferences', { exact: true }).click();
  await preferences.getByLabel('Step-free access', { exact: true }).check();
  await preferences.getByText('More about your travel style', { exact: true }).click();
  await preferences
    .getByLabel('Anything to seek out or avoid?')
    .fill('Quiet stays and local craft markets.');
  await preferences.getByLabel('Home airport (optional)').fill('KHI');
  await preferences.getByLabel('Nationality (optional)').fill('PK');
  await preferences.getByRole('button', { name: 'Save preferences' }).click();
  await expect(preferences).not.toBeVisible();
  await page.reload();
  await chooseSetting(page, 'Travel preferences');
  preferences = page.getByRole('dialog', { name: 'Your kind of travel' });
  await expectChosen(
    preferences.getByRole('combobox', { name: 'Your pace' }),
    'Slow and unhurried',
  );
  await expect(preferences.getByLabel('Food', { exact: true })).toBeChecked();
  await preferences.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  const auth = page.getByRole('dialog');
  await auth.getByLabel('Your name').fill('Travel Tester');
  await auth.getByLabel('Email address').fill(email);
  await auth.getByLabel('Password', { exact: true }).fill('initial-password-123');
  await auth.getByRole('button', { name: 'Create your account' }).click();
  await expect(auth).not.toBeVisible();
  await page.getByRole('button', { name: 'Manage account', exact: true }).click();
  let account = page.getByRole('dialog', { name: 'Your account' });
  await account.getByRole('button', { name: 'Travel preferences', exact: true }).click();
  preferences = page.getByRole('dialog', { name: 'Your kind of travel' });
  await expect(preferences.getByLabel('Home airport (optional)')).toHaveValue('KHI');
  await expect(preferences).toContainText('across devices');
  await preferences.screenshot({ path: 'docs/screenshots/account-preferences.png' });
  await preferences.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Manage account', exact: true }).click();
  account = page.getByRole('dialog', { name: 'Your account' });
  await account.getByLabel('Your name').fill('Avery Traveler');
  await account.getByRole('button', { name: 'Save name' }).click();
  // Radix Dialog marks background content aria-hidden while a modal is open, so the header is
  // (correctly) out of the accessibility tree here. Assert via the test id, which is not
  // a11y-tree based, rather than weakening what is being checked.
  await expect(page.getByTestId('account-button')).toContainText('Avery');
  const downloadPromise = page.waitForEvent('download');
  await account.getByRole('button', { name: 'Download my data' }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.account.name).toBe('Avery Traveler');
  expect(exported.profile.originAirport).toBe('KHI');
  expect(exported.profile.dietaryPreferences).toEqual(['Nut allergy']);
  expect(exported.profile.accessibilityPreferences).toEqual(['Step-free access']);
  expect(exported.profile.planningNotes).toBe('Quiet stays and local craft markets.');
  expect(JSON.stringify(exported)).not.toContain('password_hash');
  await account.getByLabel('Current password', { exact: true }).fill('initial-password-123');
  await account.getByLabel('New password', { exact: true }).fill('updated-password-123');
  await account.getByRole('button', { name: 'Update password', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Password updated');
  await account.getByRole('button', { name: 'Close dialog' }).click();
  await chooseSetting(page, 'Sign out');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('updated-password-123');
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Manage account', exact: true })).toBeVisible();
});

test('mobile account management revokes other sessions and confirms deletion', async ({
  page,
  browser,
}) => {
  const credentials = {
    email: `security-${Date.now()}@example.com`,
    password: 'account-security-123',
  };
  await page.request.post('/api/auth/register', {
    data: { ...credentials, name: 'Mobile Traveler' },
  });
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    await other.request.post('/api/auth/login', { data: credentials });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    // Two controls are named 'Manage account' at this width: the header button and the one
    // inside the mobile nav. Scope to the mobile nav so this is not a strict-mode violation.
    await page
      .getByRole('navigation', { name: 'Mobile navigation' })
      .getByRole('button', { name: 'Manage account', exact: true })
      .click();
    const account = page.getByRole('dialog', { name: 'Your account' });
    await expect(account).toContainText('1 other active session.');
    await account.getByLabel('Password to sign out other sessions').fill(credentials.password);
    await account.getByRole('button', { name: 'Sign out other sessions', exact: true }).click();
    await expect(account).toContainText('0 other active sessions.');
    expect((await other.request.get('/api/account')).status()).toBe(401);
    await account.getByRole('button', { name: 'Delete my account', exact: true }).click();
    const confirmDelete = page.getByRole('alertdialog', { name: 'Delete your account?' });
    await expect(confirmDelete).toBeVisible();
    await confirmDelete.getByLabel('Password to delete account').fill(credentials.password);
    await confirmDelete.getByLabel('Type DELETE to confirm').fill('DELETE');
    await confirmDelete.screenshot({ path: 'docs/screenshots/account-mobile.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await confirmDelete
      .getByRole('button', { name: 'Permanently delete account', exact: true })
      .click();
    await expect(confirmDelete).not.toBeVisible();
    await expect(account).not.toBeVisible();
    expect(
      (await page.request.get('/api/session').then((response) => response.json())).user,
    ).toBeNull();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  } finally {
    await other.close();
  }
});
