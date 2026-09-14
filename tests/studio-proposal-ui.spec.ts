import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { StudioWorkspace } from '../shared/studio';

test('agent reviews, publishes, updates and revokes a branded client proposal with a real PDF', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120000);
  let workspaceId = '';
  const viewer = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  try {
    const created = await page.request.post('/api/studio/workspaces', { data: {} });
    expect(created.status()).toBe(201);
    let workspace = (await created.json()).workspace as StudioWorkspace;
    workspaceId = workspace.id;
    const updated = await page.request.patch(`/api/studio/workspaces/${workspace.id}`, {
      data: {
        revision: workspace.revision,
        title: 'A considered London escape',
        brief: {
          clientName: 'Fictional proposal client',
          context: 'PRIVATE_INTERNAL_CONTEXT',
          adults: 2,
          children: 0,
          startDate: '2027-11-18',
          endDate: '2027-11-22',
          requirements: ['PRIVATE_MEDICAL_REQUIREMENT'],
        },
        stops: [
          {
            id: 'london',
            name: 'London',
            country: 'United Kingdom',
            nights: 4,
            arrivalDate: '2027-11-18',
            departureDate: '2027-11-22',
            onwardTransport: 'undecided',
            neighbourhood: 'Bloomsbury',
            notes: 'PRIVATE_AGENT_NOTE',
          },
        ],
        items: [
          {
            id: randomUUID(),
            kind: 'hotel',
            title: 'A quiet Bloomsbury hotel',
            description: 'Four nights in a double room. Breakfast included.',
            stopId: 'london',
            startDate: '2027-11-18',
            endDate: '2027-11-22',
            status: 'suggested',
            source: 'manual',
            sourceUrl: '',
            supplier: 'PRIVATE_SUPPLIER',
            privateReference: 'PRIVATE_PNR',
            price: 1200,
            currency: 'AUD',
            priceStatus: 'agent_estimate',
            quotedAt: new Date().toISOString(),
            included: true,
            needsReview: false,
            cost: 876.54,
          },
          {
            id: randomUUID(),
            kind: 'transfer',
            title: 'Arrival transfer',
            description: 'Private transfer on arrival; exact pickup to be confirmed.',
            stopId: 'london',
            startDate: '2027-11-18',
            endDate: '',
            status: 'suggested',
            source: 'manual',
            sourceUrl: '',
            supplier: '',
            privateReference: '',
            price: 200,
            currency: 'USD',
            priceStatus: 'supplier_quote',
            quotedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
            included: true,
            needsReview: false,
            cost: null,
          },
        ],
      },
    });
    expect(updated.status(), await updated.text()).toBe(200);
    workspace = (await updated.json()).workspace;
    const accepted = await page.request.post(
      `/api/studio/workspaces/${workspace.id}/accept-structure`,
      { data: { revision: workspace.revision } },
    );
    expect(accepted.status()).toBe(200);
    workspace = (await accepted.json()).workspace;
    const agency = await page.request.patch('/api/studio/agency', {
      data: {
        agency: {
          name: 'Leveleight Demo Travel',
          accentColor: '#285641',
          email: 'travel@example.com',
          quoteValidityHours: 48,
        },
      },
    });
    expect(agency.status()).toBe(200);
    await page.goto(`/studio/${workspace.id}`);
    await page.getByRole('tab', { name: 'Services', exact: true }).click();
    for (const title of ['A quiet Bloomsbury hotel', 'Arrival transfer']) {
      await page
        .locator('.studio-service-item')
        .filter({ has: page.getByRole('heading', { name: title, exact: true }) })
        .getByRole('button', { name: 'Edit service', exact: true })
        .click();
      await page.getByLabel('I have reviewed these service details').check();
      await page.getByRole('button', { name: 'Save service', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await page.getByRole('tab', { name: 'Proposal', exact: true }).click();
    await page.getByRole('button', { name: 'Preview client proposal', exact: true }).click();
    await expect(
      page.getByText('Private preview · Publish only when the client-facing details are ready.'),
    ).toBeVisible();
    await expect(page.locator('.studio-proposal-preview')).not.toContainText('PRIVATE_');
    await expect(page.locator('.studio-proposal-preview')).toContainText(
      'Currencies are shown separately',
    );
    const draftDownload = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download draft PDF' }).click();
    const draftPath = testInfo.outputPath('draft-proposal.pdf');
    await (await draftDownload).saveAs(draftPath);
    expect((await readFile(draftPath)).subarray(0, 5).toString()).toBe('%PDF-');
    await page.getByRole('button', { name: 'Publish client proposal', exact: true }).click();
    await expect(
      page.getByText('Client proposal published. Copy the link to share it.'),
    ).toBeVisible();
    let link = await page.locator('.studio-proposal-link > p > a').getAttribute('href');
    expect(link).toContain('/proposal/leveleight-demo-travel/');
    await viewer.goto(link!);
    await expect(
      viewer.getByRole('heading', { name: 'A considered London escape', exact: true }),
    ).toBeVisible();
    await expect(viewer.locator('.proposal-brand')).toContainText('Leveleight Demo Travel');
    await expect(viewer.getByRole('status')).toContainText('Prices need reconfirmation');
    await expect(viewer.locator('.client-proposal')).not.toContainText('PRIVATE_');
    await expect(viewer.locator('.client-proposal')).not.toContainText('876.54');
    await expect(viewer.locator('.site-header')).toHaveCount(0);
    await expect(viewer.locator('.proposal-pricing')).toContainText('AUD');
    await expect(viewer.locator('.proposal-pricing')).toContainText('USD');
    await viewer.screenshot({
      path: testInfo.outputPath('client-proposal-desktop.png'),
      fullPage: true,
    });
    const download = viewer.waitForEvent('download');
    await viewer.getByRole('link', { name: 'Download PDF', exact: true }).click();
    const pdfPath = testInfo.outputPath('published-proposal.pdf');
    await (await download).saveAs(pdfPath);
    expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe('%PDF-');
    await page
      .getByRole('combobox', { name: 'Proposal format', exact: true })
      .selectOption('package');
    await page.getByLabel('Total package price', { exact: true }).fill('18500');
    await page.getByRole('button', { name: 'Save pricing', exact: true }).click();
    await expect(
      page.getByText('Pricing saved. Published client links remain unchanged until republished.'),
    ).toBeVisible();
    await viewer.reload();
    await expect(viewer.locator('.proposal-pricing')).not.toContainText('18,500');
    await page.getByRole('button', { name: 'Republish client proposal', exact: true }).click();
    await expect(
      page.getByText('Client proposal published. Copy the link to share it.'),
    ).toBeVisible();
    const oldLink = link;
    link = await page.locator('.studio-proposal-link > p > a').getAttribute('href');
    expect(link).not.toBe(oldLink);
    await viewer.goto(link!);
    await expect(viewer.locator('.proposal-pricing')).toContainText('18,500');
    await expect(viewer.locator('.proposal-service-grid')).not.toContainText('1,200');
    await viewer.setViewportSize({ width: 390, height: 844 });
    await viewer.screenshot({
      path: testInfo.outputPath('client-proposal-mobile.png'),
      fullPage: true,
    });
    expect(
      await viewer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole('button', { name: 'Revoke link', exact: true }).click();
    await expect(
      page.getByText('The client link is revoked. Downloaded PDFs cannot be recalled.'),
    ).toBeVisible();
    await viewer.reload();
    await expect(
      viewer.getByRole('heading', { name: 'This proposal is unavailable' }),
    ).toBeVisible();
  } finally {
    await viewer.close();
    if (workspaceId) await page.request.delete(`/api/studio/workspaces/${workspaceId}`);
  }
});
