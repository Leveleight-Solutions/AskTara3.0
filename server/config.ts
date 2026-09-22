import type { PublicConfig } from '../shared/types.ts';

/** Cookies ignore ports, so separate local API instances need distinct names. */
export function sessionCookieName(): string {
  const configured = process.env.SESSION_COOKIE_NAME;
  if (configured !== undefined) {
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/.test(configured))
      throw new Error('SESSION_COOKIE_NAME must be a valid cookie name (1–128 token characters).');
    return configured;
  }
  return process.env.NODE_ENV === 'production'
    ? 'asktara_session'
    : `asktara_session_${process.env.PORT || '3001'}`;
}

/** Explicit allowlist: the Embed key is intended for referrer-restricted browser use. */
export function publicConfig(): PublicConfig {
  const candidate = process.env.GOOGLE_MAPS_EMBED_API_KEY?.trim();
  const privateKeys = [
    'GOOGLE_PLACES_API_KEY',
    'OPENAI_API_KEY',
    'DUFFEL_ACCESS_TOKEN',
    'LITEAPI_API_KEY',
  ].map((name) => process.env[name]?.trim());
  return candidate && /^[A-Za-z0-9_-]{20,256}$/.test(candidate) && !privateKeys.includes(candidate)
    ? { mapsEmbedApiKey: candidate }
    : {};
}
