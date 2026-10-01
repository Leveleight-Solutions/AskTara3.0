import { redactIdentityAndPayment } from './studio-imports.ts';

const identifierFields = new Set([
  'id',
  'clientId',
  'workspaceId',
  'stopId',
  'stopIds',
  'serviceId',
  'serviceIds',
  'sourceId',
  'importId',
  'requestId',
  'token',
  'quoteId',
]);
const sensitiveField =
  /^(?:passport(?:number|no|id)|(?:credit|debit)?cardnumber|cvv|cvc|securitycode)$/i;
const imageData = /data:image\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*,[^\s<>"']+/gi;

function scrubSensitiveUrl(value: string) {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    let changed = false;
    for (const key of [...url.searchParams.keys()]) {
      const normalized = key.replace(/[_ -]/g, '');
      if (
        sensitiveField.test(normalized) ||
        (/^(?:passport|card)$/i.test(normalized) && /\d{5}/.test(url.searchParams.get(key) || ''))
      ) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    return changed ? url.toString() : value;
  } catch {
    return value;
  }
}

/** Apply the existing identity/payment redactor to prose without corrupting supplier IDs,
 * source URLs, contact details or encoded assets. Creates a new JSON-compatible value. */
export function scrubStudioPrivateData<T>(value: T): T {
  const visit = (item: unknown, key = ''): unknown => {
    if (sensitiveField.test(key.replace(/[_ -]/g, ''))) return '[identity/payment detail removed]';
    if (identifierFields.has(key)) return item;
    if (typeof item === 'string') {
      if (/^(?:https?:\/\/|data:)\S+$/i.test(item)) return scrubSensitiveUrl(item);
      const urls: string[] = [];
      const prose = item.replace(/(?:https?:\/\/|data:)[^\s<>]+/gi, (url) => {
        urls.push(scrubSensitiveUrl(url));
        return `\uE000URL${String.fromCharCode(65 + urls.length)}\uE001`;
      });
      return redactIdentityAndPayment(prose).replace(
        /\uE000URL([\s\S])\uE001/g,
        (_match, letter: string) => urls[letter.charCodeAt(0) - 66] || '',
      );
    }
    if (Array.isArray(item)) return item.map((child) => visit(child, key));
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item).map(([field, child]) => [field, visit(child, field)]),
      );
    return item;
  };
  return visit(value) as T;
}

/** Media remains available to the human agent in storage, never in text-only AI context. */
export function scrubStudioAIInput<T>(value: T): T {
  const clean = scrubStudioPrivateData(value);
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') return item.replace(imageData, '[image omitted]');
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .filter(
            ([key]) =>
              !/^(?:photo|photoDataUrl|profilePhoto|profilePhotoUrl|profilePhotoDataUrl|avatar|avatarUrl)$/i.test(
                key,
              ),
          )
          .map(([key, child]) => [key, visit(child)]),
      );
    return item;
  };
  return visit(clean) as T;
}
