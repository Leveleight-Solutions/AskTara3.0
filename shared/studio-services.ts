import type { StudioHotelQuote } from './studio-hotels';
import type { StudioFlightQuote } from './studio-flights';

/** Selected supplier presentation is copied by the server, never accepted as new browser evidence. */
export type StudioServicePresentation =
  { kind: 'hotel'; hotel: StudioHotelQuote } | { kind: 'flight'; flight: StudioFlightQuote };
