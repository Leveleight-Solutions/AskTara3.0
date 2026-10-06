import { redactIdentityAndPayment } from './studio-imports.ts';
import { cruiseIsoDate, studioCruiseDraftSchema } from '../shared/studio-cruise.ts';
import { studioItinerarySchema } from '../shared/studio-itinerary.ts';

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
const internalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const hasRedactedStudioIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.includes('[payment/identity number removed]');

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
  const cruiseLinks = new WeakMap<object, { cruiseId: string; cruiseDayId?: string }>();
  const collectCruiseLinks = (item: unknown) => {
    if (Array.isArray(item)) {
      item.forEach(collectCruiseLinks);
      return;
    }
    if (!item || typeof item !== 'object') return;
    const document = item as Record<string, unknown>;
    if (Array.isArray(document.cruises)) {
      const cruises = document.cruises.flatMap((candidate) => {
        const parsed = studioCruiseDraftSchema.safeParse(candidate);
        return parsed.success ? [parsed.data] : [];
      });
      const itinerary = studioItinerarySchema.safeParse(document.itinerary);
      if (itinerary.success) {
        const rawDays = (document.itinerary as { days: object[] }).days;
        for (const [index, day] of itinerary.data.days.entries()) {
          const literalRows = (cruise: (typeof cruises)[number]) =>
            cruise.days.filter(
              (source) => cruiseIsoDate(source.date) === day.date && source.port === day.title,
            );
          const matchingCruises = cruises.filter(
            (cruise) =>
              cruise.id === day.cruiseId ||
              (hasRedactedStudioIdentifier(day.cruiseId) &&
                redactIdentityAndPayment(cruise.id) === day.cruiseId &&
                literalRows(cruise).length === 1),
          );
          if (matchingCruises.length !== 1) {
            // Keep genuine conflicting references distinct from legacy redaction markers.
            // The exemption is limited to typed UUIDs in a validated cruise document.
            if (cruises.length && day.cruiseId && internalUuid.test(day.cruiseId))
              cruiseLinks.set(rawDays[index], {
                cruiseId: day.cruiseId,
                ...(day.cruiseDayId && internalUuid.test(day.cruiseDayId)
                  ? { cruiseDayId: day.cruiseDayId }
                  : {}),
              });
            continue;
          }
          const cruise = matchingCruises[0];
          const links: { cruiseId: string; cruiseDayId?: string } = { cruiseId: cruise.id };
          if (
            day.cruiseDayId &&
            (cruise.days.some((source) => source.id === day.cruiseDayId) ||
              internalUuid.test(day.cruiseDayId))
          )
            links.cruiseDayId = day.cruiseDayId;
          else if (
            hasRedactedStudioIdentifier(day.cruiseDayId) &&
            literalRows(cruise).length === 1
          ) {
            const rows = literalRows(cruise).filter(
              (source) => source.id && redactIdentityAndPayment(source.id) === day.cruiseDayId,
            );
            if (rows.length === 1) links.cruiseDayId = rows[0].id;
          }
          cruiseLinks.set(rawDays[index], links);
        }
      }
    }
    Object.values(document).forEach(collectCruiseLinks);
  };
  collectCruiseLinks(value);
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
    if (item && typeof item === 'object') {
      const links = cruiseLinks.get(item);
      return Object.fromEntries(
        Object.entries(item).map(([field, child]) => [
          field,
          links && (field === 'cruiseId' || field === 'cruiseDayId') && links[field]
            ? links[field]
            : visit(child, field),
        ]),
      );
    }
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
