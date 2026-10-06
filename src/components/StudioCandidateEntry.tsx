import type { StudioWorkspace } from '../../shared/studio';
import {
  normalizeStudioCountry,
  type StudioDestinationCandidate,
} from '../../shared/studio-travel-research';
import { studioCandidateEntryLabel } from './studioClientInspirationState';

/** A shortlist check is conditional guidance; the actual selected route is checked separately. */
export function StudioCandidateEntry({
  workspace,
  candidate,
}: {
  workspace: StudioWorkspace;
  candidate: StudioDestinationCandidate;
}) {
  const view = studioCandidateEntryLabel(workspace, candidate);
  const passport = normalizeStudioCountry(workspace.brief.passportNationality || '');
  const entry = view.current ? candidate.entryRequirements : undefined;
  const purpose = workspace.brief.tripPurpose;
  return (
    <details
      className="studio-candidate-entry"
      data-entry-state={view.state}
      aria-label={`Entry guidance for ${candidate.destination}`}
    >
      <summary>{view.label}</summary>
      <div>
        <p>
          {passport ? `${passport.name} passport` : 'Passport not declared'} → {candidate.country}
          {' · '}
          {purpose && purpose !== 'undecided' ? purpose : 'purpose not declared'}
        </p>
        <p>
          {entry?.summary ||
            (passport
              ? 'Tara checks suggestions automatically. No current visa result is available for these details yet.'
              : 'Nationality and residence do not establish a passport. Add the passport nationality to check entry rules.')}
        </p>
        <p>
          Suggested {candidate.suggestedDays} days
          {workspace.brief.startDate
            ? ` · arrival ${workspace.brief.startDate}`
            : ' · arrival not declared'}
          {workspace.brief.endDate
            ? ` · return ${workspace.brief.endDate}`
            : ' · return not declared'}
          {workspace.brief.datesFlexible ? ' · flexible dates' : ''}
        </p>
        {entry?.missingFacts.length ? <p>Still needed: {entry.missingFacts.join(', ')}.</p> : null}
        <p>
          Preliminary guidance for this suggestion. Confirm requirements for the final route before
          booking.
        </p>
        {entry && (
          <>
            <p>
              <strong>Electronic authorisation:</strong> {entry.electronicAuthorisation}
            </p>
            {entry.conditions.length > 0 && (
              <ul>
                {entry.conditions.map((condition, index) => (
                  <li key={index}>{condition}</li>
                ))}
              </ul>
            )}
            {entry.sources.length > 0 ? (
              <ul aria-label={`Visa sources for ${candidate.destination}`}>
                {entry.sources.map((source, index) => (
                  <li key={`${source.url}:${index}`}>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.label}
                    </a>
                    {' · '}
                    {source.kind.replaceAll('_', ' ')}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No verified immigration source was returned.</p>
            )}
            <p>Checked {new Date(entry.checkedAt).toLocaleString()}</p>
            {entry.notes.map((note, index) => (
              <p key={index}>{note}</p>
            ))}
          </>
        )}
      </div>
    </details>
  );
}
