export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...options,
      headers,
    });
  } catch (error) {
    // Keep cancellations recognizable to polling and page-cleanup callers.
    if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError'))
      throw error;
    throw new ApiError(
      'Cannot connect to Tara. Please check your connection and try again.',
      0,
      'BACKEND_UNAVAILABLE',
    );
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type')?.split(';')[0].trim() || '';
  if (contentType !== 'application/json' && !contentType.endsWith('+json')) {
    throw new ApiError(
      'Tara could not connect to its API. Please try again shortly.',
      response.ok ? 502 : response.status,
      'INVALID_API_RESPONSE',
    );
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      'Tara returned an incomplete response. Please try again.',
      response.ok ? 502 : response.status,
      'INVALID_API_RESPONSE',
    );
  }
  if (!response.ok)
    throw new ApiError(
      typeof body?.error === 'string'
        ? body.error
        : body?.error?.message || body?.message || 'Something went wrong. Please try again.',
      response.status,
      typeof body?.code === 'string' ? body.code : undefined,
    );
  return body as T;
}
export const money = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    amount,
  );
export const readableDate = (date: string) =>
  date
    ? new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Dates are flexible';
