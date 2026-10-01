import type { StudioSource } from './studio';

/** ISO 3166-1 alpha-2 country/territory codes; XK is explicitly included for Kosovo.
 * Display names come from the runtime's Unicode CLDR data, not an AI destination catalogue.
 * https://www.iso.org/iso-3166-country-codes.html */
const countryCodes =
  `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK`.split(
    ' ',
  );
const names = new Intl.DisplayNames(['en'], { type: 'region' });
export const studioCountries = countryCodes
  .map((code) => ({ code, name: names.of(code) || code }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'));
const normalize = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const countries = new Map(
  studioCountries.flatMap((country) => [
    [normalize(country.code), country],
    [normalize(country.name), country],
  ]),
);
const aliases: Record<string, string> = {
  uk: 'GB',
  britain: 'GB',
  greatbritain: 'GB',
  usa: 'US',
  unitedstatesofamerica: 'US',
  russia: 'RU',
  russianfederation: 'RU',
  southkorea: 'KR',
  republicofkorea: 'KR',
  northkorea: 'KP',
  czechrepublic: 'CZ',
  turkey: 'TR',
  turkiye: 'TR',
  vietnam: 'VN',
  laos: 'LA',
  ivorycoast: 'CI',
  cotedivoire: 'CI',
  easttimor: 'TL',
  swaziland: 'SZ',
  capeverde: 'CV',
  burma: 'MM',
  myanmar: 'MM',
  hongkong: 'HK',
  macau: 'MO',
  macao: 'MO',
  palestine: 'PS',
  occupiedpalestinianterritories: 'PS',
  vaticancity: 'VA',
  holysee: 'VA',
  democraticrepublicofthecongo: 'CD',
  drcongo: 'CD',
  republicofthecongo: 'CG',
  curacao: 'CW',
  thegambia: 'GM',
  thebahamas: 'BS',
  uae: 'AE',
};
export function normalizeStudioCountry(value: string) {
  const key = normalize(value.trim());
  return countries.get(key) || countries.get((aliases[key] || '').toLowerCase());
}

export interface StudioTravelHistoryEntry {
  destination: string;
  country?: string;
  visitedAt?: string;
  interests?: string[];
}
export interface StudioTravelEvidence extends StudioSource {
  kind: 'advisory' | 'conditions' | 'official_immigration' | 'index' | 'other';
  publishedAt: string;
}
export interface StudioDestinationCandidate {
  destination: string;
  country: string;
  countryCode: string;
  reason: string;
  suggestedDays: number;
  thingsToDo: string[];
  conditions: string;
  seasonalGuidance: string;
  status: 'checked' | 'warning' | 'blocked' | 'unknown';
  advisory: string;
  recommendable: boolean;
  sources: StudioTravelEvidence[];
}
export interface StudioDestinationResearch {
  checkedAt: string;
  inputKey: string;
  historyUsed: boolean;
  candidates: StudioDestinationCandidate[];
  notes: string[];
}
export type StudioVisaCategory =
  'visa_free' | 'visa_on_arrival' | 'e_visa' | 'visa_required' | 'unknown';
export const studioVisaLabels: Record<StudioVisaCategory, string> = {
  visa_free: 'Visa-free',
  visa_on_arrival: 'Visa on arrival',
  e_visa: 'e-Visa',
  visa_required: 'Visa required',
  unknown: 'Not verified',
};
export interface StudioEntryRequirements {
  checkedAt: string;
  inputKey: string;
  stopId: string;
  passportCountry: string;
  passportCountryCode: string;
  destination: string;
  destinationCountry: string;
  destinationCountryCode: string;
  category: StudioVisaCategory;
  status: 'corroborated' | 'conflicting' | 'unverified';
  summary: string;
  conditions: string[];
  electronicAuthorisation: string;
  sources: StudioTravelEvidence[];
  observations: {
    category: StudioVisaCategory;
    summary: string;
    sourceUrl: string;
    kind: StudioTravelEvidence['kind'];
  }[];
  notes: string[];
}
