import type { StudioBrief, StudioStop, StudioWorkspace } from '../shared/studio.ts';
import { StudioError } from './studio-store.ts';
import { detectDestinationIntent } from './planner.ts';
import { normalizeStudioCountry, studioCountries } from '../shared/studio-travel-research.ts';

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
export type StudioDateReference = { date: string; index: number };
const validDate = (date: string) =>
  Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

function literalDates(
  source: string,
  today: string,
  referenceDate?: string,
): StudioDateReference[] {
  const dates: StudioDateReference[] = [];
  const occupied: [number, number][] = [];
  const add = (year: number, month: number, day: number, index: number) => {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (validDate(date) && !dates.some((entry) => entry.date === date && entry.index === index))
      dates.push({ date, index });
  };
  const yearFor = (month: number, day: number, explicit?: string) => {
    if (explicit) return Number(explicit);
    if (referenceDate) return Number(referenceDate.slice(0, 4));
    const year = Number(today.slice(0, 4));
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return candidate < today ? year + 1 : year;
  };
  const claim = (match: RegExpMatchArray) => {
    const index = match.index!;
    if (occupied.some(([start, end]) => index < end && index + match[0].length > start))
      return false;
    occupied.push([index, index + match[0].length]);
    return true;
  };
  for (const match of source.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    claim(match);
    add(+match[1], +match[2], +match[3], match.index);
  }
  for (const match of source.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g)) {
    claim(match);
    add(+match[3], +match[2], +match[1], match.index);
  }
  for (const match of source.matchAll(
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:to|[-–])\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthWords})\\.?(?:[,]?\\s+(20\\d{2}))?\\b`,
      'gi',
    ),
  )) {
    if (!claim(match)) continue;
    const month = months[match[3].toLowerCase()];
    const year = yearFor(month, +match[1], match[4]);
    add(year, month, +match[1], match.index);
    add(year, month, +match[2], match.index + match[0].indexOf(match[2], match[1].length));
  }
  for (const match of source.matchAll(
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthWords})\\.?(?:[,]?\\s+(20\\d{2}))?\\b`,
      'gi',
    ),
  )) {
    if (!claim(match)) continue;
    const month = months[match[2].toLowerCase()];
    add(yearFor(month, +match[1], match[3]), month, +match[1], match.index);
  }
  for (const match of source.matchAll(
    new RegExp(
      `\\b(${monthWords})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[,]?\\s+(20\\d{2}))?\\b`,
      'gi',
    ),
  )) {
    if (!claim(match)) continue;
    const month = months[match[1].toLowerCase()];
    add(yearFor(month, +match[2], match[3]), month, +match[2], match.index);
  }
  // An ordinal alone borrows a month/year only from supplied trip context, never
  // from today's month or an assistant's suggestion.
  const datedMonths = new Set(dates.map(({ date }) => date.slice(0, 7)));
  const monthContext = datedMonths.size === 1 ? dates[0].date : referenceDate;
  if (monthContext)
    for (const match of source.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi)) {
      if (!claim(match)) continue;
      const prefix = source.slice(Math.max(0, match.index - 50), match.index);
      if (
        !/\b(?:on|arriv\w*|return\w*|back|leave|leaving|depart\w*|until|through|from|to)\b/i.test(
          prefix,
        ) &&
        !/^\s*(?:the\s+)?\d{1,2}(?:st|nd|rd|th)(?:\s+please)?[.!]?\s*$/i.test(source)
      )
        continue;
      add(+monthContext.slice(0, 4), +monthContext.slice(5, 7), +match[1], match.index);
    }
  const ordered = dates.sort((a, b) => a.index - b.index);
  return ordered.filter((entry, index) => {
    const prefix = source.slice(Math.max(0, entry.index - 150), entry.index);
    let clause = prefix.split(/[.;,\n]|\bbut\b/i).at(-1) || '';
    const previous = ordered[index - 1];
    if (previous && previous.index >= entry.index - clause.length) {
      const afterPrevious = source.slice(previous.index + 1, entry.index);
      // A new explicit role starts a new declaration, e.g. "not arrive on
      // 3 October and arrive on 4 October". Otherwise preserve coordinated
      // exclusions such as "not 3 October or 4 October".
      if (/\b(?:arriv\w*|depart\w*|return\w*|leav\w*|start\w*|end\w*)\b/i.test(afterPrevious))
        clause = afterPrevious;
    }
    if (/\b(?:not|never|instead of|rather than|except)\b/i.test(clause)) return false;
    const next = ordered[index + 1];
    if (
      next &&
      /\b(?:chang\w*|move|shift|reschedule|correct|update|postpone|advance)\b/i.test(prefix) &&
      /\b(?:arriv\w*|depart\w*|return\w*|start\w*|end\w*)\b/i.test(prefix) &&
      /\bfrom\s*$/i.test(prefix) &&
      /\bto\b/i.test(source.slice(entry.index, next.index))
    )
      return false;
    return true;
  });
}

function suppliedDateContext(context: StudioGroundingContext) {
  const today = context.today || new Date().toISOString().slice(0, 10);
  const saved = [
    context.brief?.departureDate,
    context.brief?.startDate,
    context.brief?.endDate,
  ].filter((date): date is string => Boolean(date && validDate(date)));
  let reference: string | undefined = saved[0];
  let latest: StudioDateReference[] = [];
  for (const entry of context.messages || []) {
    if (entry.role !== 'user') continue;
    const dates = literalDates(entry.content, today, reference);
    if (!dates.length) continue;
    latest = dates;
    reference =
      new Set(dates.map(({ date }) => date.slice(0, 7))).size === 1 ? dates[0].date : undefined;
  }
  const dates = latest.length ? latest.map(({ date }) => date) : saved;
  return { today, reference, unique: new Set(dates).size === 1 ? dates[0] : undefined };
}

/** Resolve omitted years/months from user-supplied trip dates, not model prose. */
export function readStudioDateReferences(
  source: string,
  context: StudioGroundingContext = {},
): StudioDateReference[] {
  const supplied = suppliedDateContext(context);
  const dates = literalDates(source, supplied.today, supplied.reference);
  const reference = source.match(
    /\b(?:same date|same day|that date|that day|(?:it(?:['’]s| is|s)|that(?:['’]s| is)|this is)\s+(?:my |the )?(?:arrival|departure|return|start|end) date)\b/i,
  );
  if (!dates.length && supplied.unique && reference)
    dates.push({ date: supplied.unique, index: reference.index! + reference[0].length });
  return dates;
}

const readDates = readStudioDateReferences;
type TravelDateField = 'startDate' | 'endDate' | 'departureDate';

const travelDateLabels: Record<TravelDateField, RegExp> = {
  startDate: /\b(?:arriv(?:e|es|ing|al)|start(?:s|ing)?|begin(?:s|ning)?)\b/i,
  endDate: /\b(?:end(?:s|ing)?|return(?:s|ing)?|until|through|back|leav(?:e|ing))\b/i,
  departureDate: /\b(?:depart(?:s|ing|ure)?|outbound|outward)\b/i,
};

function movementDateRole(
  source: string,
  context: StudioGroundingContext,
): 'departureDate' | 'endDate' | undefined {
  const origin = context.brief?.origin?.trim();
  const destination = context.brief?.preferredDestination?.trim();
  if (origin && destination && normal(origin) === normal(destination)) return;
  const matches: { field: 'departureDate' | 'endDate'; index: number }[] = [];
  for (const [place, field] of [
    [origin, 'departureDate'],
    [destination, 'endDate'],
  ] as const) {
    if (!place) continue;
    const escaped = place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const pattern of [
      `\\b(?:depart(?:s|ing|ure)?|leav(?:e|ing))\\s+(?:(?:date|day)\\s+)?(?:from\\s+)?${escaped}(?=$|[^\\p{L}\\p{N}])`,
      `(?:^|[^\\p{L}\\p{N}])${escaped}(?:['’]s)?\\s+(?:departure|departing)\\b`,
    ])
      for (const match of source.matchAll(new RegExp(pattern, 'giu')))
        matches.push({ field, index: match.index });
  }
  return matches.sort((a, b) => b.index - a.index)[0]?.field;
}

function dateRole(
  source: string,
  entry: StudioDateReference,
  context: StudioGroundingContext = {},
): TravelDateField | undefined {
  const prefix =
    source
      .slice(Math.max(0, entry.index - 70), entry.index)
      .split(/[.;\n]/)
      .at(-1) || '';
  const latest = (Object.entries(travelDateLabels) as [TravelDateField, RegExp][])
    .flatMap(([field, pattern]) =>
      [...prefix.matchAll(new RegExp(pattern.source, 'gi'))].map((match) => ({
        field,
        index: match.index,
        word: match[0],
      })),
    )
    .sort((a, b) => b.index - a.index)[0];
  if (!latest) return;
  if (/^(?:depart|leav)/i.test(latest.word)) {
    const scoped = movementDateRole(prefix, context);
    if (scoped) return scoped;
    // A short "departure" answer to an explicit return question refers to the
    // destination departure. The origin-versus-arrival question remains distinct.
    if (latest.field === 'departureDate' && answersField(questionFields(context), 'endDate'))
      return 'endDate';
  }
  return latest.field;
}

function dateFor(
  source: string,
  field: TravelDateField,
  allowBare: boolean,
  context: StudioGroundingContext = {},
): string | undefined {
  const dates = readDates(source, context);
  if (!dates.length) return;
  const anchored = dates.filter((entry) => dateRole(source, entry, context) === field);
  if (anchored.length) return (field === 'endDate' ? anchored.at(-1) : anchored[0])!.date;
  if (
    field !== 'departureDate' &&
    dates.length >= 2 &&
    /\b(?:to|between|until|through)\b|[–]/i.test(source) &&
    !travelDateLabels.departureDate.test(source)
  )
    return (field === 'startDate' ? dates[0] : dates.at(-1))!.date;
  if (
    allowBare &&
    dates.length === 1 &&
    !Object.values(travelDateLabels).some((pattern) => pattern.test(source)) &&
    !/\b(?:fly|flight)\b/i.test(source)
  )
    return dates[0].date;
}

const dateOnlyAnswer = (source: string) =>
  !source
    .replace(new RegExp(`\\b(?:${monthWords})\\b`, 'gi'), '')
    .replace(/\b\d{1,4}(?:st|nd|rd|th)?\b/g, '')
    .replace(/\b(?:on|the|of|please)\b/gi, '')
    .replace(/[\s,./!–-]/g, '');

/** Literal date roles for turn orchestration; a departure never implies an arrival. */
export function groundedStudioDates(
  source: string,
  context: StudioGroundingContext = {},
): Partial<Pick<StudioBrief, TravelDateField>> {
  const asked = questionFields(context, context.brief);
  const result: Partial<Pick<StudioBrief, TravelDateField>> = {};
  for (const field of ['startDate', 'endDate', 'departureDate'] as const) {
    const value = dateFor(source, field, answersField(asked, field), context);
    if (value) result[field] = value;
  }
  return result;
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

export type StudioGroundingContext = {
  /** Override the current ISO date for stable tests or a request's date context. */
  today?: string;
  messages?: Pick<StudioWorkspace['messages'][number], 'role' | 'content'>[];
  /** The brief after applying literal, validated user facts. */
  brief?: StudioBrief;
};

function questionFields(
  context: StudioGroundingContext,
  current: Pick<StudioBrief, 'children'> = { children: null },
) {
  const reply = context.messages?.findLast((entry) => entry.role === 'assistant')?.content || '';
  const sentences = reply.match(/[^.!?]+[.!?]?/g) || [];
  const question =
    [...sentences].reverse().find((sentence) => sentence.endsWith('?')) || sentences.at(-1) || '';
  const fields = new Set<string>();
  if (/\badults?\b/i.test(question)) fields.add('adults');
  const ages = /\b(?:ages?|how old)\b/i.test(question);
  if (ages && (/\b(?:children|kids?|infants?|their)\b/i.test(question) || current.children))
    fields.add('childAges');
  else if (/\b(?:children|kids?|infants?)\b/i.test(question)) fields.add('children');
  if (/\b(?:budget|spend|price point|group total)\b/i.test(question)) fields.add('budget');
  if (/\b(?:nights?|length of stay|how long)\b/i.test(question)) fields.add('nights');
  if (/\b(?:arrival|arrive|start(?:ing)? date|when.*(?:travel|go|begin|start))\b/i.test(question))
    fields.add('startDate');
  if (/\b(?:return|end date)\b/i.test(question)) fields.add('endDate');
  if (/\b(?:leave|leaving)\b/i.test(question))
    fields.add(movementDateRole(question, context) || 'endDate');
  if (/\b(?:depart(?:ure)?|outbound|outward)\b/i.test(question))
    fields.add(movementDateRole(question, context) || 'departureDate');
  if (/\bdates?\b/i.test(question) && !/\b(?:birth|born)\b/i.test(question))
    fields.add('datesFlexible');
  return fields;
}

function answersField(fields: Set<string>, field: string) {
  if (!fields.has(field)) return false;
  if (['startDate', 'endDate', 'departureDate'].includes(field))
    return ['startDate', 'endDate', 'departureDate'].every(
      (other) => other === field || !fields.has(other),
    );
  if (field === 'datesFlexible')
    return [...fields].every((entry) =>
      ['startDate', 'endDate', 'departureDate', 'datesFlexible'].includes(entry),
    );
  return fields.size === 1;
}

/** Apply only source-grounded critical facts. The model chooses fields; it cannot invent their values. */
export function groundedStudioBrief(
  current: StudioBrief,
  proposed: StudioBrief,
  facts: { field: keyof StudioBrief; evidence: string }[],
  message: string,
  documentTexts: string[],
  context: StudioGroundingContext = {},
): StudioBrief {
  const next = structuredClone(current);
  const asked = questionFields({ ...context, brief: current }, current);
  const contextual = (source: string, field: string) =>
    normal(source) === normal(message) && answersField(asked, field);
  const valid = facts
    .map((fact) => ({ ...fact, sources: actualSources(fact.evidence, message, documentTexts) }))
    .filter((fact) => fact.sources.length);
  // A residence, departure city or birthplace does not establish the passport held.
  // Country names cover the global ISO list; common nationality adjectives supplement it.
  const demonyms: Record<string, string> = {
    australian: 'AU',
    pakistani: 'PK',
    british: 'GB',
    american: 'US',
    indian: 'IN',
    canadian: 'CA',
    german: 'DE',
    french: 'FR',
    italian: 'IT',
    spanish: 'ES',
    portuguese: 'PT',
    irish: 'IE',
    dutch: 'NL',
    belgian: 'BE',
    swiss: 'CH',
    austrian: 'AT',
    swedish: 'SE',
    norwegian: 'NO',
    danish: 'DK',
    finnish: 'FI',
    polish: 'PL',
    czech: 'CZ',
    greek: 'GR',
    turkish: 'TR',
    russian: 'RU',
    ukrainian: 'UA',
    chinese: 'CN',
    japanese: 'JP',
    'south korean': 'KR',
    'north korean': 'KP',
    taiwanese: 'TW',
    indonesian: 'ID',
    malaysian: 'MY',
    singaporean: 'SG',
    thai: 'TH',
    vietnamese: 'VN',
    filipino: 'PH',
    bangladeshi: 'BD',
    nepali: 'NP',
    nepalese: 'NP',
    'sri lankan': 'LK',
    emirati: 'AE',
    saudi: 'SA',
    qatari: 'QA',
    bahraini: 'BH',
    kuwaiti: 'KW',
    omani: 'OM',
    iranian: 'IR',
    iraqi: 'IQ',
    egyptian: 'EG',
    moroccan: 'MA',
    kenyan: 'KE',
    nigerian: 'NG',
    ghanaian: 'GH',
    'south african': 'ZA',
    brazilian: 'BR',
    argentinian: 'AR',
    argentine: 'AR',
    mexican: 'MX',
    colombian: 'CO',
    chilean: 'CL',
    'new zealand': 'NZ',
    'new zealander': 'NZ',
    fiji: 'FJ',
    fijian: 'FJ',
  };
  const countryWords = [
    ...studioCountries.map(({ name, code }) => [name, code] as const),
    ...Object.entries(demonyms),
    ...[
      'UK',
      'USA',
      'UAE',
      'Turkey',
      'Russia',
      'South Korea',
      'North Korea',
      'Hong Kong',
      'Macau',
      'Laos',
      'Vietnam',
    ].map((name) => [name, normalizeStudioCountry(name)!.code]),
  ];
  const lastReply =
    context.messages?.findLast((entry) => entry.role === 'assistant')?.content || '';
  const lastQuestion = (lastReply.match(/[^.!?]+\?/g) || []).at(-1) || '';
  const askedPassport = /\b(?:passport|nationality|citizenship)\b/i.test(lastQuestion);
  for (const fact of valid.filter((fact) => fact.field === 'passportNationality')) {
    const declared = new Set<string>();
    for (const source of fact.sources) {
      if (askedPassport && normal(source) === normal(message)) {
        const answer = source
          .trim()
          .replace(/[.!]$/, '')
          .replace(/\s+passport$/i, '');
        const code = normalizeStudioCountry(answer)?.code || demonyms[normal(answer)];
        if (code) declared.add(code);
      }
      for (const [phrase, code] of countryWords) {
        const word = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (
          new RegExp(
            `\\b(?:not|never|no|isn.t|doesn.t|don.t|without)\\b.{0,45}\\b${word}\\b`,
            'i',
          ).test(source)
        )
          continue;
        const before = new RegExp(
          `\\b(?:passport(?: nationality| country)?|nationality|citizenship|citizen of)\\s*(?:(?:is|held|from|issued by|of)\\s*|[:=-]\\s*){0,2}${word}(?=$|[^\\p{L}])`,
          'iu',
        );
        const after = new RegExp(
          `(?:^|[^\\p{L}])${word}\\s+(?:(?:ordinary|regular|valid)\\s+)?(?:passport|nationality|citizenship|citizen|national|client|travell?er)\\b`,
          'iu',
        );
        const adjective =
          demonyms[normal(phrase)] &&
          new RegExp(
            `\\b(?:i am|i['’]m|he is|he['’]s|she is|she['’]s|they are|they['’]re|(?:the )?client is)\\s+(?:(?:a|an)\\s+)?${word}(?=$|[^\\p{L}])`,
            'iu',
          ).test(source);
        if (before.test(source) || after.test(source) || adjective) declared.add(code);
      }
      const explicitCode = source.match(
        /\b(?:passport nationality|passport country|nationality|citizenship)\s*[:=-]\s*([A-Z]{2})\b/i,
      );
      if (explicitCode) {
        const country = normalizeStudioCountry(explicitCode[1]);
        if (country) declared.add(country.code);
      }
    }
    // Multiple declared passports still require the agent to select which one is used.
    if (declared.size === 1) next.passportNationality = [...declared][0];
  }
  const askedTripType =
    /\b(?:single|multi(?:ple)?|one destination)\b/i.test(lastQuestion) &&
    /\b(?:destination|city|cities|trip|stop)\b/i.test(lastQuestion);
  for (const fact of valid.filter((fact) => fact.field === 'tripType')) {
    const source = fact.sources[0];
    const direct =
      askedTripType && normal(source) === normal(message)
        ? normal(source).replace(/[.!]$/, '')
        : '';
    const destination = current.preferredDestination || proposed.preferredDestination || '';
    const escapedDestination = destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const onlyDestination =
      destination &&
      new RegExp(
        `(?:\\b(?:only|just)\\s+(?:visit\\s+)?${escapedDestination}(?=$|[^\\p{L}])|(?:^|[^\\p{L}])${escapedDestination}\\s+only\\b)`,
        'iu',
      ).test(source);
    const single =
      !/\b(?:not|maybe|possibly)\s+(?:a\s+)?(?:single|one|only)\b/i.test(source) &&
      (/\b(?:single[- ](?:destination|city|stop)|(?:only |just )?one (?:destination|city|stop))\b/i.test(
        source,
      ) ||
        Boolean(onlyDestination) ||
        /^(?:single|one)$/.test(direct));
    const multiple =
      !/\b(?:not|maybe|possibly)\s+(?:a\s+)?(?:multi|multiple|several)\b/i.test(source) &&
      (/\b(?:multi[- ](?:destination|city|stop)|(?:multiple|several|two|three|[2-9]|1\d|20) (?:destinations|cities|stops))\b/i.test(
        source,
      ) ||
        /^(?:multiple|multi|several)$/.test(direct));
    if (single !== multiple) next.tripType = single ? 'single' : 'multiple';
    else if (/^(?:undecided|not sure(?: yet)?)$/.test(direct)) next.tripType = 'undecided';
  }
  const asksArrival =
    /\b(?:outbound|outward|arrival|arriv(?:e|ing)|reach(?: the)? destination)\b/i.test(
      lastQuestion,
    );
  const asksReturn = /\b(?:return|back|home)\b/i.test(lastQuestion);
  const transportMode = (source: string): 'flight' | 'cruise' | undefined => {
    const flight = /\b(?:flights?|fly|flying|planes?)\b/i.test(source);
    const cruise = /\b(?:cruises?|cruising)\b/i.test(source);
    return flight === cruise ? undefined : flight ? 'flight' : 'cruise';
  };
  const uncertainTransport = (source: string) =>
    /\b(?:maybe|possibly|undecided|not sure)\b|\b(?:not|no|without)\s+(?:by\s+|a\s+)?(?:flights?|fly|flying|planes?|cruises?|cruising)\b/i.test(
      source,
    );
  for (const fact of valid.filter(
    (fact) => fact.field === 'outboundTransport' || fact.field === 'returnTransport',
  )) {
    const field = fact.field as 'outboundTransport' | 'returnTransport';
    const source = fact.sources[0];
    const applicable = new Set<'flight' | 'cruise'>();
    const askedThisLeg =
      field === 'outboundTransport' ? asksArrival && !asksReturn : asksReturn && !asksArrival;
    if (
      askedThisLeg &&
      normal(source) === normal(message) &&
      /^\s*(?:by\s+)?(?:flights?|fly|planes?|cruises?)(?:\s+please)?[.!]?\s*$/i.test(source)
    ) {
      const mode = transportMode(source);
      if (mode) applicable.add(mode);
    }
    for (const sentence of source.split(/[.;\n]/)) {
      const sharedMode = transportMode(sentence);
      if (
        sharedMode &&
        !uncertainTransport(sentence) &&
        /\b(?:arrival|outbound|outward)\s+and\s+return\b|\b(?:both ways|both legs|there and back|round[- ]trip)\b/i.test(
          sentence,
        )
      ) {
        applicable.add(sharedMode);
        continue;
      }
      for (const clause of sentence.split(/\b(?:and|but|then)\b|,/i)) {
        if (uncertainTransport(clause)) continue;
        const mode = transportMode(clause);
        if (!mode) continue;
        const returning =
          /\b(?:return(?:ing)?|homeward|back home|(?:fly|flight|cruise|cruising) (?:back|home))\b/i.test(
            clause,
          );
        const arriving =
          /\b(?:outbound|outward|arriv(?:e|ing|al)|reach(?:ing)?(?: the)? destination|(?:fly|flying|cruise|cruising) (?:out|to))\b/i.test(
            clause,
          );
        if (field === 'returnTransport' ? returning && !arriving : arriving && !returning)
          applicable.add(mode);
      }
    }
    if (applicable.size === 1) next[field] = [...applicable][0];
  }
  for (const fact of valid.filter((entry) => entry.field === 'tripPurpose')) {
    const source = fact.sources[0];
    const candidates = new Set<NonNullable<StudioBrief['tripPurpose']>>();
    for (const clause of source.split(/[.,;\n]|\b(?:and|but)\b/i)) {
      if (/\b(?:not|no|maybe|possibly|unsure)\b/i.test(clause)) continue;
      if (
        /\b(?:business|bussiness)\s+(?:trip|travel|visit|meetings?)\b|\b(?:for|on)\s+business\b|\battend(?:ing)?\s+(?:a\s+)?conference\b/i.test(
          clause,
        )
      )
        candidates.add('business');
      if (
        /\b(?:tourism|holiday|vacation)\b|\b(?:leisure|tourist)\s+(?:trip|travel|visit)\b/i.test(
          clause,
        )
      )
        candidates.add('tourism');
      if (
        /\b(?:study|studying|student)\s+(?:abroad|visa|course|trip)\b|\b(?:for|to)\s+(?:study|university)\b/i.test(
          clause,
        )
      )
        candidates.add('study');
      if (/\b(?:employment|paid work|taking a job|work visa)\b/i.test(clause))
        candidates.add('employment');
    }
    const direct = normal(message).replace(/[.!]$/, '');
    if (
      /\b(?:purpose|business or leisure|reason for.*trip)\b/i.test(lastQuestion) &&
      ['tourism', 'business', 'study', 'employment', 'other', 'undecided'].includes(direct)
    )
      candidates.add(direct as NonNullable<StudioBrief['tripPurpose']>);
    if (candidates.size === 1) next.tripPurpose = [...candidates][0];
    else if (candidates.size > 1) next.tripPurpose = 'other';
  }
  const critical = new Set<keyof StudioBrief>([
    'adults',
    'children',
    'childAges',
    'budget',
    'currency',
    'startDate',
    'endDate',
    'departureDate',
    'datesFlexible',
    'passportNationality',
    'tripType',
    'tripPurpose',
    'outboundTransport',
    'returnTransport',
    'clientId',
  ]);
  for (const fact of valid)
    if (!critical.has(fact.field)) Object.assign(next, { [fact.field]: proposed[fact.field] });
  for (const fact of valid) {
    if (fact.field !== 'adults' && fact.field !== 'children') continue;
    const source = fact.sources[0];
    const allowBare = bareNumber(message) && contextual(source, fact.field);
    const value =
      count(fact.evidence, fact.field, allowBare) ??
      count(source, fact.field, allowBare) ??
      (fact.field === 'children' &&
      contextual(source, 'children') &&
      /^\s*(?:no|none|nope)(?:\s+(?:this time|thanks|thank you))?[.!]?\s*$/i.test(message)
        ? 0
        : undefined);
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
        numeric(source).match(/\b(?:ages?|aged)\s*[:=]?\s*([\d\s,&-]+(?:and\s*\d+)?)/i)?.[1] ||
        (contextual(source, 'childAges') && /^\s*[\d\s,&-]+(?:and\s*\d+)?[.!]?\s*$/i.test(text)
          ? text
          : '');
      const ages = scoped.match(/\d+/g)?.map(Number) || [];
      if (
        next.children !== 0 &&
        ages.length &&
        ages.every((age) => age <= 17) &&
        (next.children === null || ages.length === next.children)
      )
        next.childAges = ages;
    } else if (
      fact.field === 'startDate' ||
      fact.field === 'endDate' ||
      fact.field === 'departureDate'
    ) {
      // Source context distinguishes an arrival from an outbound flight departure.
      const value = dateFor(source, fact.field, contextual(source, fact.field), {
        ...context,
        brief: current,
      });
      if (value) next[fact.field] = value;
    } else if (fact.field === 'datesFlexible') {
      if (
        /\b(?:dates? (?:are |is )?(?:flexible|not fixed)|flexible dates?|any dates?|no fixed dates?)\b/i.test(
          source,
        ) ||
        (contextual(source, 'datesFlexible') &&
          /^\s*(?:flexible|not fixed)[.!]?\s*$/i.test(message))
      )
        next.datesFlexible = true;
      else if (
        /\b(?:dates? (?:are |is )?(?:fixed|not flexible)|fixed dates?)\b/i.test(source) ||
        (contextual(source, 'datesFlexible') &&
          /^\s*(?:fixed|not flexible)[.!]?\s*$/i.test(message))
      )
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
    if (bareNumber(source) && !contextual(source, 'budget')) detail.amount = undefined;
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
      .replace(/^(?:change|update|set|make)\s+/i, '')
      .replace(/\s+(?:to|at)$/i, '')
      .replace(
        /^(?:(?:and|then|visit|plan|stay in|go to|travel to|a trip to|trip to|to|we want|we would like)\s+)+/i,
        '',
      )
      .trim();
    if (
      !name ||
      /\b(?:adults?|children|budget|hotels?|proposal|nights?)\b/i.test(name) ||
      /^(?:for|about|around|approximately|stay|staying|spend|spending|I|we|they|it|the|a|an)\b/i.test(
        name,
      )
    )
      continue;
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

export function requestedStudioNights(
  source: string,
  name: string,
  current: number | null,
  singleStop: boolean,
  allowBare = false,
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
  if (absolute) return Number(absolute[1]);
  if (!singleStop) return;
  // In a one-stop conversation, arrival and duration often share one short answer:
  // "18 November 2026, for 3 nights". Do not assign another named city's stay here.
  const durations = [...text.matchAll(/\b(\d+)\s+nights?\b/gi)];
  if (
    durations.length === 1 &&
    routeEntries(source).every((entry) => placeNormal(entry.name) === placeNormal(name)) &&
    !/\bnights?\s+(?:in|at|for)\s+[\p{L}]/iu.test(text) &&
    !/\b(?:more|extra|another)(?:\s+\d+)?\s+nights?\b|\b(?:add|remove|extend|lengthen|shorten)\b[^.;\n]{0,50}\bnights?\b|\bby\s+\d+\s+nights?\b/i.test(
      text,
    )
  )
    return Number(durations[0][1]);
  if (allowBare && bareNumber(text)) return Number(text.match(/\d+/)?.[0]);
}

function recentUserRouteSources(messages: NonNullable<StudioGroundingContext['messages']>) {
  const sources: string[] = [];
  for (const entry of [...messages].reverse()) {
    if (entry.role !== 'user') continue;
    sources.push(entry.content);
    // Stop at the most recent destination request: an earlier, superseded route
    // must not justify a model reverting the client's destination.
    if (detectDestinationIntent(entry.content).kind === 'explicit') break;
  }
  return sources;
}

/** A literal excerpt cannot justify replacing London with an unrelated model-selected city. */
export function assertStudioRouteGrounding(
  current: StudioStop[],
  proposed: GroundingStop[],
  message: string,
  documentTexts: string[],
  routeEvidence: string,
  context: StudioGroundingContext = {},
): void {
  if (sameRoute(current, proposed)) return;
  const fail = () => {
    throw new StudioError(
      502,
      'The route did not match the supplied destinations or stay lengths. Please retry or edit the route directly.',
    );
  };
  const messages = context.messages || [];
  const history = !current.length ? recentUserRouteSources(messages) : [];
  if (!actualSources(routeEvidence, message, [...documentTexts, ...history]).length) fail();
  const asked = questionFields(context, context.brief);
  const answeringNights =
    asked.has('nights') &&
    [...asked].every((field) =>
      ['nights', 'startDate', 'endDate', 'datesFlexible'].includes(field),
    );
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
  if (
    current.length &&
    !change &&
    !ideas &&
    !sourceChange &&
    !readDates(message, context).length &&
    !(answeringNights && bareNumber(message))
  )
    fail();
  const source = [message, ...(!current.length || sourceChange ? documentTexts : [])].join('\n');
  const initialSource = [source, ...history].join('\n');
  const turnDates = groundedStudioDates(message, context);
  const sourceDates = readDates(source, context);
  const sourceArrival = groundedStudioDates(source, context).startDate;
  const arrivalDate = turnDates.startDate || context.brief?.startDate;
  const endDate = turnDates.endDate || context.brief?.endDate;
  const dateNights =
    proposed.length === 1 &&
    current.length <= 1 &&
    (turnDates.startDate || turnDates.endDate) &&
    arrivalDate &&
    endDate
      ? (Date.parse(endDate) - Date.parse(arrivalDate)) / 86400000
      : undefined;
  for (const [index, entry] of proposed.entries()) {
    const old = current.find((previous) => placeNormal(previous.name) === placeNormal(entry.name));
    if (!ideas && (old ? old.nights !== entry.nights : entry.nights !== null)) {
      const singleStop = proposed.length === 1 && current.length <= 1;
      const expected =
        requestedStudioNights(
          source,
          entry.name,
          old?.nights ?? null,
          singleStop,
          answeringNights,
        ) ??
        // A single stay's explicitly supplied arrival/return dates establish its
        // length. Never use stale dates during an unrelated turn, or override an
        // explicit (possibly conflicting) night count with this calculation.
        (dateNights !== undefined &&
        Number.isInteger(dateNights) &&
        dateNights >= 0 &&
        dateNights <= 120 &&
        !/\bnights?\b/i.test(source)
          ? dateNights
          : undefined) ??
        (!current.length
          ? history
              .map((text) => requestedStudioNights(text, entry.name, null, singleStop))
              .find((nights) => nights !== undefined)
          : undefined);
      if (expected === undefined || expected !== entry.nights) fail();
    }
    if (
      entry.arrivalFixed &&
      entry.arrivalDate &&
      !sourceDates.some((date) => {
        if (date.date !== entry.arrivalDate) return false;
        const role = dateRole(source, date, context);
        if (role) return role === 'startDate';
        if (index === 0 && sourceArrival === entry.arrivalDate) return true;
        if (sourceDates.length === 1 && dateOnlyAnswer(source)) return true;
        // "London on 3 October for 3 nights" anchors a hotel stay. A trip
        // described only as "four days on 3 October" still needs its date role.
        const cityOnDate = new RegExp(
          `${escape(entry.name)}(?:\\s*,\\s*[\\p{L} .'-]+)?(?:\\s+for\\s+[\\w -]+\\s+nights?)?\\s+(?:on|from)\\s*$`,
          'iu',
        ).test(source.slice(Math.max(0, date.index - 100), date.index));
        return (
          cityOnDate &&
          requestedStudioNights(
            source,
            entry.name,
            old?.nights ?? null,
            proposed.length === 1 && current.length <= 1,
          ) !== undefined
        );
      }) &&
      !(index === 0 && context.brief?.startDate === entry.arrivalDate) &&
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
        !containsPlace(initialSource, entry.name) &&
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
