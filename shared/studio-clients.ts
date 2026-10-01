import type { StudioTravelHistoryEntry } from './studio-travel-research';

/** Photos are displayed to the agent only, never sent to a planning model. */
export interface StudioClientProfile {
  id: string;
  name: string;
  context: string;
  passportNationality: string;
  photoDataUrl: string;
  interests: string[];
  foodPreferences: string[];
  history: StudioTravelHistoryEntry[];
  updatedAt: string;
  previousTripCount?: number;
}
