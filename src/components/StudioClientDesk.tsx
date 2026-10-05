import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Callout, Tabs, TextArea, TextField } from '@radix-ui/themes';
import {
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Heart,
  UserRound,
  Users,
} from 'lucide-react';
import type { StudioBrief, StudioWorkspace } from '../../shared/studio';
import type { StudioClientProfile } from '../../shared/studio-clients';
import { normalizeStudioCountry, studioCountries } from '../../shared/studio-travel-research';
import {
  studioClientDeskAfterProfileChange,
  studioClientDeskError,
  studioClientDeskPatch,
  studioClientDeskValue,
  type StudioClientDeskDraft,
  type StudioClientDeskTextField,
} from './studioClientDeskDraft';
import './StudioClientDesk.css';

export interface StudioClientDeskProps {
  workspace: StudioWorkspace;
  disabled: boolean;
  onSave: (patch: Partial<StudioBrief>) => Promise<boolean | undefined | void>;
  selectedProfile?: StudioClientProfile;
  /** Existing saved-profile editor and history; kept outside the trip form. */
  profileContent?: ReactNode;
  initiallyOpen?: boolean;
}

const tabs = [
  { value: 'client', label: 'Client', icon: UserRound },
  { value: 'party', label: 'Travellers', icon: Users },
  { value: 'trip', label: 'Trip', icon: CalendarDays },
  { value: 'preferences', label: 'Preferences', icon: Heart },
];
const countryName = (value?: string) =>
  normalizeStudioCountry(value || '')?.name || value || 'Not supplied';

function deskSummary(brief: StudioBrief) {
  const party = [
    brief.adults !== null ? `${brief.adults} adult${brief.adults === 1 ? '' : 's'}` : '',
    brief.children !== null && brief.children > 0
      ? `${brief.children} child${brief.children === 1 ? '' : 'ren'}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const date = brief.startDate
    ? new Date(`${brief.startDate}T12:00:00Z`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : brief.datesFlexible
      ? 'Flexible dates'
      : '';
  return [party, date, brief.origin ? `From ${brief.origin}` : ''].filter(Boolean).join(' · ');
}

/** Compact intake that writes a sparse patch and leaves reusable private profile data in its own flow. */
export function StudioClientDesk({
  workspace,
  disabled,
  onSave,
  selectedProfile,
  profileContent,
  initiallyOpen,
}: StudioClientDeskProps) {
  const formId = useId();
  const [open, setOpen] = useState(
    initiallyOpen ?? (!workspace.brief.clientName && !workspace.brief.clientId),
  );
  const [tab, setTab] = useState('client');
  const [draft, setDraft] = useState<StudioClientDeskDraft>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const heading = useRef<HTMLButtonElement | null>(null);
  const identity = useRef({ workspaceId: workspace.id, clientId: workspace.brief.clientId });
  useEffect(() => {
    if (identity.current.workspaceId !== workspace.id) {
      setDraft({});
      setError('');
      setSaved(false);
      setTab('client');
      setOpen(initiallyOpen ?? (!workspace.brief.clientName && !workspace.brief.clientId));
    } else if (identity.current.clientId !== workspace.brief.clientId) {
      setDraft(studioClientDeskAfterProfileChange);
      setSaved(false);
      setError('');
    }
    identity.current = { workspaceId: workspace.id, clientId: workspace.brief.clientId };
  }, [workspace.id, workspace.brief.clientId]);
  const locked = disabled || saving;
  const value = (field: StudioClientDeskTextField) =>
    studioClientDeskValue(workspace.brief, draft, field);
  const update = (field: StudioClientDeskTextField, next: string) => {
    setDraft((current) => ({ ...current, [field]: next }));
    setError('');
    setSaved(false);
  };
  const patch = studioClientDeskPatch(workspace.brief, draft);
  const dirty = Object.keys(patch).length > 0;
  const summary = deskSummary(workspace.brief);
  const children = value('children') === '' ? null : Number(value('children'));
  const field = (
    name: StudioClientDeskTextField,
    label: string,
    options: {
      type?: 'text' | 'number' | 'date';
      placeholder?: string;
      min?: number;
      max?: number;
      maxLength?: number;
      full?: boolean;
      hint?: string;
    } = {},
  ) => (
    <label
      className={`studio-client-desk__field${options.full ? ' studio-client-desk__field--full' : ''}`}
    >
      <span>{label}</span>
      <TextField.Root
        form={formId}
        size="2"
        type={options.type || 'text'}
        placeholder={options.placeholder}
        min={options.min}
        max={options.max}
        step={options.type === 'number' ? (name === 'budget' ? 'any' : 1) : undefined}
        maxLength={options.maxLength ?? 300}
        value={value(name)}
        onChange={(event) =>
          update(name, name === 'currency' ? event.target.value.toUpperCase() : event.target.value)
        }
      />
      {options.hint && <small>{options.hint}</small>}
    </label>
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked || !dirty) return;
    const validation = studioClientDeskError(workspace.brief, patch);
    if (validation) {
      setError(validation);
      setOpen(true);
      return;
    }
    const submittedWorkspace = workspace.id;
    setError('');
    setSaving(true);
    try {
      const result = await onSave(patch);
      if (identity.current.workspaceId !== submittedWorkspace) return;
      if (result === false) {
        setError('These details were not saved. Please try again.');
        setOpen(true);
        return;
      }
      setDraft({});
      setSaved(true);
      setOpen(false);
      heading.current?.focus();
    } catch (cause) {
      if (identity.current.workspaceId === submittedWorkspace) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'These details could not be saved. Please try again.',
        );
        setOpen(true);
      }
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="studio-client-desk" aria-label="Client desk">
      <button
        ref={heading}
        type="button"
        className="studio-client-desk__heading"
        aria-expanded={open}
        aria-controls={`${formId}-content`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="studio-client-desk__avatar" aria-hidden="true">
          {selectedProfile?.photoDataUrl ? (
            <img src={selectedProfile.photoDataUrl} alt="" />
          ) : (
            <UserRound size={18} />
          )}
        </span>
        <span className="studio-client-desk__heading-text">
          <span className="studio-client-desk__eyebrow">Customer desk</span>
          <strong>{workspace.brief.clientName || 'Who are we planning for?'}</strong>
          {summary && !open && <span className="studio-client-desk__summary">{summary}</span>}
        </span>
        <ChevronDown
          size={16}
          className={open ? 'studio-client-desk__chevron--open' : undefined}
          aria-hidden="true"
        />
      </button>
      <div
        id={`${formId}-content`}
        className="studio-client-desk__content"
        hidden={!open}
        inert={!open}
      >
        <fieldset disabled={locked} className="studio-client-desk__fieldset">
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List className="studio-client-desk__tabs" aria-label="Customer details">
              {tabs.map(({ value: tabValue, label, icon: Icon }) => (
                <Tabs.Trigger key={tabValue} value={tabValue}>
                  <Icon size={13} aria-hidden="true" /> {label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Tabs.Content
              value="client"
              className="studio-client-desk__panel"
              forceMount
              hidden={tab !== 'client'}
              inert={tab !== 'client'}
            >
              <div className="studio-client-desk__grid studio-client-desk__grid--client">
                {field('clientName', 'Client name', {
                  placeholder: 'Name or family name',
                  maxLength: 200,
                })}
                <label className="studio-client-desk__field">
                  <span>Passport nationality for this trip</span>
                  <select
                    form={formId}
                    aria-label="Passport nationality for this trip"
                    value={
                      normalizeStudioCountry(value('passportNationality'))?.code ||
                      value('passportNationality')
                    }
                    onChange={(event) => update('passportNationality', event.target.value)}
                  >
                    <option value="">Not supplied</option>
                    {studioCountries.map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {selectedProfile && (
                <dl className="studio-client-desk__identity">
                  <div>
                    <dt>Lives in</dt>
                    <dd>{countryName(selectedProfile.country)}</dd>
                  </div>
                  <div>
                    <dt>Citizenship</dt>
                    <dd>{countryName(selectedProfile.nationality)}</dd>
                  </div>
                </dl>
              )}
              <div className="studio-client-desk__client-extras">
                {profileContent && (
                  <div className="studio-client-desk__profiles">{profileContent}</div>
                )}
                <details className="studio-client-desk__more">
                  <summary>Background for this trip</summary>
                  <label className="studio-client-desk__field">
                    <span>Client context</span>
                    <TextArea
                      form={formId}
                      rows={3}
                      value={value('context')}
                      maxLength={8000}
                      placeholder="Helpful background or anything to keep in mind"
                      onChange={(event) => update('context', event.target.value)}
                    />
                  </label>
                </details>
              </div>
            </Tabs.Content>
            <Tabs.Content value="party" className="studio-client-desk__panel">
              <p className="studio-client-desk__hint">
                Confirm the travelling party for this trip.
              </p>
              <div className="studio-client-desk__grid">
                {field('adults', 'Adults', {
                  type: 'number',
                  min: 1,
                  max: 100,
                  placeholder: 'Not supplied',
                })}
                {field('children', 'Children', {
                  type: 'number',
                  min: 0,
                  max: 30,
                  placeholder: 'Not supplied',
                })}
                {children !== null &&
                  children > 0 &&
                  field('childAges', 'Children’s ages', {
                    placeholder: 'For example, 5, 12',
                    full: true,
                    hint: 'One age per child, separated by commas. Leave unknown ages blank.',
                  })}
              </div>
            </Tabs.Content>
            <Tabs.Content value="trip" className="studio-client-desk__panel">
              <div className="studio-client-desk__grid">
                {field('preferredDestination', 'Destination in mind', {
                  placeholder: 'A place, region or open to ideas',
                  full: true,
                })}
                {field('origin', 'Departing from', {
                  placeholder: 'City or airport',
                  full: true,
                })}
                {field('startDate', 'Arrival at first destination', { type: 'date' })}
                {field('endDate', 'End date', { type: 'date' })}
                <label className="studio-client-desk__check studio-client-desk__field--full">
                  <input
                    form={formId}
                    type="checkbox"
                    checked={draft.datesFlexible ?? workspace.brief.datesFlexible}
                    onChange={(event) => {
                      setDraft((current) => ({
                        ...current,
                        datesFlexible: event.target.checked,
                      }));
                      setError('');
                      setSaved(false);
                    }}
                  />
                  Dates are flexible
                </label>
                {field('budget', 'Total group budget', {
                  type: 'number',
                  min: 0,
                  max: 10_000_000,
                  placeholder: 'Not supplied',
                })}
                {field('currency', 'Budget currency', { maxLength: 3, placeholder: 'USD' })}
                <label className="studio-client-desk__field studio-client-desk__field--full">
                  <span>Travel purpose</span>
                  <select
                    form={formId}
                    value={value('tripPurpose') || 'undecided'}
                    onChange={(event) => update('tripPurpose', event.target.value)}
                  >
                    <option value="undecided">Not specified</option>
                    <option value="tourism">Tourism / holiday</option>
                    <option value="business">Business visit</option>
                    <option value="study">Study</option>
                    <option value="employment">Employment / paid work</option>
                    <option value="other">Other / mixed purposes</option>
                  </select>
                </label>
              </div>
              <details className="studio-client-desk__more">
                <summary>Separate departure date</summary>
                {field('departureDate', 'Departure from origin', {
                  type: 'date',
                  hint: 'Useful when the journey arrives the next day.',
                })}
              </details>
            </Tabs.Content>
            <Tabs.Content value="preferences" className="studio-client-desk__panel">
              <div className="studio-client-desk__grid">
                {field('interests', 'Interests', {
                  full: true,
                  maxLength: 4000,
                  placeholder: 'Architecture, beaches, food…',
                  hint: 'Separate each interest with a comma.',
                })}
                {field('foodPreferences', 'Food preferences', {
                  full: true,
                  maxLength: 4000,
                  placeholder: 'Vegetarian, halal, allergies…',
                })}
                <label className="studio-client-desk__field studio-client-desk__field--full">
                  <span>Requirements</span>
                  <TextArea
                    form={formId}
                    rows={2}
                    maxLength={8000}
                    value={value('requirements')}
                    placeholder="Accessibility, pace, special requests…"
                    onChange={(event) => update('requirements', event.target.value)}
                  />
                </label>
              </div>
              <details className="studio-client-desk__more">
                <summary>Stay and flight preferences</summary>
                <div className="studio-client-desk__grid">
                  {field('hotelStandard', 'Hotel standard', {
                    placeholder: 'Boutique, 4 star, value…',
                    full: true,
                  })}
                  {field('hotelLocation', 'Hotel location', {
                    placeholder: 'Central, by the station…',
                    full: true,
                  })}
                  {field('cabin', 'Flight cabin', {
                    placeholder: 'Not discussed',
                    maxLength: 100,
                    full: true,
                  })}
                </div>
              </details>
            </Tabs.Content>
          </Tabs.Root>
        </fieldset>
        {error && (
          <Callout.Root size="1" color="red" role="alert" className="studio-client-desk__error">
            <Callout.Icon>
              <CircleAlert size={15} />
            </Callout.Icon>
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        <form
          id={formId}
          onSubmit={(event) => void submit(event)}
          className="studio-client-desk__footer"
          aria-label="Save customer details"
        >
          <span className="studio-client-desk__save-status" role="status">
            {dirty ? (
              'Unsaved details'
            ) : saved ? (
              <>
                <Check size={13} aria-hidden="true" /> Saved
              </>
            ) : (
              'Add what you know'
            )}
          </span>
          <Button type="submit" size="2" disabled={locked || !dirty} loading={saving}>
            Save details
          </Button>
        </form>
      </div>
    </section>
  );
}
