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
