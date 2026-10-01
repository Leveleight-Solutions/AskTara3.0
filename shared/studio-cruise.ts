import { z } from 'zod';
import { STUDIO_MANUAL_ITINERARY_MAX_DAYS, type StudioItinerary } from './studio-itinerary';

/** Matches the proposal service amount limit. */
export const STUDIO_CRUISE_MAX_FARE = 10_000_000;
/** Reserves room for the longest stable service prefix, "cruise-onward:". */
export const STUDIO_CRUISE_MAX_ID = 66;

export function cruiseIsoDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
    ? value
    : '';
}

export const studioCruiseDaySchema = z
  .object({
    /** Stable reviewed-source identity; optional for older saved drafts. */
    id: z.string().min(1).max(80).optional(),
    day: z.number().int().min(1).max(STUDIO_MANUAL_ITINERARY_MAX_DAYS),
    /** Literal dates are retained when a source omits the year. */
    date: z.string().max(80),
    port: z.string().trim().min(1).max(160),
    arrival: z.string().max(80),
    departure: z.string().max(80),
    details: z.string().max(1200),
  })
  .strict();

export const studioCruiseDraftSchema = z
  .object({
    id: z.string().min(1).max(STUDIO_CRUISE_MAX_ID),
    name: z.string().trim().min(1).max(160),
    ship: z.string().max(160),
    sourceUrl: z.union([
      z.literal(''),
      z
        .string()
        .url()
        .max(2048)
        .refine((value) => {
          try {
            const url = new URL(value);
            return url.protocol === 'https:' && !url.username && !url.password;
          } catch {
            return false;
          }
        }, 'Cruise sources must use an HTTPS URL without credentials.'),
    ]),
    sourceName: z.string().max(160),
    extractedAt: z.string().datetime(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    fullFare: z.number().min(0).max(STUDIO_CRUISE_MAX_FARE).nullable(),
    disembarkAfterDay: z.number().int().min(1).max(STUDIO_MANUAL_ITINERARY_MAX_DAYS).nullable(),
    onwardTransport: z.enum(['undecided', 'flight', 'cruise']),
    returnTransport: z.enum(['undecided', 'flight', 'cruise']),
    days: z.array(studioCruiseDaySchema).min(1).max(STUDIO_MANUAL_ITINERARY_MAX_DAYS),
    warnings: z.array(z.string().max(500)).max(12),
  })
  .strict()
  .superRefine((draft, ctx) => {
    if (draft.disembarkAfterDay !== null && draft.disembarkAfterDay > draft.days.length)
      ctx.addIssue({
        code: 'custom',
        path: ['disembarkAfterDay'],
        message: 'Choose a day in this cruise.',
      });
    if (draft.days.some((day, index) => day.day !== index + 1))
      ctx.addIssue({
        code: 'custom',
        path: ['days'],
        message: 'Cruise days must be in sequential order.',
      });
    const ids = draft.days.flatMap((day) => (day.id ? [day.id] : []));
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: 'custom',
        path: ['days'],
        message: 'Cruise day identifiers must be unique.',
      });
  });

export type StudioCruiseDay = z.infer<typeof studioCruiseDaySchema>;
export type StudioCruiseDraft = z.infer<typeof studioCruiseDraftSchema>;

/** Only the travelled segment becomes the daily plan; the full fare remains on the draft. */
export function cruiseDraftToItinerary(
  value: StudioCruiseDraft,
  stopIds: string[] = [],
): StudioItinerary {
  const draft = studioCruiseDraftSchema.parse(value);
  const selected = draft.days.slice(0, draft.disembarkAfterDay ?? draft.days.length);
  const lastDay = selected.at(-1)!;
  const early = selected.length < draft.days.length;
  return {
    generatedAt: draft.extractedAt,
    days: selected.map((day, index) => ({
      cruiseId: draft.id,
      ...(day.id ? { cruiseDayId: day.id } : {}),
      day: index + 1,
      date: cruiseIsoDate(day.date),
      stopIds: stopIds[index] ? [stopIds[index]] : [],
      title: day.port,
      summary: [
        day.date && !cruiseIsoDate(day.date) ? day.date : '',
        day.arrival ? `Arrival: ${day.arrival}` : '',
        day.departure ? `Departure: ${day.departure}` : '',
        early && index === selected.length - 1
          ? 'Disembark here; remaining cruise days omitted.'
          : '',
      ]
        .filter(Boolean)
        .join(' · '),
      activities: day.details
        ? [
            {
              period: 'flexible' as const,
              title: 'Cruise day details',
              description: day.details,
              // This is agent-reviewed copy. Do not misrepresent edits as source-verified statements.
              sources: [],
            },
          ]
        : [],
    })),
    notes: [
      'Full cruise fare is retained. Leaving the cruise early does not create a segment refund.',
      ...(early
        ? [
            `Planned early disembarkation: ${lastDay.port}. Confirm permission with the cruise line.`,
          ]
        : []),
      ...(draft.onwardTransport !== 'undecided'
        ? [`Onward ${draft.onwardTransport} to be arranged separately.`]
        : []),
      ...(draft.returnTransport !== 'undecided'
        ? [`Return by ${draft.returnTransport} to be arranged separately.`]
        : []),
    ],
  };
}
