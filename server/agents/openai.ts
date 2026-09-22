import { z } from 'zod';

export const DEFAULT_OPENAI_MODEL = 'gpt-6-astra';
export const planningModel = () => process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
type OpenAIPlanningCode =
  | 'OPENAI_NOT_CONFIGURED'
  | 'OPENAI_ACCESS_DENIED'
  | 'OPENAI_MODEL_UNAVAILABLE'
  | 'OPENAI_RATE_LIMITED'
  | 'OPENAI_UNAVAILABLE';
export class OpenAIPlanningError extends Error {
  readonly status = 503;
  constructor(
    message: string,
    readonly code: OpenAIPlanningCode = 'OPENAI_UNAVAILABLE',
  ) {
    super(message);
  }
}
export interface WebSource {
  url: string;
  title: string;
}

/** Canonicalize links for comparison; never allow executable or credential-bearing URLs. */
export function evidenceUrl(value: string): string | undefined {
  try {
    if (value.length > 2048) return;
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    if (!url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname))
      return;
    if (/^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname))
      return;
    url.hash = '';
    for (const key of [...url.searchParams.keys()])
      if (/^utm_/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return;
  }
}

export async function structuredResponse<T>(options: {
  name: string;
  schema: z.ZodType<T>;
  instructions: string;
  payload: unknown;
  signal?: AbortSignal;
  webSearch?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<{ data: T; sources: WebSource[]; model: string; webSearchCalls: number }> {
  const { signal } = options;
  signal?.throwIfAborted();
  if (!process.env.OPENAI_API_KEY)
    throw new OpenAIPlanningError(
      'AI planning is not configured. Add an OpenAI API key to the server to enable it. Your saved trip is unchanged.',
      'OPENAI_NOT_CONFIGURED',
    );
  const effort = process.env.OPENAI_REASONING_EFFORT || 'low';
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(effort))
    throw new Error('Invalid OpenAI reasoning effort configuration.');
  const schema = z.toJSONSchema(options.schema);
  delete (schema as Record<string, unknown>).$schema;
  const model = planningModel();
  const timeout = AbortSignal.timeout(Math.min(options.timeoutMs || 90_000, 150_000));
  const stage = options.webSearch
    ? 'Web research'
    : options.name === 'studio_brief_review'
      ? 'Brief review'
      : options.name === 'travel_intake'
        ? 'Trip intake'
        : 'Itinerary planning';
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort },
        max_output_tokens: Math.min(options.maxTokens || 7000, 12_000),
        instructions: options.instructions,
        input: [{ role: 'user', content: JSON.stringify(options.payload) }],
        text: { format: { type: 'json_schema', name: options.name, strict: true, schema } },
        ...(options.webSearch
          ? {
              tools: [{ type: 'web_search', external_web_access: true }],
              tool_choice: 'required',
              max_tool_calls: 4,
              include: ['web_search_call.action.sources'],
            }
          : {}),
      }),
    });
  } catch {
    signal?.throwIfAborted();
    throw new OpenAIPlanningError(
      `${stage} is temporarily unavailable. Your saved trip is unchanged; please retry.`,
    );
  }
  signal?.throwIfAborted();
  // Classify status codes only; provider error bodies can contain credentials or client data.
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new OpenAIPlanningError(
        'OpenAI rejected this server\u2019s credentials or access. Check the API key and project permissions. Your saved trip is unchanged.',
        'OPENAI_ACCESS_DENIED',
      );
    if (response.status === 404)
      throw new OpenAIPlanningError(
        'The configured AI model is unavailable to this OpenAI project. Check the model setting and project access. Your saved trip is unchanged.',
        'OPENAI_MODEL_UNAVAILABLE',
      );
    if (response.status === 429)
      throw new OpenAIPlanningError(
        'OpenAI\u2019s rate or usage limit was reached. Retry shortly; if it continues, check the project\u2019s quota and billing. Your saved trip is unchanged.',
        'OPENAI_RATE_LIMITED',
      );
    throw new OpenAIPlanningError(
      `${stage} is temporarily unavailable (OpenAI status ${response.status}). Your saved trip is unchanged; please retry.`,
    );
  }
  const data = (await response.json()) as {
    status?: string;
    incomplete_details?: { reason?: string } | null;
    output?: Array<{
      type: string;
      status?: string;
      action?: { type?: string; url?: string; sources?: Array<{ url?: string; title?: string }> };
      content?: Array<{
        type: string;
        text?: string;
        annotations?: Array<{ type: string; url?: string; title?: string }>;
      }>;
    }>;
  };
  signal?.throwIfAborted();
  if (
    ['travel_intake', 'studio_brief_review'].includes(options.name) &&
    data.status === 'incomplete' &&
    data.incomplete_details?.reason === 'max_output_tokens' &&
    Math.min(options.maxTokens || 7000, 12_000) < 12_000
  ) {
    console.info('Intake token-limit retry', { maxOutputTokens: 12000 });
    return structuredResponse({ ...options, maxTokens: 12000 });
  }
  if (data.status && data.status !== 'completed')
    throw new Error('OpenAI did not complete its response.');
  const items = data.output || [];
  const searches = items.filter(
    (item) => item.type === 'web_search_call' && item.status === 'completed',
  );
  const sources = new Map<string, WebSource>();
  const add = (source: { url?: string; title?: string }) => {
    const url = source.url && evidenceUrl(source.url);
    if (url && (sources.has(url) || sources.size < 500))
      sources.set(url, { url, title: (source.title || new URL(url).hostname).slice(0, 200) });
  };
  const texts = items
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content || []);
  // Explicit citations and pages actually opened must survive the bounded
  // source list even when broad search results contain hundreds of links.
  for (const text of texts)
    for (const annotation of text.annotations || [])
      if (annotation.type === 'url_citation') add(annotation);
  for (const item of searches)
    if (['open_page', 'find_in_page'].includes(item.action?.type || ''))
      add({ url: item.action?.url });
  for (const item of searches) for (const source of item.action?.sources || []) add(source);
  if (options.webSearch && (!searches.length || !sources.size))
    throw new Error('Web research returned no verifiable search sources. Please retry.');
  if (texts.some((item) => item.type === 'refusal'))
    throw new Error('OpenAI could not complete this travel request.');
  const output = texts
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text || '')
    .join('');
  if (!output || output.length > 200_000)
    throw new Error('OpenAI returned an invalid response size.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('OpenAI returned invalid structured output.');
  }
  const validated = options.schema.safeParse(parsed);
  if (!validated.success) throw new Error('OpenAI returned travel data that failed validation.');
  return {
    data: validated.data,
    sources: [...sources.values()],
    model,
    webSearchCalls: searches.length,
  };
}
