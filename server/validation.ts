import { z } from 'zod';
import { consultationFields, serviceStatuses } from '../shared/consultation.ts';

const knownConsultationSourceSchema = z.enum(['message', 'form', 'profile', 'legacy']);
const consultationFactSchema = z
  .object({
    source: knownConsultationSourceSchema,
    evidence: z.string().trim().min(1).max(500),
    valueState: z.enum(['specified', 'flexible']),
  })
  .strict();
const consultationServiceSchema = z
  .object({
    status: z.enum(serviceStatuses),
    source: z.enum(['unknown', 'message', 'form', 'profile', 'legacy']),
    evidence: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export const consultationSchema = z
  .object({
    version: z.literal(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
    services: z
      .object({ flights: consultationServiceSchema, hotels: consultationServiceSchema })
      .strict(),
    facts: z.partialRecord(z.enum(consultationFields), consultationFactSchema),
    route: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            days: z.number().int().min(1).max(21),
          })
          .strict(),
      )
      .max(5)
      .refine(
        (route) => route.reduce((sum, stop) => sum + stop.days, 0) <= 21,
        'A trip can include at most 21 days',
      )
      .optional(),
    party: z
      .object({
        hasChildren: z.boolean(),
        childAges: z.array(z.number().int().min(0).max(17)).max(15),
        source: knownConsultationSourceSchema,
        evidence: z.string().trim().min(1).max(500),
      })
      .strict()
      .optional(),
    flightJourney: z
      .object({
        type: z.enum(['unknown', 'return', 'one_way', 'multi_city']),
        departureDate: z
          .string()
          .refine(
            (value) => !value || dateSchema.safeParse(value).success,
            'Enter a valid flight date',
          ),
        returnDate: z
          .string()
          .refine(
            (value) => !value || dateSchema.safeParse(value).success,
            'Enter a valid flight date',
          ),
        cabinClass: z.enum(['economy', 'premium_economy', 'business', 'first']),
        source: knownConsultationSourceSchema,
        evidence: z.string().trim().min(1).max(500),
      })
      .strict()
      .refine(
        (journey) =>
          !journey.returnDate ||
          (journey.type !== 'one_way' &&
            (!journey.departureDate || journey.returnDate > journey.departureDate)),
        'Return date must follow departure for a return journey',
      )
      .optional(),
  })
  .strict();

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(value + 'T00:00:00Z');
    return (
      !Number.isNaN(date.valueOf()) &&
      date.toISOString().slice(0, 10) === value &&
      value >= '2020-01-01' &&
      value <= '2100-12-31'
    );
  }, 'Enter a valid date between 2020 and 2100');
export const daysSchema = z.number().int().min(1).max(21);
export const travelersSchema = z.number().int().min(1).max(16);
export const budgetSchema = z.number().min(0).max(1_000_000);
export const interestsSchema = z.array(z.string().trim().min(1).max(60)).max(15);
// Syntax only: route handlers must resolve IDs against trusted trip destinations.
export const destinationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a valid destination ID');
export const travelBriefSchema = z
  .object({
    pace: z.enum(['relaxed', 'balanced', 'active']),
    originAirport: z
      .string()
      .trim()
      .regex(/^([A-Za-z]{3})?$/, 'Use a three-letter airport code')
      .transform((value) => value.toUpperCase()),
    arrivalAirport: z
      .string()
      .trim()
      .regex(/^([A-Za-z]{3})?$/, 'Use a three-letter airport code')
      .transform((value) => value.toUpperCase()),
    guestNationality: z
      .string()
      .trim()
      .regex(/^([A-Za-z]{2})?$/, 'Use a two-letter nationality code')
      .transform((value) => value.toUpperCase()),
    includeFlights: z.boolean(),
    includeHotels: z.boolean(),
    destinationStops: z
      .array(
        z
          .object({
            destinationId: destinationIdSchema,
            days: daysSchema,
          })
          .strict(),
      )
      .max(5)
      .refine(
        (stops) => stops.reduce((sum, stop) => sum + stop.days, 0) <= 21,
        'A trip can include at most 21 days',
      )
      .refine(
        (stops) => new Set(stops.map((stop) => stop.destinationId)).size === stops.length,
        'Use each destination once in the route',
      ),
    notes: z.array(z.string().trim().min(1).max(500)).max(12),
    consultation: consultationSchema.optional(),
  })
  .strict();
export const planningRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(4000),
    tripId: z.string().uuid().optional(),
    requestId: z.string().uuid(),
    brief: travelBriefSchema.partial().optional(),
  })
  .strict();
export const itineraryItemSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/, 'Use an alphanumeric activity ID'),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    title: z.string().trim().min(1).max(160),
    description: z.string().max(1200),
    location: z.string().max(200),
    category: z.enum(['sight', 'food', 'experience', 'stay', 'leisure']),
    cost: z.number().min(0).max(100_000),
    completed: z.boolean(),
    locked: z.boolean().optional(),
    durationMinutes: z.number().int().min(15).max(720).optional(),
    travelMinutes: z.number().int().min(0).max(480).optional(),
    placeId: z.string().min(1).max(240).optional(),
    sourceId: z.string().min(1).max(200).optional(),
  })
  .strict();
export const itinerarySchema = z
  .array(
    z
      .object({
        day: daysSchema,
        destinationId: z.string().min(1).max(60).optional(),
        title: z.string().min(1).max(160),
        items: z.array(itineraryItemSchema).max(16),
      })
      .strict(),
  )
  .max(21);
export const tripPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    startDate: z.union([dateSchema, z.literal('')]),
    days: daysSchema,
    travelers: travelersSchema,
    budget: budgetSchema,
    interests: interestsSchema,
    status: z.enum(['draft', 'planned']),
    itinerary: itinerarySchema,
    brief: travelBriefSchema,
    revision: z.number().int().min(0),
  })
  .partial()
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'revision'),
    'Provide at least one change',
  );
export const flightSearchSchema = z
  .object({
    origin: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, 'Use a three-letter airport code')
      .transform((v) => v.toUpperCase()),
    destination: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, 'Use a three-letter airport code')
      .transform((v) => v.toUpperCase()),
    departureDate: dateSchema,
    returnDate: dateSchema.optional(),
    adults: z.number().int().min(1).max(9).default(1),
    cabinClass: z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
  })
  .strict()
  .refine((v) => v.origin !== v.destination, 'Choose different departure and arrival airports')
  .refine(
    (v) => !v.returnDate || v.returnDate >= v.departureDate,
    'Return date must follow departure',
  )
  .refine(
    (v) => v.departureDate >= new Date().toISOString().slice(0, 10),
    'Departure date must be today or later',
  );
export const hotelSearchSchema = z
  .object({
    destinationId: destinationIdSchema,
    checkin: dateSchema,
    checkout: dateSchema,
    adults: z.number().int().min(1).max(6).default(2),
    guestNationality: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .transform((v) => v.toUpperCase()),
  })
  .strict()
  .refine((v) => v.checkout > v.checkin, 'Check-out must follow check-in')
  .refine(
    (v) => v.checkin >= new Date().toISOString().slice(0, 10),
    'Check-in must be today or later',
  );
