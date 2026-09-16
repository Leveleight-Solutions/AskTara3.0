import type { StudioBrief, StudioStop } from '../shared/studio.ts';
import { StudioError } from './studio-store.ts';
import { detectDestinationIntent } from './planner.ts';

const normal = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const words: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const numberWord = `${Object.keys(words).join('|')}|hundred|thousand`;
function numeric(text: string): string {
  return text.replace(
    new RegExp(`\\b(?:${numberWord})(?:(?:[ -]+(?:and[ -]+)?)(?:${numberWord}))*\\b`, 'gi'),
    (phrase) => {
      if (/\band\b/i.test(phrase) && !/\b(?:hundred|thousand)\b/i.test(phrase))
        return phrase
          .split(/\s+and\s+/i)
          .map(numeric)
          .join(' and ');
      let total = 0,
        part = 0;
      for (const word of phrase.toLowerCase().split(/[ -]+/)) {
        if (word === 'and') continue;
        if (word === 'hundred') part = Math.max(part, 1) * 100;
        else if (word === 'thousand') {
          total += Math.max(part, 1) * 1000;
          part = 0;
        } else part += words[word] || 0;
      }
      return String(total + part);
    },
  );
}
const bareNumber = (text: string) =>
  /^\s*\d+(?:[.,]\d+)?\s*(?:please)?[.!]?\s*$/i.test(numeric(text));
const actualSources = (evidence: string, message: string, documents: string[]) => {
  const literal = normal(evidence);
  if (!literal || !/[\p{L}\p{N}]/u.test(literal)) return [];
  // Prefer the latest instruction over imported, potentially older information.
  return [message, ...documents].filter((source) => normal(source).includes(literal));
};

function count(
  source: string,
  field: 'adults' | 'children',
  allowBare: boolean,
): number | undefined {
  const text = numeric(source);
  if (
    field === 'children' &&
    /\b(?:no children|no kids|without children|without kids|adults only|all adults|only adults)\b/i.test(
      text,
    )
  )
    return 0;
  if (
    field === 'adults' &&
    /\b(?:travell?ing solo|solo traveller|just me|one adult)\b/i.test(source)
  )
    return 1;
  const label = field === 'adults' ? 'adults?' : '(?:children|kids?|infants?)';
  const matches = [...text.matchAll(new RegExp(`\\b(\\d{1,3})\\s*${label}\\b`, 'gi'))];
  const value = matches.length
    ? Number(matches.at(-1)![1])
    : allowBare && bareNumber(source)
      ? Number(text.match(/\d+/)?.[0])
      : undefined;
  return value !== undefined &&
    value >= (field === 'adults' ? 1 : 0) &&
    value <= (field === 'adults' ? 100 : 30)
    ? value
    : undefined;
}

const months: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};
const monthWords = Object.keys(months)
  .sort((a, b) => b.length - a.length)
  .join('|');
type ReadDate = { date: string; index: number };
function readDates(source: string): ReadDate[] {
  const dates: ReadDate[] = [];
  const add = (year: number, month: number, day: number, index: number) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (
      Number.isFinite(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date &&
      !dates.some((entry) => entry.date === date && entry.index === index)
    )
      dates.push({ date, index });
  };
  for (const match of source.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g))
    add(+match[1], +match[2], +match[3], match.index);
  for (const match of source.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g))
    add(+match[3], +match[2], +match[1], match.index);
  for (const match of source.matchAll(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthWords})\\.?[,]?\\s+(20\\d{2})\\b`, 'gi'),
  ))
    add(+match[3], months[match[2].toLowerCase()], +match[1], match.index);
  for (const match of source.matchAll(
    new RegExp(`\\b(${monthWords})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(20\\d{2})\\b`, 'gi'),
  ))
    add(+match[3], months[match[1].toLowerCase()], +match[2], match.index);
  for (const match of source.matchAll(
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:to|[-–])\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthWords})\\.?[,]?\\s+(20\\d{2})\\b`,
      'gi',
    ),
  )) {
    add(+match[4], months[match[3].toLowerCase()], +match[1], match.index);
    add(
      +match[4],
      months[match[3].toLowerCase()],
      +match[2],
      match.index + match[0].indexOf(match[2], match[1].length),
    );
  }
  return dates
    .sort((a, b) => a.index - b.index)
    .filter((entry, index, all) => !all.slice(0, index).some((old) => old.date === entry.date));
}

function dateFor(
  source: string,
  field: 'startDate' | 'endDate',
  allowBare: boolean,
): string | undefined {
  const dates = readDates(source);
  if (!dates.length) return;
  const start = /\b(?:arriv(?:e|es|ing|al)|start(?:s|ing)?|begin(?:s|ning)?|from)\b/i;
  const end = /\b(?:end(?:s|ing)?|return(?:s|ing)?|until|through|back|leav(?:e|ing))\b/i;
  const anchored = dates.filter((entry) => {
    const prefix =
      source
        .slice(Math.max(0, entry.index - 55), entry.index)
        .split(/[.;\n]/)
        .at(-1) || '';
    const labels = [
      ...prefix.matchAll(new RegExp((field === 'startDate' ? start : end).source, 'gi')),
    ];
    const opposite = [
      ...prefix.matchAll(new RegExp((field === 'startDate' ? end : start).source, 'gi')),
    ];
    return labels.length && (!opposite.length || labels.at(-1)!.index > opposite.at(-1)!.index);
  });
  if (anchored.length) return (field === 'startDate' ? anchored[0] : anchored.at(-1))!.date;
  if (dates.length >= 2 && /\b(?:to|between)\b|[–]/i.test(source))
    return (field === 'startDate' ? dates[0] : dates.at(-1))!.date;
  if (allowBare && dates.length === 1 && !start.test(source) && !end.test(source))
    return dates[0].date;
  if (
    field === 'startDate' &&
    dates.length === 1 &&
    !end.test(source) &&
    !/\b(?:depart|fly|flight)\b/i.test(source)
  )
    return dates[0].date;
}

function money(source: string): {
  amount?: number;
  currency?: string;
  perPerson: boolean;
  perDay: boolean;
  perNight: boolean;
} {
  const text = numeric(source);
  const codes: Record<string, string> = {
    'australian dollars': 'AUD',
    'us dollars': 'USD',
    'new zealand dollars': 'NZD',
    euros: 'EUR',
    'pounds sterling': 'GBP',
  };
  const codeMatch = text.match(/\b(AUD|USD|GBP|EUR|NZD|CAD|JPY|SGD|CHF|HKD)\b/i);
  const named = Object.entries(codes).find(([label]) => text.toLowerCase().includes(label));
  const currency =
    codeMatch?.[1].toUpperCase() ||
    named?.[1] ||
    (/US\$/i.test(text)
      ? 'USD'
      : /NZ\$/i.test(text)
        ? 'NZD'
        : /(?:A\$|AU\$|\$)/i.test(text)
          ? 'AUD'
          : /€/.test(text)
            ? 'EUR'
            : /£/.test(text)
              ? 'GBP'
              : undefined);
  const amountMatch =
    text.match(
      /(?:\b(?:AUD|USD|GBP|EUR|NZD|CAD|JPY|SGD|CHF|HKD)\s*\$?|(?:US|AU|NZ|A)?\$|€|£)\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
    ) ||
    text.match(
      /\b(\d[\d,]*(?:\.\d{1,2})?)\s*(?:AUD|USD|GBP|EUR|NZD|CAD|JPY|SGD|CHF|HKD|Australian dollars|US dollars|euros|pounds sterling)\b/i,
    ) ||
    text.match(
      /\b(?:budget|spend|total|price point)(?:\s+is|\s+of|\s+around)?\s*[:=]?\s*(\d[\d,]*(?:\.\d{1,2})?)\b/i,
    );
  const amount = amountMatch
    ? Number(amountMatch[1].replaceAll(',', ''))
    : bareNumber(text)
      ? Number(text.match(/[\d.,]+/)?.[0].replaceAll(',', ''))
      : undefined;
  return {
    amount: amount !== undefined && amount >= 0 && amount <= 10000000 ? amount : undefined,
    currency,
    perPerson: /\b(?:per person|per traveller|per traveler|each person|pp)\b|\/\s*person\b/i.test(
      text,
    ),
    perDay: /\b(?:per day|a day|daily)\b|\/\s*day\b/i.test(text),
    perNight: /\b(?:per night|a night|nightly)\b|\/\s*night\b/i.test(text),
  };
}

/** Apply only source-grounded critical facts. The model chooses fields; it cannot invent their values. */
export function groundedStudioBrief(
  current: StudioBrief,
  proposed: StudioBrief,
  facts: { field: keyof StudioBrief; evidence: string }[],
  message: string,
  documentTexts: string[],
): StudioBrief {
  const next = structuredClone(current);
  const valid = facts
    .map((fact) => ({ ...fact, sources: actualSources(fact.evidence, message, documentTexts) }))
    .filter((fact) => fact.sources.length);
  const critical = new Set<keyof StudioBrief>([
    'adults',
    'children',
    'childAges',
    'budget',
    'currency',
    'startDate',
    'endDate',
    'datesFlexible',
  ]);
  for (const fact of valid)
    if (!critical.has(fact.field)) Object.assign(next, { [fact.field]: proposed[fact.field] });
  for (const fact of valid) {
    if (fact.field !== 'adults' && fact.field !== 'children') continue;
    const source = fact.sources[0];
    const value =
      count(fact.evidence, fact.field, bareNumber(message)) ??
      count(source, fact.field, bareNumber(message));
    if (value !== undefined) {
      if (fact.field === 'children' && value !== next.children) next.childAges = [];
      next[fact.field] = value;
      if (fact.field === 'children' && value === 0) next.childAges = [];
    }
  }
  for (const fact of valid) {
    const source = fact.sources[0];
    if (fact.field === 'childAges') {
      const text = numeric(fact.evidence);
      const scoped =
        text.match(/\b(?:ages?|aged)\s*[:=]?\s*([\d\s,&-]+(?:and\s*\d+)?)/i)?.[1] ||
        (/^\s*[\d\s,&-]+(?:and\s*\d+)?[.!]?\s*$/i.test(text) ? text : '');
      const ages = scoped.match(/\d+/g)?.map(Number) || [];
      if (
        next.children !== 0 &&
        ages.length &&
        ages.every((age) => age <= 17) &&
        (next.children === null || ages.length === next.children)
      )
        next.childAges = ages;
    } else if (fact.field === 'startDate' || fact.field === 'endDate') {
      // Source context distinguishes an arrival from an outbound flight departure.
      const value = dateFor(source, fact.field, normal(source) === normal(fact.evidence));
      if (value) next[fact.field] = value;
    } else if (fact.field === 'datesFlexible') {
      if (
        /\b(?:dates? (?:are |is )?flexible|flexible dates?|any dates?|not fixed|no fixed dates?)\b/i.test(
          source,
        )
      )
        next.datesFlexible = true;
      else if (/\b(?:dates? (?:are |is )?(?:fixed|not flexible)|fixed dates?)\b/i.test(source))
        next.datesFlexible = false;
    }
  }
  const moneyFact =
    valid.find((fact) => fact.field === 'budget') ||
    valid.find((fact) => fact.field === 'currency');
  if (moneyFact) {
    const source = moneyFact.sources[0];
    const budgetScope = source.match(/\b(?:budget|spend|total group price)[^;\n]{0,250}/i)?.[0];
    const detail = money(budgetScope || source);
    const currency = detail.currency || next.currency;
    if (detail.amount !== undefined) {
      let multiplier = 1;
      let confirmed = true;
      if (detail.perPerson) {
        if (next.adults === null || next.children === null) confirmed = false;
        else multiplier *= next.adults + next.children;
      }
      if (detail.perDay || detail.perNight) {
        const duration = numeric(source).match(
          new RegExp(`\\b(\\d+)\\s*[- ]?${detail.perNight ? 'nights?' : 'days?'}\\b`, 'i'),
        );
        if (duration && +duration[1] > 0) multiplier *= +duration[1];
        else confirmed = false;
      }
      next.currency = currency;
      next.requirements = next.requirements.filter((value) => !value.startsWith('Budget basis:'));
      next.budget =
        confirmed && detail.amount * multiplier <= 10000000 ? detail.amount * multiplier : null;
      if (detail.perPerson || detail.perDay || detail.perNight) {
        const basis = `Budget basis: ${currency} ${detail.amount}${detail.perPerson ? ' per person' : ''}${detail.perDay ? ' per day' : ''}${detail.perNight ? ' per night' : ''}${confirmed ? '; group total calculated from confirmed multipliers.' : '; group total not confirmed.'}`;
        next.requirements = [
          ...next.requirements.filter((value) => !value.startsWith('Budget basis:')),
          basis,
        ].slice(-30);
      }
    } else if (detail.currency) {
      if (next.currency !== detail.currency) next.budget = null;
      next.currency = detail.currency;
    } else if (/\b(?:no (?:fixed )?budget|budget (?:is )?flexible|no budget limit)\b/i.test(source))
      next.budget = null;
  }
  return next;
}

type GroundingStop = Pick<StudioStop, 'name' | 'country' | 'nights'> & Partial<StudioStop>;
const placeNormal = (name: string) => normal(name).replace(/[.,]/g, '').replace(/\s+/g, ' ');
const countryNormal = (value: string) =>
  ({
    uk: 'united kingdom',
    'u k': 'united kingdom',
    usa: 'united states',
    us: 'united states',
    'united states of america': 'united states',
  })[placeNormal(value)] || placeNormal(value);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function containsPlace(text: string, name: string) {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(normal(name))}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(
    normal(text),
  );
}
function sameRoute(current: GroundingStop[], proposed: GroundingStop[]) {
  return (
    current.length === proposed.length &&
    current.every((old, index) => {
      const next = proposed[index];
      return (
        placeNormal(old.name) === placeNormal(next.name) &&
        (!old.country || countryNormal(old.country) === countryNormal(next.country)) &&
        old.nights === next.nights &&
        (old.onwardTransport || 'undecided') === (next.onwardTransport || 'undecided') &&
        (old.neighbourhood || '') === (next.neighbourhood || '') &&
        Boolean(old.arrivalFixed) === Boolean(next.arrivalFixed) &&
        (!old.arrivalFixed || old.arrivalDate === next.arrivalDate)
      );
    })
  );
}
function routeEntries(source: string): { name: string; country: string; nights: number }[] {
  const entries: { name: string; country: string; nights: number }[] = [];
  const text = numeric(source);
  const pattern =
    /(?:^|[,;:\n]|\bthen\s+|\band\s+)\s*([\p{L}][\p{L} .’'-]{1,70}?)(?:,\s*([\p{L}][\p{L} .’'-]{1,70}?))?\s+(?:for\s+)?(\d{1,3})\s+nights?\b/giu;
  for (const match of text.matchAll(pattern)) {
    const name = match[1]
      .replace(/^(?:change|switch|replace)\b.*\b(?:to|with)\s+/i, '')
      .replace(
        /^(?:(?:and|then|visit|plan|stay in|go to|travel to|a trip to|we want|we would like)\s+)+/i,
        '',
      )
      .trim();
    if (!name || /\b(?:adults?|children|budget|hotels?|proposal|nights?)\b/i.test(name)) continue;
    entries.push({ name, country: match[2]?.trim() || '', nights: +match[3] });
  }
  return entries;
}

function namedSequence(source: string, proposed: GroundingStop[]): string[] {
  const match = source.match(
    /\b(?:visit(?:ing)?|travel to|go to|destinations?\s*[:=]|route\s*[:=]|plan(?: a trip to)?)\s+([^.;\n]+)/i,
  );
  if (!match) return [];
  const phrase = match[1].split(
    /\s+\b(?:for|from|starting|on|with|budget|in|arriving)\b|\s+\d/i,
  )[0];
  if (/^(?:a|an|the|my|our|new|this|some|somewhere|anywhere|which|what|how|\d)\b/i.test(phrase))
    return [];
  const parts = phrase
    .split(/\s*(?:,|→|->|\band\b|\bthen\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return [];
  return parts.filter(
    (part) =>
      /^[\p{L}][\p{L} .’'-]{0,80}$/u.test(part) &&
      !proposed.some((stop) => stop.country && countryNormal(stop.country) === countryNormal(part)),
  );
}

function requestedNights(
  source: string,
  name: string,
  current: number | null,
  singleStop: boolean,
): number | undefined {
  const text = numeric(source),
    place = escape(name);
  const add =
    text.match(
      new RegExp(
        `\\b(?:extend|lengthen)\\b[^.;\\n]{0,35}${place}\\s+by\\s+(\\d+)\\s+nights?\\b`,
        'i',
      ),
    ) ||
    text.match(new RegExp(`\\badd\\s+(\\d+)\\s+nights?\\s+(?:to|in)\\s+${place}\\b`, 'i')) ||
    text.match(new RegExp(`${place}\\s+(?:for\\s+)?(\\d+)\\s+more\\s+nights?\\b`, 'i'));
  if (add && current !== null) return current + Number(add[1]);
  const subtract =
    text.match(
      new RegExp(`\\bshorten\\b[^.;\\n]{0,35}${place}\\s+by\\s+(\\d+)\\s+nights?\\b`, 'i'),
    ) || text.match(new RegExp(`\\bremove\\s+(\\d+)\\s+nights?\\s+from\\s+${place}\\b`, 'i'));
  if (subtract && current !== null) return current - Number(subtract[1]);
  const absolute =
    text.match(
      new RegExp(
        `${place}(?:\\s*,\\s*[\\p{L} .'-]+)?\\s+(?:(?:for|to|at)\\s+)?(\\d+)\\s+nights?\\b`,
        'iu',
      ),
    ) ||
    text.match(new RegExp(`\\b(\\d+)\\s+nights?\\s+(?:in|at|for)\\s+${place}\\b`, 'i')) ||
    (singleStop ? text.match(/^\s*(\d+)\s+nights?\s*(?:please)?[.!]?\s*$/i) : null);
  return absolute ? Number(absolute[1]) : undefined;
}

/** A literal excerpt cannot justify replacing London with an unrelated model-selected city. */
export function assertStudioRouteGrounding(
  current: StudioStop[],
  proposed: GroundingStop[],
  message: string,
  documentTexts: string[],
  routeEvidence: string,
): void {
  if (sameRoute(current, proposed)) return;
  const fail = () => {
    throw new StudioError(
      502,
      'The route did not match the supplied destinations or stay lengths. Please retry or edit the route directly.',
    );
  };
  if (!actualSources(routeEvidence, message, documentTexts).length) fail();
  const ideas =
    /\b(?:suggest|recommend|choose|pick|design)\b.{0,65}\b(?:route|destinations?|cities|places|itinerary)\b|\b(?:route ideas|where should (?:we|they|i) go|surprise me)\b/i.test(
      message,
    );
  const change =
    /\b(?:change|replace|swap|move|reorder|reverse|add|remove|drop|skip|extend|shorten|stay|nights?|arriv(?:e|al)|depart|train|rail|fly|flight|neighbourhood|neighborhood)\b/i.test(
      message,
    );
  const sourceChange =
    /\b(?:use|update|build|plan|read|review)\b.{0,50}\b(?:source|document|import|screenshot|pnr|brief|route|itinerary)\b/i.test(
      message,
    );
  if (current.length && !change && !ideas && !sourceChange) fail();
  const source = [message, ...(!current.length || sourceChange ? documentTexts : [])].join('\n');
  for (const entry of proposed) {
    const old = current.find((previous) => placeNormal(previous.name) === placeNormal(entry.name));
    if (!ideas && old && old.nights !== entry.nights) {
      const expected = requestedNights(source, entry.name, old.nights, current.length === 1);
      if (expected === undefined || expected !== entry.nights) fail();
    }
    if (
      entry.arrivalFixed &&
      entry.arrivalDate &&
      !readDates(source).some((date) => date.date === entry.arrivalDate) &&
      !current.some(
        (old) =>
          old.arrivalFixed &&
          placeNormal(old.name) === placeNormal(entry.name) &&
          old.arrivalDate === entry.arrivalDate,
      )
    )
      fail();
  }
  if (!ideas) {
    for (const entry of proposed)
      if (
        !containsPlace(source, entry.name) &&
        !current.some((old) => placeNormal(old.name) === placeNormal(entry.name))
      )
        fail();
    const relativeNights =
      /\b(?:extend|lengthen|shorten)\b[^.;\n]{0,60}\bby\s+\w+\s+nights?\b|\b(?:add|remove)\s+\w+\s+nights?\s+(?:to|in|from)\b|\bmore nights?\b/i.test(
        source,
      );
    const explicit = relativeNights ? [] : routeEntries(source);
    if (explicit.length) {
      let cursor = -1;
      for (const entry of explicit) {
        const index = proposed.findIndex(
          (next, at) => at > cursor && placeNormal(next.name) === placeNormal(entry.name),
        );
        if (
          index < 0 ||
          proposed[index].nights !== entry.nights ||
          (entry.country && countryNormal(proposed[index].country) !== countryNormal(entry.country))
        )
          fail();
        cursor = index;
      }
    } else {
      const sequence = namedSequence(source, proposed);
      let cursor = -1;
      for (const name of sequence) {
        const index = proposed.findIndex(
          (entry, at) => at > cursor && placeNormal(entry.name) === placeNormal(name),
        );
        if (index < 0) fail();
        cursor = index;
      }
    }
    if (!explicit.length && !current.length) {
      const intent = detectDestinationIntent(source);
      if (
        intent.kind === 'explicit' &&
        !proposed.some(
          (entry) =>
            containsPlace(intent.name, entry.name) || containsPlace(entry.name, intent.name),
        )
      )
        fail();
    }
    if (/\breverse (?:the )?(?:route|order|itinerary)\b/i.test(message) && current.length) {
      const reversed = [...current].reverse();
      if (
        reversed.length !== proposed.length ||
        reversed.some(
          (entry, index) => placeNormal(entry.name) !== placeNormal(proposed[index].name),
        )
      )
        fail();
    }
    for (let left = 0; left < proposed.length; left++)
      for (let right = 0; right < proposed.length; right++) {
        if (left === right) continue;
        const a = escape(proposed[left].name),
          b = escape(proposed[right].name);
        if (new RegExp(`${a}\\s+(?:to\\s+)?before\\s+${b}`, 'i').test(message) && left > right)
          fail();
        if (new RegExp(`${a}\\s+(?:to\\s+)?after\\s+${b}`, 'i').test(message) && left < right)
          fail();
      }
    // Explicit city names appearing in a requested order must remain in that order,
    // unless the instruction itself asks for reordering/removal/replacement.
    if (
      !/\b(?:move|reorder|reverse|swap|replace|remove|drop|skip|instead|before|after)\b/i.test(
        message,
      )
    ) {
      const positioned = proposed
        .map((entry, index) => ({ index, position: normal(message).indexOf(normal(entry.name)) }))
        .filter((entry) => entry.position >= 0);
      if (
        positioned.some(
          (entry, index) => index > 0 && entry.position < positioned[index - 1].position,
        )
      )
        fail();
      if (current.length && !/\b(?:change|new|start over)\b/i.test(message)) {
        const retained = current.filter((old) =>
          proposed.some((entry) => placeNormal(entry.name) === placeNormal(old.name)),
        );
        if (retained.length !== current.length) fail();
        const indexes = retained.map((entry) =>
          proposed.findIndex((next) => placeNormal(next.name) === placeNormal(entry.name)),
        );
        if (indexes.some((index, at) => at > 0 && index < indexes[at - 1])) fail();
      }
    }
  }
}
