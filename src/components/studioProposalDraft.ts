import type { StudioAgency, StudioPricing, StudioWorkspace } from '../../shared/studio';

/** Compare stored values rather than the new object reference returned by background research. */
export function studioProposalPricingKey(pricing: StudioPricing) {
  return JSON.stringify([
    pricing.mode,
    pricing.packagePrice,
    pricing.currency,
    pricing.notes,
    pricing.marginPercent,
  ]);
}

/** Actual proposal content and review gates; briefing metadata never changes a client preview. */
export function studioProposalPreviewKey(workspace: StudioWorkspace, agency: StudioAgency) {
  return JSON.stringify({
    workspaceId: workspace.id,
    title: workspace.title,
    clientName: workspace.brief.clientName,
    trip: [
      workspace.brief.startDate,
      workspace.brief.endDate,
      workspace.brief.adults,
      workspace.brief.children,
    ],
    stops: workspace.stops,
    items: workspace.items,
    recommendations: workspace.recommendations,
    itinerary: workspace.itinerary || null,
    pricing: studioProposalPricingKey(workspace.pricing),
    structureAccepted: workspace.structureAccepted,
    publication: workspace.proposal,
    branding: [
      agency.name,
      agency.logoDataUrl,
      agency.accentColor,
      agency.email,
      agency.phone,
      agency.website,
      agency.disclaimer,
      agency.quoteValidityHours,
    ],
  });
}
