import type { FlightAirport, FlightOffer } from './types';
import type { StudioItem } from './studio';

export interface StudioFlightConnection {
  journeyId: string;
  arrivalAirport: FlightAirport;
  departureAirport: FlightAirport;
  arrival: string;
  departure: string;
  durationMinutes: number | null;
  airportChange: boolean;
  overnight: boolean;
  transitCountryCode?: string;
  kind: 'connection' | 'technical_stop';
}
export interface StudioFlightAdvisory {
  kind: 'connection' | 'transit' | 'hotel_timing' | 'gap' | 'verification';
  summary: string;
  basis: 'supplier_schedule' | 'trip_dates';
  stopId?: string;
}
export interface StudioFlightQuote extends FlightOffer {
  quoteId: string;
  quotedAt: string;
  mode: 'test' | 'live' | 'provider';
  connections: StudioFlightConnection[];
  advisories: StudioFlightAdvisory[];
}
export interface StudioFlightSearchResult {
  quotes: StudioItem[];
  flights: StudioFlightQuote[];
  mode: 'test' | 'live' | 'provider';
  warning: string;
}
