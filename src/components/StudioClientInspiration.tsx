import { MapPin, Sparkles, UserRound } from 'lucide-react';
import type { StudioWorkspace } from '../../shared/studio';
import type { StudioClientProfile } from '../../shared/studio-clients';
import type { StudioDestinationCandidate } from '../../shared/studio-travel-research';

export function StudioClientInspiration({
  workspace,
  profile,
  researching,
  busy,
  onClient,
  onChoose,
  onResearch,
  onReview,
}: {
  workspace: StudioWorkspace;
  profile?: StudioClientProfile;
  researching: boolean;
  busy: boolean;
  onClient: () => void;
  onChoose: (candidate: StudioDestinationCandidate) => void;
  onResearch: () => void;
  onReview: () => void;
}) {
  const candidates = workspace.destinationResearch?.candidates || [];
  const preferences = [...workspace.brief.interests, ...(workspace.brief.foodPreferences || [])]
    .filter(Boolean)
    .slice(0, 5);
  return (
    <section
      className="studio-client-inspiration"
      aria-label="Selected client and personalised inspiration"
    >
      <div className="studio-conversation-client">
        <span className="studio-conversation-avatar">
          {profile?.photoDataUrl ? (
            <img src={profile.photoDataUrl} alt="" />
          ) : (
            <UserRound size={19} />
          )}
        </span>
        <div>
          <small>PLANNING FOR</small>
          <strong>{workspace.brief.clientName || 'Choose your client'}</strong>
        </div>
        <button onClick={onClient} disabled={busy}>
          Change client
        </button>
      </div>
      {preferences.length > 0 && (
        <div className="studio-client-preferences">
          {preferences.map((preference, index) => (
            <span key={`${index}:${preference}`}>{preference}</span>
          ))}
        </div>
      )}
      {!workspace.stops.length && (
        <>
          <div className="studio-inspiration-heading">
            <span>
              <Sparkles size={13} />{' '}
              {profile?.history.length || profile?.previousTripCount
                ? 'Inspired by their travel history'
                : 'Ideas for this client'}
            </span>
            <button onClick={onResearch} disabled={researching || busy}>
              {researching ? 'Researching…' : 'Find ideas'}
            </button>
          </div>
          {candidates.length ? (
            <div className="studio-destination-ideas">
              {candidates.slice(0, 3).map((candidate) =>
                candidate.recommendable && candidate.status !== 'blocked' ? (
                  <button
                    key={`${candidate.destination}:${candidate.countryCode}`}
                    disabled={busy}
                    onClick={() => onChoose(candidate)}
                  >
                    <MapPin size={17} />
                    <strong>{candidate.destination}</strong>
                    <span>{candidate.reason}</span>
                    <small>{candidate.suggestedDays} suggested days · Choose</small>
                  </button>
                ) : (
                  <article
                    key={`${candidate.destination}:${candidate.countryCode}`}
                    className="studio-destination-needs-review"
                  >
                    <MapPin size={17} />
                    <strong>{candidate.destination}</strong>
                    <span>{candidate.reason}</span>
                    <small>
                      {candidate.status === 'blocked'
                        ? 'Not recommended · advice warning'
                        : 'Current advice needs review'}
                    </small>
                    <button type="button" disabled={busy} onClick={onReview}>
                      Review travel advice
                    </button>
                  </article>
                ),
              )}
            </div>
          ) : (
            <p className="studio-inspiration-placeholder">
              {researching
                ? 'Tara is checking destination ideas and current advice. You can keep chatting.'
                : workspace.destinationResearch
                  ? 'No destination ideas were returned for these details. Try different dates or interests.'
                  : preferences.length
                    ? 'Tell Tara the occasion and dates, or explore destinations around these preferences.'
                    : 'Add travel interests or previous-trip feedback to personalise the suggestions.'}
            </p>
          )}
        </>
      )}
    </section>
  );
}
