/* Breaks the research call's conditions prose into what an agent scans for.

   The model returns "conditions" and "seasonalGuidance" as one paragraph each, mixing what is
   happening with what to do about it. Shown as written, the actions — the part an agent has to act
   on — were buried mid-paragraph. This splits the prose into sentences and pulls the ones that ask
   for an action into their own list. The words are never changed, only placed: a sentence that is
   misread lands in the other list, never out of sight. */

/* Labels the card already shows above the text, which the model likes to repeat as an opening. */
const LEADS = [
  /^\s*checked\s+\d{1,2}\s+\w+\s+\d{4}\s*[:\-–—]\s*/i,
  /^\s*usual seasonal patterns?(,\s*not a forecast)?\s*[:\-–—]\s*/i,
  /^\s*seasonal guidance(,\s*not a forecast)?\s*[:\-–—]\s*/i,
  /^\s*current conditions\s*[:\-–—]\s*/i,
];
export function withoutLead(text: string) {
  return LEADS.reduce((value, lead) => value.replace(lead, ''), text);
}

/* Sentence ends followed by a capital or digit. Short abbreviations ("e.g.", "St.", "Mt.") are
   rare in this prose and would at worst split one sentence in two; nothing is lost either way. */
export function sentences(text: string): string[] {
  return withoutLead(text)
    .split(/(?<=[.!?])\s+(?=["'“(]?[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/* An instruction either opens with an imperative ("Use arranged transfers…", "Confirm park access…")
   or says something must or should be done ("…must be checked nearer departure"). */
const IMPERATIVES = new Set([
  'allow',
  'arrange',
  'ask',
  'avoid',
  'book',
  'bring',
  'carry',
  'check',
  'confirm',
  'consider',
  'contact',
  'ensure',
  'follow',
  'keep',
  'monitor',
  'pack',
  'plan',
  'read',
  'recheck',
  're-check',
  'register',
  'reconfirm',
  'review',
  'stay',
  'take',
  'use',
  'verify',
  'watch',
]);
const OBLIGATION =
  /\b(must|should|need to|needs to|are advised to|is advised|is recommended|are recommended)\b[^.!?]*\b(be\s+)?(checked|confirmed|verified|reconfirmed|booked|arranged|reviewed|monitored|avoided|used|carried)\b/i;
export function isAction(sentence: string) {
  const first = sentence.match(/^["'“(]?([A-Za-z-]+)/)?.[1]?.toLowerCase() || '';
  return IMPERATIVES.has(first) || OBLIGATION.test(sentence);
}

export interface ConditionsBreakdown {
  now: string[];
  season: string[];
  /** In the order they appear: current conditions first, then the season's. */
  actions: string[];
}
export function breakDownConditions(conditions: string, season: string): ConditionsBreakdown {
  const now = sentences(conditions);
  const usual = sentences(season);
  return {
    now: now.filter((sentence) => !isAction(sentence)),
    season: usual.filter((sentence) => !isAction(sentence)),
    actions: [...now, ...usual].filter(isAction),
  };
}
