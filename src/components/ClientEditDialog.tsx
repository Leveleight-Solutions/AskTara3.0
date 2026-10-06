import { useState, type FormEvent } from 'react';
import { Button, Callout, Flex, Tabs, TextArea, TextField } from '@radix-ui/themes';
import { Plus, Trash2, UserRound } from 'lucide-react';
import type { StudioClientProfile } from '../../shared/studio-clients';
import { normalizeStudioCountry, studioCountries } from '../../shared/studio-travel-research';
import { api } from '../api';
import { Modal } from './ui';
import { clientListValues, clientProfileDraft } from './studioClientAddressBook';
import './ClientAddressBook.css';
import { readStudioImage } from './readStudioImage';

export function ClientEditDialog({
  client,
  onClose,
  onSaved,
}: {
  client?: StudioClientProfile;
  onClose: () => void;
  onSaved: (client: StudioClientProfile) => void;
}) {
  const [draft, setDraft] = useState(() => clientProfileDraft(client));
  const [interests, setInterests] = useState(draft.interests.join(', '));
  const [food, setFood] = useState(draft.foodPreferences.join(', '));
  const [tab, setTab] = useState('details');
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState('');
  const blocked = busy || photoBusy;
  const today = new Date().toISOString().slice(0, 10);
  const updateTrip = (index: number, patch: Partial<StudioClientProfile['history'][number]>) =>
    setDraft((current) => ({
      ...current,
      history: current.history.map((trip, at) => (at === index ? { ...trip, ...patch } : trip)),
    }));
  const country = (label: string, value: string | undefined, update: (value: string) => void) => (
    <label className="client-book__field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={normalizeStudioCountry(value || '')?.code || value || ''}
        onChange={(event) => update(event.target.value)}
      >
        <option value="">Not supplied</option>
        {value && !normalizeStudioCountry(value) && <option value={value}>{value}</option>}
        {studioCountries.map((item) => (
          <option key={item.code} value={item.code}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );
  async function photo(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5_000_000) {
      setError('Choose a PNG, JPEG or WebP photo smaller than 5 MB.');
      return;
    }
    setPhotoBusy(true);
    setError('');
    try {
      const image = await readStudioImage(file);
      const scale = Math.min(1, 384 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Photo processing is unavailable.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const photoDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      if (photoDataUrl.length > 200000) throw new Error('Choose a smaller photo.');
      setDraft((current) => ({ ...current, photoDataUrl }));
    } catch (cause) {
      setError((cause as Error).message || 'This photo could not be opened.');
    } finally {
      setPhotoBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    if (!draft.name.trim()) {
      setTab('details');
      setError('Enter a client name.');
      return;
    }
    const birthDate = draft.dateOfBirth || '';
    if (
      birthDate &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
        !Number.isFinite(Date.parse(birthDate)) ||
        new Date(birthDate).toISOString().slice(0, 10) !== birthDate ||
        birthDate > today)
    ) {
      setTab('details');
      setError('Use a real date of birth that is not in the future.');
      return;
    }
    if (draft.history.some((trip) => !trip.destination.trim())) {
      setTab('history');
      setError('Add a destination for each recorded trip, or remove its empty row.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api<{ client: StudioClientProfile }>(
        `/studio/client-profiles${client ? `/${client.id}` : ''}`,
        {
          method: client ? 'PATCH' : 'POST',
          body: JSON.stringify({
            ...draft,
            name: draft.name.trim(),
            interests: clientListValues(interests),
            foodPreferences: clientListValues(food),
          }),
        },
      );
      onSaved(result.client);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={client ? 'Edit client' : 'New client'}
      onClose={() => {
        if (!blocked) onClose();
      }}
      wide
    >
      <div className="client-book">
        <p className="client-book__muted">
          Keep the person’s details once. Confirm travellers and dates for each new proposal.
        </p>
        <form aria-label="Client details" noValidate onSubmit={(event) => void save(event)}>
          <fieldset disabled={blocked} className="client-book__fieldset">
            <Tabs.Root value={tab} onValueChange={setTab}>
              <Tabs.List aria-label="Client record sections">
                <Tabs.Trigger value="details">Client details</Tabs.Trigger>
                <Tabs.Trigger value="preferences">Preferences</Tabs.Trigger>
                <Tabs.Trigger value="history">
                  Travel history{draft.history.length ? ` (${draft.history.length})` : ''}
                </Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content
                value="details"
                forceMount
                hidden={tab !== 'details'}
                inert={tab !== 'details'}
                className="client-book__edit-panel"
              >
                <div className="client-book__photo-editor">
                  <span className="client-book__avatar client-book__avatar--large">
                    {draft.photoDataUrl ? (
                      <img src={draft.photoDataUrl} alt="Client photo preview" />
                    ) : (
                      <UserRound size={30} aria-hidden="true" />
                    )}
                  </span>
                  <div>
                    <label className="client-book__field">
                      <span>Client photo · optional</span>
                      <input
                        aria-label="Client photo"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) => void photo(event.target.files?.[0])}
                      />
                    </label>
                    <small>Photos and birthdays stay private and are never sent to Tara.</small>
                    {draft.photoDataUrl && (
                      <Button
                        type="button"
                        size="1"
                        variant="ghost"
                        color="gray"
                        onClick={() => setDraft({ ...draft, photoDataUrl: '' })}
                      >
                        Remove photo
                      </Button>
                    )}
                  </div>
                </div>
                <div className="client-book__form-grid">
                  <label className="client-book__field client-book__full">
                    <span>Client name</span>
                    <TextField.Root
                      autoComplete="off"
                      maxLength={200}
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </label>
                  {country('Country of residence', draft.country, (value) =>
                    setDraft({ ...draft, country: value }),
                  )}
                  {country('Nationality', draft.nationality, (value) =>
                    setDraft({ ...draft, nationality: value }),
                  )}
                  {country('Passport nationality', draft.passportNationality, (value) =>
                    setDraft({ ...draft, passportNationality: value }),
                  )}
                  <label className="client-book__field">
                    <span>Date of birth · optional</span>
                    <TextField.Root
                      aria-label="Date of birth"
                      type="date"
                      max={today}
                      value={draft.dateOfBirth}
                      onChange={(event) => setDraft({ ...draft, dateOfBirth: event.target.value })}
                    />
                  </label>
                </div>
              </Tabs.Content>
              <Tabs.Content
                value="preferences"
                forceMount
                hidden={tab !== 'preferences'}
                inert={tab !== 'preferences'}
                className="client-book__edit-panel"
              >
                <div className="client-book__form-grid">
                  <label className="client-book__field client-book__full">
                    <span>Interests</span>
                    <TextField.Root
                      aria-label="Interests"
                      value={interests}
                      maxLength={6000}
                      placeholder="Gardens, architecture, food…"
                      onChange={(event) => setInterests(event.target.value)}
                    />
                    <small>Separate each interest with a comma.</small>
                  </label>
                  <label className="client-book__field client-book__full">
                    <span>Food preferences</span>
                    <TextField.Root
                      value={food}
                      maxLength={6000}
                      placeholder="Vegetarian, halal, allergies…"
                      onChange={(event) => setFood(event.target.value)}
                    />
                  </label>
                  <label className="client-book__field client-book__full">
                    <span>Background and preferences</span>
                    <TextArea
                      rows={4}
                      maxLength={4000}
                      value={draft.context}
                      onChange={(event) => setDraft({ ...draft, context: event.target.value })}
                      placeholder="What matters to this client?"
                    />
                  </label>
                </div>
              </Tabs.Content>
              <Tabs.Content
                value="history"
                forceMount
                hidden={tab !== 'history'}
                inert={tab !== 'history'}
                className="client-book__edit-panel"
              >
                <p className="client-book__muted">
                  Record destinations and feedback so future ideas reflect what they liked.
                </p>
                <div className="client-book__history-editor">
                  {draft.history.map((trip, index) => (
                    <fieldset key={index} className="client-book__trip-editor">
                      <legend>Past trip {index + 1}</legend>
                      <div className="client-book__form-grid">
                        <label className="client-book__field">
                          <span>Destination</span>
                          <TextField.Root
                            aria-label={`Past trip ${index + 1} destination`}
                            maxLength={200}
                            value={trip.destination}
                            onChange={(event) =>
                              updateTrip(index, { destination: event.target.value })
                            }
                          />
                        </label>
                        {country(`Past trip ${index + 1} country`, trip.country, (value) =>
                          updateTrip(index, { country: value }),
                        )}
                        <label className="client-book__field">
                          <span>Trip date</span>
                          <TextField.Root
                            aria-label={`Past trip ${index + 1} date`}
                            type={
                              !trip.visitedAt || /^\d{4}-\d{2}-\d{2}$/.test(trip.visitedAt)
                                ? 'date'
                                : 'text'
                            }
                            maxLength={40}
                            value={trip.visitedAt || ''}
                            onChange={(event) =>
                              updateTrip(index, { visitedAt: event.target.value })
                            }
                          />
                        </label>
                        <label className="client-book__field">
                          <span>Trip status</span>
                          <select
                            aria-label={`Past trip ${index + 1} status`}
                            value={trip.experience || 'visited'}
                            onChange={(event) =>
                              updateTrip(index, {
                                experience: event.target.value as 'visited' | 'planned',
                              })
                            }
                          >
                            <option value="visited">Visited</option>
                            <option value="planned">Planned only</option>
                          </select>
                        </label>
                        <label className="client-book__field">
                          <span>Client feedback</span>
                          <select
                            aria-label={`Past trip ${index + 1} feedback`}
                            value={trip.feedback || ''}
                            onChange={(event) =>
                              updateTrip(index, {
                                feedback:
                                  (event.target.value as 'liked' | 'disliked' | 'neutral') ||
                                  undefined,
                              })
                            }
                          >
                            <option value="">Not recorded</option>
                            <option value="liked">Liked</option>
                            <option value="neutral">Neutral</option>
                            <option value="disliked">Disliked</option>
                          </select>
                        </label>
                        <label className="client-book__field">
                          <span>Trip interests</span>
                          <TextField.Root
                            aria-label={`Past trip ${index + 1} interests`}
                            value={trip.interests?.join(', ') || ''}
                            onChange={(event) =>
                              updateTrip(index, { interests: event.target.value.split(',') })
                            }
                          />
                        </label>
                        <label className="client-book__field client-book__full">
                          <span>Trip notes</span>
                          <TextArea
                            aria-label={`Past trip ${index + 1} notes`}
                            rows={2}
                            maxLength={1000}
                            value={trip.notes || ''}
                            onChange={(event) => updateTrip(index, { notes: event.target.value })}
                          />
                        </label>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="1"
                        color="red"
                        aria-label={`Remove past trip ${index + 1}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            history: draft.history.filter((_, at) => at !== index),
                          })
                        }
                      >
                        <Trash2 size={12} /> Remove trip
                      </Button>
                    </fieldset>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="soft"
                  disabled={draft.history.length >= 100}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      history: [...draft.history, { destination: '', experience: 'visited' }],
                    })
                  }
                >
                  <Plus size={14} /> Add past trip
                </Button>
              </Tabs.Content>
            </Tabs.Root>
          </fieldset>
          {error && (
            <Callout.Root color="red" role="alert" size="1" mt="3">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          <Flex justify="between" align="center" gap="3" mt="5">
            <Button type="button" variant="soft" color="gray" disabled={blocked} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={blocked} disabled={blocked}>
              Save client
            </Button>
          </Flex>
        </form>
      </div>
    </Modal>
  );
}
