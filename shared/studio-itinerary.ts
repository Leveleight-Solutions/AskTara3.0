import { z } from 'zod';
import type { StudioSource } from './studio';

export const STUDIO_ITINERARY_MAX_DAYS = 35;
/** Manual plans are not bounded by the AI generation response size. */
export const STUDIO_MANUAL_ITINERARY_MAX_DAYS = 366;
export const STUDIO_ITINERARY_MAX_ACTIVITIES = 20;

export interface StudioItineraryActivity {
  period: 'morning' | 'afternoon' | 'evening' | 'flexible';
  title: string;
  description: string;
  sources: StudioSource[];
}
export interface StudioItineraryDay {
  /** Links reviewed cruise rows to their source draft for safe reapplication. */
  cruiseId?: string;
  /** Stable source row identity survives deletions, reordering and manual title/date edits. */
  cruiseDayId?: string;
  day: number;
  date: string;
  stopIds: string[];
  title: string;
  summary: string;
  activities: StudioItineraryActivity[];
}
export interface StudioItinerary {
  generatedAt: string;
  days: StudioItineraryDay[];
  notes: string[];
}

export const studioItinerarySchema = z
  .object({
    generatedAt: z.string().datetime(),
    days: z
      .array(
        z
          .object({
            cruiseId: z.string().min(1).max(80).optional(),
            cruiseDayId: z.string().min(1).max(80).optional(),
            day: z.number().int().min(1).max(STUDIO_MANUAL_ITINERARY_MAX_DAYS),
            date: z
              .string()
              .regex(/^(?:\d{4}-\d{2}-\d{2})?$/)
              .refine(
                (value) =>
                  !value ||
                  (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
                    Number.isFinite(Date.parse(value)) &&
                    new Date(value).toISOString().slice(0, 10) === value),
                'Use a real date in YYYY-MM-DD format.',
              ),
            stopIds: z.array(z.string().min(1).max(80)).max(20),
            title: z.string().min(1).max(160),
            summary: z.string().max(600),
            activities: z
              .array(
                z
                  .object({
                    period: z.enum(['morning', 'afternoon', 'evening', 'flexible']),
                    title: z.string().min(1).max(200),
                    description: z.string().max(1200),
                    sources: z
                      .array(
                        z
                          .object({
                            label: z.string().max(200),
                            url: z.string().url().max(2048),
                            checkedAt: z.string().datetime(),
                          })
                          .strict(),
                      )
                      .max(5),
                  })
                  .strict(),
              )
              .max(STUDIO_ITINERARY_MAX_ACTIVITIES),
          })
          .strict(),
      )
      .min(1)
      .max(STUDIO_MANUAL_ITINERARY_MAX_DAYS),
    notes: z.array(z.string().max(500)).max(20),
  })
  .strict();

/** A citation can survive a manual save only for unchanged, previously cited prose. */
export function sanitizeManualStudioItinerary(
  value: StudioItinerary,
  previous?: StudioItinerary | null,
): StudioItinerary {
  const parsed = studioItinerarySchema.parse(value);
  const priorActivities = previous?.days.flatMap((day) => day.activities) || [];
  return {
    ...parsed,
    days: parsed.days.map((day, index) => ({
      ...day,
      day: index + 1,
      activities: day.activities.map((activity) => {
        const unchanged = priorActivities.find(
          (prior) => prior.title === activity.title && prior.description === activity.description,
        );
        return { ...activity, sources: unchanged?.sources || [] };
      }),
    })),
  };
}

export function moveStudioItineraryEntry<T>(entries: T[], index: number, offset: -1 | 1): T[] {
  const target = index + offset;
  if (index < 0 || index >= entries.length || target < 0 || target >= entries.length)
    return entries;
  const moved = [...entries];
  [moved[index], moved[target]] = [moved[target], moved[index]];
  return moved;
}
