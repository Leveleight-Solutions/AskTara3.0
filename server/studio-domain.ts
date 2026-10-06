import { z } from 'zod';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  StudioWorkspace,
  StudioStop,
  StudioAgency,
  StudioQualification,
  StudioRecommendation,
} from '../shared/studio.ts';
import { StudioError } from './studio-store.ts';
import {
  studioItinerarySchema,
  sanitizeManualStudioItinerary,
} from '../shared/studio-itinerary.ts';
import {
  normalizeStudioCountry,
  studioCandidateEntryInputKey,
} from '../shared/studio-travel-research.ts';
import { studioEntryPurposeDeclarations } from './studio-entry-context.ts';

export const studioDate = z
  .string()
  .refine(
    (value) =>
      !value ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value),
    'Use a real date in YYYY-MM-DD format.',
  );
const short = z.string().trim().max(300);
const amount = z.number().finite().min(0).max(10000000).nullable();
const currency = z.string().regex(/^[A-Z]{3}$/);
export const studioBriefSchema = z
  .object({
    clientId: z.string().max(80).optional(),
    passportNationality: z
      .string()
      .refine((v) => !v || Boolean(normalizeStudioCountry(v)), 'Choose a passport nationality.')
      .optional(),
    preferredDestination: short.optional(),
    destinationCountry: z
      .string()
      .refine((v) => !v || Boolean(normalizeStudioCountry(v)), 'Choose a destination country.')
      .optional(),
    tripType: z.enum(['undecided', 'single', 'multiple']).optional(),
    tripPurpose: z
      .enum(['undecided', 'tourism', 'business', 'study', 'employment', 'other'])
      .optional(),
    outboundTransport: z.enum(['undecided', 'flight', 'cruise']).optional(),
    returnTransport: z.enum(['undecided', 'flight', 'cruise']).optional(),
    foodPreferences: z.array(short).max(30).optional(),
    clientName: short,
    context: z.string().max(8000),
    request: z.string().max(16000),
    departureDate: studioDate
      .describe('Departure from the origin. Arrival at the first destination uses startDate.')
      .optional(),
    tripDays: z.number().int().min(1).max(366).nullable().optional(),
    returnDepartureDate: studioDate.optional(),
    startDate: studioDate,
    endDate: studioDate,
    datesFlexible: z.boolean(),
    adults: z.number().int().min(1).max(100).nullable(),
    children: z.number().int().min(0).max(30).nullable(),
    childAges: z.array(z.number().int().min(0).max(17)).max(30),
    budget: amount,
    currency,
    origin: short,
    hotelStandard: short,
    hotelLocation: short,
    cabin: short,
    interests: z.array(short).max(30),
    requirements: z.array(z.string().max(1000)).max(30),
    output: z.enum(['structure', 'proposal']),
  })
  .strict();
export const studioStopSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().trim().min(1).max(120),
    country: short,
    nights: z.number().int().min(0).max(120).nullable(),
    arrivalDate: studioDate,
    arrivalFixed: z.boolean().optional(),
    departureDate: studioDate,
    onwardTransport: z.enum(['undecided', 'flight', 'train', 'car', 'ferry', 'coach', 'other']),
    neighbourhood: short,
    notes: z.string().max(1500),
  })
  .strict();
export const studioItemSchema = z
  .object({
    id: z.string().min(1).max(80),
    kind: z.enum(['hotel', 'flight', 'tour', 'cruise', 'transfer', 'insurance', 'other']),
    title: z.string().trim().min(1).max(300),
    description: z.string().max(5000),
    stopId: z.string().max(80),
    startDate: studioDate,
    endDate: studioDate,
    status: z.enum(['suggested', 'externally_booked', 'placeholder']),
    source: z.enum(['manual', 'import', 'liteapi']),
    sourceUrl: z.string().max(2048),
    supplier: short,
    privateReference: z.string().max(300),
    price: amount,
    currency,
    priceStatus: z.enum(['unpriced', 'agent_estimate', 'supplier_quote', 'sandbox']),
    quotedAt: z.string().max(40),
    included: z.boolean(),
    needsReview: z.boolean(),
    cost: amount,
    imageUrl: z.string().url().max(2048).optional(),
    presentation: z.unknown().optional(),
  })
  .strict();
export const studioRecommendationSchema = z
  .object({
    id: z.string().min(1).max(80),
    stopId: z.string().max(80),
    name: short,
    category: z.enum(['activity', 'food']),
    description: z.string().max(2500),
    sources: z
      .array(
        z
          .object({ label: short, url: z.string().url().max(2048), checkedAt: z.string().max(40) })
          .strict(),
      )
      .max(8),
    included: z.boolean(),
  })
  .strict();
export const studioPricingSchema = z
  .object({
    mode: z.enum(['itemised', 'package']),
    packagePrice: amount,
    currency,
    notes: z.string().max(2500),
    marginPercent: z.number().finite().min(0).max(1000),
  })
  .strict();
export const studioAgencySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    logoDataUrl: z
      .string()
      .max(200000)
      .refine(
        (value) => !value || /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value),
        'Use a small PNG or JPEG logo.',
      ),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    email: z
      .string()
      .max(254)
      .refine((value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)),
    phone: z.string().max(80),
    website: z
      .string()
      .max(500)
      .refine((value) => !value || /^https?:\/\/[^\s]+$/.test(value)),
    quoteValidityHours: z.number().int().min(1).max(720),
    gds: z.enum(['auto', 'amadeus', 'sabre', 'galileo', 'other']),
    customQuestions: z.array(z.string().trim().min(1).max(500)).max(20),
    paymentCostPercent: z.number().finite().min(0).max(10),
    disclaimer: z.string().max(3000),
  })
  .strict();
export const studioPatchSchema = z
  .object({
    revision: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    brief: studioBriefSchema.partial().optional(),
    stops: z.array(studioStopSchema).max(20).optional(),
    items: z.array(studioItemSchema).max(150).optional(),
    recommendations: z.array(studioRecommendationSchema).max(120).optional(),
    pricing: studioPricingSchema.partial().optional(),
    itinerary: studioItinerarySchema.nullable().optional(),
  })
  .strict();
export function addNights(date: string, nights: number) {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + nights);
  return day.toISOString().slice(0, 10);
}
export function recalculateStudioStops(stops: StudioStop[], startDate: string): StudioStop[] {
  let cursor = startDate;
  const ids = new Set<string>();
  let total = 0;
  return stops.map((stop) => {
    if (ids.has(stop.id)) throw new StudioError(400, 'Each route stop needs its own identifier.');
    ids.add(stop.id);
    total += stop.nights || 0;
    if (total > 365)
      throw new StudioError(400, 'Split routes longer than 365 nights into separate proposals.');
    const arrival = stop.arrivalFixed && stop.arrivalDate ? stop.arrivalDate : cursor;
    if (cursor && arrival && arrival < cursor)
      throw new StudioError(
        400,
        `${stop.name} starts before the previous stay ends. Check its fixed arrival date.`,
      );
    const departure = arrival && stop.nights !== null ? addNights(arrival, stop.nights) : '';
    cursor = departure;
    return { ...stop, arrivalDate: arrival, departureDate: departure };
  });
}
export function structureFingerprint(workspace: StudioWorkspace) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        startDate: workspace.brief.startDate,
        endDate: workspace.brief.endDate,
        stops: workspace.stops.map(
          ({
            id,
            name,
            country,
            nights,
            arrivalDate,
            departureDate,
            onwardTransport,
            neighbourhood,
          }) => ({
            id,
            name,
            country,
            nights,
            arrivalDate,
            departureDate,
            onwardTransport,
            neighbourhood,
          }),
        ),
      }),
    )
    .digest('hex');
}
export function replaceStudioRecommendations(
  workspace: StudioWorkspace,
  stopIds: string[],
  category: StudioRecommendation['category'],
  recommendations: StudioRecommendation[],
) {
  const replacing = (item: StudioRecommendation) =>
    stopIds.includes(item.stopId) && item.category === category;
  const next = [
    ...workspace.recommendations.filter((item) => !replacing(item)),
    ...recommendations,
  ];
  if (next.length > 120)
    throw new StudioError(
      400,
      'Keep at most 120 recommendations per proposal. Choose fewer destinations or remove older suggestions.',
    );
  if (workspace.recommendations.some((item) => item.included && replacing(item)))
    if (!workspace.itineraryManual) workspace.itinerary = null;
  workspace.recommendations = next;
}

export function qualifyStudio(
  workspace: StudioWorkspace,
  agency: StudioAgency,
): StudioQualification {
  const { brief: b, stops } = workspace;
  const known: StudioQualification['known'] = [];
  const questions: StudioQualification['questions'] = [];
  const fact = (id: string, label: string, value: string) => known.push({ id, label, value });
  const ask = (id: string, label: string, reason: string, required = false) =>
    questions.push({ id, label, reason, required });
  if (stops.length) fact('route', 'Destinations', stops.map((s) => s.name).join(' → '));
  else
    ask(
      'route',
      'Where would you like the client to travel?',
      'A destination is needed to build a route.',
      true,
    );
  const passport = normalizeStudioCountry(b.passportNationality || '');
  if (passport) fact('passportNationality', 'Passport nationality', passport.name);
  else
    ask(
      'passportNationality',
      'Which country issued the passport held?',
      'Only the country is needed; do not enter a passport number.',
    );
  if (b.tripType && b.tripType !== 'undecided')
    fact(
      'tripType',
      'Trip type',
      b.tripType === 'single' ? 'Single destination' : 'Multiple destinations',
    );
  else
    ask(
      'tripType',
      'Is this a single-destination or multi-destination trip?',
      'Confirm the intended scope before adding route stops.',
    );
  if (b.outboundTransport && b.outboundTransport !== 'undecided')
    fact(
      'outboundTransport',
      'Travel to destination',
      b.outboundTransport === 'cruise' ? 'Cruise' : 'Flight',
    );
  else
    ask(
      'outboundTransport',
      'How would you like to travel there: Flight or Cruise?',
      'Arrival arrangements may affect entry and port requirements.',
    );
  if (b.returnTransport && b.returnTransport !== 'undecided')
    fact('returnTransport', 'Return travel', b.returnTransport === 'cruise' ? 'Cruise' : 'Flight');
  else
    ask(
      'returnTransport',
      'Will the return be by flight or cruise?',
      'The return can use a different transport mode.',
    );
  if (b.departureDate) fact('departureDate', 'Departure from origin', b.departureDate);
  else if (stops.length && !b.datesFlexible)
    ask(
      'departureDate',
      'When would you like to depart, or are dates flexible?',
      'Journey options use departure from your origin; arrival comes from the selected schedule.',
    );
  if (b.tripDays) fact('tripDays', 'Requested trip days', String(b.tripDays));
  if (b.returnDepartureDate) fact('returnDepartureDate', 'Return departure', b.returnDepartureDate);
  if (b.origin) fact('origin', 'Starting from', b.origin);
  else if (stops.length)
    ask(
      'origin',
      'Where will you start this journey?',
      'Use the starting city to compare flight or cruise routes.',
    );
  if (b.tripPurpose && b.tripPurpose !== 'undecided')
    fact('tripPurpose', 'Travel purpose', b.tripPurpose);
  if (b.startDate) fact('startDate', 'Arrival date', b.startDate);
  else if (b.datesFlexible) fact('dates', 'Travel dates', 'Flexible');
  if (b.endDate) fact('endDate', 'Trip end', b.endDate);
  else if (stops.length && stops.every((s) => s.nights !== null))
    fact('nights', 'Stay length', `${stops.reduce((sum, s) => sum + (s.nights || 0), 0)} nights`);
  else if (!b.tripDays)
    ask(
      'nights',
      'How many nights in each destination, or what is the end date?',
      'Avoid assuming a return date or length of stay.',
    );
  if (b.adults !== null) fact('adults', 'Adults', String(b.adults));
  else
    ask(
      'adults',
      'How many adults are travelling on this trip?',
      'Previous client trips do not establish the current party.',
    );
  if (b.children !== null) fact('children', 'Children', String(b.children));
  else
    ask(
      'children',
      'Are any children travelling this time?',
      'The party may differ from an earlier booking.',
    );
  if (b.children && b.childAges.length !== b.children)
    ask(
      'childAges',
      'What are the ages of all children?',
      'Room, fare and insurance eligibility depend on age.',
    );
  else if (b.childAges.length) fact('childAges', 'Child ages', b.childAges.join(', '));
  if (b.budget !== null) fact('budget', 'Group budget', `${b.currency} ${b.budget}`);
  else
    ask(
      'budget',
      'Is there a group budget or price point?',
      'Optional for a route outline; important before selecting priced services.',
    );
  if (b.hotelStandard) fact('hotelStandard', 'Hotel preference', b.hotelStandard);
  else
    ask(
      'hotelStandard',
      'Any hotel standard or price-point preference?',
      'Ask before spending time on unsuitable hotel searches.',
    );
  if (b.hotelLocation) fact('hotelLocation', 'Preferred location', b.hotelLocation);
  if (b.cabin) fact('cabin', 'Flight cabin', b.cabin);
  if (b.requirements.length || b.interests.length)
    fact('preferences', 'Client preferences', [...b.interests, ...b.requirements].join('; '));
  for (let index = 0; index < agency.customQuestions.length; index++) {
    const label = agency.customQuestions[index];
    // Custom responses are part of the agent's context, not inferred profile facts.
    if (!b.context.toLowerCase().includes(label.toLowerCase()))
      ask(`agency-${index}`, label, 'Your agency’s qualifying question.');
  }
  const criteria = [
    stops.length > 0,
    Boolean(b.startDate || b.datesFlexible),
    Boolean(b.endDate || (stops.length && stops.every((stop) => stop.nights !== null))),
    b.adults !== null,
    b.children !== null && (b.children === 0 || b.childAges.length === b.children),
    b.budget !== null,
    Boolean(b.hotelStandard || b.output === 'structure'),
    Boolean(b.interests.length || b.requirements.length || b.context),
  ];
  return {
    score: Math.round((criteria.filter(Boolean).length / criteria.length) * 100),
    known,
    questions,
    skipped: workspace.qualification.skipped,
  };
}
export function applyStudioPatch(
  workspace: StudioWorkspace,
  patch: z.infer<typeof studioPatchSchema>,
  agency: StudioAgency,
): StudioWorkspace {
  const previous = structureFingerprint(workspace);
  const transportBasis = (value: StudioWorkspace) =>
    JSON.stringify({
      origin: value.brief.origin,
      departureDate: value.brief.departureDate || '',
      returnDepartureDate: value.brief.returnDepartureDate || '',
      tripDays: value.brief.tripDays ?? null,
      outbound: value.brief.outboundTransport || 'undecided',
      returning: value.brief.returnTransport || 'undecided',
    });
  const previousTransport = transportBasis(workspace);
  const previousCabin = workspace.brief.cabin;
  const entryBasis = (value: StudioWorkspace) =>
    JSON.stringify({
      passport: value.brief.passportNationality || '',
      purpose: value.brief.tripPurpose || 'undecided',
      activityDeclarations: studioEntryPurposeDeclarations(value.brief),
      destination: value.brief.preferredDestination || '',
      country: value.brief.destinationCountry || '',
      start: value.brief.startDate,
      end: value.brief.endDate,
      outbound: value.brief.outboundTransport || 'undecided',
      returning: value.brief.returnTransport || 'undecided',
      route: value.stops.map(
        ({ id, name, country, arrivalDate, departureDate, nights, onwardTransport }) => ({
          id,
          name,
          country,
          arrivalDate,
          departureDate,
          nights,
          onwardTransport,
        }),
      ),
    });
  const researchBasis = (value: StudioWorkspace) =>
    JSON.stringify({
      clientId: value.brief.clientId || '',
      context: value.brief.context,
      destination: value.brief.preferredDestination || '',
      country: value.brief.destinationCountry || '',
      start: value.brief.startDate,
      end: value.brief.endDate,
      flexible: value.brief.datesFlexible,
      adults: value.brief.adults,
      children: value.brief.children,
      budget: value.brief.budget,
      currency: value.brief.currency,
      origin: value.brief.origin,
      interests: value.brief.interests,
      food: value.brief.foodPreferences || [],
      requirements: value.brief.requirements,
      tripType: value.brief.tripType || 'undecided',
      route: value.stops.map(({ name, country }) => ({ name, country })),
    });
  const previousEntryBasis = entryBasis(workspace);
  const previousResearchBasis = researchBasis(workspace);
  const previousCandidateEntryBasis = workspace.destinationResearch?.candidates.map((candidate) =>
    studioCandidateEntryInputKey(workspace, candidate),
  );
  const itineraryBasis = (value: StudioWorkspace) => {
    const { request: _request, output: _output, clientName: _name, ...preferences } = value.brief;
    return JSON.stringify({
      preferences,
      items: value.items,
      recommendations: value.recommendations,
    });
  };
  const previousItineraryBasis = itineraryBasis(workspace);
  const oldParty = JSON.stringify([
    workspace.brief.adults,
    workspace.brief.children,
    workspace.brief.childAges,
  ]);
  if (patch.title !== undefined) workspace.title = patch.title;
  if (patch.brief) workspace.brief = { ...workspace.brief, ...patch.brief };
  if (workspace.brief.passportNationality)
    workspace.brief.passportNationality = normalizeStudioCountry(
      workspace.brief.passportNationality,
    )!.code;
  if (workspace.brief.destinationCountry)
    workspace.brief.destinationCountry = normalizeStudioCountry(
      workspace.brief.destinationCountry,
    )!.code;
  if (
    workspace.brief.endDate &&
    workspace.brief.startDate &&
    workspace.brief.endDate < workspace.brief.startDate
  )
    throw new StudioError(400, 'The end date must follow arrival.');
  if (
    workspace.brief.children !== null &&
    workspace.brief.childAges.length > workspace.brief.children
  )
    throw new StudioError(400, 'Child ages exceed the number of children.');
  workspace.stops = recalculateStudioStops(
    patch.stops ?? workspace.stops,
    workspace.brief.startDate,
  );
  if (patch.items) {
    const originals = new Map(workspace.items.map((item) => [item.id, item]));
    workspace.items = patch.items.map((item) => {
      const old = originals.get(item.id);
      if (
        (item.imageUrl !== undefined && item.imageUrl !== old?.imageUrl) ||
        (item.presentation !== undefined &&
          !isDeepStrictEqual(item.presentation, old?.presentation))
      )
        throw new StudioError(
          400,
          'Supplier presentation and media can only come from a selected quote.',
        );
      if (item.source === 'liteapi' && (!old || old.source !== 'liteapi'))
        throw new StudioError(400, 'Select a returned supplier quote before adding it.');
      if (
        (old?.source === 'liteapi' || old?.presentation) &&
        (
          [
            'source',
            'kind',
            'title',
            'stopId',
            'price',
            'currency',
            'priceStatus',
            'quotedAt',
            'startDate',
            'endDate',
            'supplier',
            'sourceUrl',
          ] as const
        ).some((field) => item[field] !== old[field])
      )
        throw new StudioError(
          400,
          'Supplier quote identity, dates and amounts cannot be relabelled. Add a separate agent estimate instead.',
        );
      if (item.price !== null && item.priceStatus === 'unpriced')
        throw new StudioError(400, 'Choose an estimate or quote label for an entered price.');
      if (
        item.kind === 'insurance' &&
        item.price !== null &&
        item.source === 'manual' &&
        item.priceStatus !== 'agent_estimate'
      )
        throw new StudioError(
          400,
          'Manual insurance amounts must be labelled agent estimates until a quoting provider is connected.',
        );
      if (item.startDate && item.endDate && item.endDate < item.startDate)
        throw new StudioError(400, 'An item end date precedes its start.');
      return {
        ...item,
        ...(old?.imageUrl ? { imageUrl: old.imageUrl } : {}),
        presentation: old?.presentation,
      };
    });
    if (new Set(workspace.items.map((i) => i.id)).size !== workspace.items.length)
      throw new StudioError(400, 'Item identifiers must be unique.');
  }
  if (patch.recommendations) {
    const existing = new Map(workspace.recommendations.map((r) => [r.id, r]));
    for (const rec of patch.recommendations) {
      const old = existing.get(rec.id);
      if (!old || !isDeepStrictEqual({ ...rec, included: old.included }, old))
        throw new StudioError(
          400,
          'Only the inclusion choice can change for researched recommendations.',
        );
    }
    workspace.recommendations = patch.recommendations;
  }
  if (patch.pricing) workspace.pricing = { ...workspace.pricing, ...patch.pricing };
  const changed = previous !== structureFingerprint(workspace);
  if (changed && workspace.clarification) workspace.clarification = null;
  if (changed) {
    workspace.structureAccepted = false;
    if (workspace.stage !== 'brief') workspace.stage = 'structure';
    const stopIds = new Set(workspace.stops.map((s) => s.id));
    workspace.recommendations = workspace.recommendations.filter((r) => stopIds.has(r.stopId));
  }
  if (
    changed ||
    oldParty !==
      JSON.stringify([workspace.brief.adults, workspace.brief.children, workspace.brief.childAges])
  )
    workspace.items = workspace.items.map((item) => ({ ...item, needsReview: true }));
  else if (
    previousTransport !== transportBasis(workspace) ||
    previousCabin !== workspace.brief.cabin
  ) {
    const transportChanged = previousTransport !== transportBasis(workspace);
    workspace.items = workspace.items.map((item) =>
      item.kind === 'flight' || (transportChanged && ['cruise', 'transfer'].includes(item.kind))
        ? { ...item, needsReview: true }
        : item,
    );
  }
  if (changed || previousItineraryBasis !== itineraryBasis(workspace)) {
    // Agent-authored plans remain editable after preferences or supplier selections change.
    if (!workspace.itineraryManual) workspace.itinerary = null;
    if (workspace.itinerary) {
      workspace.itinerary.days.forEach((day) => {
        day.stopIds = day.stopIds.filter((id) => workspace.stops.some((stop) => stop.id === id));
      });
      workspace.itinerary.notes = [
        ...new Set([
          ...workspace.itinerary.notes,
          'Trip details changed. Review the daily plan against the current route and services.',
        ]),
      ].slice(-20);
    }
  }
  if (patch.itinerary !== undefined) {
    workspace.itineraryManual = true;
    workspace.itinerary =
      patch.itinerary === null
        ? null
        : sanitizeManualStudioItinerary(patch.itinerary, workspace.itinerary);
    const ids = new Set(workspace.stops.map((stop) => stop.id));
    if (workspace.itinerary?.days.some((day) => day.stopIds.some((id) => !ids.has(id))))
      throw new StudioError(400, 'Daily plans must refer to destinations in this workspace.');
  }
  if (patch.stops) {
    workspace.brief.preferredDestination = workspace.stops[0]?.name || '';
    workspace.brief.destinationCountry =
      normalizeStudioCountry(workspace.stops[0]?.country || '')?.code || '';
  }
  if (previousEntryBasis !== entryBasis(workspace)) {
    workspace.entryRequirements = [];
    workspace.tripBriefing = null;
  }
  if (previousResearchBasis !== researchBasis(workspace)) workspace.destinationResearch = null;
  else if (workspace.destinationResearch)
    workspace.destinationResearch.candidates.forEach((candidate, index) => {
      if (
        previousCandidateEntryBasis?.[index] !== studioCandidateEntryInputKey(workspace, candidate)
      )
        delete candidate.entryRequirements;
    });
  workspace.qualification = qualifyStudio(workspace, agency);
  return workspace;
}
