/* The two details the home composer can borrow from its chips, shaped so the panels that collect
   them and the prompt builder that spends them agree on one vocabulary.

   Both are optional everywhere: a chip that has not been answered is the normal state, and an
   unanswered detail is never invented — Tara asks for what she still needs. */

/** Who is coming, split the way the panel asks it. Children are counted separately because "4
    travellers" and "2 adults and 2 children" plan into different trips. */
export type TripParty = { adults: number; children: number };

/** When they want to go: in both modes a span they leave on and return from, differing only in how
    finely it is known. Specific carries ISO `YYYY-MM-DD` days; flexible carries `YYYY-MM` months,
    which is all a client still choosing a season can honestly give. `end` is empty until the
    return has been picked, and a flexible span of one month means leaving and returning inside it.

    Flexible months are a span, not a list of candidates: December 2026 to January 2027 is one trip
    that crosses the new year, not a choice between two trips. */
export type TripDates =
  | { mode: 'specific'; start: string; end: string }
  | { mode: 'flexible'; start: string; end: string };

export const MAX_ADULTS = 16;
export const MAX_CHILDREN = 8;

export const emptyParty = (): TripParty => ({ adults: 1, children: 0 });

export const partyTotal = (party: TripParty) => party.adults + party.children;

/** The chip's own label, and the phrase the prompt builder appends — one function so the hero and
    the brief can never describe the same party differently. */
export function describeParty(party: TripParty): string {
  const parts = [`${party.adults} ${party.adults === 1 ? 'adult' : 'adults'}`];
  if (party.children > 0)
    parts.push(`${party.children} ${party.children === 1 ? 'child' : 'children'}`);
  return parts.join(', ');
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `2027-04` → `April 2027`. Written out rather than run through toLocaleDateString, which needs a
    day to parse and would drift a month backwards west of Greenwich. */
export function describeMonth(month: string): string {
  const [year, index] = month.split('-');
  const name = MONTH_NAMES[Number(index) - 1];
  return name ? `${name} ${year}` : month;
}

/** Midday, so a bare date string lands on the chosen day in every timezone: parsed as written it
    is UTC midnight, which renders as the day before anywhere west of Greenwich. */
export const readDay = (day: string) => new Date(`${day}T12:00:00`);

export const shortDay = (day: string) =>
  readDay(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** `2027-04` → `Apr 2027`, for the chip, where the full month name would push the bar wider than
    the composer above it. */
export function shortMonth(month: string): string {
  const [year, index] = month.split('-');
  const name = MONTH_NAMES[Number(index) - 1];
  return name ? `${name.slice(0, 3)} ${year}` : month;
}

/** What the chip reads once dates are set: the span, at whichever grain it was given.

    A span inside one year drops the repeated year — "Oct – Nov 2026" — while one that crosses the
    new year keeps both, because the year is the whole point of that answer. */
export function describeDates(dates: TripDates): string {
  if (dates.mode === 'flexible') {
    if (!dates.start) return 'Flexible';
    if (!dates.end || dates.end === dates.start) return describeMonth(dates.start);
    return dates.start.slice(0, 4) === dates.end.slice(0, 4)
      ? `${shortMonth(dates.start).slice(0, 3)} – ${shortMonth(dates.end)}`
      : `${shortMonth(dates.start)} – ${shortMonth(dates.end)}`;
  }
  if (!dates.start) return 'Add dates';
  return dates.end && dates.end !== dates.start
    ? `${shortDay(dates.start)} – ${shortDay(dates.end)}`
    : shortDay(dates.start);
}
