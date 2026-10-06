import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newStudioWorkspace } from '../server/studio-store.ts';
import type { StudioItem } from '../shared/studio.ts';
import { studioCanvasBudget } from '../src/components/studioCanvasBudget.ts';

const item = (overrides: Partial<StudioItem>): StudioItem => ({
  id: crypto.randomUUID(),
  kind: 'hotel',
  title: 'Fictional quote',
  description: '',
  stopId: '',
  startDate: '',
  endDate: '',
  price: 300,
  currency: 'AUD',
  priceStatus: 'supplier_quote',
  status: 'suggested',
  source: 'manual',
  sourceUrl: '',
  supplier: '',
  privateReference: '',
  quotedAt: '',
  cost: null,
  included: true,
  needsReview: true,
  ...overrides,
});
test('desktop budget excludes sandbox and unpriced services and never converts other currencies', () => {
  const workspace = newStudioWorkspace();
  workspace.brief.currency = 'AUD';
  workspace.brief.budget = 1000;
  workspace.items = [
    item({}),
    item({ currency: 'USD', price: 200 }),
    item({ price: 9500, priceStatus: 'sandbox' }),
    item({ price: null, priceStatus: 'unpriced' }),
    item({ price: 1000, included: false }),
  ];
  assert.deepEqual(studioCanvasBudget(workspace), {
    currency: 'AUD',
    total: 300,
    budget: 1000,
    remaining: 700,
    percent: 30,
    sandboxCount: 1,
    unpricedCount: 1,
    otherCurrencies: [['USD', 200]],
  });
});
test('the budget keeps overspend visible and an undecided budget has no made-up remaining amount', () => {
  const workspace = newStudioWorkspace();
  workspace.brief.currency = 'AUD';
  workspace.brief.budget = 200;
  workspace.items = [item({})];
  assert.equal(studioCanvasBudget(workspace).remaining, -100);
  assert.equal(studioCanvasBudget(workspace).percent, 100);
  workspace.brief.budget = null;
  assert.equal(studioCanvasBudget(workspace).remaining, null);
  assert.equal(studioCanvasBudget(workspace).percent, 0);
});
