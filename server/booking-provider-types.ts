import type {
  Booking,
  BookingOfferView,
  BookingQuote,
  BookingGuest,
  BookingHolder,
} from '../shared/bookings.ts';

/** Stored only in the owner-scoped offer table. Never accepted from client JSON. */
export interface StoredBookingOffer {
  view: BookingOfferView;
  provider: 'liteapi';
  providerOfferId: string;
  hotelId?: string;
  guestNationality?: string;
}
export interface ProviderPrebook {
  prebookId: string;
  quote: BookingQuote;
}
export interface ProviderBookingResult {
  status: 'confirmed' | 'pending' | 'cancelled' | 'unknown' | 'failed';
  providerBookingId?: string;
  /** Private recovery reference; never a ticket or confirmed booking. */
  providerPrebookId?: string;
  confirmationCode?: string;
  ticketNumbers?: string[];
  paymentStatus: Booking['paymentStatus'];
  message?: string;
  cancellation?: Booking['cancellation'];
}
export interface BookingProvider {
  prebook(offer: StoredBookingOffer): Promise<ProviderPrebook>;
  confirm(input: {
    offer: StoredBookingOffer;
    prebookId: string;
    quote: BookingQuote;
    clientReference: string;
    holder: BookingHolder;
    guests: BookingGuest[];
    /** Persist before dispatching a final supplier booking. */
    checkpoint?: (state: { providerPrebookId: string }) => void | Promise<void>;
  }): Promise<ProviderBookingResult>;
  retrieve(input: {
    providerBookingId?: string;
    providerPrebookId?: string;
    cancelIntentAt?: string;
    clientReference: string;
  }): Promise<ProviderBookingResult>;
  cancel(input: {
    providerBookingId: string;
    clientReference: string;
  }): Promise<ProviderBookingResult>;
}
