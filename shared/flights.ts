import type { FlightOffer } from './types';

export function flightDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return 'Date unavailable';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
export function flightTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? value.slice(11, 16) : '—';
}
export function flightDuration(value?: string) {
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?$/.exec(value || '');
  if (!match) return 'Duration unavailable';
  const hours = Number(match[1] || 0) * 24 + Number(match[2] || 0);
  return (
    [hours ? `${hours}h` : '', match[3] ? `${Number(match[3])}m` : ''].filter(Boolean).join(' ') ||
    'Under 1m'
  );
}
export function flightPrice(offer: Pick<FlightOffer, 'price' | 'currency'>) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: offer.currency }).format(
      offer.price,
    );
  } catch {
    return `${offer.currency} ${offer.price.toFixed(2)}`;
  }
}
export function flightExpiry(expiresAt: string | undefined, now = Date.now()) {
  if (
    !expiresAt ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(expiresAt) ||
    !Number.isFinite(Date.parse(expiresAt))
  )
    return {
      state: 'unknown' as const,
      label: 'Quote expiry not supplied. Search again to check current fares.',
    };
  const expires = new Date(expiresAt);
  if (expires.getTime() <= now)
    return {
      state: 'expired' as const,
      label: 'This quote has expired. Search again for current fares.',
    };
  return {
    state: 'active' as const,
    label: `Quote expires ${expires.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}. Availability may change sooner.`,
  };
}
