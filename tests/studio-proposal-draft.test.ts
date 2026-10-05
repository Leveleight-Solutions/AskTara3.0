import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newStudioWorkspace } from '../server/studio-store.ts';
import { defaultStudioAgency } from '../shared/studio.ts';
import {
  studioProposalPreviewKey,
  studioProposalPricingKey,
} from '../src/components/studioProposalDraft.ts';
import { syntheticTripBriefing } from './studio-trip-briefing-fixture.ts';

test('background briefing revisions preserve the saved pricing identity and client preview content', () => {
  const workspace = newStudioWorkspace();
  Object.assign(workspace.brief, {
    preferredDestination: 'London',
    destinationCountry: 'GB',
    passportNationality: 'PK',
    tripPurpose: 'tourism',
    startDate: '2027-04-01',
    endDate: '2027-04-05',
  });
  const agency = defaultStudioAgency();
  const pricing = studioProposalPricingKey(workspace.pricing);
  const preview = studioProposalPreviewKey(workspace, agency);
  const incoming = structuredClone(workspace);
  incoming.revision++;
  incoming.updatedAt = new Date().toISOString();
  incoming.tripBriefing = syntheticTripBriefing(incoming);
  incoming.entryRequirements = incoming.tripBriefing.stops.flatMap((stop) =>
    stop.entryRequirements ? [stop.entryRequirements] : [],
  );
  assert.equal(studioProposalPricingKey(incoming.pricing), pricing);
  assert.equal(studioProposalPreviewKey(incoming, structuredClone(agency)), preview);
});

test('equal pricing values compare the same across replacement objects and property order', () => {
  const pricing = newStudioWorkspace().pricing;
  const reordered = {
    marginPercent: pricing.marginPercent,
    currency: pricing.currency,
    mode: pricing.mode,
    notes: pricing.notes,
    packagePrice: pricing.packagePrice,
  };
  assert.equal(studioProposalPricingKey(reordered), studioProposalPricingKey(pricing));
  assert.notEqual(
    studioProposalPricingKey({ ...pricing, packagePrice: 2400 }),
    studioProposalPricingKey(pricing),
  );
});

test('changes to actual proposal content or gates invalidate the preview context', () => {
  const workspace = newStudioWorkspace();
  const agency = defaultStudioAgency();
  const key = studioProposalPreviewKey(workspace, agency);
  for (const change of [
    (next: typeof workspace) => {
      next.title = 'Another trip';
    },
    (next: typeof workspace) => {
      next.brief.startDate = '2027-04-01';
    },
    (next: typeof workspace) => {
      next.brief.adults = 3;
    },
    (next: typeof workspace) => {
      next.pricing.notes = 'Breakfast included';
    },
    (next: typeof workspace) => {
      next.structureAccepted = true;
    },
    (next: typeof workspace) => {
      next.proposal = {
        token: 'published',
        publishedAt: new Date().toISOString(),
        revision: next.revision,
      };
    },
  ]) {
    const next = structuredClone(workspace);
    change(next);
    assert.notEqual(studioProposalPreviewKey(next, agency), key);
  }
  assert.notEqual(studioProposalPreviewKey(workspace, { ...agency, name: 'Another agency' }), key);
});

test('private passport/background and qualification metadata do not alter the public preview', () => {
  const workspace = newStudioWorkspace();
  const agency = defaultStudioAgency();
  const key = studioProposalPreviewKey(workspace, agency);
  workspace.brief.passportNationality = 'CA';
  workspace.brief.context = 'Private background';
  workspace.qualification.score = 50;
  workspace.messages.push({
    id: 'message',
    role: 'user',
    content: 'Private planning conversation',
    createdAt: new Date().toISOString(),
  });
  assert.equal(studioProposalPreviewKey(workspace, agency), key);
});
