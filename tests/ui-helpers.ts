import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Radix Themes `Select` renders a `button[role="combobox"]` plus a portalled listbox, not a
 * native `<select>`. Playwright's `selectOption()` and `toHaveValue()` only work on real
 * `<select>`/input elements, so both throw against these controls.
 *
 * Options are also addressed by their VISIBLE LABEL here, not by the underlying value — e.g.
 * the gender control takes 'Female', not 'F'. Check the component's `<Select.Item>` list when
 * adding a call site; several selects share a label but not their option wording (there are two
 * different "Your pace" selects in this app, with different options).
 */
export async function choose(page: Page, trigger: Locator, optionLabel: string | RegExp) {
  await trigger.click();
  await page.getByRole('option', { name: optionLabel }).click();
  await expect(trigger).toContainText(optionLabel);
}

/** Asserts a Radix Select's current selection, replacing `toHaveValue()` on a native select. */
export async function expectChosen(trigger: Locator, optionLabel: string | RegExp) {
  await expect(trigger).toContainText(optionLabel);
}

/**
 * Travel preferences, Agency settings, Manage account and Sign out no longer sit in the top bar:
 * they live behind a gear `IconButton` named "Settings" in the left sidebar, which opens a Radix
 * `DropdownMenu`. Its entries are `menuitem`s, not buttons, and reaching one is two clicks rather
 * than one, so every spec goes through here instead of re-deriving the shape.
 *
 * The first three open their section of the settings page (/settings/...), not a dialog.
 *
 * Note this is NOT the same control as the "Manage account" button in the sidebar foot, which is
 * still a plain button.
 */
export async function chooseSetting(page: Page, itemName: string) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: itemName, exact: true }).click();
}

/** Advanced editors live in a dialog; the main workspace remains the conversation and itinerary. */
export async function openStudioTool(
  page: Page,
  name:
    | 'Client & trip'
    | 'Route'
    | 'Accommodation'
    | 'Daily activities'
    | 'Optional ideas'
    | 'Proposal',
) {
  const tabs = page.getByRole('tablist', { name: 'Plan details', exact: true });
  if (!(await tabs.isVisible())) {
    if ((page.viewportSize()?.width ?? 1440) < 768)
      await page.getByRole('tab', { name: 'Trip workspace', exact: true }).click();
    await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
  }
  await tabs.getByRole('tab', { name, exact: true }).click();
  return page.getByRole('dialog').filter({ has: tabs });
}

export async function closeStudioTool(page: Page) {
  const tabs = page.getByRole('tablist', { name: 'Plan details', exact: true });
  if (await tabs.isVisible())
    await page
      .getByRole('dialog')
      .filter({ has: tabs })
      .getByRole('button', { name: 'Close dialog', exact: true })
      .click();
}

/** The focused customer stage owns saved profiles; mobile first reveals its workspace pane. */
export async function openStudioClientDesk(page: Page) {
  await openStudioTool(page, 'Client & trip');
  const desk = page.getByRole('region', { name: 'Client desk', exact: true });
  const heading = desk.getByRole('button', { name: /^Customer desk/ });
  if ((await heading.getAttribute('aria-expanded')) === 'false') await heading.click();
  await desk.getByRole('tab', { name: 'Client', exact: true }).click();
  return desk;
}

export async function openStudioCruiseImport(page: Page) {
  await openStudioTool(page, 'Route');
  const importer = page.getByRole('region', { name: 'Cruise itinerary import', exact: true });
  if (!(await importer.isVisible()))
    await page.getByText('Add a cruise or edit a sailing', { exact: true }).click();
  return importer;
}

export async function openStudioDestinationResearch(page: Page) {
  await openStudioTool(page, 'Route');
  const summary = page.getByText('Destination inspiration & detailed entry research', {
    exact: true,
  });
  const disclosure = page.locator('details').filter({ has: summary });
  if ((await disclosure.getAttribute('open')) === null) await summary.click();
  return disclosure;
}

/** The profile disclosure stays open when its parent stage is temporarily hidden. */
export async function openStudioClientProfiles(page: Page, summaryLabel: string) {
  const summary = page.getByText(summaryLabel, { exact: true });
  if ((await summary.locator('..').getAttribute('open')) === null) await summary.click();
}

/** Creates a disposable fictional client through the chooser before a Home proposal starts.
 * Real-API journeys delete the returned profile and their test workspace in cleanup.
 */
export async function confirmStudioStartClient(page: Page, name = 'Fictional Workflow Traveller') {
  const picker = page.getByRole('dialog', { name: 'Who is this proposal for?', exact: true });
  await picker.getByRole('button', { name: 'New client', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'New client', exact: true });
  await editor.getByRole('textbox', { name: 'Client name', exact: true }).fill(name);
  const response = page.waitForResponse(
    (value) =>
      new URL(value.url()).pathname === '/api/studio/client-profiles' &&
      value.request().method() === 'POST',
  );
  await editor.getByRole('button', { name: 'Save client', exact: true }).click();
  const saved = await response;
  expect(saved.status()).toBe(201);
  const clientId = (await saved.json()).client.id as string;
  await picker.getByRole('button', { name: 'Start proposal', exact: true }).click();
  return clientId;
}
