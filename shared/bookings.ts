import type { FlightJourney } from './types';

export type BookingKind = 'hotel' | 'flight';
export type BookingStatus =
  | 'checkout'
  | 'confirming'
  | 'pending'
  | 'confirmed'
  | 'unknown'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'expired';

/** Public offer data. Provider offer IDs and credentials stay on the server. */
export interface BookingOfferView {
  id: string;
  kind: BookingKind;
  name: string;
  description: string;
  price: number;
  currency: string;
  adults: number;
  startDate: string;
  endDate?: string;
  location: string;
  room?: string;
  journeys?: FlightJourney[];
  expiresAt: string;
  tripId?: string;
  mode: 'test';
  confirmationAvailable?: boolean;
  unavailableReason?: string;
}

export interface CancellationPolicy {
  from?: string;
  until?: string;
  amount?: number;
  currency?: string;
  description: string;
}

export interface BookingQuote {
  version: string;
  price: number;
  currency: string;
  originalPrice: number;
  priceChanged: boolean;
  expiresAt: string;
  terms: string[];
  cancellationPolicies: CancellationPolicy[];
}

export interface BookingGuest {
  firstName: string;
  lastName: string;
  email?: string;
  dateOfBirth?: string;
  gender?: 'M' | 'F';
  nationality?: string;
  passportNumber?: string;
  passportExpiry?: string;
  passportIssueCountry?: string;
}

export interface BookingHolder {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  phoneCountryCode?: string;
}

export interface Booking {
  id: string;
  kind: BookingKind;
  mode: 'test';
  status: BookingStatus;
  offer: BookingOfferView;
  quote: BookingQuote;
  providerBookingId?: string;
  confirmationCode?: string;
  ticketNumbers?: string[];
  paymentStatus: 'not_charged' | 'simulated' | 'unknown';
  message?: string;
  cancellation?: { status: string; fee?: number; currency?: string };
  createdAt: string;
  updatedAt: string;
}

export interface ConfirmBookingInput {
  requestId: string;
  quoteVersion: string;
  acceptedPrice: number;
  acceptedCurrency: string;
  holder: BookingHolder;
  guests: BookingGuest[];
  acceptSandbox: true;
  acceptTerms: true;
}
