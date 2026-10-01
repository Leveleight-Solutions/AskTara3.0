import type { StudioBrief, StudioQuestion, StudioStop } from './studio';
import { normalizeStudioCountry } from './studio-travel-research';

/* Batch answers for the brief's clarifying questions.

   The questions come from qualifyStudio (server/studio-domain.ts) with stable ids, and most of
   them are a single brief field. Those answers are saved with one workspace PATCH — no model
   call. Only what the agent types in their own words goes to Tara, and all of it in one review
   turn, so eight questions cost at most one round trip instead of eight. */

export interface ClarifyOption {
  id: string;
  label: string;
  detail?: string;
  brief: Partial<StudioBrief>;
}
/** An input beside the options for answers that are a value rather than a choice. */
export type ClarifyInput = 'date' | 'ages' | 'country' | 'nights';
export interface ClarifySpec {
  options: ClarifyOption[];
  input?: ClarifyInput;
  /** Placeholder for the free-text answer, which always goes to Tara. */
  placeholder: string;
}
export type ClarifyAnswer =
  | { kind: 'option'; optionId: string }
  | { kind: 'value'; value: string }
  | { kind: 'text'; text: string }
  /** Nights per route stop, carrying the names so the answer reads back without the route. */
  | { kind: 'nights'; stops: { id: string; name: string; nights: number }[] }
  | { kind: 'skip' };
export type ClarifyAnswers = Record<string, ClarifyAnswer>;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const transport = (field: 'outboundTransport' | 'returnTransport'): ClarifyOption[] => [
  { id: 'flight', label: 'Flight', brief: { [field]: 'flight' } },
  { id: 'cruise', label: 'Cruise', brief: { [field]: 'cruise' } },
];

const SPECS: Record<string, ClarifySpec> = {
  tripType: {
    options: [
      { id: 'single', label: 'Single destination', brief: { tripType: 'single' } },
      { id: 'multiple', label: 'Multiple destinations', brief: { tripType: 'multiple' } },
    ],
    placeholder: 'Describe the scope',
  },
  outboundTransport: { options: transport('outboundTransport'), placeholder: 'Describe it' },
  returnTransport: { options: transport('returnTransport'), placeholder: 'Describe it' },
  startDate: {
    options: [
      {
        id: 'flexible',
        label: 'Dates are flexible',
        detail: 'Keep the route tentative for now.',
        brief: { datesFlexible: true, startDate: '' },
      },
    ],
    input: 'date',
    placeholder: 'e.g. early June, school holidays',
  },
  adults: {
    options: [1, 2, 3, 4].map((n) => ({
      id: String(n),
      label: count(n, 'adult', 'adults'),
      brief: { adults: n },
    })),
    placeholder: 'Another number, or describe the party',
  },
  children: {
    options: [
      { id: '0', label: 'No children', brief: { children: 0, childAges: [] } },
      ...[1, 2, 3].map((n) => ({
        id: String(n),
        label: count(n, 'child', 'children'),
        brief: { children: n },
      })),
    ],
    placeholder: 'Another number, or describe them',
  },
  childAges: { options: [], input: 'ages', placeholder: 'Describe the ages' },
  /* Per-stop nights are saved straight onto the route. Sent as words, the review's grounding check
     rejects even a plain "4 nights in Tokyo, 3 in Kyoto" and asks again, so a typed answer here is
     the fallback for an end date or a route that does not exist yet. */
  nights: { options: [], input: 'nights', placeholder: 'Or an end date, e.g. back by 20 June' },
  hotelStandard: {
    options: ['3-star', '4-star', '5-star', 'Boutique'].map((label) => ({
      id: label.toLowerCase(),
      label,
      brief: { hotelStandard: label },
    })),
    placeholder: 'A price point, brand or style',
  },
  passportNationality: {
    options: [],
    input: 'country',
    placeholder: 'Describe the passports held',
  },
};
const FREE_TEXT: ClarifySpec = { options: [], placeholder: 'Type your answer' };

export function clarifySpec(questionId: string): ClarifySpec {
  return SPECS[questionId] || FREE_TEXT;
}

export const CHILD_AGES_QUESTION: StudioQuestion = {
  id: 'childAges',
  label: 'What are the ages of all children?',
  reason: 'Room, fare and insurance eligibility depend on age.',
  required: false,
};

/** Integers only, for typed counts like "5" — anything wordier is Tara's to read. */
const wholeNumber = (text: string) => (/^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : null);

/** The children count this batch establishes: the answer if one is given, else the brief's. */
export function answeredChildren(answers: ClarifyAnswers, brief: Pick<StudioBrief, 'children'>) {
  const answer = answers.children;
  if (answer?.kind === 'option') return Number(answer.optionId);
  if (answer?.kind === 'text') return wholeNumber(answer.text) ?? brief.children;
  return brief.children;
}

/** The server's questions, plus the ages question as soon as a children answer calls for it. */
export function clarifyQuestions(
  questions: StudioQuestion[],
  answers: ClarifyAnswers,
  brief: Pick<StudioBrief, 'children' | 'childAges'>,
): StudioQuestion[] {
  const list = [...questions];
  const children = answeredChildren(answers, brief);
  const childrenAt = list.findIndex((question) => question.id === 'children');
  if (childrenAt >= 0 && !list.some((question) => question.id === 'childAges')) {
    if (children && children > 0) list.splice(childrenAt + 1, 0, CHILD_AGES_QUESTION);
  }
  // "No children" makes an ages question the server asked earlier moot.
  return children === 0 ? list.filter((question) => question.id !== 'childAges') : list;
}

/** Ages typed as "5, 8" or "5 and 8"; null unless every one is a valid child age. */
export function parseAges(value: string): number[] | null {
  const parts = value.split(/[^0-9]+/).filter(Boolean);
  if (!parts.length) return null;
  const ages = parts.map(Number);
  return ages.every((age) => Number.isInteger(age) && age >= 0 && age <= 17) ? ages : null;
}

/* The brief card's own names for these facts (qualifyStudio), so the turn Tara reads is a short
   list of facts rather than eight questions repeated back at her. Agency questions keep their
   wording, which is the only name they have. */
const SHORT_LABELS: Record<string, string> = {
  route: 'Destinations',
  passportNationality: 'Passport nationality',
  tripType: 'Trip type',
  outboundTransport: 'Travel to destination',
  returnTransport: 'Return travel',
  startDate: 'Arrival date',
  nights: 'Nights or end date',
  adults: 'Adults',
  children: 'Children',
  childAges: 'Child ages',
  budget: 'Group budget',
  hotelStandard: 'Hotel preference',
};
export const shortLabel = (question: StudioQuestion) => SHORT_LABELS[question.id] || question.label;

export interface ClarifyLine {
  questionId: string;
  label: string;
  value: string;
}
export interface ClarifyPlan {
  /** Saved straight to the brief with one PATCH. */
  brief: Partial<StudioBrief>;
  /** The route with answered nights applied, in the same PATCH; the server re-dates it. */
  stops?: StudioStop[];
  saved: ClarifyLine[];
  /** Written answers, sent to Tara together in one review turn. */
  forTara: ClarifyLine[];
}

/** What the agent sees for an answer, in the tray and in the message to Tara. */
export function answerText(questionId: string, answer: ClarifyAnswer): string {
  if (answer.kind === 'skip') return 'Skipped';
  if (answer.kind === 'text') return answer.text.trim();
  if (answer.kind === 'nights')
    return answer.stops
      .map((stop) => `${stop.name} ${count(stop.nights, 'night', 'nights')}`)
      .join(', ');
  if (answer.kind === 'option')
    return (
      clarifySpec(questionId).options.find((option) => option.id === answer.optionId)?.label ||
      answer.optionId
    );
  if (questionId === 'passportNationality')
    return normalizeStudioCountry(answer.value)?.name || answer.value;
  return answer.value.trim();
}

/** True when the answer is complete enough to count — an empty text box is not an answer. */
export function isAnswered(answer: ClarifyAnswer | undefined) {
  if (!answer || answer.kind === 'skip') return false;
  if (answer.kind === 'text') return !!answer.text.trim();
  if (answer.kind === 'value') return !!answer.value.trim();
  if (answer.kind === 'nights') return answer.stops.length > 0;
  return true;
}

export function planClarifyAnswers(
  questions: StudioQuestion[],
  answers: ClarifyAnswers,
  brief: Pick<StudioBrief, 'children' | 'childAges'>,
  stops: StudioStop[] = [],
): ClarifyPlan {
  const plan: ClarifyPlan = { brief: {}, saved: [], forTara: [] };
  const children = answeredChildren(answers, brief);
  for (const question of clarifyQuestions(questions, answers, brief)) {
    const answer = answers[question.id];
    if (!isAnswered(answer)) continue;
    const line = {
      questionId: question.id,
      label: shortLabel(question),
      value: answerText(question.id, answer!),
    };
    if (answer!.kind === 'nights') {
      const nights = new Map(answer!.stops.map((stop) => [stop.id, stop.nights]));
      const known = stops.filter((stop) => nights.has(stop.id));
      // Only stops still on the route; a route Tara has since rebuilt makes these stale.
      if (known.length) {
        plan.stops = stops.map((stop) =>
          nights.has(stop.id) ? { ...stop, nights: nights.get(stop.id)! } : stop,
        );
        plan.saved.push(line);
      }
      continue;
    }
    const structured = structuredAnswer(question.id, answer!, children);
    if (structured) {
      Object.assign(plan.brief, structured);
      plan.saved.push(line);
    } else plan.forTara.push(line);
  }
  return plan;
}

function structuredAnswer(
  questionId: string,
  answer: ClarifyAnswer,
  children: number | null,
): Partial<StudioBrief> | null {
  if (answer.kind === 'option')
    return clarifySpec(questionId).options.find((o) => o.id === answer.optionId)?.brief || null;
  if (answer.kind === 'value') {
    if (questionId === 'startDate' && /^\d{4}-\d{2}-\d{2}$/.test(answer.value))
      return { startDate: answer.value, datesFlexible: false };
    if (questionId === 'passportNationality') {
      const country = normalizeStudioCountry(answer.value);
      return country ? { passportNationality: country.code } : null;
    }
    if (questionId === 'childAges') {
      const ages = parseAges(answer.value);
      // A list that does not match the head count is a question for Tara, not a field.
      return ages && (children === null || ages.length === children) ? { childAges: ages } : null;
    }
    return null;
  }
  if (answer.kind === 'text') {
    const n = wholeNumber(answer.text);
    if (questionId === 'adults' && n !== null && n >= 1 && n <= 100) return { adults: n };
    if (questionId === 'children' && n !== null && n <= 30)
      return n === 0 ? { children: 0, childAges: [] } : { children: n };
  }
  return null;
}

/** The one turn Tara reads: the written answers, with what was saved alongside for context. */
export function clarifyMessage(plan: ClarifyPlan): string {
  if (!plan.forTara.length) return '';
  const lines = ['Answers to your questions:'];
  for (const line of plan.forTara) lines.push(`- ${line.label}: ${line.value}`);
  if (plan.saved.length)
    lines.push(
      '',
      `Saved to the brief: ${plan.saved.map((l) => `${l.label}: ${l.value}`).join('; ')}.`,
    );
  return lines.join('\n');
}
