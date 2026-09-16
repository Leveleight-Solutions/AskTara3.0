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

/** Recognize stated constraints without parsing or rewriting the user's request. */
export function buildTripPrompt(
  message: string,
  defaults: { travelers?: number; startDate?: string },
): string {
  const prompt = message.trim();
  if (!prompt) return '';
  const supplements: string[] = [];
  if (
    defaults.travelers !== undefined &&
    Number.isInteger(defaults.travelers) &&
    defaults.travelers >= 1 &&
    defaults.travelers <= 16 &&
    !partyPatterns.some((pattern) => pattern.test(prompt))
  ) {
    supplements.push(`for ${defaults.travelers} travelers`);
  }
  if (defaults.startDate && !datePatterns.some((pattern) => pattern.test(prompt))) {
    supplements.push(`starting ${defaults.startDate}`);
  }
  return [prompt, ...supplements].join(' ');
}
