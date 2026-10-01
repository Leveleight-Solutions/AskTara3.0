import type { StudioTravelHistoryEntry } from './studio-travel-research';

/** Photos are displayed to the agent only, never sent to a planning model. */
export interface StudioClientProfile {
  id: string;
  name: string;
  /** Residence and citizenship are independent of the passport used for a trip. */
  country?: string;
  nationality?: string;
  /** Private record only; not sent to recommendation models. */
  dateOfBirth?: string;
  context: string;
  passportNationality: string;
  photoDataUrl: string;
  interests: string[];
  foodPreferences: string[];
  history: StudioTravelHistoryEntry[];
  updatedAt: string;
  previousTripCount?: number;
}
