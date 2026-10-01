import type { StudioBrief } from '../shared/studio.ts';

type ActivityDeclarations = {
  attendingMeetings: boolean | null;
  localEmployment: boolean | null;
  paidWork: boolean | null;
};

/** Send only explicit activity declarations to entry research, never the private request. */
export function studioEntryPurposeDeclarations(brief: StudioBrief): ActivityDeclarations {
  const declared: ActivityDeclarations = {
    attendingMeetings: null,
    localEmployment: null,
    paidWork: null,
  };
  const topics: Record<keyof ActivityDeclarations, RegExp> = {
    attendingMeetings: /\bmeetings?\b/,
    localEmployment: /\b(?:employment|employed|taking (?:a )?(?:local )?job)\b/,
    paidWork: /\bpaid work\b/,
  };
  // Requests are appended in conversational order. A later explicit declaration
  // supersedes an earlier one; a question or hypothetical does not establish a fact.
  const sentences =
    (brief.request || '')
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .match(/[^.!?\n]+[.!?]?/g) || [];
  for (const sentence of sentences) {
    if (/\?|\b(?:if|suppose|hypothetically)\b/.test(sentence)) continue;
    for (const raw of sentence.split(/[,;]|\bbut\b/)) {
      const clause = raw.trim();
      const direct =
        /^(?:(?:actually|instead|now)\s+)?(?:i|we|(?:my|the|our) (?:client|traveller|traveler))\b/.test(
          clause,
        );
      const bareNegative = /^(?:with\s+)?(?:no|without)\b/.test(clause);
      if (!direct && !bareNegative) continue;
      if (
        /\b(?:maybe|perhaps|possibly|might|may|could|would|should|not sure|unsure|undecided|considering|whether)\b/.test(
          clause,
        )
      ) {
        if (direct)
          for (const field of Object.keys(topics) as (keyof ActivityDeclarations)[])
            if (topics[field].test(clause)) declared[field] = null;
        continue;
      }
      if (/\b(?:at home|back home|home country|current job)\b/.test(clause)) continue;

      // A coordinated explicit exclusion covers each listed activity, as in
      // "with no employment or paid work". Do not infer these exclusions from
      // "only meetings": the traveller must actually state them.
      const exclusions = [
        ...clause.matchAll(
          /\b(?:no|without)\s+(?:any\s+)?((?:(?:local\s+)?employment|paid work|(?:business\s+)?meetings?)(?:\s+(?:or|and)\s+(?:any\s+)?(?:(?:local\s+)?employment|paid work|(?:business\s+)?meetings?))*)/g,
        ),
      ];
      for (const exclusion of exclusions)
        for (const field of Object.keys(topics) as (keyof ActivityDeclarations)[])
          if (topics[field].test(exclusion[1])) declared[field] = false;

      if (!direct) continue;
      const negativePrefix = String.raw`\b(?:not|never|don't|won't)\s+(?:(?:plan|intend) to\s+)?(?:be\s+|do\s+|doing\s+|undertake\s+|take(?: up)?\s+|engage in\s+)?(?:any\s+)?`;
      const negative: Record<keyof ActivityDeclarations, RegExp> = {
        attendingMeetings: new RegExp(
          negativePrefix +
            String.raw`(?:attend(?:ing)?\s+|hav(?:e|ing)\s+)?(?:business\s+)?meetings?\b`,
        ),
        localEmployment: new RegExp(
          negativePrefix + String.raw`(?:(?:local\s+)?employment|employed)\b`,
        ),
        paidWork: new RegExp(negativePrefix + String.raw`paid work\b`),
      };
      const positive: Record<keyof ActivityDeclarations, RegExp> = {
        attendingMeetings:
          /\b(?:attend(?:ing)?|hav(?:e|ing))\s+(?:only\s+)?(?:business\s+)?meetings?\b/,
        localEmployment:
          /\b(?:(?:will|shall|plan to|intend to|am going to|are going to)\s+(?:take(?: up)?|undertake|accept|do|start)\s+(?:local\s+)?employment|(?:will|shall)\s+be\s+employed|(?:am|are|is)\s+taking\s+(?:a\s+)?(?:local\s+)?job)\b/,
        paidWork:
          /\b(?:(?:will|shall|plan to|intend to|am going to|are going to)\s+(?:do|undertake|perform|accept|take)\s+(?:some\s+)?paid work|(?:am|are|is)\s+doing\s+paid work)\b/,
      };
      for (const field of Object.keys(topics) as (keyof ActivityDeclarations)[]) {
        const excluded = exclusions.some((exclusion) => topics[field].test(exclusion[1]));
        if (negative[field].test(clause)) declared[field] = false;
        else if (
          !excluded &&
          !/\b(?:not|never|don't|won't)\b/.test(clause) &&
          positive[field].test(clause)
        )
          declared[field] = true;
      }
    }
  }
  return declared;
}
