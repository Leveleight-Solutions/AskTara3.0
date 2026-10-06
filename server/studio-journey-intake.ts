import type { StudioWorkspace } from '../shared/studio.ts';
import { studioFlightsArrangedExternally } from '../shared/studio-assistant.ts';

/** Transport research needs origin and destination, not a guessed hotel arrival. */
export function studioJourneyIntakeReply(workspace: StudioWorkspace): string | undefined {
  if (
    workspace.structureAccepted ||
    workspace.clarification ||
    !workspace.stops.length ||
    workspace.brief.startDate ||
    studioFlightsArrangedExternally(workspace)
  )
    return;
  const { brief } = workspace;
  const destination = workspace.stops[0].name;
  if (!brief.outboundTransport || brief.outboundTransport === 'undecided')
    return `The travel schedule will give us the arrival date in ${destination}. How would you like to travel there: Flight or Cruise?`;
  if (!brief.origin.trim())
    return `Where will you depart from? A city or port is enough to compare routes to ${destination}.`;
  const mode = brief.outboundTransport === 'cruise' ? 'cruise' : 'flight';
  if (!brief.departureDate && !brief.datesFlexible)
    return `You can explore ${mode} routes from ${brief.origin} to ${destination} below. Choose a departure date or flexible dates for the next search.`;
  return;
}
