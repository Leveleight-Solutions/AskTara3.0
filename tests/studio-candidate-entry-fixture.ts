import type { Route } from '@playwright/test';
import type { StudioWorkspace } from '../shared/studio';
import {
  normalizeStudioCountry,
  studioCandidateEntryInputKey,
  type StudioCandidateEntryRequirements,
  type StudioVisaCategory,
} from '../shared/studio-travel-research';

/** Browser-only synthetic policy; this fixture never asserts real immigration eligibility. */
export function seedSyntheticCandidateEntries(
  workspace: StudioWorkspace,
  category: StudioVisaCategory = 'visa_free',
  options: { status?: StudioCandidateEntryRequirements['status']; checkedAt?: string } = {},
) {
  const passport = normalizeStudioCountry(workspace.brief.passportNationality || '');
  for (const candidate of workspace.destinationResearch?.candidates || []) {
    const checkedAt = options.checkedAt || new Date().toISOString();
    candidate.entryRequirements = {
      scope: 'destination_shortlist',
      inputKey: studioCandidateEntryInputKey(workspace, candidate),
      checkedAt,
      passportCountry: passport?.name || '',
      passportCountryCode: passport?.code || '',
      destinationCountryCode: candidate.countryCode,
      status: passport ? options.status || 'preliminary' : 'missing_passport',
      category: passport ? category : 'unknown',
      summary: passport
        ? 'Synthetic conditional entry guidance for the declared passport.'
        : 'Declare a passport nationality.',
      conditions: ['Synthetic policy conditions require agent review.'],
      electronicAuthorisation: 'Check electronic authorisation separately.',
      missingFacts: [
        ...(!workspace.brief.startDate ? ['arrival date'] : []),
        ...(!workspace.brief.endDate ? ['return date'] : []),
        ...(!workspace.brief.tripPurpose || workspace.brief.tripPurpose === 'undecided'
          ? ['trip purpose']
          : []),
      ],
      sources: passport
        ? [
            {
              label: `Synthetic official ${candidate.country} visa source`,
              url: 'https://www.mofa.go.jp/j_info/visit/visa/index.html',
              kind: 'official_immigration',
              publishedAt: checkedAt,
              checkedAt,
            },
          ]
        : [],
      notes: ['This is synthetic browser test data, not actual visa guidance.'],
    };
  }
}
export async function fulfilSyntheticCandidateEntries(route: Route, workspace: StudioWorkspace) {
  if (!new URL(route.request().url()).pathname.endsWith('/destinations/entry-requirements'))
    return false;
  const body = route.request().postDataJSON();
  if (body.revision !== workspace.revision) {
    await route.fulfill({ status: 409, json: { error: 'Workspace revision changed.' } });
    return true;
  }
  seedSyntheticCandidateEntries(workspace);
  workspace.revision++;
  await route.fulfill({ json: { workspace, research: workspace.destinationResearch } });
  return true;
}
