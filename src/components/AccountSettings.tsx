import { useEffect, useState, type FormEvent } from 'react';
import { Check, Download, ShieldCheck, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  Flex,
  Grid,
  Heading,
  Select,
  Separator,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes';
import { api } from '../api';
import { useApp } from '../context';
import {
  defaultTravelProfile,
  dietaryPreferenceOptions,
  accessibilityPreferenceOptions,
  type AccountDetails,
  type TravelProfile,
} from '../../shared/account';
import type { User } from '../../shared/types';

const interests = [
  'Culture',
  'Food',
  'Nature',
  'Adventure',
  'Beaches',
  'Art',
  'Relaxation',
  'Romance',
  'Family',
];

const fieldsetReset = { border: 0, padding: 0, margin: 0, minWidth: 0 } as const;

function OptionChip({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <Card asChild size="1" variant="surface">
      <label style={{ cursor: 'pointer' }}>
        <Flex align="center" gap="2">
          <Checkbox
            size="2"
            checked={checked}
            onCheckedChange={(state) => onCheckedChange(state === true)}
          />
          <Text size="2">{label}</Text>
        </Flex>
      </label>
    </Card>
  );
}

/**
 * The Travel preferences section of the settings page. It was a dialog; it is now page content, so
 * saving keeps the form on screen (with a confirmation toast) instead of closing it.
 */
export function PreferencesSettings() {
  const { profile, refreshProfile, user, toast } = useApp();
  const [value, setValue] = useState<TravelProfile>(profile || defaultTravelProfile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (profile) setValue(profile);
  }, [profile]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { updatedAt: _updatedAt, ...preferences } = value;
      await api('/profile', { method: 'PATCH', body: JSON.stringify(preferences) });
      await refreshProfile();
      toast('Your preferences are saved for new trips.');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Text as="p" size="2" color="gray" mb="4">
        Tara uses these as a starting point for new trips. You can ask for something different at
        any time.{' '}
        {user
          ? 'Your preferences follow your account across devices.'
          : 'Your preferences are saved with this browser session and move with you when you sign in.'}
      </Text>
      <form onSubmit={submit}>
        <fieldset disabled={busy} style={fieldsetReset}>
          <Flex direction="column" gap="4">
            <label>
              <Text as="div" size="2" weight="medium" mb="1">
                Your pace
              </Text>
              <Select.Root
                size="3"
                value={value.pace}
                onValueChange={(pace) =>
                  setValue({ ...value, pace: pace as TravelProfile['pace'] })
                }
              >
                <Select.Trigger style={{ width: '100%' }} />
                <Select.Content>
                  <Select.Item value="relaxed">Slow and unhurried</Select.Item>
                  <Select.Item value="balanced">A little of everything</Select.Item>
                  <Select.Item value="active">See as much as possible</Select.Item>
                </Select.Content>
              </Select.Root>
            </label>
            <fieldset style={fieldsetReset}>
              <Text asChild size="2" weight="bold">
                <legend>What draws you in?</legend>
              </Text>
              <Flex gap="2" wrap="wrap" mt="3">
                {interests.map((interest) => (
                  <OptionChip
                    key={interest}
                    label={interest}
                    checked={value.interests.includes(interest)}
                    onCheckedChange={(checked) =>
                      setValue({
                        ...value,
                        interests: checked
                          ? [...value.interests, interest]
                          : value.interests.filter((item) => item !== interest),
                      })
                    }
                  />
                ))}
              </Flex>
            </fieldset>
            <Card size="2">
              <details>
                <Text asChild size="2" weight="bold">
                  <summary style={{ cursor: 'pointer' }}>
                    Dietary preferences
                    {value.dietaryPreferences.length ? ` (${value.dietaryPreferences.length})` : ''}
                  </summary>
                </Text>
                <Box mt="4">
                  <fieldset style={fieldsetReset}>
                    <Text asChild size="2" weight="bold">
                      <legend>What should Tara keep in mind for meals?</legend>
                    </Text>
                    <Flex gap="2" wrap="wrap" mt="3">
                      {dietaryPreferenceOptions.map((preference) => (
                        <OptionChip
                          key={preference}
                          label={preference}
                          checked={value.dietaryPreferences.includes(preference)}
                          onCheckedChange={(checked) =>
                            setValue({
                              ...value,
                              dietaryPreferences: checked
                                ? [...value.dietaryPreferences, preference]
                                : value.dietaryPreferences.filter((item) => item !== preference),
                            })
                          }
                        />
                      ))}
                    </Flex>
                  </fieldset>
                  <Text as="p" size="1" color="gray" mt="3">
                    These are planning requirements. Menus, ingredients and allergy precautions need
                    direct confirmation with the venue.
                  </Text>
                </Box>
              </details>
            </Card>
            <Card size="2">
              <details>
                <Text asChild size="2" weight="bold">
                  <summary style={{ cursor: 'pointer' }}>
                    Accessibility preferences
                    {value.accessibilityPreferences.length
                      ? ` (${value.accessibilityPreferences.length})`
                      : ''}
                  </summary>
                </Text>
                <Box mt="4">
                  <fieldset style={fieldsetReset}>
                    <Text asChild size="2" weight="bold">
                      <legend>What access features would help?</legend>
                    </Text>
                    <Flex gap="2" wrap="wrap" mt="3">
                      {accessibilityPreferenceOptions.map((preference) => (
                        <OptionChip
                          key={preference}
                          label={preference}
                          checked={value.accessibilityPreferences.includes(preference)}
                          onCheckedChange={(checked) =>
                            setValue({
                              ...value,
                              accessibilityPreferences: checked
                                ? [...value.accessibilityPreferences, preference]
                                : value.accessibilityPreferences.filter(
                                    (item) => item !== preference,
                                  ),
                            })
                          }
                        />
                      ))}
                    </Flex>
                  </fieldset>
                  <Text as="p" size="1" color="gray" mt="3">
                    Tara records what you need. Access at places, rooms and transport services must
                    be confirmed directly before travel.
                  </Text>
                </Box>
              </details>
            </Card>
            <Card size="2">
              <details>
                <Text asChild size="2" weight="bold">
                  <summary style={{ cursor: 'pointer' }}>
                    More about your travel style{value.planningNotes ? ' (saved)' : ''}
                  </summary>
                </Text>
                <Box mt="4">
                  <label>
                    <Text as="div" size="2" weight="medium" mb="1">
                      Anything to seek out or avoid?
                    </Text>
                    <TextArea
                      size="3"
                      rows={3}
                      maxLength={500}
                      value={value.planningNotes}
                      placeholder="Quiet stays, local craft markets, fewer stairs, places you want to avoid…"
                      onChange={(event) =>
                        setValue({ ...value, planningNotes: event.target.value })
                      }
                    />
                  </label>
                  <Text as="p" size="1" color="gray" mt="3">
                    {value.planningNotes.length}/500 characters. These notes start each new trip;
                    edit that trip’s settings to change them for one journey.
                  </Text>
                </Box>
              </details>
            </Card>
            <Grid columns={{ initial: '1', sm: '2' }} gap="4">
              <label>
                <Text as="div" size="2" weight="medium" mb="1">
                  Home airport (optional)
                </Text>
                <TextField.Root
                  size="3"
                  placeholder="e.g. KHI"
                  maxLength={3}
                  pattern="[A-Za-z]{3}|"
                  value={value.originAirport}
                  onChange={(event) =>
                    setValue({ ...value, originAirport: event.target.value.toUpperCase() })
                  }
                />
              </label>
              <label>
                <Text as="div" size="2" weight="medium" mb="1">
                  Nationality (optional)
                </Text>
                <TextField.Root
                  size="3"
                  placeholder="Country code, e.g. PK"
                  maxLength={2}
                  pattern="[A-Za-z]{2}|"
                  value={value.guestNationality}
                  onChange={(event) =>
                    setValue({ ...value, guestNationality: event.target.value.toUpperCase() })
                  }
                />
              </label>
            </Grid>
            <Text as="p" size="1" color="gray">
              The airport and two-letter nationality code help fill your flight and hotel research
              details. Searches run when you enable them for a trip.
            </Text>
          </Flex>
        </fieldset>
        {error && (
          <Callout.Root color="red" role="alert" size="1" mt="4">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        <Flex mt="4">
          <Button size="3" loading={busy} disabled={busy}>
            {busy ? 'Saving…' : 'Save preferences'}
            <Check size={16} />
          </Button>
        </Flex>
      </form>
    </>
  );
}

/** The Account section of the settings page: name, password, sessions, export and deletion. */
export function AccountSettings({
  onDeleted,
  onSessionChange,
}: {
  onDeleted: () => Promise<void>;
  onSessionChange: () => void;
}) {
  const { user, setUser, toast } = useApp();
  const [details, setDetails] = useState<AccountDetails | null>(null);
  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [revokePassword, setRevokePassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api<{ account: AccountDetails }>('/account')
      .then((response) => {
        if (active) setDetails(response.account);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function perform(action: string, operation: () => Promise<void>) {
    if (busy) return;
    setBusy(action);
    setError('');
    try {
      await operation();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function exportData() {
    const data = await api<object>('/account/export');
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'asktara-account.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Your travel data is ready to download.');
  }
  return (
    <Flex direction="column" gap="5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void perform('name', async () => {
            const response = await api<{ user: User }>('/account', {
              method: 'PATCH',
              body: JSON.stringify({ name }),
            });
            setUser(response.user);
            toast('Your name has been updated.');
          });
        }}
      >
        <Flex direction="column" gap="3" align="start">
          <Text as="p" size="2" color="gray" style={{ overflowWrap: 'anywhere' }}>
            {user?.email}
          </Text>
          <Box width="100%">
            <label>
              <Text as="div" size="2" weight="medium" mb="1">
                Your name
              </Text>
              <TextField.Root
                size="3"
                required
                maxLength={80}
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          </Box>
          <Button size="3" variant="soft" loading={busy === 'name'} disabled={Boolean(busy)}>
            {busy === 'name' ? 'Saving…' : 'Save name'}
            <Check size={15} />
          </Button>
        </Flex>
      </form>
      <Separator size="4" />
      <section aria-labelledby="account-password-heading">
        <Heading as="h2" size="4" id="account-password-heading" mb="2">
          Change password
        </Heading>
        <Text as="p" size="2" color="gray" mb="3">
          Updating your password signs out other sessions and stops active planning requests.
        </Text>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void perform('password', async () => {
              await api('/account/password', {
                method: 'POST',
                body: JSON.stringify({ currentPassword, newPassword }),
              });
              setCurrentPassword('');
              setNewPassword('');
              setDetails((current) => (current ? { ...current, otherSessions: 0 } : current));
              onSessionChange();
              toast('Password updated. Other sessions are signed out.');
            });
          }}
        >
          <Flex direction="column" gap="3" align="start">
            <Box width="100%">
              <label>
                <Text as="div" size="2" weight="medium" mb="1">
                  Current password
                </Text>
                <TextField.Root
                  size="3"
                  type="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </label>
            </Box>
            <Box width="100%">
              <label>
                <Text as="div" size="2" weight="medium" mb="1">
                  New password
                </Text>
                <TextField.Root
                  size="3"
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </label>
            </Box>
            <Button size="3" variant="soft" loading={busy === 'password'} disabled={Boolean(busy)}>
              {busy === 'password' ? 'Updating…' : 'Update password'}
              <ShieldCheck size={15} />
            </Button>
          </Flex>
        </form>
      </section>
      <Separator size="4" />
      <section aria-labelledby="account-sessions-heading">
        <Heading as="h2" size="4" id="account-sessions-heading" mb="2">
          Your signed-in sessions
        </Heading>
        <Text as="p" size="2" color="gray" mb="3">
          {details
            ? `${details.otherSessions} other active ${details.otherSessions === 1 ? 'session' : 'sessions'}.`
            : 'Loading session details…'}{' '}
          This session stays signed in.
        </Text>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void perform('sessions', async () => {
              await api('/account/sessions/revoke', {
                method: 'POST',
                body: JSON.stringify({ currentPassword: revokePassword }),
              });
              setRevokePassword('');
              setDetails((current) => (current ? { ...current, otherSessions: 0 } : current));
              toast('Other sessions have been signed out.');
            });
          }}
        >
          <Flex direction="column" gap="3" align="start">
            <Box width="100%">
              <label>
                <Text as="div" size="2" weight="medium" mb="1">
                  Password to sign out other sessions
                </Text>
                <TextField.Root
                  size="3"
                  required
                  type="password"
                  maxLength={128}
                  autoComplete="current-password"
                  value={revokePassword}
                  onChange={(event) => setRevokePassword(event.target.value)}
                />
              </label>
            </Box>
            <Button
              size="3"
              variant="soft"
              loading={busy === 'sessions'}
              disabled={Boolean(busy) || !details?.otherSessions}
            >
              {busy === 'sessions' ? 'Signing out…' : 'Sign out other sessions'}
            </Button>
          </Flex>
        </form>
      </section>
      <Separator size="4" />
      <section aria-labelledby="account-data-heading">
        <Heading as="h2" size="4" id="account-data-heading" mb="2">
          Your travel data
        </Heading>
        <Text as="p" size="2" color="gray" mb="3">
          Download your profile, trips, conversations, itinerary history and wishlist as a JSON
          file.
        </Text>
        <Button
          size="3"
          variant="soft"
          loading={busy === 'export'}
          disabled={Boolean(busy)}
          onClick={() => void perform('export', exportData)}
        >
          <Download size={15} />
          {busy === 'export' ? 'Preparing…' : 'Download my data'}
        </Button>
      </section>
      <Separator size="4" />
      <section aria-labelledby="account-delete-heading">
        <Heading as="h2" size="4" id="account-delete-heading" mb="2">
          Delete account
        </Heading>
        <Text as="p" size="2" color="gray" mb="3">
          Permanently removes your account, preferences, trips, conversations, saved items and
          itinerary history. Shared links stop working and all sessions are signed out.
        </Text>
        <Button
          size="3"
          variant="soft"
          color="red"
          disabled={Boolean(busy)}
          onClick={() => setDeleting(true)}
        >
          Delete my account
        </Button>
        {/* Destructive and irreversible: password + typed DELETE confirmation stay required. */}
        <AlertDialog.Root
          open={deleting}
          onOpenChange={(open) => {
            if (open || busy) return;
            setDeleting(false);
            setDeletePassword('');
            setConfirmation('');
          }}
        >
          <AlertDialog.Content maxWidth="480px">
            <AlertDialog.Title>Delete your account?</AlertDialog.Title>
            <AlertDialog.Description size="2" color="gray">
              Permanently removes your account, preferences, trips, conversations, saved items and
              itinerary history. Shared links stop working and all sessions are signed out.
            </AlertDialog.Description>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void perform('delete', async () => {
                  await api('/account', {
                    method: 'DELETE',
                    body: JSON.stringify({ currentPassword: deletePassword, confirmation }),
                  });
                  setDeletePassword('');
                  await onDeleted();
                });
              }}
            >
              <Flex direction="column" gap="3" mt="4">
                <label>
                  <Text as="div" size="2" weight="medium" mb="1">
                    Password to delete account
                  </Text>
                  <TextField.Root
                    size="3"
                    type="password"
                    required
                    maxLength={128}
                    autoComplete="current-password"
                    value={deletePassword}
                    onChange={(event) => setDeletePassword(event.target.value)}
                  />
                </label>
                <label>
                  <Text as="div" size="2" weight="medium" mb="1">
                    Type DELETE to confirm
                  </Text>
                  <TextField.Root
                    size="3"
                    required
                    value={confirmation}
                    autoComplete="off"
                    pattern="DELETE"
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
                {error && (
                  <Callout.Root color="red" role="alert" size="1">
                    <Callout.Text>{error}</Callout.Text>
                  </Callout.Root>
                )}
                <Flex gap="3" wrap="wrap" justify="end" mt="2">
                  <AlertDialog.Cancel>
                    <Button
                      type="button"
                      size="3"
                      variant="soft"
                      color="gray"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        setDeleting(false);
                        setDeletePassword('');
                        setConfirmation('');
                      }}
                    >
                      Keep my account
                    </Button>
                  </AlertDialog.Cancel>
                  <Button
                    size="3"
                    color="red"
                    loading={busy === 'delete'}
                    disabled={Boolean(busy) || confirmation !== 'DELETE'}
                  >
                    {busy === 'delete' ? 'Deleting…' : 'Permanently delete account'}
                    <Trash2 size={15} />
                  </Button>
                </Flex>
              </Flex>
            </form>
          </AlertDialog.Content>
        </AlertDialog.Root>
      </section>
      {error && !deleting && (
        <Callout.Root color="red" role="alert" size="1">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
    </Flex>
  );
}
