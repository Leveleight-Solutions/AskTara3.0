import type { StudioAgency, StudioWorkspace } from '../shared/studio.ts';
import { reviewStudioBrief, studioRecommendations } from './studio-models.ts';
import { generateStudioItinerary } from './studio-itinerary.ts';
import { replaceStudioRecommendations } from './studio-domain.ts';
import {
  researchStudioDestinations,
  checkStudioEntryRequirements,
} from './studio-travel-research.ts';
import { normalizeStudioCountry } from '../shared/studio-travel-research.ts';
import type { StudioTravelHistoryEntry } from '../shared/studio-travel-research.ts';

/** Each turn runs inside the route's revision-checked, atomic action transaction. */
export async function runStudioAssistant(
  workspace: StudioWorkspace,
  message: string,
  agency: StudioAgency,
  signal?: AbortSignal,
  history: StudioTravelHistoryEntry[] = [],
) {
  const previousItinerary = workspace.itinerary;
  const review = await reviewStudioBrief(workspace, message, agency, signal, history);
  const action = 'action' in review ? review.action : 'continue';
  if (action === 'destinations') {
    workspace.destinationResearch = await researchStudioDestinations(workspace, history, signal);
    return {
      ...review,
      reply:
        'The destination research is ready in Brief & route. Review current conditions and the travel advice before choosing a destination.',
      nextAction: 'structure',
    };
  }
  if (action === 'entry_check') {
    if (!workspace.brief.passportNationality)
      return {
        ...review,
        reply:
          'Which country issued the client’s passport? I only need the nationality, never a passport number.',
        nextAction: 'structure',
      };
    if (!workspace.stops.length)
      return {
        ...review,
        reply:
          'Choose a destination first, then I can check entry requirements for the client’s passport nationality.',
        nextAction: 'structure',
      };
    const stop = workspace.stops[0];
    if (!normalizeStudioCountry(stop.country))
      return {
        ...review,
        reply: `Add the destination country for ${stop.name} in Brief & route, then I can check its entry requirements.`,
        nextAction: 'structure',
      };
    const result = await checkStudioEntryRequirements(workspace, signal, stop.id);
    workspace.entryRequirements = [
      ...(workspace.entryRequirements || []).filter((value) => value.stopId !== stop.id),
      result,
    ];
    return {
      ...review,
      reply: `Entry research for ${stop.name} is ready in Brief & route. Review the official sources and any unresolved checks.${workspace.stops.length > 1 ? ' Use the destination selector to check each other country.' : ''}`,
      nextAction: 'structure',
    };
  }
  if (action === 'itinerary') {
    if (!workspace.stops.length)
      return {
        ...review,
        reply: 'I can build the complete itinerary. Where would you like to travel?',
        nextAction: 'structure',
      };
    const missing = workspace.stops.filter((stop) => stop.nights === null);
    if (missing.length)
      return {
        ...review,
        reply: `How many nights would you like in ${missing.map((stop) => stop.name).join(', ')}? Then I can build the day-by-day itinerary.`,
        nextAction: 'structure',
      };
    const end = workspace.stops.at(-1)?.departureDate;
    if (end && workspace.brief.endDate && end !== workspace.brief.endDate)
      return {
        ...review,
        reply:
          'The stay lengths and your requested end date differ. Should I change the nights or the end date before building the itinerary?',
        nextAction: 'structure',
      };
    // Explicitly requesting an itinerary authorises a draft using this route. It never books
    // services, publishes a proposal, or changes an existing client-facing snapshot.
    workspace.structureAccepted = true;
    workspace.itinerary = await generateStudioItinerary(
      { ...workspace, itinerary: previousItinerary },
      message,
      signal,
    );
    workspace.itineraryManual = false;
    workspace.stage = 'itinerary';
    return {
      ...review,
      reply: `Your ${workspace.itinerary.days.length}-day itinerary is ready, with sources for the suggested activities. Tell me what to change, explore hotel and flight options in Services, or preview the proposal when you’re ready.`,
      nextAction: 'itinerary',
    };
  }
  if (action === 'activities' || action === 'food') {
    if (!workspace.structureAccepted)
      return {
        ...review,
        reply: 'Review and accept the route first, then I can research ideas for its destinations.',
        nextAction: 'structure',
      };
    const category = action === 'food' ? ('food' as const) : ('activity' as const);
    const recommendations = await studioRecommendations(
      workspace,
      workspace.stops.map((stop) => stop.id),
      category,
      message,
      signal,
    );
    replaceStudioRecommendations(
      workspace,
      workspace.stops.map((stop) => stop.id),
      category,
      recommendations,
    );
    workspace.stage = 'recommendations';
    return {
      ...review,
      reply: `I found ${recommendations.length} sourced ${category === 'food' ? 'food' : 'activity'} ideas. Choose the ones you want to include, or ask me to work them into the itinerary.`,
      nextAction: 'recommendations',
    };
  }
  if (action === 'services' || action === 'proposal') {
    if (!workspace.structureAccepted)
      return {
        ...review,
        reply:
          'Review and accept the route first so the next step uses the right destinations and stay lengths.',
        nextAction: 'structure',
      };
    workspace.stage = action;
    return {
      ...review,
      reply:
        action === 'services'
          ? 'Services is open for hotel and flight options or arrangements you already have. Search the options there, then ask me to update the itinerary around your selections.'
          : 'Your proposal is ready to preview, including the saved itinerary and selected services. You can download its PDF or publish a link when you choose.',
      nextAction: action,
    };
  }
  return review;
}
