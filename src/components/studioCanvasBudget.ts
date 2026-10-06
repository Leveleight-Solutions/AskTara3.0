import type { StudioWorkspace } from '../../shared/studio';

/** Supplier test rates and other currencies never become a live trip total. */
export function studioCanvasBudget(workspace: StudioWorkspace) {
  const currency = workspace.brief.currency;
  const selected = workspace.items.filter((item) => item.included);
  const amounts = new Map<string, number>();
  let sandboxCount = 0;
  let unpricedCount = 0;
  for (const item of selected) {
    if (item.priceStatus === 'sandbox') {
      sandboxCount++;
      continue;
    }
    if (item.price === null || item.priceStatus === 'unpriced') {
      unpricedCount++;
      continue;
    }
    amounts.set(item.currency, (amounts.get(item.currency) || 0) + item.price);
  }
  const total = amounts.get(currency) || 0;
  const budget = workspace.brief.budget;
  return {
    currency,
    total,
    budget,
    remaining: budget === null ? null : budget - total,
    percent: budget === null || budget <= 0 ? 0 : Math.min(100, (total / budget) * 100),
    sandboxCount,
    unpricedCount,
    otherCurrencies: [...amounts].filter(([code]) => code !== currency),
  };
}
