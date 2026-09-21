import {
  MAX_ADULTS,
  MAX_CHILDREN,
  describeMonth,
  describeParty,
  type TripDates,
  type TripParty,
} from './trip-details';

const count =
  '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)';
const partyPatterns = [
  new RegExp(
    `\\b${count}\\s*(?:adults?|children|kids?|travell?ers?|people|persons?|guests?|passengers?|friends?)\\b`,
    'i',
  ),
  new RegExp(`\\b(?:party|group|family)\\s+of\\s+${count}\\b`, 'i'),
  new RegExp(`\\b${count}\\s+of\\s+us\\b`, 'i'),
  new RegExp(
    `\\bfor\\s+${count}(?=[,.;!?]|$|\\s+(?:with|on|in|from|starting|departing|leaving|who|and|but|to|at)\\b)`,
    'i',
  ),
  /\b(?:solo|alone|by myself|on my own|just me)\b/i,
  /\b(?:(?:as|for) a couple|couple[’']?s? (?:trip|holiday|vacation|getaway))\b/i,
  /\b(?:my (?:partner|wife|husband) and (?:I|me)|(?:I|me) and my (?:partner|wife|husband))\b/i,
];

const month =
  '(?:January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sept?|October|Oct|November|Nov|December|Dec)';
const datePatterns = [
  /\b\d{4}-\d{1,2}-\d{1,2}\b/,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
  /\b\d{1,2}-\d{1,2}-\d{2,4}\b/,
  new RegExp(
    `\\b(?:${month}\\.?\\s+(?:\\d{4}|\\d{1,2}(?:st|nd|rd|th)?)|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${month})\\b`,
    'i',
  ),
  new RegExp(
    `\\b(?:in|during|starting|from|after|before|by|this|next)\\s+(?:(?:early|mid|late)[ -])?${month}\\b`,
    'i',
  ),
  new RegExp(`\\b${month}\\s+(?:trip|holiday|vacation|getaway)\\b`, 'i'),
  /\b(?:today|tomorrow|tonight|anytime|flexible dates?|dates? (?:are )?flexible|no fixed dates?|no dates? yet)\b/i,
  /\b(?:next|this|coming|on|starting|from)\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|weekend|week|month|year|spring|summer|autumn|fall|winter)\b/i,
  /\b(?:in|during)\s+(?:the\s+)?(?:spring|summer|autumn|fall|winter)\b/i,
  new RegExp(`\\bin\\s+${count}\\s+(?:days?|weeks?|months?)\\b`, 'i'),
];

/** A party the chips can vouch for. Nobody travels alone-less, and a coachload is a brief to write
    out rather than a number to tick up, so anything outside these bounds is left unsaid. */
const usableParty = (party: TripParty) =>
  Number.isInteger(party.adults) &&
  Number.isInteger(party.children) &&
  party.adults >= 1 &&
  party.adults <= MAX_ADULTS &&
  party.children >= 0 &&
  party.children <= MAX_CHILDREN;

/** The dates half of the supplement. A span is stated as a span in both grains, because the length
    of a trip is as much of a constraint as its start: a client who picks December and January
    means one holiday over the new year, not a choice between two. The flexible wording keeps the
    grain honest — months, not days — so nothing downstream reads a precision that was never
    given. */
function describeDateChoice(dates: TripDates): string {
  if (dates.mode === 'flexible') {
    if (!dates.start) return '';
    if (!dates.end || dates.end === dates.start)
      return `with flexible dates in ${describeMonth(dates.start)}`;
    return `with flexible dates, leaving in ${describeMonth(dates.start)} and returning in ${describeMonth(dates.end)}`;
  }
  if (!dates.start) return '';
  return dates.end && dates.end !== dates.start
    ? `from ${dates.start} to ${dates.end}`
    : `starting ${dates.start}`;
}

/** Recognize stated constraints without parsing or rewriting the user's request. */
export function buildTripPrompt(
  message: string,
  defaults: { party?: TripParty; dates?: TripDates },
): string {
  const prompt = message.trim();
  if (!prompt) return '';
  const supplements: string[] = [];
  /* The chips only ever fill a silence. A brief that already names its party or its dates is sent
     word for word, because the agent's own sentence is better evidence of what the client wants
     than a control they may have left at its default. */
  if (
    defaults.party &&
    usableParty(defaults.party) &&
    !partyPatterns.some((pattern) => pattern.test(prompt))
  ) {
    supplements.push(`for ${describeParty(defaults.party)}`);
  }
  if (defaults.dates && !datePatterns.some((pattern) => pattern.test(prompt))) {
    const phrase = describeDateChoice(defaults.dates);
    if (phrase) supplements.push(phrase);
  }
  return [prompt, ...supplements].join(' ');
}
