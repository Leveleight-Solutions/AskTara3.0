/** Fixed diagnostic codes only: never log raw provider bodies or customer requirements. */
const reasons = new Map([
  ['Destination metadata included private personalization.', 'research_privacy'],
  ['Web research made an unsupported suitability guarantee.', 'research_suitability'],
  ['Web research cited a URL outside its returned search sources.', 'research_citation'],
  [
    'Web research cited only URLs outside its returned search sources for an entity.',
    'research_entity_citation',
  ],
  ['The researched chat answer did not cite a verifiable source.', 'research_reply_citation'],
  ['The researched answer did not cite a verifiable source.', 'research_answer_citation'],
  ['Web research did not resolve the complete requested route.', 'research_incomplete_route'],
  [
    'Web research substituted a different city for the requested destination.',
    'research_wrong_city',
  ],
  ['Web research returned no sourced places for part of the route.', 'research_missing_places'],
  ['OpenAI did not complete its response.', 'model_incomplete'],
  ['OpenAI returned travel data that failed validation.', 'model_schema'],
  ['OpenAI returned invalid structured output.', 'model_json'],
  ['Web research returned no verifiable search sources. Please retry.', 'research_no_sources'],
]);

export function planningFailureReason(error: unknown): string {
  if (!(error instanceof Error)) return 'internal';
  return reasons.get(error.message) || ('status' in error ? 'service_or_constraint' : 'internal');
}
