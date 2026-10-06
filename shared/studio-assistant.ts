import type { StudioWorkspace } from './studio';

export type StudioAssistantActionKind =
  | 'answer'
  | 'approve_route'
  | 'hotels'
  | 'flights'
  | 'cruises'
  | 'activities'
  | 'food'
  | 'generate_itinerary'
  | 'preview'
  | 'destinations';
export interface StudioAssistantAction {
  id: string;
  label: string;
  detail: string;
  kind: StudioAssistantActionKind;
  questionId?: string;
  stopId?: string;
  disabledReason?: string;
  choices?: { label: string; message: string }[];
}

/** Grounded UI controls, not model instructions or authorisation to book/publish. */
export function buildStudioAssistantActions(workspace: StudioWorkspace): StudioAssistantAction[] {
  if (workspace.clarification)
    return [
      {
        id: 'confirm-stay-dates',
        kind: 'answer',
        questionId: 'clarification',
        stopId: workspace.clarification.stopId,
        label: 'Confirm stay dates',
        detail: 'Confirm the proposed date range before planning around it.',
        choices: [
          { label: 'Use these dates', message: 'Yes, use the proposed stay dates.' },
          { label: 'Keep the nights', message: 'No, keep the stated number of nights.' },
        ],
      },
    ];
  const actions: StudioAssistantAction[] = [];
  const addAnswer = (questionId: string, label: string, detail: string, stopId?: string) =>
    actions.push({
      id: `answer-${questionId}${stopId ? `-${stopId}` : ''}`,
      kind: 'answer',
      questionId,
      label,
      detail,
      ...(stopId ? { stopId } : {}),
    });
  if (!workspace.stops.length && !workspace.cruises?.length) {
    actions.push({
      id: 'destination-ideas',
      kind: 'destinations',
      label: 'Recommend destinations',
      detail:
        'Research current advice and ideas using this client’s stated interests and travel feedback.',
    });
    addAnswer('route', 'Choose a destination', 'Tell Tara where this trip should go.');
    return actions;
  }
  const missingNights = workspace.stops.find((stop) => stop.nights === null);
  if (missingNights)
    addAnswer(
      'nights',
      `Nights in ${missingNights.name}`,
      'Confirm this stay length without assuming hotel nights from trip days.',
      missingNights.id,
    );
  else if (!workspace.structureAccepted)
    actions.push({
      id: 'approve-route',
      kind: 'approve_route',
      label: 'Use this route',
      detail: 'Confirm these destinations and stay lengths so services use the right route.',
    });
  if (!workspace.brief.startDate)
    addAnswer(
      'startDate',
      'Set travel dates',
      'Confirm arrival dates; flight departure is a separate date.',
    );
  else if (workspace.brief.adults === null)
    addAnswer(
      'adults',
      'Who is travelling?',
      'Confirm this trip’s adults and children; past parties are not reused.',
    );
  else if (workspace.brief.children === null)
    addAnswer(
      'children',
      'Confirm children',
      'State the children travelling, including zero when it is an adults-only trip.',
    );
  else if (
    workspace.brief.children > 0 &&
    workspace.brief.childAges.length !== workspace.brief.children
  )
    addAnswer('childAges', 'Child ages', 'Hotel room availability needs an age for every child.');
  if (!missingNights && workspace.structureAccepted && !workspace.itinerary)
    actions.push({
      id: 'generate-itinerary',
      kind: 'generate_itinerary',
      label: 'Build daily itinerary',
      detail:
        'Draft activities around the confirmed route, current preferences and available seasonal guidance.',
    });
  if (workspace.structureAccepted) {
    const hotelStops = workspace.stops.filter((stop) => stop.nights !== null && stop.nights > 0);
    const unselectedHotelStops = hotelStops.filter(
      (stop) =>
        !workspace.items.some(
          (item) =>
            item.kind === 'hotel' && item.included && !item.needsReview && item.stopId === stop.id,
        ),
    );
    for (const stop of unselectedHotelStops.slice(0, 1))
      actions.push({
        id: `hotels-${stop.id}`,
        kind: 'hotels',
        stopId: stop.id,
        label: `Hotels in ${stop.name}`,
        detail:
          'Search supplier rooms and choose a quote for the proposal; selection does not reserve a room.',
      });
    if (workspace.stops.length)
      actions.push({
        id: 'flights',
        kind: 'flights',
        label: 'Find flights',
        detail:
          'Use explicitly selected airports, flight dates and passenger count; inspect supplied segments and connections.',
      });
    actions.push(
      {
        id: 'activities',
        kind: 'activities',
        label: 'Things to do',
        detail: 'Research sourced activities for the chosen destinations.',
      },
      {
        id: 'food',
        kind: 'food',
        label: 'Food ideas',
        detail: 'Research options using stated food preferences.',
      },
      {
        id: 'preview-proposal',
        kind: 'preview',
        label: 'Preview proposal',
        detail: 'Preview saved choices. Publication and booking require separate explicit actions.',
      },
    );
  }
  if (
    workspace.structureAccepted ||
    workspace.brief.outboundTransport === 'cruise' ||
    workspace.brief.returnTransport === 'cruise'
  )
    actions.push({
      id: 'cruise',
      kind: 'cruises',
      label: 'Add cruise sailing',
      detail:
        'Supply a real sailing or schedule to review; do not invent a ship, port order or fare.',
    });
  if (!workspace.brief.passportNationality)
    addAnswer(
      'passportNationality',
      'Passport country',
      'Declare the passport used for this trip so automatic entry checks can run.',
    );
  if (!workspace.brief.tripPurpose || workspace.brief.tripPurpose === 'undecided')
    addAnswer(
      'tripPurpose',
      'Travel purpose',
      'Entry requirements differ for tourism, business, study and employment.',
    );
  if (workspace.brief.budget === null)
    addAnswer(
      'budget',
      'Set a budget',
      'State the budget and currency, or keep it open while drafting.',
    );
  if (!missingNights && workspace.structureAccepted && workspace.itinerary)
    actions.push({
      id: 'generate-itinerary',
      kind: 'generate_itinerary',
      label: 'Update daily itinerary',
      detail:
        'Explicitly request a researched revision of the existing plan; review your manual edits before replacing activities.',
    });
  // One hotel chip opens the destination picker, leaving every missing field reachable.
  return actions;
}
