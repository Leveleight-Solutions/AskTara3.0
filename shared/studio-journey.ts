import { z } from 'zod';
import type { StudioWorkspace } from './studio';

export type StudioJourneyDirection = 'outbound' | 'return';
export type StudioJourneyMode = 'flight' | 'cruise';
export const STUDIO_JOURNEY_FRESH_MS = 6 * 60 * 60 * 1000;

const isoDate = (value: string) =>
  value === '' ||
  (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value);
const date = z.string().max(10).refine(isoDate, 'Use a valid calendar date.');
const name = z.string().trim().max(200);
const airportCode = z.union([z.literal(''), z.string().regex(/^[A-Z]{3}$/)]);

/** The complete allowlist for transport research; arrival is intentionally not an input. */
export const studioJourneyInputSchema = z
  .object({
    direction: z.enum(['outbound', 'return']),
    mode: z.enum(['undecided', 'flight', 'cruise']),
    origin: name,
    destination: name,
    departureDate: date,
    returnDepartureDate: date,
    datesFlexible: z.boolean(),
    tripDays: z.number().int().min(1).max(366).nullable(),
    adults: z.number().int().min(1).max(100).nullable(),
    children: z.number().int().min(0).max(100).nullable(),
    childAges: z.array(z.number().int().min(0).max(17)).max(100),
    cabin: z.string().trim().max(100),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
export type StudioJourneyInput = z.infer<typeof studioJourneyInputSchema>;

const sourceSchema = z
  .object({
    label: z.string().max(200),
    url: z.string().max(2048),
    checkedAt: z.string().datetime(),
  })
  .strict();

/** Published route guidance is distinct from dated supplier inventory or a reviewed sailing. */
export const studioJourneyOptionSchema = z
  .object({
    id: z.string().min(1).max(80),
    basis: z.literal('route_guidance'),
    title: z.string().trim().min(1).max(200),
    operator: z.string().trim().max(160),
    origin: name.min(1),
    destination: name.min(1),
    originAirportCode: airportCode,
    destinationAirportCode: airportCode,
    via: z.array(z.string().trim().min(1).max(160)).max(6),
    duration: z.string().max(160),
    summary: z.string().trim().min(1).max(800),
    returnSummary: z.string().max(500),
    sources: z.array(sourceSchema).min(1).max(6),
    departureDate: z.literal(''),
    arrivalDate: z.literal(''),
    price: z.null(),
  })
  .strict();
export type StudioJourneyOption = z.infer<typeof studioJourneyOptionSchema>;

export const studioJourneyResearchSchema = z
  .object({
    inputKey: z.string().regex(/^[a-f0-9]{64}$/),
    checkedAt: z.string().datetime(),
    input: studioJourneyInputSchema,
    status: z.enum(['ready', 'unavailable']),
    summary: z.string().max(900),
    options: z.array(studioJourneyOptionSchema).max(4),
    missingFacts: z.array(z.string().max(240)).max(12),
    notes: z.array(z.string().max(500)).max(8),
  })
  .strict();
export type StudioJourneyResearch = z.infer<typeof studioJourneyResearchSchema>;

export const studioJourneySelectionSchema = z
  .object({
    direction: z.enum(['outbound', 'return']),
    mode: z.enum(['flight', 'cruise']),
    inputKey: z.string().regex(/^[a-f0-9]{64}$/),
    selectedAt: z.string().datetime(),
    option: studioJourneyOptionSchema,
  })
  .strict();
export type StudioJourneySelection = z.infer<typeof studioJourneySelectionSchema>;

type JourneyBrief = StudioWorkspace['brief'] & {
  tripDays?: number | null;
  returnDepartureDate?: string;
};

/** The return direction reverses the final destination and origin, without changing any dates. */
export function studioJourneyInput(
  workspace: StudioWorkspace,
  direction: StudioJourneyDirection,
  mode?: StudioJourneyMode,
): StudioJourneyInput {
  const brief: JourneyBrief = workspace.brief;
  const outward = direction === 'outbound';
  const destination =
    (outward ? workspace.stops[0] : workspace.stops.at(-1))?.name ||
    brief.preferredDestination ||
    '';
  return {
    direction,
    mode: mode || (outward ? brief.outboundTransport : brief.returnTransport) || 'undecided',
    origin: (outward ? brief.origin : destination).trim().slice(0, 200),
    destination: (outward ? destination : brief.origin).trim().slice(0, 200),
    departureDate: outward
      ? brief.departureDate || ''
      : brief.returnDepartureDate || brief.endDate || '',
    returnDepartureDate: brief.returnDepartureDate || '',
    datesFlexible: brief.datesFlexible,
    tripDays: brief.tripDays ?? null,
    adults: brief.adults,
    children: brief.children,
    childAges: [...brief.childAges],
    cabin: brief.cabin.trim().slice(0, 100),
    currency: brief.currency.trim().toUpperCase(),
  };
}

/** Fixed key order supports server hashing and exact browser/server stale-input comparisons. */
export function studioJourneyCanonicalInput(input: StudioJourneyInput): string {
  return JSON.stringify({
    direction: input.direction,
    mode: input.mode,
    origin: input.origin,
    destination: input.destination,
    departureDate: input.departureDate,
    returnDepartureDate: input.returnDepartureDate,
    datesFlexible: input.datesFlexible,
    tripDays: input.tripDays,
    adults: input.adults,
    children: input.children,
    childAges: input.childAges,
    cabin: input.cabin,
    currency: input.currency,
  });
}

export function studioJourneyResearchFresh(
  workspace: StudioWorkspace,
  research: StudioJourneyResearch | null | undefined,
  direction: StudioJourneyDirection,
  mode?: StudioJourneyMode,
  now = Date.now(),
): boolean {
  if (
    !research ||
    studioJourneyCanonicalInput(research.input) !==
      studioJourneyCanonicalInput(studioJourneyInput(workspace, direction, mode))
  )
    return false;
  const age = now - Date.parse(research.checkedAt);
  return Number.isFinite(age) && age >= 0 && age < STUDIO_JOURNEY_FRESH_MS;
}

/** Missing fare facts do not block research into published routes. */
export function studioJourneyMissingFacts(input: StudioJourneyInput): string[] {
  const facts: string[] = [];
  if (input.mode === 'undecided') facts.push('Choose flight or cruise for this journey.');
  if (!input.origin) facts.push('Departure city or port.');
  if (!input.destination) facts.push('Destination city or port.');
  if (!input.departureDate)
    facts.push('Exact departure date for a dated supplier schedule and fare.');
  if (input.adults === null || input.children === null)
    facts.push('Adult and child traveller counts for a supplier fare.');
  if (input.children !== null && input.children > input.childAges.length)
    facts.push('Every child’s age for a supplier fare.');
  if (input.mode === 'flight' && !input.cabin) facts.push('Preferred cabin for a supplier fare.');
  if (input.direction === 'outbound' && !input.returnDepartureDate)
    facts.push('Return departure date, or confirmation that this is a one-way journey.');
  return facts;
}
