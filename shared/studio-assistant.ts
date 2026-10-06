import type { StudioQuestion, StudioWorkspace } from './studio';

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
  | 'destinations'
  | 'journey';
export interface StudioAssistantAction {
  id: string;
  label: string;
  detail: string;
  kind: StudioAssistantActionKind;
  questionId?: string;
  stopId?: string;
  direction?: 'outbound' | 'return';
  mode?: 'flight' | 'cruise';
  disabledReason?: string;
  choices?: { label: string; message: string }[];
}

/** Current-trip arrangements take precedence over generic service suggestions. */
export function studioFlightsArrangedExternally(workspace: StudioWorkspace): boolean {
  let external = false;
  const instructions = [
    workspace.brief.request,
    ...workspace.messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content),
  ];
  for (const instruction of instructions)
    for (const clause of instruction.split(/[.;!?\n]|\bbut\b/i)) {
      if (!/\b(?:flights?|airfare)\b/i.test(clause)) continue;
      const declined =
        /\b(?:no|skip|exclude|without|out of scope)\s+(?:(?:any|the|my|our)\s+)?(?:flights?|airfare)\b|\b(?:do not|don't|won't|will not)\s+(?:need|want|include|search(?: for)?|find|arrange)\s+(?:(?:any|the|my|our)\s+)?(?:flights?|airfare)\b/i.test(
          clause,
        );
      const separate =
        !/\b(?:not|never|haven't|have not|not yet|maybe|possibly|might)\b/i.test(clause) &&
        (/\b(?:flights?|airfare)\b.{0,80}\b(?:already booked|already arranged|already sorted|booked|arranged|sorted|separately|out of scope|excluded)\b/i.test(
          clause,
        ) ||
          /\b(?:already booked|already arranged|already sorted|arrange (?:my|our|their) own|handle (?:my|our|their) own)\b.{0,45}\b(?:flights?|airfare)\b/i.test(
            clause,
          ));
      if (declined || separate) external = true;
      else if (
        !/\b(?:not|no|don't|do not|maybe|possibly|might)\b/i.test(clause) &&
        /\b(?:find|search(?: for)?|compare|include|need|want)\b.{0,45}\b(?:flights?|airfare)\b/i.test(
          clause,
        )
      )
        external = false;
    }
  return external;
}

/** Known trip facts are never turned back into compulsory intake questions. */
export function buildStudioGuidedQuestions(workspace: StudioWorkspace): StudioQuestion[] {
  const brief = workspace.brief;
  const externallyArranged = studioFlightsArrangedExternally(workspace);
  const cruiseRequested =
    brief.outboundTransport === 'cruise' || brief.returnTransport === 'cruise';
  const known: Record<string, boolean> = {
    route: Boolean(workspace.stops.length || workspace.cruises?.length),
    origin: Boolean(brief.origin.trim()),
    departureDate: Boolean(brief.departureDate || brief.datesFlexible),
    returnDepartureDate: Boolean(brief.returnDepartureDate || brief.datesFlexible),
    tripDays: brief.tripDays != null,
    startDate: Boolean(brief.startDate || brief.datesFlexible),
    adults: brief.adults !== null,
    children: brief.children !== null,
    childAges:
      brief.children === 0 ||
      (brief.children !== null && brief.childAges.length === brief.children),
    nights: Boolean(
      workspace.stops.length && workspace.stops.every((stop) => stop.nights !== null),
    ),
    passportNationality: Boolean(brief.passportNationality),
    tripPurpose: Boolean(brief.tripPurpose && brief.tripPurpose !== 'undecided'),
    tripType: Boolean(brief.tripType && brief.tripType !== 'undecided'),
    outboundTransport: Boolean(brief.outboundTransport && brief.outboundTransport !== 'undecided'),
    returnTransport: Boolean(brief.returnTransport && brief.returnTransport !== 'undecided'),
    budget: brief.budget !== null,
    hotelStandard: Boolean(brief.hotelStandard.trim()),
  };
  const questions = workspace.qualification.questions.filter(
    (question) =>
      !known[question.id] &&
      !(
        externallyArranged &&
        !cruiseRequested &&
        ['origin', 'departureDate', 'outboundTransport', 'returnTransport'].includes(question.id)
      ),
  );
  const add = (question: StudioQuestion) => {
    if (!known[question.id] && !questions.some((existing) => existing.id === question.id))
      questions.push(question);
  };
  // With arrival still open, establish the outward journey before asking for it.
  // Existing confirmed stay dates can still be edited without redoing transport intake.
  if (!brief.startDate && (!externallyArranged || cruiseRequested)) {
    add({
      id: 'outboundTransport',
      label: 'How would you like to travel there?',
      reason: 'Choose a flight or cruise to explore outward routes before setting the arrival.',
      required: false,
    });
    add({
      id: 'origin',
      label: 'Where will you depart from?',
      reason: 'A city, airport or port is enough to research possible routes.',
      required: false,
    });
    add({
      id: 'departureDate',
      label: 'When would you like to depart?',
      reason: 'This is departure from your origin. Arrival is confirmed from the travel schedule.',
      required: false,
    });
  }
  add({
    id: 'tripPurpose',
    label: 'What is this trip for?',
    reason: 'Entry requirements depend on the purpose of the visit.',
    required: false,
  });
  const priority =
    !brief.startDate && !externallyArranged
      ? [
          'route',
          'outboundTransport',
          'origin',
          'departureDate',
          'tripDays',
          'returnTransport',
          'returnDepartureDate',
          'adults',
          'children',
          'childAges',
          'startDate',
          'nights',
          'passportNationality',
          'tripPurpose',
          'tripType',
          'budget',
          'hotelStandard',
        ]
      : [
          'route',
          'adults',
          'children',
          'childAges',
          'startDate',
          'nights',
          'passportNationality',
          'tripPurpose',
          'tripType',
          'tripDays',
          'budget',
          'hotelStandard',
          'outboundTransport',
          'returnTransport',
          'origin',
          'departureDate',
          'returnDepartureDate',
        ];
  const order = (id: string) => (priority.includes(id) ? priority.indexOf(id) : priority.length);
  return questions.sort((left, right) => order(left.id) - order(right.id));
}

/** Grounded UI controls, not model instructions or authorisation to book/publish. */
export function buildStudioAssistantActions(workspace: StudioWorkspace): StudioAssistantAction[] {
  if (workspace.clarification) {
    const pending = workspace.clarification;
    const stop = workspace.stops.find((entry) => entry.id === pending.stopId);
    const chosenDates = (nights: number) =>
      `Use arrival ${pending.arrivalDate} and return ${new Date(Date.parse(pending.arrivalDate) + nights * 86400000).toISOString().slice(0, 10)} for ${nights} nights${stop ? ` in ${stop.name}` : ''}.`;
    return [
      {
        id: 'confirm-stay-dates',
        kind: 'answer',
        questionId: 'clarification',
        stopId: workspace.clarification.stopId,
        label: 'Confirm stay dates',
        detail: 'Confirm the proposed date range before planning around it.',
        choices: [
          { label: 'Use these dates', message: chosenDates(pending.proposedNights) },
          { label: 'Keep the nights', message: chosenDates(pending.statedNights) },
        ],
      },
    ];
  }
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
  const destinationKnown = Boolean(
    workspace.stops.length || workspace.cruises?.length || workspace.brief.preferredDestination,
  );
  if (!destinationKnown) {
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
  const externalFlights = studioFlightsArrangedExternally(workspace);
  if (
    !workspace.structureAccepted &&
    (!externalFlights ||
      workspace.brief.outboundTransport === 'cruise' ||
      workspace.brief.returnTransport === 'cruise')
  ) {
    const outward: StudioAssistantAction[] = [];
    if (!externalFlights)
      outward.push({
        id: 'journey-outbound-flight',
        kind: 'journey',
        direction: 'outbound',
        mode: 'flight',
        label: 'Explore flight routes',
        detail: 'Compare sourced routes and connections before confirming the arrival date.',
      });
    outward.push({
      id: 'journey-outbound-cruise',
      kind: 'journey',
      direction: 'outbound',
      mode: 'cruise',
      label: 'Explore cruise routes',
      detail: 'Explore real operators and ports; a sailing schedule confirms travel dates.',
    });
    if (workspace.brief.outboundTransport === 'cruise') outward.reverse();
    actions.push(...outward);
    if (!externalFlights || workspace.brief.returnTransport === 'cruise')
      actions.push({
        id: 'journey-return',
        kind: 'journey',
        direction: 'return',
        ...(workspace.brief.returnTransport === 'flight' ||
        workspace.brief.returnTransport === 'cruise'
          ? { mode: workspace.brief.returnTransport }
          : {}),
        label: 'Plan return travel',
        detail: 'Compare the return separately, including a different travel mode.',
      });
  }
  if (!workspace.stops.length && !workspace.cruises?.length)
    addAnswer(
      'route',
      'Review the destination',
      'Add the destination to the route without assuming stay dates or nights.',
    );
  const missingNights = workspace.stops.find((stop) => stop.nights === null);
  if (missingNights) {
    addAnswer(
      'nights',
      `Nights in ${missingNights.name}`,
      'Confirm this stay length without assuming hotel nights from trip days.',
      missingNights.id,
    );
    if (workspace.stops.length === 1 && missingNights.arrivalDate && workspace.brief.tripDays) {
      const nights = workspace.brief.tripDays - 1;
      actions.at(-1)!.choices = [
        {
          label: `${workspace.brief.tripDays} days at destination · ${nights} ${nights === 1 ? 'night' : 'nights'}`,
          message: `Use ${nights} nights in ${missingNights.name}.`,
        },
      ];
    }
  } else if (!workspace.structureAccepted && (workspace.stops.length || workspace.cruises?.length))
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
    if (
      workspace.stops.length &&
      workspace.brief.children === 0 &&
      !studioFlightsArrangedExternally(workspace)
    )
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
