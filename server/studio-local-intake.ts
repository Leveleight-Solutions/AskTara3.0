import { randomUUID } from 'node:crypto';
import { destinations } from '../shared/catalog.ts';
import type { StudioAgency, StudioBrief, StudioStop, StudioWorkspace } from '../shared/studio.ts';
import { applyStudioPatch, qualifyStudio, studioDate } from './studio-domain.ts';
import {
  groundedStudioBrief,
  assertStudioRouteGrounding,
  groundedStudioDates,
  requestedStudioNights,
  studioAnsweringField,
  studioCountryRouteRefinement,
} from './studio-grounding.ts';
import {
  prepareStudioStayClarification,
  resolveStudioClarification,
  recoverStudioStayClarification,
  studioStayConfirmation,
} from './studio-intake-continuity.ts';
import { normalizeStudioCountry } from '../shared/studio-travel-research.ts';
import { buildStudioGuidedQuestions } from '../shared/studio-assistant.ts';
import { studioJourneyIntakeReply } from './studio-journey-intake.ts';

const normal = (value: string) => value.normalize('NFKC').trim().toLowerCase();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const datePattern = String.raw`20\d{2}-\d{2}-\d{2}`;
const placePattern = String.raw`[\p{L}][\p{L}\p{M} .’'-]{0,79}?`;
type Mention = { name: string; country: string; index: number; end: number; nights?: number };
const greeting =
  /^(?:hi|hello|hey|good (?:morning|afternoon|evening))(?:\s+(?:tara|there))?[,.!\s]*(?:how are you[?!.\s]*)?$/i;
const thanks = /^(?:thanks(?: a lot)?|thank you(?: very much)?|cheers)[!.\s]*$/i;
const acknowledgement = /^(?:ok(?:ay)?|sure|great|sounds good|got it|understood)[!.\s]*$/i;
const placePrefix = (text: string, index: number) =>
  (
    text
      .slice(0, index)
      .split(/[,;.!?\n]|\bbut\b/i)
      .at(-1) || ''
  ).replace(
    /\b(?:no|without)\s+(?:children|kids|infants|passports?|nationality|budget|flights?|hotels?)\b/gi,
    '',
  );
const uncertainPlacePrefix = (prefix: string) =>
  /\b(?:not|never|no|without|maybe|possibly|might|if|unless|instead of|rather than|considering)\b|\bdon['’]t\b|\b(?:could|would)\s*$/i.test(
    prefix,
  );

function nextQuestion(workspace: StudioWorkspace, agency: StudioAgency) {
  const questions = buildStudioGuidedQuestions({
    ...workspace,
    qualification: qualifyStudio(workspace, agency),
  });
  const priority = [
    'route',
    'outboundTransport',
    'origin',
    'departureDate',
    'returnTransport',
    'adults',
    'children',
    'childAges',
    'startDate',
    'nights',
    'budget',
    'hotelStandard',
  ];
  const question = priority.map((id) => questions.find((entry) => entry.id === id)).find(Boolean);
  if (question?.id === 'nights') {
    const stop = workspace.stops.find((entry) => entry.nights === null);
    if (stop)
      return {
        ...question,
        label: `How many nights would you like in ${stop.name}?`,
        stopId: stop.id,
      };
  }
  return question || questions[0];
}

// A literal uncatalogued place is accepted only in answer to the destination question.
// Capitalisation and a short name shape keep casual sentences out of the route; an
// explicit "trip to ..." remains available for other spellings and longer names.
function contextualPlace(text: string) {
  const name = text.trim().replace(/[.!]$/, '').trim();
  if (
    !/^[\p{Lu}][\p{L}\p{M}’'-]*(?:\s+[\p{Lu}][\p{L}\p{M}’'-]*){0,3}(?:,\s*[\p{Lu}][\p{L}\p{M}’'-]*(?:\s+[\p{Lu}][\p{L}\p{M}’'-]*){0,3})?$/u.test(
      name,
    ) ||
    /\b(?:hi|hello|hey|thanks|thank|you|yes|no|none|nothing|maybe|anything|anywhere|somewhere|whatever|unsure|unknown|not|sure|okay|ok|great|fine|good|help|please|test|testing|later|tomorrow|flexible|fixed|I|we|it|that|this|my|your|our|am|is|are|do|does|else|sounds|how|what|why|can|could|would|let|tell|recommend|suggest|surprise|me)\b/i.test(
      name,
    )
  )
    return;
  const [city, country = ''] = name.split(/,\s*/);
  return cleanPlace(city) ? { name: city, country } : undefined;
}

function changedDetails(before: StudioWorkspace, after: StudioWorkspace) {
  const facts: string[] = [];
  if (JSON.stringify(before.stops) !== JSON.stringify(after.stops))
    facts.push(
      after.stops
        .map(
          (stop) =>
            `${stop.name}${stop.nights === null ? '' : ` for ${stop.nights} night${stop.nights === 1 ? '' : 's'}`}`,
        )
        .join(' → '),
    );
  const a = before.brief,
    b = after.brief;
  if (a.passportNationality !== b.passportNationality && b.passportNationality)
    facts.push(
      `${normalizeStudioCountry(b.passportNationality)?.name || b.passportNationality} passport`,
    );
  if (a.tripPurpose !== b.tripPurpose && b.tripPurpose !== 'undecided')
    facts.push(`travel purpose: ${b.tripPurpose}`);
  if (a.tripType !== b.tripType && b.tripType !== 'undecided')
    facts.push(b.tripType === 'single' ? 'single destination' : 'multiple destinations');
  if (a.tripDays !== b.tripDays && b.tripDays !== null && b.tripDays !== undefined)
    facts.push(`${b.tripDays}-day trip`);
  if (a.origin !== b.origin && b.origin) facts.push(`departure city: ${b.origin}`);
  if (a.departureDate !== b.departureDate && b.departureDate)
    facts.push(`outbound departure ${b.departureDate}`);
  if (a.returnDepartureDate !== b.returnDepartureDate && b.returnDepartureDate)
    facts.push(`return departure ${b.returnDepartureDate}`);
  if (a.outboundTransport !== b.outboundTransport && b.outboundTransport !== 'undecided')
    facts.push(`arrival by ${b.outboundTransport}`);
  if (a.returnTransport !== b.returnTransport && b.returnTransport !== 'undecided')
    facts.push(`return by ${b.returnTransport}`);
  if (a.adults !== b.adults) facts.push(`${b.adults} adult${b.adults === 1 ? '' : 's'}`);
  if (a.children !== b.children)
    facts.push(
      b.children === 0 ? 'no children' : `${b.children} child${b.children === 1 ? '' : 'ren'}`,
    );
  if (JSON.stringify(a.childAges) !== JSON.stringify(b.childAges) && b.childAges.length)
    facts.push(`child ages ${b.childAges.join(', ')}`);
  if (a.startDate !== b.startDate) facts.push(`arrival ${b.startDate}`);
  if (a.endDate !== b.endDate) facts.push(`trip end ${b.endDate}`);
  if (a.datesFlexible !== b.datesFlexible)
    facts.push(b.datesFlexible ? 'flexible dates' : 'fixed dates');
  if (a.budget !== b.budget || a.currency !== b.currency)
    facts.push(
      b.budget === null
        ? `budget amount unconfirmed (${b.currency})`
        : `group budget ${b.currency} ${b.budget}`,
    );
  if (a.hotelStandard !== b.hotelStandard) facts.push(`${b.hotelStandard} hotels`);
  if (a.output !== b.output)
    facts.push(b.output === 'structure' ? 'route outline only' : 'full proposal');
  if (JSON.stringify(a.requirements) !== JSON.stringify(b.requirements))
    facts.push(...b.requirements.filter((entry) => !a.requirements.includes(entry)));
  return facts.filter(Boolean);
}

function cleanPlace(value: string) {
  const name = value
    .replace(
      /^(?:(?:plan\s+)?(?:a\s+)?trip\s+to|plan|visit|stay\s+in|arrive(?:\s+in)?|then|to)\s+/i,
      '',
    )
    .replace(
      /\s+(?:for\s+)?(?:exactly|precisely|roughly|about|around|approximately|just|only)$/i,
      '',
    )
    .trim();
  // Keep a literal place name, not the surrounding planning instructions or preferences.
  if (
    !name ||
    /\b(?:adults?|children|kids?|travell?ers?|budget|nights?|days?|hotels?|proposal|client|please|prefer|with|for|from|starting|we|want|need|add|more|remove|extend|shorten|the|a|an|somewhere|anywhere|maybe|possibly|not|never|if|hi|hello|thanks)\b/i.test(
      name,
    ) ||
    /^(?:exactly|precisely|roughly|about|around|approximately|just|only)$/i.test(name)
  )
    return;
  return name;
}

function readMentions(text: string, current: StudioStop[]): Mention[] {
  const mentions: Mention[] = [];
  const add = (label: string, index: number, end: number, nights?: number, country = '') => {
    const name = cleanPlace(label);
    if (!name || (nights !== undefined && nights > 120)) return;
    const prefix = placePrefix(text, index);
    if (
      uncertainPlacePrefix(prefix) ||
      /\b(?:from|origin(?: city)?\s*[:=])\s*$/i.test(prefix) ||
      /^\s+(?:is|as)\s+(?:(?:my|our|the)\s+)?(?:origin|departure city|home city|birthplace|residence)\b/i.test(
        text.slice(end),
      )
    )
      return;
    const known = destinations.find((entry) => normal(entry.name) === normal(name));
    const old = current.find((entry) => normal(entry.name) === normal(name));
    const duplicate = mentions.find((entry) => normal(entry.name) === normal(name));
    if (duplicate) {
      if (nights !== undefined) duplicate.nights = nights;
      return;
    }
    mentions.push({
      name: old?.name || known?.name || name,
      country: country || old?.country || known?.country || '',
      index,
      end,
      nights,
    });
  };
  // A stay can appear on either side of its destination, with an explicit arrival date.
  const following = new RegExp(
    String.raw`(?:^|[,;:\n]|\bthen\s+|\band\s+|\b(?:trip\s+to|visit|arrive(?:\s+in)?|stay\s+in)\s+)\s*(${placePattern})(?:,\s*(${placePattern}))?\s+(?:on\s+${datePattern}\s+)?(?:for\s+)?(\d{1,3})\s+nights?\b`,
    'giu',
  );
  for (let match = following.exec(text); match; match = following.exec(text)) {
    if (!cleanPlace(match[1])) {
      // A comma before a party detail must not consume a later actual destination.
      following.lastIndex = match.index + 1;
      continue;
    }
    add(match[1], match.index, match.index + match[0].length, +match[3], match[2]?.trim());
  }
  const preceding = new RegExp(
    String.raw`\b(\d{1,3})\s+nights?\s+(?:in|at)\s+(${placePattern})(?=$|[.,;\n!?]|\s+(?:then|and|on|starting|with|for|budget)\b)`,
    'giu',
  );
  for (const match of text.matchAll(preceding))
    add(match[2], match.index, match.index + match[0].length, +match[1]);

  // Explicitly directed names also work outside the editorial destination catalog.
  const directed = new RegExp(
    String.raw`\b(?:trip\s+to|(?:go(?:ing)?|travel(?:l?ing)?)\s+to|visit|arrive(?:\s+in)?|stay\s+in|destination\s*[:=])\s+(${placePattern})(?=$|[.,;\n!?]|\s+(?:then|and|on|for|starting|with|from)\b)`,
    'giu',
  );
  for (const match of text.matchAll(directed))
    add(match[1], match.index, match.index + match[0].length);

  // Preserve the order in the brief, rather than catalog order. Existing names may be
  // mentioned by an unrelated preference; their metadata is only changed by stay evidence.
  for (const destination of [...current, ...destinations]) {
    const match = new RegExp(
      `(?<![\\p{L}\\p{N}])${escape(destination.name)}(?![\\p{L}\\p{N}])`,
      'iu',
    ).exec(text);
    if (match) add(destination.name, match.index, match.index + match[0].length);
  }
  return mentions.sort((a, b) => a.index - b.index);
}

function readDates(text: string, brief: StudioBrief, stops: StudioStop[]) {
  const dates = [...text.matchAll(new RegExp(`\\b${datePattern}\\b`, 'g'))].filter(
    (match) => studioDate.safeParse(match[0]).success,
  );
  for (const match of dates) {
    const prefix =
      text
        .slice(0, match.index)
        .split(/[.;\n]/)
        .at(-1) || '';
    const tail = prefix.slice(-100);
    if (uncertainPlacePrefix(placePrefix(text, match.index || 0))) continue;
    if (/\b(?:end(?:s|ing)?|return(?:s|ing)?|until|through|leav(?:e|ing))\b[^,;]*$/i.test(tail)) {
      brief.endDate = match[0];
      continue;
    }
    const arrival = tail.match(/\barriv(?:e|es|ing|al)(?:\s+(?:in|at))?\s+(.+?)\s+(?:on\s+)?$/i);
    if (arrival) {
      const place = arrival[1].trim().replace(/\s+on$/i, '');
      const stop = stops.find((entry) => normal(entry.name) === normal(place));
      if (stop && stop !== stops[0]) {
        stop.arrivalDate = match[0];
        stop.arrivalFixed = true;
        continue;
      }
      if (stop === stops[0]) {
        brief.startDate = match[0];
        continue;
      }
    }
    const explicitStart =
      /\b(?:start(?:s|ing)?|begin(?:s|ning)?|arrival\s+date)\s*(?:date\s*)?(?:is\s*|[:=]\s*|on\s*)?$/i.test(
        tail,
      );
    const firstStay =
      !brief.startDate &&
      stops[0] &&
      requestedStudioNights(text, stops[0].name, stops[0].nights, true) !== undefined &&
      new RegExp(`${escape(stops[0].name)}\\s+on\\s+$`, 'i').test(tail);
    if (explicitStart || firstStay) brief.startDate = match[0];
  }
  const range = text.match(
    new RegExp(
      `\\b(?:from|between)\\s+(${datePattern})\\s+(?:to|and|–)\\s+(${datePattern})\\b`,
      'i',
    ),
  );
  if (
    range &&
    !/\b(?:fly|flight|depart)\b/i.test(text) &&
    range.slice(1).every((date) => studioDate.safeParse(date).success)
  ) {
    brief.startDate = range[1];
    brief.endDate = range[2];
  }
}

function readBrief(
  current: StudioBrief,
  text: string,
  answering?: string,
  messages: StudioWorkspace['messages'] = [],
): StudioBrief {
  const facts: { field: keyof StudioBrief; evidence: string }[] = [];
  if (
    answering === 'adults' ||
    answering === 'children' ||
    answering === 'childAges' ||
    answering === 'tripDays' ||
    answering === 'budget'
  )
    facts.push({ field: answering, evidence: text });
  const include = (field: keyof StudioBrief, pattern: RegExp) => {
    if (pattern.test(text)) facts.push({ field, evidence: text });
  };
  include('adults', /\badults?\b|\b(?:travell?ing solo|solo traveller|just me)\b/i);
  include('children', /\b(?:child(?:ren)?|kids?|infants?|adults only|all adults|only adults)\b/i);
  include(
    'tripPurpose',
    /\b(?:business|bussiness|tourism|holiday|vacation|honeymoon|leisure|study|studying|employment|paid work|conference)\b/i,
  );
  include('childAges', /\b(?:ages?|aged)\b/i);
  if (
    answering === 'passportNationality' ||
    /\b(?:passports?|nationality|citizenship|citizen|client|i am|i['’]m)\b/i.test(text)
  )
    facts.push({ field: 'passportNationality', evidence: text });
  include(
    'startDate',
    /\b(?:start(?:s|ing)?|begin(?:s|ning)?|arrival date)\b|\barriv(?:e|es|ing|al)\s+(?:on\s+)?(?=\d)/i,
  );
  include('endDate', /\b(?:return(?:s|ing)?|end date|leav(?:e|ing))\b/i);
  include('departureDate', /\b(?:depart(?:ing|ure)?|outbound)\b/i);
  include('returnDepartureDate', /\b(?:return(?:ing)?|fly(?:ing)? back|leav(?:e|ing))\b/i);
  include(
    'datesFlexible',
    /\b(?:flexible|fixed)\s+dates?\b|\bdates?\s+(?:are |is )?(?:flexible|fixed|not flexible)\b/i,
  );
  include(
    'budget',
    /\b(?:budget|spend)\b|\b(?:AUD|USD|GBP|EUR|NZD|CAD|JPY|SGD|CHF|HKD)\s*[\d$]|[$€£]\s*\d/i,
  );
  const brief = groundedStudioBrief(current, current, facts, text, [], { messages });
  const originMatch = text.match(
    /\b(?:(?:i|we)\s+(?:am |are )?from|(?:depart(?:ing)?|fly(?:ing)?|start(?:ing)?)\s+from|origin(?: city)?\s*[:=])\s+([\p{L}][\p{L}\p{M} .’'-]{0,79}?)(?=\s+(?:to|on|having|with|holding|and|for)\b|[,.!;\n]|$)/iu,
  );
  const origin =
    originMatch && !uncertainPlacePrefix(placePrefix(text, originMatch.index || 0))
      ? originMatch[1]?.trim()
      : undefined;
  const place = origin || (answering === 'origin' ? text.trim().replace(/[.!]$/, '') : '');
  if (place && contextualPlace(place.charAt(0).toUpperCase() + place.slice(1)))
    brief.origin = place;
  const single =
    /\b(?:single[- ]destination|one destination|single[- ]city|one city)\b/i.test(text) ||
    (answering === 'tripType' && /^\s*(?:single|one)[.!]?\s*$/i.test(text));
  const multiple =
    /\b(?:multi[- ]destination|multiple destinations|multi[- ]city|multiple cities)\b/i.test(
      text,
    ) ||
    (answering === 'tripType' && /^\s*(?:multiple|multi|several)[.!]?\s*$/i.test(text));
  if (single !== multiple) brief.tripType = single ? 'single' : 'multiple';
  const mode = (value: string): 'flight' | 'cruise' | undefined => {
    const flight = /\b(?:flight|fly|flying|plane|air)\b/i.test(value);
    const cruise = /\b(?:cruise|cruising)\b/i.test(value);
    return flight === cruise ? undefined : flight ? 'flight' : 'cruise';
  };
  const wholeMode = mode(text);
  if (
    wholeMode &&
    !/\b(?:maybe|possibly|undecided|not sure|not by)\b/i.test(text) &&
    /\b(?:arrival|outbound|outward)\s+and\s+return\b|\b(?:both ways|both legs|there and back|round[- ]trip)\b/i.test(
      text,
    )
  )
    brief.outboundTransport = brief.returnTransport = wholeMode;
  else {
    for (const clause of text.split(/\b(?:and|but|then)\b|[.;,\n]/i)) {
      if (
        /\b(?:maybe|possibly|undecided|not sure)\b|\b(?:not|no|without)\s+(?:by\s+|a\s+)?(?:flight|fly|flying|plane|air|cruise|cruising)\b/i.test(
          clause,
        )
      )
        continue;
      const transport = mode(clause);
      if (!transport) continue;
      if (
        /\b(?:return(?:ing)?|homeward|back home|(?:fly|flight|cruise|cruising) (?:back|home))\b/i.test(
          clause,
        )
      )
        brief.returnTransport = transport;
      else if (
        /\b(?:outbound|outward|arriv(?:e|ing|al)|reach(?:ing)?(?: the)? destination|(?:fly|flying|cruise|cruising) (?:out|to))\b/i.test(
          clause,
        )
      )
        brief.outboundTransport = transport;
    }
    if (
      (answering === 'outboundTransport' || answering === 'returnTransport') &&
      /^\s*(?:by\s+)?(?:flight|fly|plane|air|cruise)(?:\s+please)?[.!]?\s*$/i.test(text) &&
      wholeMode
    )
      brief[answering] = wholeMode;
  }
  if (
    answering === 'children' &&
    /^\s*(?:no|none|nope)(?:\s+(?:thanks|thank you))?[.!]?\s*$/i.test(text)
  ) {
    brief.children = 0;
    brief.childAges = [];
  }
  if (
    ['startDate', 'departureDate', 'datesFlexible'].includes(answering || '') &&
    /^\s*(?:flexible|any dates?)[.!]?\s*$/i.test(text)
  )
    brief.datesFlexible = true;
  const stars = text.match(/\b([1-5])\s*[- ]?\s*stars?\b/i);
  if (stars) brief.hotelStandard = `${stars[1]} star`;
  const travelers = text.match(/\b(\d{1,3})\s+travell?ers?\b/i);
  if (travelers && +travelers[1] > 0 && +travelers[1] <= 130)
    brief.requirements = [
      ...brief.requirements.filter((entry) => !entry.startsWith('Party total:')),
      `Party total: ${+travelers[1]} travellers.`,
    ].slice(-30);
  if (/\b(?:route|structure)\s+only\b/i.test(text)) brief.output = 'structure';
  return brief;
}

/** Deterministic intake for installations without a model key; unknown facts stay unknown. */
export function localStudioReview(
  workspace: StudioWorkspace,
  message: string,
  agency: StudioAgency,
) {
  const confirmation =
    recoverStudioStayClarification(workspace, message, agency) ||
    resolveStudioClarification(workspace, message, agency);
  if (confirmation) return confirmation;
  const before = structuredClone(workspace);
  const pending = nextQuestion(workspace, agency);
  const lastReply = workspace.messages.findLast((entry) => entry.role === 'assistant')?.content;
  const contextualAnswer = [
    'adults',
    'children',
    'childAges',
    'budget',
    'startDate',
    'endDate',
    'departureDate',
    'nights',
    'tripDays',
    'datesFlexible',
  ].find((field) =>
    studioAnsweringField({ messages: workspace.messages, brief: workspace.brief }, field),
  );
  const directQuestion = lastReply?.match(/[^.!?]+\?/g)?.at(-1) || '';
  const otherAnswer = /\bpassport\b/i.test(directQuestion)
    ? 'passportNationality'
    : /\b(?:single|multi|multiple)\b.*\b(?:destination|trip)\b/i.test(directQuestion)
      ? 'tripType'
      : /\bwhere\b.*\b(?:depart|start)\b.*\bfrom\b/i.test(directQuestion)
        ? 'origin'
        : /\b(?:travel there|reach.*destination|outbound|outward|arrival)\b/i.test(
              directQuestion,
            ) && !/\breturn\b/i.test(directQuestion)
          ? 'outboundTransport'
          : /\breturn\b/i.test(directQuestion) && /\b(?:flight|cruise)\b/i.test(directQuestion)
            ? 'returnTransport'
            : undefined;
  // Transport buttons save the chosen mode without adding a conversation turn.
  // That one completed question may therefore precede the next literal origin answer.
  const completedTransportQuestion =
    otherAnswer === 'outboundTransport' &&
    /\bflight\b/i.test(directQuestion) &&
    /\bcruise\b/i.test(directQuestion) &&
    ['flight', 'cruise'].includes(workspace.brief.outboundTransport || '') &&
    !workspace.brief.origin.trim() &&
    workspace.stops.length === 1 &&
    Boolean(workspace.stops[0].name.trim()) &&
    pending?.id === 'origin';
  const answering =
    (completedTransportQuestion ? 'origin' : otherAnswer) ||
    contextualAnswer ||
    (pending &&
    (lastReply?.endsWith(pending.label) ||
      (['adults', 'children', 'childAges', 'budget', 'startDate', 'departureDate'].includes(
        pending.id,
      ) &&
        studioAnsweringField({ messages: workspace.messages, brief: workspace.brief }, pending.id)))
      ? pending.id
      : undefined);
  const useImports =
    (!workspace.brief.request && !workspace.stops.length) ||
    /\b(?:review|read|use|update|build|plan)\b.{0,60}\b(?:import(?:ed)?|source|document|client information)\b/i.test(
      message,
    );
  const sources: { text: string; answering?: string }[] = [
    ...(useImports ? workspace.imports.map((entry) => ({ text: entry.text })) : []),
    { text: message, answering },
  ];
  let brief = structuredClone(workspace.brief);
  let stops = structuredClone(workspace.stops);
  for (const { text, answering: context } of sources) {
    brief = readBrief(brief, text, context, context ? workspace.messages : []);
    const mentions =
      context === 'origin' && contextualPlace(text.charAt(0).toUpperCase() + text.slice(1))
        ? []
        : readMentions(text, stops);
    const nightIndex = text.search(/\bnights?\b/i);
    const affirmativeNights =
      nightIndex < 0 || !uncertainPlacePrefix(placePrefix(text, nightIndex));
    if (
      !mentions.length &&
      stops.length === 1 &&
      normalizeStudioCountry(stops[0].name) &&
      /\bthen\b|→|->/i.test(text)
    ) {
      const sequence = text.split(/\s+(?:then|and)\s+|\s*(?:→|->)\s*/i).map(contextualPlace);
      if (sequence.length > 1 && sequence.every(Boolean))
        mentions.push(...sequence.map((place, index) => ({ ...place!, index, end: index + 1 })));
    }
    if (
      studioCountryRouteRefinement(
        stops,
        mentions.map((entry) => ({ ...entry, nights: entry.nights ?? null })),
        text,
      )
    )
      stops = [];
    if (!mentions.length && !stops.length && context === 'route') {
      const place = contextualPlace(text);
      if (place) mentions.push({ ...place, index: 0, end: text.length });
    }
    if (!stops.length) {
      stops = mentions.slice(0, 20).map(({ name, country, nights }) => ({
        id: randomUUID(),
        name,
        country,
        nights: nights ?? null,
        arrivalDate: '',
        departureDate: '',
        onwardTransport: 'undecided',
        neighbourhood: '',
        notes: '',
      }));
    } else {
      // A change to one destination must not discard the rest of a saved route.
      for (const mention of mentions) {
        const old = stops.find((entry) => normal(entry.name) === normal(mention.name));
        if (old && mention.nights !== undefined) old.nights = mention.nights;
        else if (
          !old &&
          mention.nights !== undefined &&
          stops.length < 20 &&
          /\b(?:add|then|visit|trip\s+to)\b/i.test(text)
        )
          stops.push({
            id: randomUUID(),
            name: mention.name,
            country: mention.country,
            nights: mention.nights,
            arrivalDate: '',
            departureDate: '',
            onwardTransport: 'undecided',
            neighbourhood: '',
            notes: '',
          });
      }
      const shortNights = text.match(/^\s*(\d{1,3})\s+nights?\s*(?:please)?[.!]?\s*$/i);
      if (stops.length === 1 && shortNights && +shortNights[1] <= 120)
        stops[0].nights = +shortNights[1];
      const namedTargets =
        context === 'nights'
          ? stops.filter((stop) =>
              new RegExp(`(?:^|[^\\p{L}])${escape(stop.name)}(?=$|[^\\p{L}])`, 'iu').test(
                directQuestion,
              ),
            )
          : [];
      const targetedStop =
        context === 'nights'
          ? namedTargets.length === 1
            ? namedTargets[0]
            : stops.length === 1
              ? stops[0]
              : undefined
          : undefined;
      if (targetedStop && /^\s*(?:[\p{L}\s-]+|\d{1,3})(?:\s+nights?)?[.!]?\s*$/iu.test(text)) {
        const nights = requestedStudioNights(
          text,
          targetedStop.name,
          targetedStop.nights,
          true,
          true,
        );
        if (nights !== undefined && Number.isInteger(nights) && nights >= 0 && nights <= 120)
          targetedStop.nights = nights;
      }
      // Combined replies can supply duration together with passport, dates and transport.
      // Reuse route grounding so another city's nights or a relative adjustment cannot leak in.
      const durations = [...text.matchAll(/\b(\d{1,3})\s+nights?\b/gi)];
      if (
        affirmativeNights &&
        stops.length === 1 &&
        durations.length === 1 &&
        +durations[0][1] <= 120
      ) {
        const proposed = [{ ...stops[0], nights: +durations[0][1] }];
        try {
          assertStudioRouteGrounding(stops, proposed, text, [], text, {
            messages: workspace.messages,
            brief,
          });
          stops = proposed;
        } catch {
          /* An ambiguous stay remains unchanged for the agent to clarify. */
        }
      }
    }
    readDates(text, brief, stops);
    if (affirmativeNights && stops.length === 1) {
      const nights = requestedStudioNights(text, stops[0].name, stops[0].nights, true);
      if (nights !== undefined && Number.isInteger(nights) && nights >= 0 && nights <= 120)
        stops[0].nights = nights;
    }
    if (stops.length <= 1)
      Object.assign(
        brief,
        groundedStudioDates(text, { messages: workspace.messages, brief: workspace.brief }),
      );
  }
  const conflict = prepareStudioStayClarification(workspace, brief, stops, message);
  applyStudioPatch(workspace, { revision: workspace.revision, brief, stops }, agency);
  if (conflict) workspace.clarification = conflict.clarification;
  if (workspace.stops.length && workspace.title === 'New client proposal')
    workspace.title = workspace.stops
      .map((stop) => stop.name)
      .join(' → ')
      .slice(0, 200);
  const changes = changedDetails(before, workspace);
  if (changes.length)
    workspace.brief.request = [before.brief.request, message]
      .filter(Boolean)
      .join('\n')
      .slice(-16000);
  if (workspace.clarification) return studioStayConfirmation(workspace)!;
  if (answering === 'children' && /^\s*(?:yes|yep|yeah)[.!]?\s*$/i.test(message))
    return 'How many children are travelling? I’ll also need their ages.';
  const journey = studioJourneyIntakeReply(workspace);
  if (journey)
    return changes.length ? `Noted: ${changes.slice(0, 3).join('; ')}. ${journey}` : journey;
  const next =
    nextQuestion(workspace, agency)?.label ||
    'You can review and accept the route to continue to services.';
  if (changes.length) return `Noted: ${changes.slice(0, 4).join('; ')}. ${next}`;
  if (greeting.test(message.trim())) return `Hi! Let’s put together your client’s trip. ${next}`;
  if (thanks.test(message.trim())) return `You’re welcome. ${next}`;
  if (acknowledgement.test(message.trim())) return `All right. ${next}`;
  return `I couldn’t read any new trip details from that. ${next}`;
}
