import type { StudioWorkspace } from '../../shared/studio';
import { normalizeStudioCountry } from '../../shared/studio-travel-research';
import { studioTripBriefingDisplay } from './studioTripBriefingView';

/** Summarise only current evidence; a completed failed check is a review task, not a pending job. */
export function studioCanvasTravelStatus(workspace: StudioWorkspace, now = Date.now()) {
  const view = studioTripBriefingDisplay(workspace, now);
  const passport = normalizeStudioCountry(workspace.brief.passportNationality || '');
  const oldEntry = Boolean(workspace.tripBriefing || workspace.entryRequirements?.length);
  const entryLabel = !passport
    ? 'Add passport nationality'
    : !view.ready
      ? 'Choose destination for entry advice'
      : view.rows.length &&
          view.rows.every((row) => row.entryRequirements?.status === 'corroborated')
        ? 'Entry sources checked'
        : view.rows.some((row) => row.preliminaryEntryRequirements?.status === 'preliminary')
          ? 'Preliminary entry guidance ready'
          : view.rows.some(
                (row) =>
                  row.entryRequirements || row.preliminaryEntryRequirements || row.entryError,
              ) || view.fresh
            ? 'Entry advice needs review'
            : oldEntry
              ? 'Entry checks need refreshing'
              : 'Entry checks pending';
  const weatherAvailable =
    view.rows.length && view.rows.every((row) => row.weather && row.weather.kind !== 'unavailable');
  const weatherLabel = !view.ready
    ? 'Choose destination for climate guidance'
    : weatherAvailable
      ? view.rows.every((row) => row.weather?.kind === 'climate_overview')
        ? 'Destination climate ready'
        : view.rows.every((row) => row.weather?.kind === 'seasonal_outlook')
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
