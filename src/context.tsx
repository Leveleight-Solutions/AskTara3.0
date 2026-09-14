import { createContext, useContext } from 'react';
import type { Catalog, SavedItem, User, IntegrationStatus } from '../shared/types';
import type { TravelProfile } from '../shared/account';
export interface AppContextType {
  catalog: Catalog;
  user: User | null;
  setUser: (u: User | null) => void;
  ownerVersion: number;
  profile: TravelProfile | null;
  refreshProfile: () => Promise<void>;
  saved: SavedItem[];
  refreshSaved: () => Promise<void>;
  toggleSave: (type: SavedItem['type'], itemId: string) => Promise<void>;
  isSaved: (type: SavedItem['type'], itemId: string) => boolean;
  toast: (message: string) => void;
  openAuth: () => void;
  integrations: IntegrationStatus;
}
export const AppContext = createContext<AppContextType>(null!);
export const useApp = () => useContext(AppContext);
