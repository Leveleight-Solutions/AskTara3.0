/** Travel-agent workspace: structure first, services and recommendations only on request. */
export type StudioStage = 'brief' | 'structure' | 'services' | 'recommendations' | 'proposal';
export type TransportMode = 'undecided' | 'flight' | 'train' | 'car' | 'ferry' | 'coach' | 'other';
export interface StudioStop {
  id: string;
  name: string;
  country: string;
  nights: number | null;
  arrivalDate: string;
  arrivalFixed?: boolean;
  departureDate: string;
  onwardTransport: TransportMode;
  neighbourhood: string;
  notes: string;
}
export interface StudioBrief {
  clientName: string;
  context: string;
  request: string;
  startDate: string;
  endDate: string;
  datesFlexible: boolean;
  adults: number | null;
  children: number | null;
  childAges: number[];
  budget: number | null;
  currency: string;
  origin: string;
  hotelStandard: string;
  hotelLocation: string;
  cabin: string;
  interests: string[];
  requirements: string[];
  output: 'structure' | 'proposal';
}
export interface StudioQuestion {
  id: string;
  label: string;
  reason: string;
  required: boolean;
}
export interface StudioQualification {
  score: number;
  known: { id: string; label: string; value: string }[];
  questions: StudioQuestion[];
  skipped: boolean;
}
export interface StudioSource {
  label: string;
  url: string;
  checkedAt: string;
}
export interface StudioItem {
  id: string;
  kind: 'hotel' | 'flight' | 'tour' | 'cruise' | 'transfer' | 'insurance' | 'other';
  title: string;
  description: string;
  stopId: string;
  startDate: string;
  endDate: string;
  status: 'suggested' | 'externally_booked' | 'placeholder';
  source: 'manual' | 'import' | 'liteapi';
  sourceUrl: string;
  supplier: string;
  privateReference: string;
  price: number | null;
  currency: string;
  priceStatus: 'unpriced' | 'agent_estimate' | 'supplier_quote' | 'sandbox';
  quotedAt: string;
  included: boolean;
  needsReview: boolean;
  /** Agent-only acquisition cost; excluded from all client output. */
  cost: number | null;
}
export interface StudioRecommendation {
  id: string;
  stopId: string;
  name: string;
  category: 'activity' | 'food';
  description: string;
  sources: StudioSource[];
  included: boolean;
}
export interface StudioImport {
  id: string;
  kind: 'text' | 'image' | 'pdf' | 'url' | 'audio';
  name: string;
  text: string;
  createdAt: string;
  sourceUrl: string;
  warnings: string[];
}
export interface StudioAgency {
  name: string;
  logoDataUrl: string;
  accentColor: string;
  email: string;
  phone: string;
  website: string;
  quoteValidityHours: number;
  gds: 'auto' | 'amadeus' | 'sabre' | 'galileo' | 'other';
  customQuestions: string[];
  paymentCostPercent: number;
  disclaimer: string;
}
export interface StudioPricing {
  mode: 'itemised' | 'package';
  packagePrice: number | null;
  currency: string;
  notes: string;
  /** Internal commercial allowance, never represented as a card surcharge rule. */
  marginPercent: number;
}
export interface StudioWorkspace {
  id: string;
  revision: number;
  title: string;
  stage: StudioStage;
  brief: StudioBrief;
  qualification: StudioQualification;
  stops: StudioStop[];
  structureAccepted: boolean;
  items: StudioItem[];
  recommendations: StudioRecommendation[];
  imports: StudioImport[];
  messages: { id: string; role: 'user' | 'assistant'; content: string; createdAt: string }[];
  pricing: StudioPricing;
  proposal: { token: string; publishedAt: string; revision: number } | null;
  createdAt: string;
  updatedAt: string;
  /** When it was pinned to the top of the recent list; stored beside the document, not in it. */
  pinnedAt?: string | null;
}
export interface StudioClient {
  name: string;
  context: string;
  previousWorkspaces: { id: string; title: string; updatedAt: string }[];
}
export const defaultStudioAgency = (): StudioAgency => ({
  name: 'Asktara',
  logoDataUrl: '',
  accentColor: '#285641',
  email: '',
  phone: '',
  website: '',
  quoteValidityHours: 48,
  gds: 'auto',
  customQuestions: [],
  paymentCostPercent: 0,
  disclaimer:
    'This is a travel proposal. Availability and prices require reconfirmation before booking.',
});
