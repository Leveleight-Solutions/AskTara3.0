import type { StudioItem } from './studio';

export interface HotelPhoto {
  url: string;
  caption: string;
}
export interface HotelDetails {
  photos: HotelPhoto[];
  roomPhotos: HotelPhoto[];
  description: string;
  roomDescription: string;
  amenities: string[];
  roomAmenities: string[];
  group: string;
  stars: number | null;
  distanceKm: number | null;
  cancellation: string;
  taxes: string;
  detailsStatus: 'available' | 'unavailable';
}
/** Supplier identifiers stay on the server; quoteId is the application's scoped selection ID. */
export interface StudioHotelQuote extends HotelDetails {
  quoteId: string;
  hotelKey: string;
  name: string;
  address: string;
  room: string;
  board: string;
  price: number;
  currency: string;
  checkin: string;
  checkout: string;
  quotedAt: string;
  mode: 'live' | 'test' | 'provider';
  adults: number;
  childAges: number[];
}
export interface HotelInventory {
  returnedHotels: number;
  returnedQuotes: number;
  limit: number;
  hasMore: boolean;
  searchRadiusKm: number;
  pagesSearched: number;
  incomplete: boolean;
  nextOffset: number | null;
  searchLimitReached?: boolean;
}
export interface HotelRecommendations {
  status: 'ai' | 'unavailable';
  picks: { quoteId: string; reason: string }[];
  message: string;
}
export interface StudioHotelSearchResult {
  quotes: StudioItem[];
  hotels: StudioHotelQuote[];
  recommendations: HotelRecommendations;
  inventory: HotelInventory;
  mode: 'live' | 'test' | 'provider';
  warning: string;
}

export function filterHotelQuotes(
  hotels: StudioHotelQuote[],
  filters: { group: string; amenities: string[]; search: string },
) {
  const text = filters.search.trim().toLocaleLowerCase();
  return hotels.filter(
    (hotel) =>
      (!filters.group || hotel.group === filters.group) &&
      filters.amenities.every((amenity) => hotel.amenities.includes(amenity)) &&
      (!text ||
        [hotel.name, hotel.address, hotel.room].join(' ').toLocaleLowerCase().includes(text)),
  );
}
