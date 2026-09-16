export const dietaryPreferenceOptions = [
  'Vegetarian',
  'Vegan',
  'Gluten-free',
  'Dairy-free',
  'Nut allergy',
  'Shellfish allergy',
  'Halal',
  'Kosher',
] as const;
export const accessibilityPreferenceOptions = [
  'Wheelchair access',
  'Step-free access',
  'Elevator',
  'Ground-floor room',
  'Accessible bathroom',
] as const;

export interface TravelProfile {
  pace: 'relaxed' | 'balanced' | 'active';
  interests: string[];
  originAirport: string;
  guestNationality: string;
  dietaryPreferences: string[];
  accessibilityPreferences: string[];
  planningNotes: string;
  updatedAt: string;
}

export const defaultTravelProfile: TravelProfile = {
  pace: 'balanced',
  interests: [],
  originAirport: '',
  guestNationality: '',
  dietaryPreferences: [],
  accessibilityPreferences: [],
  planningNotes: '',
  updatedAt: '',
};

export interface AccountDetails {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  otherSessions: number;
}
