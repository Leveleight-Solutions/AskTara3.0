import type { Destination, FlightOffer, Trip } from './types';
import type { ConsultationState } from './consultation';

export type AgentId =
  | 'intake'
  | 'destinations'
  | 'places'
  | 'verification'
  | 'stays'
  | 'flights'
  | 'itinerary'
  | 'review';
export type StageStatus = 'running' | 'completed' | 'skipped' | 'failed';
export interface PlanningEvent {
  id: string;
  agent: AgentId;
  status: StageStatus;
  label: string;
  detail: string;
  at: string;
}
export interface TravelBrief {
  pace: 'relaxed' | 'balanced' | 'active';
  originAirport: string;
  arrivalAirport: string;
  guestNationality: string;
  includeFlights: boolean;
  includeHotels: boolean;
  destinationStops: { destinationId: string; days: number }[];
  notes: string[];
  consultation?: ConsultationState;
}
export interface PlanSource {
  id: string;
  kind: 'catalog' | 'google_places' | 'duffel' | 'liteapi' | 'user' | 'web';
  label: string;
  url?: string;
  checkedAt: string;
  status: 'curated' | 'live' | 'test' | 'unverified' | 'user';
}
export interface PlanIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  day?: number;
  itemId?: string;
}
export interface PlanningQuestion {
  field:
    | 'destination'
    | 'dates'
    | 'duration'
    | 'origin'
    | 'nationality'
    | 'travelers'
    | 'budget'
    | 'flights'
    | 'flight_dates'
    | 'hotels'
    | 'interests';
  question: string;
  suggestions: string[];
}
export interface PlanningPlace {
  id: string;
  name: string;
  destinationId: string;
  address: string;
  coordinates?: [number, number];
  category: 'sight' | 'food' | 'experience' | 'leisure';
  durationMinutes: number;
  estimatedCost: number;
  sourceId: string;
  description?: string;
  evidenceUrls?: string[];
  suitability?: string[];
  mapsUrl?: string;
  openingHours?: string[];
  attributions?: { provider: string; providerUri?: string }[];
}
export interface ResearchStay {
  id: string;
  destinationId: string;
  name: string;
  description: string;
  image: string;
  price: number;
  currency: string;
  basis: 'night' | 'stay';
  sourceId: string;
}
export interface PlanningReport {
  generatedAt: string;
  mode: 'local' | 'live';
  summary: string;
  model?: string;
  researchSummary?: string;
  assumptions: string[];
  questions: PlanningQuestion[];
  issues: PlanIssue[];
  sources: PlanSource[];
  places: PlanningPlace[];
  stays: ResearchStay[];
  flights: FlightOffer[];
  destinations: Destination[];
  budget: {
    currency: 'USD';
    target: number;
    targetCurrency?: string;
    activities: number;
    accommodation: number;
    flights: number | null;
    total: number;
    unpriced: string[];
  };
  agentIds: AgentId[];
}
export interface PlanningRun {
  id: string;
  tripId: string;
  requestId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  events: PlanningEvent[];
  createdAt: string;
  updatedAt: string;
  error?: string;
  result?: {
    trip: Trip;
    message: import('./types').Message;
    mode: 'local' | 'live';
    warning?: string;
  };
}
export interface TripRevision {
  id: string;
  tripId: string;
  version: number;
  reason: string;
  createdAt: string;
}
export interface WorkflowResult {
  trip: Trip;
  reply: string;
  mode: 'local' | 'live';
  warning?: string;
  report: PlanningReport;
}
export interface WorkflowInput {
  trip: Trip;
  message: string;
  brief?: Partial<TravelBrief>;
  signal?: AbortSignal;
  onEvent?: (event: PlanningEvent) => void;
}
