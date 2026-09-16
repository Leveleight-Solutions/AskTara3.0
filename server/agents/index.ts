import { randomUUID } from 'node:crypto';
import { destinations, stays } from '../../shared/catalog.ts';
import type { Trip } from '../../shared/types.ts';
import { findDestination, tripDestinations } from '../../shared/destinations.ts';
import type {
  AgentId,
  PlanningEvent,
  PlanningQuestion,
  PlanningReport,
  PlanSource,
  ResearchStay,
  StageStatus,
  TravelBrief,
  WorkflowInput,
  WorkflowResult,
} from '../../shared/planning.ts';
import { detectDestinationIntent, localPlan } from '../planner.ts';
import { searchFlights, searchHotels } from '../integrations.ts';
import { flightSearchSchema, hotelSearchSchema, itinerarySchema } from '../validation.ts';
import { modelComposition, modelIntake, type DestinationRequest } from './models.ts';
import { researchDestinations } from './research.ts';
import { planningFailureReason } from './failures.ts';
import { verifyResearchPlaces } from './verify.ts';
import { curatedPlaces, researchGooglePlaces } from './places.ts';
import {
  updateConsultation,
  getConsultationQuestions,
  hasUnsupportedParty,
  hasConfirmedAdultParty,
} from './consultation.ts';
import {
  allocatedStops,
  buildLocalItinerary,
  defaultBrief,
  minuteOfDay,
  preserveLockedStops,
  type CompositionDay,
} from './schedule.ts';
export {
  buildLocalItinerary,
  preserveLockedStops,
  PlanningConstraintError,
  defaultBrief,
} from './schedule.ts';
export { stripGooglePlaceContent, readGooglePlaceDetails } from './places.ts';

const labels: Record<AgentId, string> = {
  intake: 'Understanding your trip',
  destinations: 'Shaping your route',
  places: 'Finding places to explore',
  verification: 'Checking venue status',
  stays: 'Finding somewhere to stay',
  flights: 'Checking flight options',
  itinerary: 'Putting your days together',
  review: 'Checking the details',
};
const isoNow = () => new Date().toISOString();
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function localBrief(
  original: Trip,
  trip: Trip,
  message: string,
  supplied?: Partial<TravelBrief>,
): TravelBrief {
  const brief = { ...defaultBrief(), ...structuredClone(original.brief || {}), ...supplied };
  const adultCount = message.match(/\b(\d{1,2})\s+adults?\b/i)?.[1];
  const childCount = message.match(/\b(\d{1,2})\s+(?:children|child|kids?)\b/i)?.[1];
  const infantCount = message.match(/\b(\d{1,2})\s+(?:infants?|babies|baby)\b/i)?.[1];
  if (adultCount && (childCount || infantCount))
    trip.travelers = Math.min(
      16,
      Number(adultCount) + Number(childCount || 0) + Number(infantCount || 0),
    );
  if (/\b(slower|slow|relaxed|relaxing|less busy|unhurried)\b/i.test(message))
    brief.pace = 'relaxed';
  else if (/\b(active|packed|busier|more activities)\b/i.test(message)) brief.pace = 'active';
  else if (/\bbalanced\b/i.test(message)) brief.pace = 'balanced';
  if (/\b(?:include|find|search|need|with)\b.{0,20}\bflights?\b/i.test(message))
    brief.includeFlights = true;
  if (
    /\b(?:include|find|search|need|with)\b.{0,20}\b(?:hotels?|stays?|accommodation)\b/i.test(
      message,
    )
  )
    brief.includeHotels = true;
  if (/\b(?:no|without|skip)\s+flights?\b/i.test(message)) brief.includeFlights = false;
  if (/\b(?:no|without|skip)\s+(?:hotels?|accommodation)\b/i.test(message))
    brief.includeHotels = false;
  const origin = message.match(/\b(?:from|origin(?: airport)?)\s+([A-Z]{3})\b/)?.[1];
  const arrival = message.match(/\b(?:to|arrival(?: airport)?)\s+([A-Z]{3})\b/)?.[1];
  const nationality = message.match(/\bnationality\s*[:=]?\s*([A-Z]{2})\b/)?.[1];
  if (origin) brief.originAirport = origin;
  if (arrival) brief.arrivalAirport = arrival;
  if (nationality) brief.guestNationality = nationality;
  const preferences = message
    .split(/[.!?\n]+/)
    .map((value) => value.trim())
    .filter((value) =>
      /vegetarian|vegan|allerg|wheelchair|accessib|mobility|step[- ]free|quiet|gluten|halal|kosher|children|kids|infant/i.test(
        value,
      ),
    );
  brief.notes = [
    ...new Set([...brief.notes, ...preferences.map((value) => value.slice(0, 500))]),
  ].slice(-12);
  // A departure city in "from London to Kyoto" is not a requested itinerary stop.
  const routeMessage = message.replace(/\bfrom\s+[^.!?\n]+?\s+to\s+/gi, 'to ');
  const named = tripDestinations(original)
    .map((destination) => {
      const names = [...new Set([destination.name, destination.id.replaceAll('-', ' ')])];
      const indexes = names
        .map((name) =>
          routeMessage.search(
            new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(name)}(?=$|[^\\p{L}\\p{N}])`, 'iu'),
          ),
        )
        .filter((index) => index >= 0);
      return { destination, names, index: Math.min(...indexes) };
    })
    .filter((entry) => Number.isFinite(entry.index))
    .sort((a, b) => a.index - b.index)
    .slice(0, 5);
  if (supplied?.destinationStops?.length) {
    brief.destinationStops = supplied.destinationStops;
    trip.days = brief.destinationStops.reduce((sum, stop) => sum + stop.days, 0);
  } else if (named.length > 1) {
    const explicit = named.map(({ destination, names }) => {
      const name = `(?:${names.map(escapeRegex).join('|')})`;
      const count =
        message.match(
          new RegExp(`(\\d{1,2})\\s*(?:days?|nights?)\\s*(?:in\\s+|at\\s+)?${name}`, 'i'),
        )?.[1] ||
        message.match(
          new RegExp(`${name}\\s+(?:for\\s+)?(\\d{1,2})\\s*(?:days?|nights?)`, 'i'),
        )?.[1];
      return { destinationId: destination.id, days: Number(count || 0) };
    });
    if (
      explicit.every((stop) => stop.days > 0) &&
      explicit.reduce((sum, stop) => sum + stop.days, 0) <= 21
    ) {
      brief.destinationStops = explicit;
      trip.days = explicit.reduce((sum, stop) => sum + stop.days, 0);
    } else {
      trip.days = Math.max(named.length, trip.days);
      brief.destinationStops = named.map(({ destination }, index) => ({
        destinationId: destination.id,
        days: Math.floor(trip.days / named.length) + (index < trip.days % named.length ? 1 : 0),
      }));
    }
  } else if (named.length === 1 && named[0].destination.id !== original.destinationId) {
    brief.destinationStops = [{ destinationId: named[0].destination.id, days: trip.days }];
  } else if (!brief.destinationStops.length && trip.destinationId) {
    brief.destinationStops = [{ destinationId: trip.destinationId, days: trip.days }];
  }
  brief.destinationStops = allocatedStops(trip, brief);
  if (brief.destinationStops.length) trip.destinationId = brief.destinationStops[0].destinationId;
  return brief;
}

function reviewPlan(original: Trip, trip: Trip, report: PlanningReport) {
  const requirements = (trip.brief?.notes || []).filter((note) =>
    /dietary|vegetarian|vegan|allerg|gluten|dairy|halal|kosher|accessib|wheelchair|step.free|elevator|ground.floor/i.test(
      note,
    ),
  );
  if (requirements.length)
    report.issues.push({
      code: 'requirements_unverified',
      severity: 'warning',
      message: `Your dietary or accessibility requirements are recorded, but suitability has not been verified. Confirm them directly with venues, accommodation and transport providers. ${requirements.filter((note) => !note.startsWith('Dietary and accessibility suitability')).join(' ')}`,
    });
  const ids = new Set<string>(),
    places = new Set<string>();
  for (const day of trip.itinerary) {
    let end = 0;
    for (const item of day.items) {
      if (ids.has(item.id)) throw new Error('The itinerary contains duplicate activity IDs');
      ids.add(item.id);
      const start = minuteOfDay(item.time);
      if (start < end)
        report.issues.push({
          code: 'schedule_overlap',
          severity: 'warning',
          day: day.day,
          itemId: item.id,
          message: `Day ${day.day}: ${item.title} overlaps another stop. Adjust the protected activity times.`,
        });
      end = Math.max(end, start + (item.durationMinutes || 60));
      if (end > 1440)
        report.issues.push({
          code: 'late_finish',
          severity: 'warning',
          day: day.day,
          itemId: item.id,
          message: `Day ${day.day}: ${item.title} ends after midnight.`,
        });
      if (item.placeId && places.has(item.placeId))
        report.issues.push({
          code: 'repeat_place',
          severity: 'info',
          day: day.day,
          itemId: item.id,
          message: `${item.title} appears more than once because a protected stop was kept.`,
        });
      if (item.placeId) places.add(item.placeId);
      const place = report.places.find((entry) => entry.id === item.placeId);
      if (place?.openingHours && trip.startDate) {
        const weekday = new Date(
          `${addDays(trip.startDate, day.day - 1)}T12:00:00Z`,
        ).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
        const hours = place.openingHours.find((line) => line.startsWith(weekday));
        if (hours && /closed/i.test(hours))
          report.issues.push({
            code: 'place_closed',
            severity: 'warning',
            day: day.day,
            itemId: item.id,
            message: `${place.name} lists ${weekday} as closed. Move or replace this stop and confirm current hours.`,
          });
      }
    }
  }
  for (const day of original.itinerary)
    for (const item of day.items.filter((entry) => entry.locked)) {
      const preserved = trip.itinerary
        .find((entry) => entry.day === day.day)
        ?.items.find((entry) => entry.id === item.id);
      if (!preserved || JSON.stringify(preserved) !== JSON.stringify(item))
        throw new Error('A protected stop was not preserved');
      if (
        trip.itinerary.find((entry) => entry.day === day.day)?.destinationId !==
          day.destinationId &&
        (day.destinationId || original.destinationId) !== trip.destinationId
      )
        report.issues.push({
          code: 'protected_destination',
          severity: 'warning',
          day: day.day,
          itemId: item.id,
          message: `${item.title} was kept from your earlier route. Check that its location fits this day.`,
        });
    }
  if (
    trip.destinationId &&
    (trip.itinerary.length !== trip.days ||
      trip.itinerary.some((day, index) => day.day !== index + 1))
  )
    throw new Error('The itinerary does not cover every requested day');
  report.budget.activities = Math.round(
    trip.itinerary.reduce(
      (sum, day) => sum + day.items.reduce((subtotal, item) => subtotal + item.cost, 0),
      0,
    ) * trip.travelers,
  );
  report.budget.total =
    report.budget.activities + report.budget.accommodation + (report.budget.flights || 0);
  if (
    report.budget.total > trip.budget &&
    (report.budget.targetCurrency || 'USD') === report.budget.currency &&
    (!trip.brief?.consultation || trip.brief.consultation.facts.budget?.valueState === 'specified')
  )
    report.issues.push({
      code: 'over_budget',
      severity: 'warning',
      message: `The priced and estimated parts total $${report.budget.total.toLocaleString('en-US')}, which is $${(report.budget.total - trip.budget).toLocaleString('en-US')} above your group budget. Reduce paid stops or adjust your accommodation allowance.`,
    });
}

/** Recheck a manually edited schedule without retaining obsolete timing/budget findings. */
export function refreshPlanningReport(trip: Trip): Trip {
  if (!trip.planning) return trip;
  const result = structuredClone(trip);
  const report = result.planning!;
  const dynamic = new Set([
    'over_budget',
    'schedule_overlap',
    'late_finish',
    'repeat_place',
    'protected_destination',
    'place_closed',
    'requirements_unverified',
  ]);
  report.issues = report.issues.filter((issue) => !dynamic.has(issue.code));
  report.budget.target = result.budget;
  report.budget.targetCurrency = result.brief?.consultation?.currency || 'USD';
  reviewPlan(result, result, report);
  report.summary = `${result.days} days at a ${result.brief?.pace || 'balanced'} pace. ${report.issues.some((issue) => issue.severity !== 'info') ? 'Review the notes before confirming your plans.' : 'The schedule passes the automated timing and consistency checks.'}`;
  report.generatedAt = isoNow();
  return result;
}

/** Bounded, auditable orchestration: model intake, real research tools, composition, schedule guardrails. */
export async function runPlanningWorkflow(input: WorkflowInput): Promise<WorkflowResult> {
  const { signal } = input;
  const completed = new Set<AgentId>();
  const emit = (agent: AgentId, status: StageStatus, detail: string) => {
    signal?.throwIfAborted();
    if (status === 'completed') completed.add(agent);
    const event: PlanningEvent = {
      id: randomUUID(),
      agent,
      status,
      label: labels[agent],
      detail,
      at: isoNow(),
    };
    input.onEvent?.(event);
  };
  const report: PlanningReport = {
    generatedAt: isoNow(),
    mode: 'local',
    summary: '',
    assumptions: [],
    questions: [],
    issues: [],
    sources: [],
    places: [],
    stays: [],
    flights: [],
    destinations: [],
    budget: {
      currency: 'USD',
      target: input.trip.budget,
      targetCurrency: input.trip.brief?.consultation?.currency || 'AUD',
      activities: 0,
      accommodation: 0,
      flights: null,
      total: 0,
      unpriced: ['Local transport', 'Travel insurance', 'Unlisted taxes and personal spending'],
    },
    agentIds: [],
  };
  const issue = (code: string, message: string) =>
    report.issues.push({ code, severity: 'warning', message });
  const question = (field: PlanningQuestion['field'], text: string, suggestions: string[] = []) => {
    if (!report.questions.some((entry) => entry.field === field))
      report.questions.push({ field, question: text, suggestions });
  };
  const source = (value: Omit<PlanSource, 'checkedAt'>) => {
    if (!report.sources.some((entry) => entry.id === value.id))
      report.sources.push({ ...value, checkedAt: isoNow() });
  };
  emit('intake', 'running', 'Reading your destination, dates, budget and preferences.');
  const hasAI = Boolean(process.env.OPENAI_API_KEY);
  const parsed = hasAI
    ? { trip: structuredClone(input.trip), reply: '' }
    : localPlan(input.trip, input.message);
  let trip = parsed.trip;
  if (!input.trip.itinerary.length) trip.itinerary = [];
  const destinationIntent = detectDestinationIntent(input.message);
  if (!hasAI && destinationIntent.kind === 'explicit' && !destinationIntent.destination) {
    const existingPlan = input.trip.itinerary.length > 0;
    if (!existingPlan) {
      trip.brief = localBrief(input.trip, trip, input.message, input.brief);
      trip.destinationId = '';
      trip.brief.destinationStops = [];
      trip.itinerary = [];
    }
    report.summary = `Live research is needed to plan ${destinationIntent.name}.`;
    report.budget.target = trip.budget;
    question('destination', report.summary, []);
    emit('intake', 'completed', `Your request for ${destinationIntent.name} was understood.`);
    for (const agent of ['destinations', 'places', 'stays', 'flights', 'itinerary'] as AgentId[])
      emit(agent, 'skipped', 'Global research requires the OpenAI connection.');
    emit(
      'review',
      'completed',
      existingPlan
        ? 'Your existing itinerary is unchanged.'
        : 'No replacement destination was selected.',
    );
    report.agentIds = [...completed];
    return {
      trip,
      reply: parsed.reply,
      mode: 'local',
      warning: report.summary,
      report: existingPlan && trip.planning ? trip.planning : report,
    };
  }
  let brief = localBrief(input.trip, trip, input.message, input.brief);
  let modelUsed = false,
    modelFailed = false;
  let intent: 'plan' | 'discover' | 'answer' | 'clarify' =
    destinationIntent.kind === 'discovery' ? 'discover' : 'plan';
  let intakeReply = '';
  let destinationRequests: DestinationRequest[] = [];
  if (hasAI) {
    const intake = await modelIntake(trip, input.message, brief, signal);
    signal?.throwIfAborted();
    trip = {
      ...trip,
      startDate: intake.startDate,
      days: intake.days,
      travelers: intake.travelers,
      budget: intake.budget,
      interests: intake.interests,
    };
    brief = {
      ...brief,
      pace: intake.pace,
      originAirport: intake.originAirport,
      arrivalAirport: intake.arrivalAirport,
      guestNationality: intake.guestNationality,
      includeFlights: intake.includeFlights,
      includeHotels: intake.includeHotels,
      destinationStops: intake.destinationStops,
      notes: [...new Set([...brief.notes, ...intake.notes])].slice(-12),
      ...input.brief,
    };
    brief.consultation =
      intake.intent === 'answer' || intake.intent === 'clarify'
        ? updateConsultation({
            trip: input.trip,
            message: '',
            brief: input.trip.brief || defaultBrief(),
          })
        : updateConsultation({
            trip: input.trip,
            message: input.message,
            brief,
            updates: intake.consultationUpdates,
            form: input.brief?.consultation,
          });
    destinationRequests = intake.destinationRequests;
    intent = intake.intent;
    intakeReply = intake.reply;
    // The explicit settings are authoritative, and contain only server-known IDs.
    if (input.brief?.destinationStops?.length) {
      destinationRequests = input.brief.destinationStops.map((stop) => {
        const destination = findDestination(stop.destinationId, trip);
        if (!destination) throw new Error('This route contains an unresolved destination.');
        return { name: `${destination.name}, ${destination.country}`, days: stop.days };
      });
      trip.days = destinationRequests.reduce((sum, stop) => sum + stop.days, 0);
      intent = 'plan';
    }
    modelUsed = true;
    report.model = process.env.OPENAI_MODEL || 'gpt-6-astra';
  }
  if (!hasAI)
    brief.consultation = updateConsultation({
      trip: input.trip,
      message: input.message,
      brief,
      form: input.brief?.consultation,
    });
  const previousRoute = input.trip.brief?.consultation?.route;
  const sameResolvedRoute =
    brief.destinationStops.length > 0 &&
    brief.destinationStops.length === input.trip.brief?.destinationStops.length &&
    brief.destinationStops.every(
      (stop, index) =>
        stop.destinationId === input.trip.brief?.destinationStops[index].destinationId,
    );
  const routeChanged =
    !sameResolvedRoute &&
    previousRoute?.length &&
    destinationRequests.length &&
    JSON.stringify(previousRoute.map((entry) => entry.name.toLowerCase())) !==
      JSON.stringify(destinationRequests.map((entry) => entry.name.toLowerCase()));
  if (
    routeChanged ||
    (input.trip.startDate && trip.startDate !== input.trip.startDate) ||
    (input.trip.itinerary.length && trip.days !== input.trip.days)
  ) {
    const previousJourney = input.trip.brief?.consultation?.flightJourney;
    if (previousJourney && brief.consultation?.flightJourney?.evidence === previousJourney.evidence)
      delete brief.consultation.flightJourney;
    if (routeChanged && brief.arrivalAirport === input.trip.brief?.arrivalAirport)
      brief.arrivalAirport = '';
    for (const service of ['flights', 'hotels'] as const) {
      const choice = brief.consultation!.services[service];
      if (
        choice.status === 'already_booked' &&
        choice.evidence === input.trip.brief?.consultation?.services[service].evidence
      )
        brief.consultation!.services[service] = { status: 'unknown', source: 'unknown' };
    }
  }
  if (destinationRequests.length) brief.consultation!.route = destinationRequests;
  brief.includeFlights = brief.consultation!.services.flights.status === 'requested';
  brief.includeHotels = brief.consultation!.services.hotels.status === 'requested';
  if (brief.consultation!.facts.dates?.valueState === 'flexible') trip.startDate = '';
  // Resolve known IDs without spending on destination research before intake is ready.
  if (!input.trip.itinerary.length && brief.destinationStops.length)
    trip.destinationId = brief.destinationStops[0].destinationId;
  if (!input.trip.itinerary.length && destinationRequests.length)
    trip.title = destinationRequests
      .map((entry) => entry.name)
      .join(' & ')
      .slice(0, 120);
  trip.brief = brief;
  const needsChildAges = hasUnsupportedParty(brief);
  const confirmedAdultParty = hasConfirmedAdultParty(brief);
  if (needsChildAges && (brief.includeHotels || brief.includeFlights))
    question(
      'travelers',
      'This search currently prices adults only. Confirm adult and child ages with the provider before requesting family fares or room rates.',
      [],
    );
  else if (!confirmedAdultParty && (brief.includeHotels || brief.includeFlights))
    question(
      'travelers',
      'Are all travellers adults? If children are coming, please include their ages so they are not priced as adults.',
    );
  report.budget.target = trip.budget;
  report.budget.targetCurrency = brief.consultation!.currency;
  emit('intake', 'completed', 'Your confirmed details and preferences are saved.');
  // A conversational answer or clarification must never replace the saved schedule.
  const finishConversation = (reply: string): WorkflowResult => {
    for (const agent of ['stays', 'flights', 'itinerary'] as AgentId[])
      emit(agent, 'skipped', 'No itinerary change requested or a destination choice is needed.');
    emit(
      'review',
      'completed',
      input.trip.itinerary.length
        ? 'Your saved itinerary is unchanged.'
        : 'Your preferences are saved for the next step.',
    );
    report.mode = modelUsed ? 'live' : 'local';
    report.agentIds = [...completed];
    report.summary = reply;
    const saved = input.trip.itinerary.length
      ? {
          ...structuredClone(input.trip),
          brief: { ...input.trip.brief!, consultation: brief.consultation },
        }
      : trip;
    const previous = saved.planning;
    const combined = previous
      ? {
          ...previous,
          model: report.model,
          mode: report.mode,
          summary: report.summary,
          researchSummary: report.researchSummary,
          generatedAt: isoNow(),
          questions: report.questions,
          agentIds: report.agentIds,
          destinations: report.destinations.length ? report.destinations : previous.destinations,
          places: [
            ...new Map(
              [...previous.places, ...report.places].map((entry) => [entry.id, entry]),
            ).values(),
          ],
          sources: [
            ...new Map(
              [...previous.sources, ...report.sources].map((entry) => [entry.id, entry]),
            ).values(),
          ],
        }
      : report;
    saved.destinations = [
      ...new Map(
        [...(saved.destinations || []), ...report.destinations].map((entry) => [entry.id, entry]),
      ).values(),
    ];
    saved.planning = combined;
    return { trip: saved, reply, mode: report.mode, report: combined };
  };
  if (hasAI && intent === 'clarify') {
    question('destination', intakeReply || 'Which city and country should I plan for?');
    emit('destinations', 'skipped', 'Waiting for clarification.');
    emit('places', 'skipped', 'Waiting for clarification.');
    return finishConversation(intakeReply || 'Which city and country should I plan for?');
  }
  if (
    intent === 'plan' &&
    trip.startDate &&
    trip.startDate < new Date().toISOString().slice(0, 10)
  ) {
    report.questions = [
      {
        field: 'dates',
        question: `That start date (${trip.startDate}) has passed. What future date should I plan for?`,
        suggestions: [],
      },
    ];
    return finishConversation(report.questions[0].question);
  }
  if (intent === 'plan' && !input.trip.itinerary.length) {
    const pending = getConsultationQuestions(trip, brief, 20)
      .filter((entry) => !['nationality', 'flight_dates'].includes(entry.field))
      .slice(0, 2);
    if (pending.length) {
      report.questions = pending;
      emit('destinations', 'skipped', 'Confirming your brief before research.');
      emit('places', 'skipped', 'Research will use your confirmed preferences.');
      const names =
        destinationRequests.map((entry) => entry.name).join(' and ') ||
        brief.consultation?.route?.map((entry) => entry.name).join(' and ') ||
        findDestination(trip.destinationId, trip)?.name;
      const intro = !input.trip.messages.length
        ? names
          ? `I can help plan ${names}.`
          : 'I can help you plan that.'
        : 'Thanks — I’ve saved those details.';
      return finishConversation(
        `${intro}\n\n${pending.map((entry) => entry.question).join('\n\n')}`,
      );
    }
  }
  emit(
    'destinations',
    'running',
    hasAI
      ? 'Resolving your destinations with live web research.'
      : 'Checking the order of your stops.',
  );
  if (hasAI) {
    emit(
      'places',
      'running',
      'Searching current sources for places that fit your dates and preferences.',
    );
    const researchInput = { trip, message: input.message, brief, destinationRequests, intent };
    let researched;
    try {
      researched = await researchDestinations(researchInput, signal);
    } catch (error) {
      signal?.throwIfAborted();
      const reason = planningFailureReason(error);
      // One new, independently validated research attempt. Never retry supplier mutations,
      // authentication failures or arbitrary application errors here.
      if (
        !reason.startsWith('research_') &&
        !['model_schema', 'model_json', 'model_incomplete'].includes(reason)
      )
        throw error;
      console.info('Research validation retry', { reason });
      emit('places', 'running', 'Rechecking sources before adding them to your plan.');
      researched = await researchDestinations(
        { ...researchInput, validationFeedback: reason },
        signal,
      );
    }
    signal?.throwIfAborted();
    report.destinations = researched.destinations;
    report.places = researched.places;
    report.sources = researched.sources;
    report.researchSummary = researched.summary;
    researched.questions.forEach((text) => question('destination', text));
    emit(
      'destinations',
      researched.destinations.length ? 'completed' : 'skipped',
      researched.destinations.map((entry) => `${entry.name}, ${entry.country}`).join(' → ') ||
        'A destination detail needs clarification.',
    );
    emit(
      'places',
      researched.sources.length ? 'completed' : 'skipped',
      `${researched.places.length} place suggestions; ${researched.sources.length} web sources checked.`,
    );
    if (intent !== 'plan' || !researched.destinations.length)
      return finishConversation(researched.reply || intakeReply || researched.questions.join(' '));
    if (researched.destinations.length !== destinationRequests.length)
      throw new Error(
        'Destination research did not resolve every requested stop. Your saved trip is unchanged.',
      );
    trip.destinations = [
      ...new Map(
        [...(trip.destinations || []), ...researched.destinations].map((entry) => [
          entry.id,
          entry,
        ]),
      ).values(),
    ];
    brief.destinationStops = researched.destinations.map((destination, index) => ({
      destinationId: destination.id,
      days: destinationRequests[index].days,
    }));
    brief.destinationStops = allocatedStops(trip, brief);
    trip.destinationId = brief.destinationStops[0]?.destinationId || '';
    trip.brief = brief;
  } else {
    report.destinations = brief.destinationStops
      .map((stop) => findDestination(stop.destinationId, trip)!)
      .filter(Boolean);
    emit(
      'destinations',
      report.destinations.length ? 'completed' : 'skipped',
      report.destinations.map((entry) => entry.name).join(' → ') ||
        'Waiting for your destination choice.',
    );
  }
  if (!report.destinations.length) {
    question(
      'destination',
      'Which destination would you like to explore?',
      destinations.slice(0, 6).map((entry) => entry.name),
    );
    emit('places', 'skipped', 'Choose a destination to continue.');
    if (intent === 'discover') {
      const preferred = destinations.filter((entry) =>
        trip.interests.some((interest) =>
          [...entry.tags, entry.vibe].join(' ').toLowerCase().includes(interest.toLowerCase()),
        ),
      );
      const ideas = (preferred.length ? preferred : destinations).slice(0, 3);
      return finishConversation(
        `A few starting points: ${ideas.map((entry) => `${entry.name}, ${entry.country}`).join('; ')}.\n\nWhich appeals to you? These are curated ideas; live destination research is currently unavailable.`,
      );
    }
    return finishConversation('Where would you like to go?');
  }
  for (const pending of getConsultationQuestions(trip, brief, 3))
    question(pending.field, pending.question, pending.suggestions);
  trip.title =
    `${report.destinations.map((entry) => entry.name).join(' & ')} · ${trip.days} days`.slice(
      0,
      120,
    );
  if (report.destinations.length > 1) {
    report.budget.unpriced.push('Travel between destinations');
    issue(
      'transfer_unconfirmed',
      'A transfer day is reserved between destinations. Choose and confirm each connection; its timing and cost are not included.',
    );
  }
  if (!trip.startDate && brief.consultation?.facts.dates?.valueState !== 'flexible')
    question('dates', 'What date will you arrive at your first destination?');
  if (!hasAI)
    source({
      id: 'catalog-places',
      kind: 'catalog',
      label: 'Asktara curated destination ideas',
      status: 'curated',
    });
  report.assumptions.push(
    'Activity and meal costs are estimates in USD per person; the budget breakdown multiplies them by the group size.',
    'Durations and travel buffers are planning estimates. Straight-line distances help group places; road routes and transport schedules have not been verified.',
    'Place opening hours, where supplied, are a research snapshot. Confirm the exact date, admission and reservations before travel.',
  );
  await Promise.all([
    (async () => {
      if (!hasAI) {
        emit('places', 'running', 'Gathering a varied set of sights and experiences.');
        report.places = curatedPlaces(report.destinations.map((entry) => entry.id));
      }
      if (process.env.GOOGLE_PLACES_API_KEY) {
        const researched = await Promise.all(
          report.destinations.map(async (destination) => {
            try {
              const places = await researchGooglePlaces(
                destination.id,
                trip.interests,
                signal,
                destination,
              );
              signal?.throwIfAborted();
              if (places.length)
                source({
                  id: `google-places-${destination.id}`,
                  kind: 'google_places',
                  label: `Google Places · ${destination.name}`,
                  url: 'https://maps.google.com/',
                  status: 'live',
                });
              return places;
            } catch {
              signal?.throwIfAborted();
              issue(
                'places_fallback',
                `Live place research for ${destination.name} was unavailable. The other sourced suggestions are retained.`,
              );
              return [];
            }
          }),
        );
        const live = researched.flat();
        const liveNames = new Set(
          live.map((entry) => `${entry.destinationId}:${entry.name.toLowerCase()}`),
        );
        report.places = [
          ...live,
          ...report.places.filter(
            (entry) => !liveNames.has(`${entry.destinationId}:${entry.name.toLowerCase()}`),
          ),
        ];
      }
      if (!hasAI || process.env.GOOGLE_PLACES_API_KEY)
        emit(
          'places',
          'completed',
          `${report.places.length} researched or curated ideas, each with its source.`,
        );
    })(),
    (async () => {
      const hotelStatus = brief.consultation!.services.hotels.status;
      if (hotelStatus === 'not_needed' || hotelStatus === 'already_booked') {
        emit(
          'stays',
          'skipped',
          hotelStatus === 'already_booked'
            ? 'You said accommodation is already arranged.'
            : 'You asked to leave accommodation out.',
        );
        return;
      }
      emit('stays', 'running', 'Checking accommodation needs and a stay allowance.');
      if (!hasAI)
        source({
          id: 'catalog-stays',
          kind: 'catalog',
          label: 'Illustrative stays and nightly allowances',
          status: 'curated',
        });
      const rooms = Math.ceil(trip.travelers / 2);
      let offset = 0;
      for (let index = 0; index < brief.destinationStops.length; index++) {
        const stop = brief.destinationStops[index];
        const nights = Math.max(
          0,
          stop.days - (index === brief.destinationStops.length - 1 ? 1 : 0),
        );
        const sample = !hasAI
          ? stays.find((entry) => entry.destinationId === stop.destinationId)
          : undefined;
        let allowance = (sample?.price || 0) * nights * rooms;
        if (sample)
          report.stays.push({
            id: sample.id,
            destinationId: stop.destinationId,
            name: sample.name,
            description:
              'Fictional inspiration stay. This nightly room allowance is not a hotel offer or availability.',
            image: sample.image,
            price: sample.price,
            currency: 'USD',
            basis: 'night',
            sourceId: 'catalog-stays',
          });
        if (
          brief.includeHotels &&
          process.env.LITEAPI_API_KEY &&
          trip.startDate &&
          brief.guestNationality &&
          nights > 0 &&
          confirmedAdultParty
        ) {
          const query = hotelSearchSchema.safeParse({
            destinationId: stop.destinationId,
            checkin: addDays(trip.startDate, offset),
            checkout: addDays(trip.startDate, offset + nights),
            adults: trip.travelers,
            guestNationality: brief.guestNationality,
          });
          if (query.success)
            try {
              const result = await searchHotels(
                query.data,
                signal,
                findDestination(stop.destinationId, trip),
              );
              signal?.throwIfAborted();
              const sourceId = `liteapi-${stop.destinationId}`;
              if (result.offers.length) {
                source({
                  id: sourceId,
                  kind: 'liteapi',
                  label: `LiteAPI ${result.mode === 'live' ? 'hotel quotes' : result.mode === 'test' ? 'test hotel rates' : 'unverified environment hotel rates'}`,
                  status:
                    result.mode === 'live'
                      ? 'live'
                      : result.mode === 'test'
                        ? 'test'
                        : 'unverified',
                  url: 'https://www.liteapi.travel/',
                });
                report.stays = report.stays.filter(
                  (entry) => entry.destinationId !== stop.destinationId,
                );
                report.stays.push(
                  ...result.offers.slice(0, 3).map((offer): ResearchStay => ({
                    id: offer.id,
                    destinationId: stop.destinationId,
                    name: offer.name,
                    description: `${offer.room}${offer.board ? ` · ${offer.board}` : ''}. ${result.warning}`,
                    image: offer.image,
                    price: offer.price,
                    currency: offer.currency,
                    basis: 'stay',
                    sourceId,
                  })),
                );
                const usd =
                  result.mode === 'live'
                    ? result.offers
                        .filter((offer) => offer.currency === 'USD')
                        .map((offer) => offer.price)
                    : [];
                if (usd.length) allowance = Math.min(...usd);
                else
                  issue(
                    'hotel_estimate',
                    'These hotel rates are test or unverified results and are excluded from the trip budget. Accommodation still needs live pricing.',
                  );
              } else
                issue(
                  'hotel_no_results',
                  `No hotel offers were returned for ${findDestination(stop.destinationId, trip)?.name}. Accommodation still needs pricing.`,
                );
            } catch {
              signal?.throwIfAborted();
              issue(
                'hotels_fallback',
                'Hotel search could not be completed. Check the budget panel for any unpriced accommodation.',
              );
            }
          else
            issue(
              'hotels_requirements',
              'Hotel search requires future dates and a group of at most six adults. Your itinerary is still available.',
            );
        }
        if (nights > 0 && !sample && allowance === 0) {
          const name = findDestination(stop.destinationId, trip)?.name;
          report.budget.unpriced.push(`Accommodation${name ? ` in ${name}` : ''}`);
          issue(
            'accommodation_unpriced',
            `Accommodation${name ? ` in ${name}` : ''} has no available estimate or live quote and is excluded from the estimated total.`,
          );
        }
        report.budget.accommodation += allowance;
        offset += stop.days;
      }
      report.assumptions.push(
        `Accommodation allows ${Math.max(0, trip.days - 1)} nights and ${rooms} ${rooms === 1 ? 'room' : 'rooms'} at two travelers per room unless a live rate for the full group is available. No accommodation is reserved.`,
      );
      if (brief.includeHotels && !brief.guestNationality)
        question(
          'nationality',
          'What is the lead guest’s two-letter nationality code for hotel rates?',
          [],
        );
      if (brief.includeHotels && !process.env.LITEAPI_API_KEY)
        issue(
          'hotels_not_connected',
          'Hotel search is not connected. Accommodation needs pricing; any local allowances are labelled estimates.',
        );
      emit(
        'stays',
        'completed',
        brief.includeHotels && report.sources.some((entry) => entry.kind === 'liteapi')
          ? 'Hotel provider results are ready, with environment and pricing labels.'
          : report.budget.unpriced.some((entry) => entry.startsWith('Accommodation'))
            ? 'Accommodation still needs pricing; missing costs are listed separately.'
            : 'An accommodation allowance is included; live availability is not confirmed.',
      );
    })(),
    (async () => {
      if (!brief.includeFlights) {
        const status = brief.consultation!.services.flights.status;
        if (status === 'unknown') report.budget.unpriced.push('Flights — needs not discussed');
        emit(
          'flights',
          'skipped',
          status === 'already_booked'
            ? 'You said flights are already arranged.'
            : status === 'not_needed'
              ? 'You asked to leave flights out.'
              : 'Flight needs have not been discussed yet.',
        );
        return;
      }
      emit('flights', 'running', 'Checking the airports, dates and available flight connection.');
      if (!brief.originAirport || !brief.arrivalAirport)
        question(
          'origin',
          !brief.originAirport
            ? 'Which city or airport would you like to fly from?'
            : 'Which arrival airport would you prefer? You can give its name or three-letter code.',
          [],
        );
      const journey = brief.consultation?.flightJourney;
      const flightDatesReady =
        journey &&
        journey.type !== 'unknown' &&
        journey.departureDate &&
        (journey.type !== 'return' || journey.returnDate);
      if (!flightDatesReady)
        question(
          'flight_dates',
          'Are these one-way or return flights, and what dates would you like to fly? Your holiday dates may differ.',
        );
      if (!process.env.DUFFEL_ACCESS_TOKEN && !process.env.LITEAPI_API_KEY)
        issue(
          'flights_not_connected',
          'Live flight search is not connected. Add LITEAPI_API_KEY (or DUFFEL_ACCESS_TOKEN) to enable flight quotes.',
        );
      if (brief.destinationStops.length > 1 || journey?.type === 'multi_city')
        issue(
          'flights_multicity',
          'This flight tool searches single-destination return journeys. Search and arrange the connections for this multi-destination route separately.',
        );
      const query = flightSearchSchema.safeParse({
        origin: brief.originAirport,
        destination: brief.arrivalAirport,
        departureDate: journey?.departureDate || '',
        returnDate: journey?.type === 'return' ? journey.returnDate || undefined : undefined,
        adults: trip.travelers,
        cabinClass: journey?.cabinClass || 'economy',
      });
      if (
        (process.env.DUFFEL_ACCESS_TOKEN || process.env.LITEAPI_API_KEY) &&
        query.success &&
        flightDatesReady &&
        journey?.type !== 'multi_city' &&
        brief.destinationStops.length === 1 &&
        confirmedAdultParty
      ) {
        try {
          const result = await searchFlights(query.data, signal);
          signal?.throwIfAborted();
          report.flights = result.offers.slice(0, 5);
          const sourceLabel = result.source === 'liteapi' ? 'LiteAPI' : 'Duffel';
          const sourceId = `${result.source}-flights`;
          source({
            id: sourceId,
            kind: result.source,
            label:
              result.mode === 'test'
                ? `${sourceLabel} test flight offers`
                : result.mode === 'live'
                  ? `${sourceLabel} live flight offers`
                  : `${sourceLabel} unverified environment flight offers`,
            status:
              result.mode === 'test' ? 'test' : result.mode === 'live' ? 'live' : 'unverified',
            url:
              result.source === 'liteapi' ? 'https://www.liteapi.travel/' : 'https://duffel.com/',
          });
          if (result.mode === 'live') {
            const usd = result.offers
              .filter((offer) => offer.currency === 'USD')
              .map((offer) => offer.price);
            if (usd.length) report.budget.flights = Math.min(...usd);
          }
          if (result.mode === 'test')
            issue(
              'test_flights',
              'These flight offers are simulated test results; their prices are excluded from the trip budget.',
            );
          report.assumptions.push(
            'Flight quotes cover the explicitly requested journey for the confirmed adult group. Arrival-day timing, baggage and fare rules require review before booking.',
          );
          if (!result.offers.length)
            issue('flight_no_results', 'The provider returned no matching flight offers.');
        } catch {
          signal?.throwIfAborted();
          issue(
            'flights_fallback',
            'The flight provider could not complete this search. No flight cost is included.',
          );
        }
      } else if (brief.originAirport && brief.arrivalAirport && trip.startDate && !query.success)
        issue(
          'flight_requirements',
          'Flight search requires different airport codes, future dates and a group of at most nine adults.',
        );
      if (report.budget.flights === null) report.budget.unpriced.push('Flights');
      emit(
        'flights',
        report.flights.length ? 'completed' : 'skipped',
        report.flights.length
          ? `${report.flights.length} flight options returned; no booking made.`
          : 'No confirmed live flight cost is included.',
      );
    })(),
  ]);
  if (hasAI) {
    emit(
      'verification',
      'running',
      'Checking current venue notices and closures against your travel dates.',
    );
    const verified = await verifyResearchPlaces(
      { trip, brief, places: report.places, sources: report.sources },
      signal,
    );
    signal?.throwIfAborted();
    report.places = verified.places;
    report.destinations = report.destinations.map((destination) => ({
      ...destination,
      highlights: destination.highlights.filter((name) =>
        report.places.some(
          (place) => place.destinationId === destination.id && place.name === name,
        ),
      ),
    }));
    trip.destinations = trip.destinations?.map(
      (destination) =>
        report.destinations.find((entry) => entry.id === destination.id) || destination,
    );
    report.sources = [
      ...new Map(
        [...report.sources, ...verified.sources].map((entry) => [entry.id, entry]),
      ).values(),
    ];
    report.issues.push(...verified.issues);
    if (verified.issues.some((entry) => entry.code === 'place_closed_excluded'))
      report.researchSummary = [
        report.researchSummary,
        ...verified.issues
          .filter(
            (entry) =>
              entry.code === 'place_closed_excluded' || entry.code === 'protected_closed_place',
          )
          .map((entry) => entry.message),
      ]
        .filter(Boolean)
        .join('\n\n');
    emit(
      'verification',
      'completed',
      `${report.places.length} suggestions retained after checking current notices; ${verified.issues.filter((entry) => entry.code === 'place_closed_excluded').length} closed venues excluded.`,
    );
  }
  signal?.throwIfAborted();
  emit(
    'itinerary',
    'running',
    'Grouping places and making room for meals, travel and protected stops.',
  );
  let composition: CompositionDay[] | undefined;
  let personalizedSummary = '';
  if (process.env.OPENAI_API_KEY && !modelFailed) {
    try {
      const composed = await modelComposition(
        { ...trip, itinerary: input.trip.itinerary, planning: report },
        brief,
        report.places,
        input.message,
        signal,
      );
      signal?.throwIfAborted();
      composition = composed.days;
      personalizedSummary = composed.summary;
      modelUsed = true;
    } catch {
      signal?.throwIfAborted();
      modelFailed = true;
      issue(
        'composition_fallback',
        'The AI composition could not be completed. Your researched places were scheduled with the local planner.',
      );
    }
  }
  trip.itinerary = buildLocalItinerary(trip, brief, report.places, composition);
  trip = preserveLockedStops(input.trip, trip);
  itinerarySchema.parse(trip.itinerary);
  trip.updatedAt = isoNow();
  emit(
    'itinerary',
    'completed',
    `${trip.itinerary.length} days created; protected stops kept in place.`,
  );
  emit('review', 'running', 'Checking timing, duplicates, protected stops and the group budget.');
  reviewPlan(input.trip, trip, report);
  report.mode = modelUsed ? 'live' : 'local';
  const names = report.destinations.map((entry) => entry.name).join(' & ');
  report.summary =
    personalizedSummary ||
    `${trip.days} days in ${names}, at a ${brief.pace} pace. ${report.issues.filter((entry) => entry.severity !== 'info').length ? 'Review the notes before confirming your plans.' : 'The schedule passes the automated timing and consistency checks.'}`;
  emit(
    'review',
    'completed',
    `${report.issues.filter((entry) => entry.severity !== 'info').length} planning notes; ${report.questions.length} ${report.questions.length === 1 ? 'detail' : 'details'} still to confirm.`,
  );
  report.agentIds = [...completed];
  report.generatedAt = isoNow();
  trip.planning = report;
  report.questions = report.questions.slice(0, 2);
  const questions = report.questions.length
    ? `\n\n${report.questions.map((entry) => entry.question).join('\n\n')}`
    : '';
  const warning = modelFailed
    ? 'AI planning was partially unavailable, so the local planner completed the missing steps. Review the planning notes.'
    : !modelUsed
      ? 'Local planner: curated destination knowledge and deterministic scheduling. Connect OpenAI to enable conversational AI specialists.'
      : undefined;
  return {
    trip,
    mode: report.mode,
    report,
    warning,
    reply: personalizedSummary
      ? `${personalizedSummary}${questions}${report.sources.some((entry) => entry.status === 'test') ? '\n\nSupplier offers are sandbox examples.' : ''}`
      : `${input.trip.itinerary.length ? 'I’ve updated' : 'I’ve put together'} your ${trip.days}-day ${names} itinerary. Open the trip details for the daily plan, sources and estimated costs.${questions}`,
  };
}
