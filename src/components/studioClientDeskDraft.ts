import type { StudioBrief } from '../../shared/studio';

const numericFields = ['adults', 'children', 'budget'] as const;
const listFields = ['interests', 'foodPreferences', 'requirements'] as const;
export type StudioClientDeskTextField =
  | 'clientName'
  | 'passportNationality'
  | 'context'
  | 'preferredDestination'
  | 'origin'
  | 'departureDate'
  | 'startDate'
  | 'endDate'
  | 'tripPurpose'
  | 'adults'
  | 'children'
  | 'childAges'
  | 'budget'
  | 'currency'
  | 'interests'
  | 'foodPreferences'
  | 'requirements'
  | 'hotelStandard'
  | 'hotelLocation'
  | 'cabin';

/** Only edited fields live here, so a server update cannot be overwritten by a stale full brief. */
export type StudioClientDeskDraft = Partial<Record<StudioClientDeskTextField, string>> & {
  datesFlexible?: boolean;
};

export function studioClientDeskValue(
  brief: StudioBrief,
  draft: StudioClientDeskDraft,
  field: StudioClientDeskTextField,
): string {
  if (draft[field] !== undefined) return draft[field];
  const value = brief[field];
  return Array.isArray(value)
    ? value.join(field === 'requirements' ? '\n' : ', ')
    : String(value ?? '');
}

export function studioClientDeskPatch(
  brief: StudioBrief,
  draft: StudioClientDeskDraft,
): Partial<StudioBrief> {
  const patch: Record<string, unknown> = {};
  for (const [field, raw] of Object.entries(draft)) {
    if (raw === undefined) continue;
    let value: unknown = raw;
    if (numericFields.includes(field as (typeof numericFields)[number]))
      value = raw === '' ? null : Number(raw);
    else if (listFields.includes(field as (typeof listFields)[number]))
      value = String(raw)
        .split(field === 'requirements' ? '\n' : /[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
    else if (field === 'childAges')
      value = String(raw)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map(Number);
    else if (field === 'currency') value = String(raw).trim().toUpperCase();
    const previous = brief[field as keyof StudioBrief];
    const unchanged =
      Array.isArray(value) && Array.isArray(previous)
        ? value.length === previous.length && value.every((item, index) => item === previous[index])
        : value === previous;
    if (!unchanged) patch[field] = value;
  }
  // An explicit "no children" answer also removes ages from a previous family trip.
  if (draft.children !== undefined && draft.children !== '' && Number(draft.children) === 0)
    if (brief.childAges.length || 'childAges' in patch) patch.childAges = [];
  return patch as Partial<StudioBrief>;
}

export function studioClientDeskError(brief: StudioBrief, patch: Partial<StudioBrief>): string {
  const value = { ...brief, ...patch };
  if ('adults' in patch && value.adults !== null)
    if (!Number.isInteger(value.adults) || value.adults < 1 || value.adults > 100)
      return 'Enter between 1 and 100 adults, or leave the count blank.';
  if ('children' in patch && value.children !== null)
    if (!Number.isInteger(value.children) || value.children < 0 || value.children > 30)
      return 'Enter between 0 and 30 children, or leave the count blank.';
  if ('childAges' in patch || 'children' in patch) {
    if (value.childAges.some((age) => !Number.isInteger(age) || age < 0 || age > 17))
      return 'Enter each child’s age as a whole number between 0 and 17.';
    if (value.children !== null && value.childAges.length > value.children)
      return 'There are more ages than children. Check the travelling party.';
  }
  if ('budget' in patch && value.budget !== null)
    if (!Number.isFinite(value.budget) || value.budget < 0 || value.budget > 10_000_000)
      return 'Enter a total budget between 0 and 10,000,000, or leave it blank.';
  if ('currency' in patch && !/^[A-Z]{3}$/.test(value.currency))
    return 'Use a three-letter budget currency, such as USD or PKR.';
  if (('startDate' in patch || 'endDate' in patch) && value.startDate && value.endDate)
    if (value.endDate < value.startDate)
      return 'The end date must follow arrival at the first destination.';
  return '';
}

/** Choosing another saved client replaces that client's background without losing trip edits. */
export function studioClientDeskAfterProfileChange(draft: StudioClientDeskDraft) {
  const {
    clientName: _name,
    passportNationality: _passport,
    context: _context,
    interests: _interests,
    foodPreferences: _food,
    ...tripDraft
  } = draft;
  return tripDraft;
}
