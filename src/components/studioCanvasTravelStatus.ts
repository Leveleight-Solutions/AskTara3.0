import type { StudioWorkspace } from '../../shared/studio';
import { normalizeStudioCountry } from '../../shared/studio-travel-research';
import { studioTripBriefingDisplay } from './studioTripBriefingView';

/** Summarise only current evidence; a completed failed check is a review task, not a pending job. */
export function studioCanvasTravelStatus(workspace: StudioWorkspace, now = Date.now()) {
  const view = studioTripBriefingDisplay(workspace, now);
  const passport = normalizeStudioCountry(workspace.brief.passportNationality || '');
  const purpose = workspace.brief.tripPurpose || 'undecided';
  const oldEntry = Boolean(workspace.tripBriefing || workspace.entryRequirements?.length);
  const entryLabel = !passport
    ? 'Add passport nationality'
    : purpose === 'undecided'
      ? 'Add trip purpose for entry advice'
      : !view.ready
        ? 'Confirm trip details for entry advice'
        : view.rows.length &&
            view.rows.every((row) => row.entryRequirements?.status === 'corroborated')
          ? 'Entry sources checked'
          : view.rows.some((row) => row.entryRequirements || row.entryError) || view.fresh
            ? 'Entry advice needs review'
            : oldEntry
              ? 'Entry checks need refreshing'
              : 'Entry checks pending';
  const weatherAvailable =
    view.rows.length && view.rows.every((row) => row.weather && row.weather.kind !== 'unavailable');
  const weatherLabel = !view.ready
    ? 'Confirm dates for weather guidance'
    : weatherAvailable
      ? view.rows.every((row) => row.weather?.kind === 'seasonal_outlook')
        ? 'Seasonal outlook ready'
        : view.rows.every((row) => row.weather?.kind === 'forecast')
          ? 'Weather forecast ready'
          : 'Weather guidance ready'
      : view.fresh
        ? 'Weather guidance needs review'
        : workspace.tripBriefing
          ? 'Weather guidance needs refreshing'
          : 'Weather guidance pending';
  return { entryLabel, weatherLabel };
}
