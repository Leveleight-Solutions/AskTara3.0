import type { PublicConfig } from '../shared/types.ts';

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
