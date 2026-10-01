import { useEffect, useState } from 'react';
import { Button, Callout, Flex, Text, TextArea, TextField } from '@radix-ui/themes';
import type { StudioClientProfile } from '../../shared/studio-clients';
import type { StudioWorkspace } from '../../shared/studio';
import { normalizeStudioCountry, studioCountries } from '../../shared/studio-travel-research';
import { api } from '../api';

const empty = () => ({
  name: '',
  context: '',
  country: '',
  nationality: '',
  dateOfBirth: '',
  passportNationality: '',
  photoDataUrl: '',
  interests: [] as string[],
  foodPreferences: [] as string[],
  history: [] as StudioClientProfile['history'],
});
export function StudioClientProfiles({
  workspace,
  disabled,
  onSelect,
  onProfiles,
  onDeleted,
}: {
  workspace: StudioWorkspace;
  disabled: boolean;
  onSelect: (profile: StudioClientProfile | null) => Promise<void>;
  onDeleted: () => Promise<void>;
  onProfiles: (profiles: StudioClientProfile[]) => void;
}) {
  const [profiles, setProfiles] = useState<StudioClientProfile[]>([]);
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [combinedHistory, setCombinedHistory] = useState<StudioClientProfile['history'] | null>(
    null,
  );
  const [historyError, setHistoryError] = useState('');
  useEffect(() => {
    let active = true;
    void api<{ clients: StudioClientProfile[] }>('/studio/client-profiles')
      .then(({ clients }) => {
        if (active) {
          setProfiles(clients);
          onProfiles(clients);
        }
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [workspace.id]);
  const selected = profiles.find((profile) => profile.id === workspace.brief.clientId);
  useEffect(() => {
    let active = true;
    setCombinedHistory(null);
    setHistoryError('');
    if (!selected) return;
    void api<{ history: StudioClientProfile['history'] }>(
      `/studio/client-profiles/${selected.id}/history?workspaceId=${workspace.id}`,
    )
      .then(({ history }) => {
        if (active) setCombinedHistory(history);
      })
      .catch(() => {
        if (active)
          setHistoryError(
            'Previous itinerary history could not be loaded. Saved profile trips are shown below.',
          );
      });
    return () => {
      active = false;
    };
  }, [workspace.id, selected?.id, selected?.updatedAt]);
  const history = combinedHistory || selected?.history || [];
  const update = (clients: StudioClientProfile[]) => {
    setProfiles(clients);
    onProfiles(clients);
  };
  const updateTrip = (index: number, patch: Partial<StudioClientProfile['history'][number]>) =>
    setDraft((value) => ({
      ...value,
      history: value.history.map((trip, at) => (at === index ? { ...trip, ...patch } : trip)),
    }));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <details>
      <summary style={{ cursor: 'pointer' }}>
        Client profiles {selected ? `· ${selected.name}` : '· new or returning'}
      </summary>
      <Flex direction="column" gap="3" mt="3">
        <Text size="1" color="gray">
          Save preferences and past trips. Optional photos help you recognise clients and are never
          sent to Tara. Do not enter passport numbers or payment details.
        </Text>
        {selected?.photoDataUrl && (
          <img
            src={selected.photoDataUrl}
            alt={`${selected.name} profile`}
            style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 12 }}
          />
        )}
        <label>
          <Text as="div" size="2">
            Saved client
          </Text>
          <select
            aria-label="Saved client"
            value={selected?.id || ''}
            disabled={disabled || busy}
            style={{ width: '100%', padding: 8 }}
            onChange={(e) => {
              setError('');
              setBusy(true);
              void onSelect(profiles.find((p) => p.id === e.target.value) || null)
                .catch((c) => setError(c.message))
                .finally(() => setBusy(false));
            }}
          >
            <option value="">No linked profile</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.id.slice(0, 6)}
                {p.history[0] ? ` · ${p.history[0].destination}` : ''}
              </option>
            ))}
          </select>
        </label>
        <Flex gap="2" wrap="wrap">
          <Button
            type="button"
            size="1"
            variant="soft"
            disabled={disabled || busy}
            onClick={() => {
              setEditing(null);
              setDraft({
                ...empty(),
                name: workspace.brief.clientName,
                context: workspace.brief.context,
                passportNationality: workspace.brief.passportNationality || '',
                interests: workspace.brief.interests,
                foodPreferences: workspace.brief.foodPreferences || [],
              });
              setOpen(true);
            }}
          >
            New client profile
          </Button>
          {selected && (
            <>
              <Button
                type="button"
                size="1"
                variant="soft"
                disabled={disabled || busy}
                onClick={() => {
                  const { id, updatedAt, previousTripCount, ...value } = selected;
                  setEditing(id);
                  setDraft({ ...empty(), ...value });
                  setOpen(true);
                }}
              >
                Edit profile
              </Button>
              <Button
                size="1"
                color="red"
                variant="ghost"
                disabled={disabled || busy}
                onClick={() => {
                  setBusy(true);
                  setError('');
                  void api(`/studio/client-profiles/${selected.id}`, { method: 'DELETE' })
                    .then(async () => {
                      update(profiles.filter((p) => p.id !== selected.id));
                      await onDeleted();
                    })
                    .catch((c) => setError(c.message))
                    .finally(() => setBusy(false));
                }}
              >
                Delete profile
              </Button>
            </>
          )}
        </Flex>
        {selected && !open && (
          <>
            <Text size="2">
              {history.length
                ? `Travel history: ${history.map((h) => `${h.destination}${h.experience === 'planned' ? ' (planned)' : ''}`).join(', ')}`
                : 'Add previous destinations to personalise suggestions.'}
            </Text>
            {historyError && (
              <Text size="1" color="amber">
                {historyError}
              </Text>
            )}
            {history.length > 0 && (
              <details>
                <summary style={{ cursor: 'pointer' }}>
                  View travel history ({history.length})
                </summary>
                <Flex
                  direction="column"
                  gap="3"
                  mt="2"
                  role="region"
                  aria-label="Saved travel history"
                >
                  {history.map((trip, index) => (
                    <article key={`${trip.destination}-${trip.visitedAt || ''}-${index}`}>
                      <Text as="p" size="2" weight="medium">
                        {trip.destination}
                        {trip.country
                          ? `, ${normalizeStudioCountry(trip.country)?.name || trip.country}`
                          : ''}
                      </Text>
                      <Text as="p" size="1" color="gray">
                        {trip.experience === 'planned' ? 'Planned itinerary' : 'Visited'}
                        {trip.visitedAt ? ` · ${trip.visitedAt}` : ''}
                        {trip.feedback
                          ? ` · ${trip.feedback === 'liked' ? 'Liked' : trip.feedback === 'disliked' ? 'Disliked' : 'Neutral'}`
                          : ''}
                      </Text>
                      {!!trip.interests?.length && (
                        <Text as="p" size="1">
                          Interests: {trip.interests.join(', ')}
                        </Text>
                      )}
                      {trip.notes && (
                        <Text as="p" size="1">
                          {trip.notes}
                        </Text>
                      )}
                    </article>
                  ))}
                </Flex>
              </details>
            )}
          </>
        )}
        {open && (
          <form
            aria-label="Client profile"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError('');
              void api<{ client: StudioClientProfile }>(
                `/studio/client-profiles${editing ? `/${editing}` : ''}`,
                { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(draft) },
              )
                .then(async ({ client }) => {
                  update([client, ...profiles.filter((p) => p.id !== client.id)]);
                  await onSelect(client);
                  setOpen(false);
                })
                .catch((cause) => setError(cause.message))
                .finally(() => setBusy(false));
            }}
          >
            <fieldset disabled={disabled || busy} style={{ border: 0, padding: 0 }}>
              <Flex direction="column" gap="2">
                <label>
                  <Text size="2">Profile name</Text>
                  <TextField.Root
                    required
                    maxLength={200}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </label>
                <label>
                  <Text size="2">Country of residence</Text>
                  <select
                    aria-label="Profile country of residence"
                    value={draft.country}
                    onChange={(e) => setDraft({ ...draft, country: e.target.value })}
                    style={{ display: 'block', width: '100%', padding: 8 }}
                  >
                    <option value="">Not supplied</option>
                    {studioCountries.map((country) => (
                      <option value={country.code} key={country.code}>
                        {country.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <Text size="2">Nationality</Text>
                  <select
                    aria-label="Profile nationality"
                    value={draft.nationality}
                    onChange={(e) => setDraft({ ...draft, nationality: e.target.value })}
                    style={{ display: 'block', width: '100%', padding: 8 }}
                  >
                    <option value="">Not supplied</option>
                    {studioCountries.map((country) => (
                      <option value={country.code} key={country.code}>
                        {country.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <Text size="2">Date of birth</Text>
                  <TextField.Root
                    aria-label="Profile date of birth"
                    type="date"
                    max={today}
                    value={draft.dateOfBirth}
                    onChange={(e) => setDraft({ ...draft, dateOfBirth: e.target.value })}
                  />
                </label>
                <label>
                  <Text size="2">Passport nationality</Text>
                  <select
                    aria-label="Profile passport nationality"
                    value={draft.passportNationality}
                    onChange={(e) => setDraft({ ...draft, passportNationality: e.target.value })}
                    style={{ display: 'block', width: '100%', padding: 8 }}
                  >
                    <option value="">Not supplied</option>
                    {studioCountries.map((c) => (
                      <option value={c.code} key={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <Text size="2">Background and preferences</Text>
                  <TextArea
                    value={draft.context}
                    maxLength={4000}
                    onChange={(e) => setDraft({ ...draft, context: e.target.value })}
                  />
                </label>
                <label>
                  <Text size="2">Interests · comma separated</Text>
                  <TextField.Root
                    value={draft.interests.join(', ')}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        interests: e.target.value.split(',').map((v) => v.trim()),
                      })
                    }
                  />
                </label>
                <label>
                  <Text size="2">Food preferences · comma separated</Text>
                  <TextField.Root
                    value={draft.foodPreferences.join(', ')}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        foodPreferences: e.target.value.split(',').map((v) => v.trim()),
                      })
                    }
                  />
                </label>
                <Flex direction="column" gap="3" aria-label="Travel history">
                  <Text size="2" weight="medium">
                    Recorded past trips
                  </Text>
                  <Text size="1" color="gray">
                    Record visits, previous plans and what the client liked. Tara can use these
                    details when suggesting the next destination.
                  </Text>
                  {draft.history.map((trip, index) => (
                    <fieldset
                      key={index}
                      style={{ border: '1px solid var(--gray-6)', borderRadius: 8, padding: 12 }}
                    >
                      <legend>Past trip {index + 1}</legend>
                      <Flex direction="column" gap="2">
                        <label>
                          <Text size="2">Destination</Text>
                          <TextField.Root
                            aria-label={`Past trip ${index + 1} destination`}
                            required
                            maxLength={200}
                            value={trip.destination}
                            onChange={(e) => updateTrip(index, { destination: e.target.value })}
                          />
                        </label>
                        <label>
                          <Text size="2">Country</Text>
                          <select
                            aria-label={`Past trip ${index + 1} country`}
                            value={
                              normalizeStudioCountry(trip.country || '')?.code || trip.country || ''
                            }
                            onChange={(e) => updateTrip(index, { country: e.target.value })}
                            style={{ display: 'block', width: '100%', padding: 8 }}
                          >
                            <option value="">Not supplied</option>
                            {trip.country && !normalizeStudioCountry(trip.country) && (
                              <option value={trip.country}>{trip.country}</option>
                            )}
                            {studioCountries.map((country) => (
                              <option value={country.code} key={country.code}>
                                {country.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <Text size="2">Trip status</Text>
                          <select
                            aria-label={`Past trip ${index + 1} status`}
                            value={trip.experience || 'visited'}
                            onChange={(e) =>
                              updateTrip(index, {
                                experience: e.target.value as 'visited' | 'planned',
                              })
                            }
                            style={{ display: 'block', width: '100%', padding: 8 }}
                          >
                            <option value="visited">Visited</option>
                            <option value="planned">Planned only</option>
                          </select>
                        </label>
                        <label>
                          <Text size="2">Trip date</Text>
                          <TextField.Root
                            aria-label={`Past trip ${index + 1} date`}
                            type={
                              !trip.visitedAt || /^\d{4}-\d{2}-\d{2}$/.test(trip.visitedAt)
                                ? 'date'
                                : 'text'
                            }
                            max={today}
                            maxLength={40}
                            value={trip.visitedAt || ''}
                            onChange={(e) => updateTrip(index, { visitedAt: e.target.value })}
                          />
                        </label>
                        <label>
                          <Text size="2">Trip interests · comma separated</Text>
                          <TextField.Root
                            aria-label={`Past trip ${index + 1} interests`}
                            value={(trip.interests || []).join(', ')}
                            onChange={(e) =>
                              updateTrip(index, {
                                interests: e.target.value.split(',').map((value) => value.trim()),
                              })
                            }
                          />
                        </label>
                        <label>
                          <Text size="2">Client feedback</Text>
                          <select
                            aria-label={`Past trip ${index + 1} feedback`}
                            value={trip.feedback || ''}
                            onChange={(e) =>
                              updateTrip(index, {
                                feedback:
                                  (e.target.value as 'liked' | 'neutral' | 'disliked') || undefined,
                              })
                            }
                            style={{ display: 'block', width: '100%', padding: 8 }}
                          >
                            <option value="">Not recorded</option>
                            <option value="liked">Liked</option>
                            <option value="neutral">Neutral</option>
                            <option value="disliked">Disliked</option>
                          </select>
                        </label>
                        <label>
                          <Text size="2">Trip notes</Text>
                          <TextArea
                            aria-label={`Past trip ${index + 1} notes`}
                            maxLength={1000}
                            value={trip.notes || ''}
                            onChange={(e) => updateTrip(index, { notes: e.target.value })}
                          />
                        </label>
                        <Button
                          type="button"
                          variant="soft"
                          color="red"
                          size="1"
                          aria-label={`Remove past trip ${index + 1}`}
                          onClick={() =>
                            setDraft((value) => ({
                              ...value,
                              history: value.history.filter((_trip, at) => at !== index),
                            }))
                          }
                        >
                          Remove trip
                        </Button>
                      </Flex>
                    </fieldset>
                  ))}
                  <Button
                    type="button"
                    variant="soft"
                    size="1"
                    disabled={draft.history.length >= 100}
                    onClick={() =>
                      setDraft((value) => ({
                        ...value,
                        history: [...value.history, { destination: '', experience: 'visited' }],
                      }))
                    }
                  >
                    Add past trip
                  </Button>
                </Flex>
                <label>
                  <Text as="div" size="2">
                    Optional client photo · max 140 KB
                  </Text>
                  <input
                    aria-label="Client photo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 140000) {
                        setError('Choose a photo smaller than 140 KB.');
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () =>
                        setDraft((d) => ({ ...d, photoDataUrl: String(reader.result) }));
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
                {draft.photoDataUrl && (
                  <Flex gap="2" align="center">
                    <img
                      src={draft.photoDataUrl}
                      alt="Client photo preview"
                      style={{ width: 64, height: 64, objectFit: 'cover' }}
                    />
                    <Button
                      type="button"
                      size="1"
                      variant="soft"
                      onClick={() => setDraft({ ...draft, photoDataUrl: '' })}
                    >
                      Remove photo
                    </Button>
                  </Flex>
                )}
                <Flex gap="2">
                  <Button type="submit" loading={busy}>
                    Save client profile
                  </Button>
                  <Button type="button" variant="soft" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                </Flex>
              </Flex>
            </fieldset>
          </form>
        )}
        {error && (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
      </Flex>
    </details>
  );
}
