import type { StudioItem, StudioStop } from './studio';

/** Public, immutable client output. Never extend this with the private workspace. */
export interface StudioClientProposal {
  version: 1;
  title: string;
  clientName: string;
  publishedAt: string;
  validUntil: string;
  revision: number;
  agency: {
    name: string;
    slug: string;
    logoDataUrl: string;
    accentColor: string;
    email: string;
    phone: string;
    website: string;
    disclaimer: string;
  };
  trip: { startDate: string; endDate: string; adults: number | null; children: number | null };
  stops: Pick<
    StudioStop,
    | 'id'
    | 'name'
    | 'country'
    | 'nights'
    | 'arrivalDate'
    | 'departureDate'
    | 'onwardTransport'
    | 'neighbourhood'
  >[];
  items: {
    id: string;
    kind: StudioItem['kind'];
    title: string;
    description: string;
    stopId: string;
    startDate: string;
    endDate: string;
    status: StudioItem['status'];
    price: number | null;
    currency: string;
    priceStatus: StudioItem['priceStatus'];
    quotedAt: string;
  }[];
  recommendations: {
    id: string;
    stopId: string;
    name: string;
    category: 'activity' | 'food';
    description: string;
    sources: { label: string; url: string; checkedAt: string }[];
  }[];
  pricing: {
    mode: 'itemised' | 'package';
    packagePrice: number | null;
    currency: string;
    notes: string;
    totals: { currency: string; amount: number; containsEstimates: boolean }[];
    unpricedCount: number;
    sandboxCount: number;
  };
  notice: string;
}

export interface StudioProposalLink {
  token: string;
  slug: string;
  url: string;
  pdfUrl: string;
  publishedAt: string;
  validUntil: string;
}

export function studioProposalIsStale(proposal: StudioClientProposal, now = Date.now()) {
  return now >= Date.parse(proposal.validUntil);
}

export function studioProposalMoney(amount: number, currency: string) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    maximumFractionDigits: 2,
  }).format(amount);
}
