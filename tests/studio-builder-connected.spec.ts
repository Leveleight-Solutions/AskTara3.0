import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { StudioWorkspace } from '../shared/studio';

// Real local API and persistence. Manual planning performs no upstream or booking calls.
test('reviewed cruise flows through route, services, manual activities and a real proposal PDF', async ({
  page,
}, testInfo) => {
  let id = '';
  try {
    const created = await page.request.post('/api/studio/workspaces', { data: {} });
    expect(created.status()).toBe(201);
    id = ((await created.json()).workspace as StudioWorkspace).id;
    await page.goto(`/studio/${id}`);
    const importer = page.getByRole('region', { name: 'Cruise itinerary import' });
    await importer.getByRole('button', { name: 'Enter cruise manually', exact: true }).click();
    await importer.getByLabel('Cruise name', { exact: true }).fill('Fictional Pacific cruise');
    await importer.getByLabel('Full cruise fare', { exact: true }).fill('4500');
    const ports = ['Hong Kong', 'At sea', 'Taipei', 'Shanghai'];
    for (let i = 0; i < ports.length; i++) {
      if (i) await importer.getByRole('button', { name: 'Add cruise day', exact: true }).click();
      await importer.getByLabel(`Port or sea day · day ${i + 1}`, { exact: true }).fill(ports[i]);
      await importer
        .getByLabel(`Cruise date · day ${i + 1}`, { exact: true })
        .fill(`2027-10-0${i + 1}`);
    }
    await importer.getByRole('combobox', { name: 'Leave the cruise', exact: true }).click();
    await page.getByRole('option', { name: 'Day 3: Taipei', exact: true }).click();
    await importer
      .getByRole('combobox', { name: 'Onward travel after cruise', exact: true })
      .click();
    await page.getByRole('option', { name: 'Flight', exact: true }).click();
    await importer.getByRole('combobox', { name: 'Return travel', exact: true }).click();
    await page.getByRole('option', { name: 'Another cruise', exact: true }).click();
    await importer.getByRole('button', { name: 'Apply reviewed cruise', exact: true }).click();
    await expect(page.getByLabel('Nights in Taipei', { exact: true })).toHaveValue('0');
    await page.getByRole('button', { name: 'Accept structure', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Accommodation', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page.getByRole('region', { name: 'Proposal services', exact: true }),
    ).toContainText('Onward flight from Taipei');
    await page.getByRole('tab', { name: 'Daily activities', exact: true }).click();
    await page.getByRole('button', { name: 'Edit daily plan', exact: true }).click();
    const editor = page.getByRole('form', { name: 'Edit daily itinerary' });
    await editor.getByRole('button', { name: 'Add activity to day 3', exact: true }).click();
    await editor
      .getByLabel('Day 3 activity 1 title', { exact: true })
      .fill('Agent’s Taipei night market recommendation');
    await editor
      .getByRole('textbox', { name: 'Day 3 activity 1 details', exact: true })
      .fill('Walk through the market after disembarkation.');
    await editor.getByRole('button', { name: 'Save daily plan', exact: true }).click();
    await page.reload();
    await expect(
      page.getByText('Agent’s Taipei night market recommendation', { exact: true }),
    ).toBeVisible();
    const saved = await page.request.get(`/api/studio/workspaces/${id}`);
    const workspace = (await saved.json()).workspace as StudioWorkspace;
    expect(workspace.cruises?.[0].days).toHaveLength(4);
    expect(workspace.itinerary?.days).toHaveLength(3);
    expect(
      workspace.items.find((item) => item.kind === 'cruise' && item.price !== null)?.price,
    ).toBe(4500);
    await page.getByRole('tab', { name: 'Proposal', exact: true }).click();
    await page.getByRole('button', { name: 'Preview client proposal', exact: true }).click();
    const proposal = page.getByTestId('client-proposal');
    await expect(proposal).toContainText('Agent’s Taipei night market recommendation');
    await expect(proposal).toContainText('Full fare retained');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download draft PDF', exact: true }).click();
    const pdf = testInfo.outputPath('cruise-itinerary.pdf');
    await (await downloaded).saveAs(pdf);
    expect((await readFile(pdf)).subarray(0, 5).toString()).toBe('%PDF-');
    await page.screenshot({
      path: testInfo.outputPath('itinerary-builder-proposal.png'),
      fullPage: true,
    });
  } finally {
    if (id) expect((await page.request.delete(`/api/studio/workspaces/${id}`)).status()).toBe(204);
  }
});

test('a newly saved cruise day retains its identity when edited without reopening the editor', async ({
  page,
}) => {
  let id = '';
  try {
    const created = await page.request.post('/api/studio/workspaces', { data: {} });
    expect(created.status()).toBe(201);
    const workspace = (await created.json()).workspace as StudioWorkspace;
    id = workspace.id;
    const cruise = {
      id: crypto.randomUUID(),
      name: 'Fictional source identity check',
      ship: 'Example ship',
      sourceUrl: '',
      sourceName: 'Synthetic authored schedule',
      extractedAt: new Date().toISOString(),
      currency: 'USD',
      fullFare: 4500,
      disembarkAfterDay: null,
      onwardTransport: 'undecided',
      returnTransport: 'undecided',
      warnings: [],
      days: [
        { day: 1, date: '2027-10-01', port: 'Hong Kong', arrival: '', departure: '', details: '' },
      ],
    };
    const initial = await page.request.post(`/api/studio/workspaces/${id}/cruises/apply`, {
      data: { revision: workspace.revision, cruise },
    });
    expect(initial.status()).toBe(200);
    await page.goto(`/studio/${id}`);
    await page.getByLabel('Saved cruise to edit', { exact: true }).selectOption(cruise.id);
    const importer = page.getByRole('region', { name: 'Cruise itinerary import' });
    await importer.getByRole('button', { name: 'Add cruise day', exact: true }).click();
    await importer.getByLabel('Port or sea day · day 2', { exact: true }).fill('Taipei');
    await importer.getByLabel('Cruise date · day 2', { exact: true }).fill('2027-10-03');
    const firstSave = page.waitForResponse(
      (response) =>
        response.url().endsWith('/cruises/apply') && response.request().method() === 'POST',
    );
    await importer.getByRole('button', { name: 'Apply reviewed cruise', exact: true }).click();
    const saved = ((await (await firstSave).json()).workspace as StudioWorkspace).cruises![0];
    expect(saved.days[1].id).toBeTruthy();
    await expect(importer.getByRole('status')).toContainText('Reviewed cruise saved');
    await importer.getByLabel('Port or sea day · day 2', { exact: true }).fill('Keelung');
    await importer.getByLabel('Cruise date · day 2', { exact: true }).fill('2027-10-04');
    const secondSave = page.waitForResponse(
      (response) =>
        response.url().endsWith('/cruises/apply') && response.request().method() === 'POST',
    );
    await importer.getByRole('button', { name: 'Apply reviewed cruise', exact: true }).click();
    const updated = (await (await secondSave).json()).workspace as StudioWorkspace;
    expect(updated.cruises![0].days[1]).toMatchObject({
      id: saved.days[1].id,
      port: 'Keelung',
      date: '2027-10-04',
    });
    expect(updated.itinerary!.days[1].cruiseDayId).toBe(saved.days[1].id);
    expect(updated.items.find((item) => item.kind === 'cruise' && item.price !== null)?.price).toBe(
      4500,
    );
  } finally {
    if (id) expect((await page.request.delete(`/api/studio/workspaces/${id}`)).status()).toBe(204);
  }
});
