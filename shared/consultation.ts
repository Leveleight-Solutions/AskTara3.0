/** Private, owner-scoped intake memory. Missing facts are unknown, never defaults. */
export const consultationFields = [
  'destination',
  'dates',
  'duration',
  'travelers',
  'budget',
  'origin',
  'interests',
] as const;
export type ConsultationField = (typeof consultationFields)[number];
export const serviceStatuses = ['unknown', 'requested', 'not_needed', 'already_booked'] as const;
export type ServiceStatus = (typeof serviceStatuses)[number];
export type ConsultationSource = 'unknown' | 'message' | 'form' | 'profile' | 'legacy';
export interface ConsultationFact {
  source: Exclude<ConsultationSource, 'unknown'>;
  evidence: string;
  valueState: 'specified' | 'flexible';
}
export interface ConsultationService {
  status: ServiceStatus;
  source: ConsultationSource;
  evidence?: string;
}
export interface ConsultationFlightJourney {
  type: 'unknown' | 'return' | 'one_way' | 'multi_city';
  departureDate: string;
  returnDate: string;
  cabinClass: 'economy' | 'premium_economy' | 'business' | 'first';
  evidence: string;
  source: Exclude<ConsultationSource, 'unknown'>;
}
export interface ConsultationState {
  version: 1;
  /** Requested budget currency, not a conversion of the USD estimate ledger. */
  currency: string;
  services: { flights: ConsultationService; hotels: ConsultationService };
  facts: Partial<Record<ConsultationField, ConsultationFact>>;
  /** Pending route names survive consultation before destination research resolves IDs. */
  route?: { name: string; days: number }[];
  flightJourney?: ConsultationFlightJourney;
  party?: {
    hasChildren: boolean;
    childAges: number[];
    source: Exclude<ConsultationSource, 'unknown'>;
    evidence: string;
  };
}
/** Model extraction must quote the current customer message; it cannot supply its own provenance. */
export interface ConsultationUpdates {
  facts: { field: ConsultationField; evidence: string; valueState: 'specified' | 'flexible' }[];
  services: { service: 'flights' | 'hotels'; status: ServiceStatus; evidence: string }[];
  currency: { value: string; evidence: string } | null;
  party: { hasChildren: boolean; childAges: number[]; evidence: string } | null;
  flightJourney?: Omit<ConsultationFlightJourney, 'source'> | null;
}
export function defaultConsultation(): ConsultationState {
  return {
    version: 1,
    currency: 'AUD',
    services: {
      flights: { status: 'unknown', source: 'unknown' },
      hotels: { status: 'unknown', source: 'unknown' },
    },
    facts: {},
  };
}

/** Read-only UI helper. Seeded trip numbers never become confirmed intake facts. */
export function getConsultation(trip: {
  brief?: { consultation?: ConsultationState };
}): ConsultationState {
  return trip.brief?.consultation || defaultConsultation();
}
