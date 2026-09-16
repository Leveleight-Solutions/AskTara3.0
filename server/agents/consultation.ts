import {
  defaultConsultation,
  type ConsultationFact,
  type ConsultationField,
  type ConsultationState,
  type ConsultationUpdates,
  type ServiceStatus,
} from '../../shared/consultation.ts';
import type { PlanningQuestion, TravelBrief } from '../../shared/planning.ts';
import type { Trip } from '../../shared/types.ts';
import { consultationSchema, dateSchema } from '../validation.ts';
import { detectDestinationIntent } from '../planner.ts';

const normalise = (value: string) =>
  value.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const count = String.raw`(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)`;
const adultCountPattern = new RegExp(`\\b${count}\\s+adults?\\b`, 'i');
const adultCompositionPattern = new RegExp(
  `\\b${count}\\s+adults?\\b|\\b(?:adults only|only adults|all adults|all (?:travell?ers?|people|guests) are adults)\\b`,
  'i',
);
const months = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`;
const serviceNoun = {
  flights: String.raw`(?:flights?|airfares?|air travel)`,
  hotels: String.raw`(?:hotels?|accommodation|stays?|rooms?)`,
};

function supportedEvidence(message: string, evidence: string): boolean {
  return (
    Boolean(evidence.trim()) &&
    evidence.length <= 500 &&
    normalise(message).includes(normalise(evidence))
  );
}

/** Only explicit service decisions count. A missing/false legacy checkbox is not a decision. */
function serviceDecision(
  message: string,
  service: 'flights' | 'hotels',
): { status: ServiceStatus; evidence: string } | undefined {
  const noun = serviceNoun[service];
  const mentioned = new RegExp(`\\b${noun}\\b`, 'i');
  let result: { status: ServiceStatus; evidence: string } | undefined;
  for (const raw of message.split(/[.!?;\n]|\bbut\b/i)) {
    const text = raw.trim();
    if (!mentioned.test(text) || text.length > 500) continue;
    // Do not turn a question, hypothetical or objection to assumptions into consent.
    if (
      /\b(?:assum(?:e|ing)|if|might|maybe|perhaps|not sure|unsure|whether|do i|do we|should i|should we)\b/i.test(
        text,
      )
    )
      continue;
    // "No flights booked yet" reports an unfinished task, not a declined service.
    if (
      new RegExp(
        `\\bno\\s+${noun}\\s+(?:are\\s+)?booked\\b|\\b${noun}\\s+(?:(?:are|is)\\s+)?(?:not|not yet)\\s+booked\\b`,
        'i',
      ).test(text)
    )
      continue;
    const booked = new RegExp(
      `\\b(?:already\\s+(?:have\\s+)?(?:our\\s+|my\\s+)?(?:booked|sorted)|(?:have|we've|i've)\\s+(?:booked|sorted))\\s+(?:(?:our|my|the)\\s+)?${noun}\\b|\\b${noun}\\s+(?:(?:are|is)\\s+)?(?:already\\s+)?(?:booked|sorted)\\b`,
      'i',
    );
    const declined = new RegExp(
      `\\b(?:no|without|skip|no need for)\\s+${noun}\\b|\\b(?:don't|do not|won't)\\s+(?:need|want|require)\\s+(?:(?:any|the)\\s+)?${noun}\\b|\\b${noun}\\s+(?:(?:are|is)\\s+)?(?:not needed|not required|unnecessary)\\b|\\b(?:book|arrange|sort)\\s+(?:our\\s+|my\\s+|the\\s+)?${noun}\\s+(?:ourselves|myself)\\b`,
      'i',
    );
    const requested = new RegExp(
      `\\b(?:include|find|search|need|want|would like|arrange|book|handle|sort out|help (?:with|booking))\\s+(?:(?:our|my|the|some|return|one-way|one way|both)\\s+)*${noun}\\b|\\b${noun}\\s*,?\\s*(?:please|too|as well)\\b|\\b(?:include|find|need|want|arrange|book)\\s+(?:both\\s+)?(?:${serviceNoun.flights} and ${serviceNoun.hotels}|${serviceNoun.hotels} and ${serviceNoun.flights})\\b`,
      'i',
    );
    if (booked.test(text) && !/\b(?:not|haven't|hasn't|didn't|never)\b/i.test(text))
      result = { status: 'already_booked', evidence: text };
    else if (declined.test(text)) result = { status: 'not_needed', evidence: text };
    else if (requested.test(text) && !/\b(?:not|don't|haven't|never)\b/i.test(text))
      result = { status: 'requested', evidence: text };
  }
  return result;
}

function contextualServices(
  trip: Trip,
  message: string,
): Partial<Record<'flights' | 'hotels', ServiceStatus>> {
  if (/\b(?:itinerary only|just (?:the|an) itinerary|only (?:the|an) itinerary)\b/i.test(message))
    return { flights: 'not_needed', hotels: 'not_needed' };
  const result: Partial<Record<'flights' | 'hotels', ServiceStatus>> = {};
  const previous =
    [...trip.messages].reverse().find((entry) => entry.role === 'assistant')?.content || '';
  const questionText = previous
    .split('?')
    .slice(0, -1)
    .map((sentence) => sentence.split(/[.!]/).at(-1) || '')
    .join(' ');
  const asked = (['flights', 'hotels'] as const).filter((service) =>
    new RegExp(`\\b${serviceNoun[service]}\\b`, 'i').test(questionText),
  );
  const text = normalise(message)
    .replace(/[.!?,]/g, '')
    .trim();
  if (!asked.length || text.length > 100) return result;
  const both = /\b(?:both|neither|all)\b/.test(text);
  let status: ServiceStatus | undefined;
  if (
    /^(?:yes(?: please)?(?: both(?: please)?)?|both(?: please)?|sure(?: please)?|please do|yes help with both)$/.test(
      text,
    )
  )
    status = 'requested';
  else if (/^(?:no(?: thanks| thank you)?|neither(?: thanks)?|no neither(?: thanks)?)$/.test(text))
    status = 'not_needed';
  else if (
    /^(?:(?:they're|they are|it's|it is|both are|all are|we're|we are) )?(?:already )?(?:booked|sorted)(?: already)?$/.test(
      text,
    )
  )
    status = 'already_booked';
  if (status && (asked.length === 1 || both)) for (const service of asked) result[service] = status;
  return result;
}

function confirmsAdultsInContext(trip: Trip, message: string): boolean {
  const answer = normalise(message)
    .replace(/[.!?,]/g, '')
    .trim();
  if (!/^(?:yes|yes please|yes they are|yes we are|correct|that's right)$/.test(answer))
    return false;
  const previous =
    [...trip.messages].reverse().find((entry) => entry.role === 'assistant')?.content || '';
  const questions = previous
    .split('?')
    .slice(0, -1)
    .map((part) => part.split(/[.!]/).at(-1)?.trim() || '');
  const adultQuestion =
    /\bare\s+(?:all\s+)?(?:\d+\s+)?(?:(?:the|your)\s+)?(?:travell?ers|people|guests|passengers)\s+(?:all\s+)?adults\b|\bis everyone\s+(?:travell?ing\s+)?an adult\b/i;
  // A bare "yes" cannot answer two independent yes/no questions at once.
  return (
    questions.some((question) => adultQuestion.test(question)) &&
    !questions.some(
      (question) =>
        !adultQuestion.test(question) &&
        /\b(?:are|is|do|does|would|will|have|has|can|could)\s+(?:you|we|they|everyone|all|your|the)\b/i.test(
          question,
        ),
    )
  );
}

function recordFact(
  state: ConsultationState,
  field: ConsultationField,
  evidence: string,
  valueState: ConsultationFact['valueState'] = 'specified',
) {
  state.facts[field] = { source: 'message', evidence: evidence.trim().slice(0, 500), valueState };
}

function currencyIn(message: string): string | undefined {
  const explicit = message
    .match(/\b(AUD|USD|NZD|CAD|EUR|GBP|JPY|SGD|HKD|PKR|INR|AED|THB|IDR)\b/i)?.[1]
    .toUpperCase();
  if (explicit) return explicit;
  if (/\b(?:Australian dollars?|Aussie dollars?)\b|(?:AU|A)\$/i.test(message)) return 'AUD';
  if (/\b(?:US|U\.S\.|American) dollars?\b|US\$/i.test(message)) return 'USD';
  if (/€|\beuros?\b/i.test(message)) return 'EUR';
  if (/£|\b(?:British pounds?|pounds? sterling)\b/i.test(message)) return 'GBP';
  return undefined;
}

function childAgesIn(message: string): number[] {
  const ages = [...message.matchAll(/\b(\d{1,2})[ -]year[ -]olds?\b/gi)].map((match) =>
    Number(match[1]),
  );
  for (const match of message.matchAll(
    /\b(?:aged?|ages?)\s+(\d{1,2}(?:\s*(?:,|and|&)\s*\d{1,2})*)/gi,
  )) {
    ages.push(...[...match[1].matchAll(/\d+/g)].map((entry) => Number(entry[0])));
  }
  return ages.filter((age) => age >= 0 && age < 18).slice(0, 15);
}

/** Conservatively recover literal customer facts, including from pre-consultation saved chats. */
function applyLiteralMessage(state: ConsultationState, message: string) {
  const destination = detectDestinationIntent(message);
  if (destination.kind === 'explicit') recordFact(state, 'destination', destination.name);
  const duration = message.match(
    new RegExp(`\\b${count}\\s*[- ]?(?:days?|nights?|weeks?)\\b|\\b(?:a|one) week\\b`, 'i'),
  );
  if (duration && !/\bin\s*$/i.test(message.slice(0, duration.index)))
    recordFact(state, 'duration', duration[0]);
  const party = message.match(
    new RegExp(
      `\\b${count}\\s+(?:adults?|travell?ers?|people|persons?|guests?|passengers?)\\b|\\b(?:party|group|family) of ${count}\\b|\\b${count} of us\\b|\\b(?:solo|just me|on my own|by myself|a couple)\\b`,
      'i',
    ),
  );
  if (party) recordFact(state, 'travelers', party[0]);
  const date = message.match(
    new RegExp(
      `\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b(?:${months}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${months}(?:\\s+\\d{4})?)\\b`,
      'i',
    ),
  );
  const flexibleDate = message.match(
    /\b(?:flexible dates?|dates? (?:are )?flexible|no fixed dates?|no dates? yet|anytime)\b/i,
  );
  const monthOnly = message.match(
    new RegExp(
      `\\b(?:in|during|next|this)\\s+(?:(?:early|mid|late)\\s+)?${months}(?:\\s+\\d{4})?\\b`,
      'i',
    ),
  );
  if (flexibleDate) recordFact(state, 'dates', flexibleDate[0], 'flexible');
  else if (date)
    recordFact(state, 'dates', date[0], /\b\d{4}\b/.test(date[0]) ? 'specified' : 'flexible');
  else if (monthOnly) recordFact(state, 'dates', monthOnly[0], 'flexible');
  const budget = message.match(
    /(?:\b(?:AUD|USD|NZD|CAD|EUR|GBP|JPY|SGD|HKD|PKR|INR|AED|THB|IDR)\s*|[$£€])\s*\d[\d,.]*(?:\s*[kK])?\b|\bbudget\s*(?:(?:is|of|around|about|up to)\s+)?\d[\d,.]*/i,
  );
  const flexibleBudget = message.match(
    /\b(?:no fixed budget|flexible budget|budget (?:is )?flexible|no budget limit|budget (?:is )?not decided)\b/i,
  );
  if (flexibleBudget) recordFact(state, 'budget', flexibleBudget[0], 'flexible');
  else if (
    budget &&
    (/\b(?:budget|total|spend|afford|up to|under|limit)\b/i.test(message) ||
      message.trim().replace(/[.!?]$/, '') === budget[0])
  )
    recordFact(state, 'budget', budget[0]);
  const origin = message.match(
    /\b(?:depart(?:ing)?|fly(?:ing)?|leav(?:e|ing)|travel(?:l?ing)?)\s+from\s+([\p{L}][\p{L}\s-]{1,50}?)(?=\s+(?:to|on|for|in|with|and)\b|[,.!?]|$)/iu,
  );
  if (origin) recordFact(state, 'origin', origin[0]);
  const interests = message.match(
    /\b(?:prefer|enjoy|love|interested in|keen on)\s+[^.!?]{2,150}|\b(?:vegetarian|vegan|step-free|wheelchair|quiet places|food and culture|hiking|history|museums)\b/i,
  );
  if (interests) recordFact(state, 'interests', interests[0]);
  for (const service of ['flights', 'hotels'] as const) {
    const decision = serviceDecision(message, service);
    if (decision) state.services[service] = { ...decision, source: 'message' };
  }
  const currency = currencyIn(message);
  if (currency) state.currency = currency;
  const children =
    /\b(?:children|child|kids?|infants?|babies|baby|\d{1,2}[ -]year[ -]olds?)\b/i.test(message);
  const adultsOnly =
    /\b(?:adults only|only adults|all adults|all (?:travell?ers?|people|guests) are adults|no children|no kids|without children|children (?:are )?not coming)\b/i.test(
      message,
    );
  if (adultsOnly)
    state.party = {
      hasChildren: false,
      childAges: [],
      source: 'message',
      evidence: message.match(adultCompositionPattern)?.[0] || message.slice(0, 500),
    };
  else if (children) {
    const ages = childAgesIn(message);
    state.party = {
      hasChildren: true,
      childAges: ages,
      source: 'message',
      evidence: message.slice(0, 500),
    };
  } else if (adultCountPattern.test(message) && state.party?.hasChildren !== true) {
    // A fresh explicit adult count confirms composition; it cannot silently retract known children.
    state.party = {
      hasChildren: false,
      childAges: [],
      source: 'message',
      evidence: message.match(adultCountPattern)![0],
    };
  }
}

function groundedFlightDate(value: string, evidence: string): string {
  if (!value || !dateSchema.safeParse(value).success) return '';
  if (evidence.includes(value)) return value;
  const [year, month, day] = value.split('-').map(Number);
  const name = new Date(Date.UTC(year, month - 1, day)).toLocaleString('en-AU', {
    month: 'short',
    timeZone: 'UTC',
  });
  const named = new RegExp(
    `\\b(?:${day}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${name}[a-z]*|${name}[a-z]*\\s+${day}(?:st|nd|rd|th)?)\\b`,
    'i',
  );
  return named.test(evidence) && evidence.includes(String(year)) ? value : '';
}

export function updateConsultation(input: {
  trip: Trip;
  message: string;
  brief: TravelBrief;
  updates?: ConsultationUpdates;
  form?: Partial<ConsultationState>;
}): ConsultationState {
  const { trip, brief, message, updates, form } = input;
  const stored = consultationSchema.safeParse(trip.brief?.consultation || brief.consultation);
  const state: ConsultationState = stored.success
    ? structuredClone(stored.data)
    : defaultConsultation();
  if (!stored.success) {
    // The legacy initial numbers are placeholders. Only non-default text and original user messages migrate.
    if (trip.itinerary.length || trip.planning)
      state.currency =
        trip.planning?.budget.targetCurrency || trip.planning?.budget.currency || 'USD';
    if (trip.destinationId)
      state.facts.destination = {
        source: 'legacy',
        evidence: trip.destinationId,
        valueState: 'specified',
      };
    if (trip.startDate)
      state.facts.dates = { source: 'legacy', evidence: trip.startDate, valueState: 'specified' };
    if (trip.brief?.originAirport)
      state.facts.origin = {
        source: 'profile',
        evidence: trip.brief.originAirport,
        valueState: 'specified',
      };
    if (trip.interests.length)
      state.facts.interests = {
        source: 'profile',
        evidence: trip.interests.join(', ').slice(0, 500),
        valueState: 'specified',
      };
    for (const service of ['flights', 'hotels'] as const) {
      if (service === 'flights' ? trip.brief?.includeFlights : trip.brief?.includeHotels)
        state.services[service] = {
          status: 'requested',
          source: 'legacy',
          evidence: 'Previously enabled search',
        };
    }
    for (const previous of trip.messages.filter((item) => item.role === 'user').slice(-50))
      applyLiteralMessage(state, previous.content);
  }
  // Form fields are deliberately separate from derived model numbers and default checkbox values.
  if (form) {
    if (form.currency && /^[A-Z]{3}$/.test(form.currency)) state.currency = form.currency;
    for (const [field, fact] of Object.entries(form.facts || {})) {
      if (fact?.source === 'form' && fact.evidence)
        state.facts[field as ConsultationField] = { ...fact, source: 'form' };
    }
    for (const service of ['flights', 'hotels'] as const) {
      const decision = form.services?.[service];
      if (decision?.source === 'form') state.services[service] = { ...decision, source: 'form' };
    }
    if (form.party?.source === 'form') state.party = structuredClone(form.party);
    if (form.flightJourney?.source === 'form')
      state.flightJourney = structuredClone(form.flightJourney);
  }
  const contextual = contextualServices(trip, message);
  if (updates) {
    for (const fact of updates.facts) {
      if (supportedEvidence(message, fact.evidence))
        recordFact(state, fact.field, fact.evidence, fact.valueState);
    }
    for (const update of updates.services) {
      if (!supportedEvidence(message, update.evidence)) continue;
      if (
        update.status === 'unknown' &&
        !(
          new RegExp(`\\b${serviceNoun[update.service]}\\b`, 'i').test(update.evidence) &&
          /\b(?:unsure|not sure|undecided|don't know|do not know)\b/i.test(update.evidence)
        )
      )
        continue;
      const literal = serviceDecision(update.evidence, update.service);
      // Model evidence cannot transform an unstated decline or unbooked service into a decision.
      if (
        update.status !== 'unknown' &&
        literal?.status !== update.status &&
        contextual[update.service] !== update.status
      )
        continue;
      state.services[update.service] = {
        status: update.status,
        source: 'message',
        evidence: update.evidence,
      };
    }
    if (updates.currency && supportedEvidence(message, updates.currency.evidence)) {
      const actual = currencyIn(updates.currency.evidence);
      if (actual === updates.currency.value) state.currency = actual;
    }
    if (updates.party && supportedEvidence(message, updates.party.evidence)) {
      const { hasChildren, childAges, evidence } = updates.party;
      const explicitlyAdultOnly =
        /\b(?:adults only|only adults|all adults|all (?:travell?ers?|people|guests) are adults|no children|no kids|without children|children (?:are )?not coming)\b/i.test(
          evidence,
        );
      if (hasChildren || explicitlyAdultOnly)
        state.party = {
          hasChildren,
          childAges: childAges.filter((age) => childAgesIn(evidence).includes(age)).slice(0, 15),
          evidence,
          source: 'message',
        };
    }
    if (updates.flightJourney && supportedEvidence(message, updates.flightJourney.evidence)) {
      const journey = updates.flightJourney;
      const departureDate = groundedFlightDate(journey.departureDate, journey.evidence);
      const returnDate = groundedFlightDate(journey.returnDate, journey.evidence);
      const type =
        journey.type === 'return' &&
        /\b(?:return|round[ -]trip|roundtrip|back)\b/i.test(journey.evidence) &&
        !/\bno return\b/i.test(journey.evidence)
          ? 'return'
          : journey.type === 'one_way' && /\b(?:one[ -]way|no return)\b/i.test(journey.evidence)
            ? 'one_way'
            : journey.type === 'multi_city' &&
                /\b(?:multi[ -]city|open[ -]jaw|several cities)\b/i.test(journey.evidence)
              ? 'multi_city'
              : state.flightJourney?.type || 'unknown';
      state.flightJourney = {
        ...journey,
        type,
        departureDate: departureDate || state.flightJourney?.departureDate || '',
        returnDate: returnDate || state.flightJourney?.returnDate || '',
        source: 'message',
      };
      if (type === 'one_way') state.flightJourney.returnDate = '';
      if (
        state.flightJourney.returnDate &&
        state.flightJourney.returnDate <= state.flightJourney.departureDate
      )
        state.flightJourney.returnDate = '';
    }
  }
  for (const service of ['flights', 'hotels'] as const) {
    const status = contextual[service];
    if (status)
      state.services[service] = { status, source: 'message', evidence: message.slice(0, 500) };
  }
  if (confirmsAdultsInContext(trip, message)) {
    state.party = { hasChildren: false, childAges: [], source: 'message', evidence: message };
  }
  // Explicit literal statements override contradictory extraction. Unrelated follow-ups preserve memory.
  applyLiteralMessage(state, message);
  return consultationSchema.parse(state);
}

/** Keep the interview short. Supplier-specific details can be requested after core trip intake. */
export function getConsultationQuestions(
  trip: Trip,
  brief: TravelBrief,
  max = 2,
): PlanningQuestion[] {
  const state = brief.consultation || trip.brief?.consultation || defaultConsultation();
  const questions: PlanningQuestion[] = [];
  const ask = (field: PlanningQuestion['field'], question: string, suggestions: string[] = []) =>
    questions.push({ field, question, suggestions });
  if (!state.facts.destination || state.facts.destination.valueState === 'flexible')
    ask('destination', 'Where would you like to go, or would you like help choosing?', [
      'Help me choose',
    ]);
  if (!state.facts.dates)
    ask(
      'dates',
      state.facts.duration
        ? 'When are you thinking of travelling? Flexible dates are fine.'
        : 'When are you thinking of travelling, and for how long?',
      ['My dates are flexible'],
    );
  else if (!state.facts.duration) ask('duration', 'How many days would you like to be away?');
  if (!state.facts.travelers)
    ask(
      'travelers',
      'Who is travelling? Please include the number of adults and any children’s ages.',
    );
  if (state.services.flights.status === 'unknown')
    ask('flights', 'Would you like help finding flights, or are they already sorted?', [
      'Find flights for me',
      'My flights are already booked',
      'No flights needed',
    ]);
  if (state.services.hotels.status === 'unknown')
    ask('hotels', 'Would you like help with accommodation?', [
      'Find hotels for me',
      'My hotels are already booked',
      'No hotels needed',
    ]);
  if (!state.facts.budget)
    ask(
      'budget',
      `What total budget would feel comfortable in ${state.currency}? A rough range is fine.`,
      ['My budget is flexible'],
    );
  if (!state.facts.interests)
    ask(
      'interests',
      'What would make this trip a great one for you—food, nature, culture, or time to unwind?',
    );
  if (state.services.flights.status === 'requested') {
    if (!state.facts.origin && !brief.originAirport)
      ask('origin', 'Which city or airport would you like to fly from?');
    const journey = state.flightJourney;
    if (
      !journey ||
      journey.type === 'unknown' ||
      !journey.departureDate ||
      (journey.type === 'return' && !journey.returnDate)
    )
      ask(
        'flight_dates',
        'Are these one-way or return flights, and what dates would you like to fly? Your holiday dates may differ.',
      );
  }
  const limit = Number.isFinite(max) ? Math.min(3, Math.max(0, Math.floor(max))) : 2;
  return questions.slice(0, limit);
}

/** Current supplier adapters submit an adults-only party. Never silently price children as adults. */
export function hasUnsupportedParty(brief: TravelBrief): boolean {
  return brief.consultation?.party?.hasChildren === true;
}

/** A count of travellers does not establish that every traveller is an adult. */
export function hasConfirmedAdultParty(brief: TravelBrief): boolean {
  // False is stored only after an explicit adult/no-child choice or a scoped contextual answer.
  return brief.consultation?.party?.hasChildren === false;
}
