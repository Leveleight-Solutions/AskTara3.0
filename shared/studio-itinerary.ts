import { z } from 'zod';
import type { StudioSource } from './studio';

export const STUDIO_ITINERARY_MAX_DAYS = 35;

export interface StudioItineraryActivity {
  period: 'morning' | 'afternoon' | 'evening' | 'flexible';
  title: string;
  description: string;
  sources: StudioSource[];
}
export interface StudioItineraryDay {
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
            day: z.number().int().min(1).max(STUDIO_ITINERARY_MAX_DAYS),
            date: z.string().regex(/^(?:\d{4}-\d{2}-\d{2})?$/),
            stopIds: z.array(z.string().min(1).max(80)).min(1).max(20),
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
              .min(1)
              .max(3),
          })
          .strict(),
      )
      .min(1)
      .max(STUDIO_ITINERARY_MAX_DAYS),
    notes: z.array(z.string().max(500)).max(12),
  })
  .strict();
