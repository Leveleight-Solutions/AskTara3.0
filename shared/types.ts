import type { TravelBrief, PlanningReport } from './planning';
export type Vibe =
  'All places' | 'By the water' | 'City escapes' | 'Into the wild' | 'Culture & charm';
export interface Destination {
  id: string;
  name: string;
  country: string;
  region: string;
  description: string;
  longDescription: string;
  image: string;
  tags: string[];
  vibe: Vibe;
  bestTime: string;
  dailyBudget: number;
  coordinates: [number, number];
  highlights: string[];
}
export interface Stay {
  id: string;
  destinationId: string;
  name: string;
  description: string;
  image: string;
  style: string;
  price: number;
  rating: number;
  amenities: string[];
}
export interface Experience {
  id: string;
  destinationId: string;
  name: string;
  description: string;
  image: string;
  duration: string;
  price: number;
  category: string;
}
export interface Catalog {
  destinations: Destination[];
  stays: Stay[];
  experiences: Experience[];
}
export interface User {
  id: string;
  name: string;
  email: string;
}
export interface Session {
  user: User | null;
}
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
export interface ItineraryItem {
  id: string;
  time: string;
  title: string;
  description: string;
  location: string;
  category: 'sight' | 'food' | 'experience' | 'stay' | 'leisure';
  cost: number;
  completed: boolean;
  locked?: boolean;
  durationMinutes?: number;
  placeId?: string;
  sourceId?: string;
  travelMinutes?: number;
}
export interface ItineraryDay {
  day: number;
  destinationId?: string;
  title: string;
  items: ItineraryItem[];
}
export interface Trip {
  id: string;
  title: string;
  destinationId: string;
  startDate: string;
  /** Public destination identity resolved by the server; survives report refreshes and sharing. */
  destinations?: Destination[];
  days: number;
  travelers: number;
  budget: number;
  interests: string[];
  status: 'draft' | 'planned';
  revision?: number;
  brief?: TravelBrief;
  planning?: PlanningReport;
  itinerary: ItineraryDay[];
  messages: Message[];
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ChatResponse {
  trip: Trip;
  message: Message;
  mode: 'local' | 'live';
  warning?: string;
  runId?: string;
}
export interface IntegrationStatus {
  ai: boolean;
  flights: boolean;
  hotels: boolean;
  activities: boolean;
  mode: 'local' | 'live';
}
export interface PublicConfig {
  /** Public, website-restricted Maps Embed key. Never the server Places key. */
  mapsEmbedApiKey?: string;
}
export interface SavedItem {
  id: string;
  type: 'destination' | 'stay' | 'experience';
  itemId: string;
}
export interface FlightAirport {
  code: string;
  name?: string;
  city?: string;
  timeZone?: string;
}
export interface FlightCarrier {
  name: string;
  code?: string;
}
export interface FlightSegment {
  id: string;
  origin: FlightAirport;
  destination: FlightAirport;
  departure: string;
  arrival: string;
  duration?: string;
  originTerminal?: string;
  destinationTerminal?: string;
  marketingCarrier?: FlightCarrier;
  operatingCarrier?: FlightCarrier;
  marketingFlightNumber?: string;
  operatingFlightNumber?: string;
  passengers?: {
    passengerId: string;
    cabin?: string;
    baggages?: { type: string; quantity: number }[];
  }[];
  stops?: {
    airport: FlightAirport;
    arrival?: string;
    departure?: string;
    duration?: string;
  }[];
}
export interface FlightJourney {
  id: string;
  origin: FlightAirport;
  destination: FlightAirport;
  departure: string;
  arrival: string;
  duration?: string;
  connections: number;
  stops: number;
  segments: FlightSegment[];
}
export interface FlightOffer {
  /** Owner-scoped reference for sandbox checkout, issued by the search endpoint. */
  bookingOfferId?: string;
  id: string;
  airline: string;
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  duration: string;
  stops: number;
  price: number;
  currency: string;
  journeys?: FlightJourney[];
  requestedJourneyCount?: number;
  passengerCount?: number;
  priceScope?: 'all_passengers_complete_journey';
  expiresAt?: string;
  liveMode?: boolean;
}
