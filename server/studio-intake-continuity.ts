import type { StudioAgency, StudioBrief, StudioStop, StudioWorkspace } from '../shared/studio.ts';
import { applyStudioPatch } from './studio-domain.ts';
import { studioJourneyIntakeReply } from './studio-journey-intake.ts';
import { studioFlightsArrangedExternally } from '../shared/studio-assistant.ts';
import {
  groundedStudioDates,
  requestedStudioNights,
  readStudioDateReferences,
} from './studio-grounding.ts';

const dateLabel = (date: string) =>
  new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
const dayCount = (start: string, end: string) => (Date.parse(end) - Date.parse(start)) / 86400000;
const addNights = (start: string, nights: number) =>
  new Date(Date.parse(start) + nights * 86400000).toISOString().slice(0, 10);

export function studioStayConfirmation(workspace: StudioWorkspace) {
  const pending = workspace.clarification;
  if (!pending) return;
  const stop = workspace.stops.find((entry) => entry.id === pending.stopId);
  return `${dateLabel(pending.arrivalDate)} to ${dateLabel(pending.departureDate)} is ${pending.proposedNights} nights; you also mentioned ${pending.statedNights}. Shall I use those dates and ${pending.proposedNights} nights${stop ? ` for ${stop.name}` : ''}?`;
}

/** Existing saved chats may still end with the former ambiguous either/or question. */
export function recoverStudioStayClarification(
  workspace: StudioWorkspace,
  message: string,
  agency: StudioAgency,
) {
  if (
    workspace.clarification ||
    workspace.stops.length !== 1 ||
    !/^(?:yes|yep|yeah|sure|ok(?:ay)?)[.!\s]*$/i.test(message.trim())
  )
    return;
  const previousReply =
    workspace.messages.findLast((entry) => entry.role === 'assistant')?.content || '';
  if (!/\bor\b/i.test(previousReply) || !/\bnights?\b/i.test(previousReply)) return;
  const previousRequest = workspace.messages.findLast(
    (entry) =>
      entry.role === 'user' &&
      !/^(?:yes|yep|yeah|sure|ok(?:ay)?)[.!\s]*$/i.test(entry.content.trim()),
  );
  if (!previousRequest) return;
  const brief = structuredClone(workspace.brief);
  const stops = structuredClone(workspace.stops);
  const conflict = prepareStudioStayClarification(workspace, brief, stops, previousRequest.content);
  if (!conflict) return;
  applyStudioPatch(workspace, { revision: workspace.revision, brief, stops }, agency);
  workspace.clarification = conflict.clarification;
  return conflict.reply;
}

/** A bare yes is meaningful only when we saved one explicit confirmation proposal. */
export function resolveStudioClarification(
  workspace: StudioWorkspace,
  message: string,
  agency: StudioAgency,
): string | undefined {
  const pending = workspace.clarification;
  if (!pending) return;
  const stop = workspace.stops.find((entry) => entry.id === pending.stopId);
  if (workspace.stops.length !== 1 || !stop) {
    workspace.clarification = null;
    return;
  }
  const answer = message.trim();
  const confirmsDates =
    /^(?:yes|yep|yeah|sure|ok(?:ay)?|correct|agreed|please do|go ahead|use (?:those|the) dates)(?:[,!\s]+(?:please|thanks|that['’]s right))?[.!\s]*$/i.test(
      answer,
    );
  const durationAnswer = answer.replace(/^(?:keep|use|make it)\s+(?:the\s+)?/i, '');
  const confirmsNights = /^\s*(?:\d+|[a-z]+(?:[ -][a-z]+)*)\s+nights?[.!\s]*$/i.test(durationAnswer)
    ? requestedStudioNights(durationAnswer, stop.name, stop.nights, true)
    : undefined;
  if (
    confirmsDates &&
    workspace.messages.findLast((entry) => entry.role === 'assistant')?.content !==
      studioStayConfirmation(workspace)
  )
    return studioStayConfirmation(workspace);
  const parsed = groundedStudioDates(message, {
    messages: workspace.messages,
    brief: workspace.brief,
  });
  const explicitNights = requestedStudioNights(message, stop.name, stop.nights, true);
  const explicitChoice =
    parsed.startDate === pending.arrivalDate &&
    explicitNights !== undefined &&
    parsed.endDate === addNights(pending.arrivalDate, explicitNights) &&
    [pending.statedNights, pending.proposedNights].includes(explicitNights);
  const nights = confirmsDates
    ? pending.proposedNights
    : confirmsNights !== undefined &&
        [pending.statedNights, pending.proposedNights].includes(confirmsNights)
      ? confirmsNights
      : explicitChoice
        ? explicitNights
        : undefined;
  if (nights !== undefined) {
    const endDate = addNights(pending.arrivalDate, nights);
    applyStudioPatch(
      workspace,
      {
        revision: workspace.revision,
        brief: {
          startDate: pending.arrivalDate,
          endDate,
          request: [workspace.brief.request, message].filter(Boolean).join('\n').slice(-16000),
        },
        stops: [{ ...stop, nights, arrivalDate: pending.arrivalDate, arrivalFixed: true }],
      },
      agency,
    );
    workspace.clarification = null;
    return `${stop.name}: ${dateLabel(pending.arrivalDate)} to ${dateLabel(endDate)}, ${nights} nights. Would you like me to build the day-by-day itinerary?`;
  }
  if (/^(?:no|nope|not sure|what|which)(?:\s+thanks)?[?!.\s]*$/i.test(answer))
    return `Choose “Use ${pending.proposedNights} nights” to leave on ${dateLabel(pending.departureDate)}, or “Keep ${pending.statedNights} nights” to leave on ${dateLabel(addNights(pending.arrivalDate, pending.statedNights))}. You can also give me different dates.`;
  // A new date/duration answer supersedes the proposal; unrelated details do not.
  if (parsed.startDate || parsed.endDate || explicitNights !== undefined)
    workspace.clarification = null;
}

/** Hold contradictory alternatives without committing an internally inconsistent route. */
export function prepareStudioStayClarification(
  workspace: StudioWorkspace,
  brief: StudioBrief,
  stops: StudioStop[],
  message: string,
) {
  if (stops.length !== 1) return;
  const dates = groundedStudioDates(message, {
    messages: workspace.messages,
    brief: workspace.brief,
  });
  const oldStop = workspace.stops.find((entry) => entry.id === stops[0].id);
  const statedNights =
    requestedStudioNights(message, stops[0].name, oldStop?.nights ?? null, true) ??
    (dates.startDate || dates.endDate ? (oldStop?.nights ?? undefined) : undefined);
  const arrivalDate = dates.startDate || brief.startDate;
  const departureDate = dates.endDate || brief.endDate;
  if (statedNights === undefined || !arrivalDate || !departureDate) return;
  const proposedNights = dayCount(arrivalDate, departureDate);
  if (
    !Number.isInteger(proposedNights) ||
    proposedNights < 0 ||
    proposedNights > 120 ||
    proposedNights === statedNights
  )
    return;
  const clarification: NonNullable<StudioWorkspace['clarification']> = {
    kind: 'stay_dates',
    stopId: stops[0].id,
    arrivalDate,
    departureDate,
    statedNights,
    proposedNights,
  };
  // Keep the previously consistent schedule intact until a complete alternative is chosen.
  // The new dates remain visible in the saved confirmation rather than shifting old nights.
  brief.startDate = workspace.brief.startDate;
  brief.endDate = workspace.brief.endDate;
  stops[0] = {
    ...stops[0],
    arrivalDate: oldStop?.arrivalDate || '',
    arrivalFixed: oldStop?.arrivalFixed || false,
    nights: oldStop?.nights ?? null,
  };
  if (oldStop && oldStop.arrivalFixed === undefined) delete stops[0].arrivalFixed;
  return {
    clarification,
    reply: `${dateLabel(arrivalDate)} to ${dateLabel(departureDate)} is ${proposedNights} nights; you also mentioned ${statedNights}. Shall I use those dates and ${proposedNights} nights for ${stops[0].name}?`,
  };
}

/** Explain only what survived validation, and ask for the next missing detail. */
export function studioIntakeRecoveryReply(workspace: StudioWorkspace, message: string) {
  const stop = workspace.stops[0];
  if (!stop) return 'Where would you like to travel?';
  if (!workspace.brief.startDate && !studioFlightsArrangedExternally(workspace))
    return (
      studioJourneyIntakeReply(workspace) ||
      `${stop.name}${stop.nights !== null ? ` for ${stop.nights} nights` : ''} is noted. Compare outbound and return journeys below; a selected schedule will confirm arrival.`
    );
  if (!workspace.brief.startDate && workspace.brief.departureDate)
    return `Your departure${workspace.brief.origin ? ` from ${workspace.brief.origin}` : ''} is ${dateLabel(workspace.brief.departureDate)}. What date will you arrive in ${stop.name}?`;
  if (!workspace.brief.startDate) {
    const dates = readStudioDateReferences(message, {
      messages: workspace.messages,
      brief: workspace.brief,
    });
    if (dates.length === 1)
      return `${stop.name} is noted. Is ${dateLabel(dates[0].date)} your departure${workspace.brief.origin ? ` from ${workspace.brief.origin}` : ''} or your arrival in ${stop.name}?`;
  }
  if (stop.nights === null)
    return `${stop.name}${workspace.brief.startDate ? `, arriving ${dateLabel(workspace.brief.startDate)}` : ''} is noted. How many nights would you like to stay?`;
  if (!workspace.brief.startDate && !workspace.brief.datesFlexible)
    return `${stop.name} for ${stop.nights} nights is noted. What date will you arrive?`;
  return `${stop.name} for ${stop.nights} nights is noted. Would you like me to build the day-by-day itinerary?`;
}
