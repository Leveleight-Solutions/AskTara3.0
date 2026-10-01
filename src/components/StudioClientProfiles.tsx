import { useEffect, useState } from 'react';
import { Button, Callout, Flex, Text, TextArea, TextField } from '@radix-ui/themes';
import type { StudioClientProfile } from '../../shared/studio-clients';
import type { StudioWorkspace } from '../../shared/studio';
import { studioCountries } from '../../shared/studio-travel-research';
import { api } from '../api';

const empty = () => ({
  name: '',
  context: '',
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
  const update = (clients: StudioClientProfile[]) => {
    setProfiles(clients);
    onProfiles(clients);
  };
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
                  setDraft(value);
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
          <Text size="2">
            {selected.history.length
              ? `Past travel: ${selected.history.map((h) => h.destination).join(', ')}`
              : 'Add previous destinations to personalise suggestions.'}
          </Text>
        )}
        {open && (
          <form
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
                <label>
                  <Text size="2">Past trips · one destination per line</Text>
                  <TextArea
                    value={draft.history.map((h) => h.destination).join('\n')}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        history: e.target.value
                          .split('\n')
                          .map((destination, index) => ({ ...draft.history[index], destination })),
                      })
                    }
                  />
                </label>
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
