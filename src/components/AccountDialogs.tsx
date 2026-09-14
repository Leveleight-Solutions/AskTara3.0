import { useEffect, useState, type FormEvent } from 'react';
import { Check, Download, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../context';
import { Modal } from './ui';
import {
  defaultTravelProfile,
  dietaryPreferenceOptions,
  accessibilityPreferenceOptions,
  type AccountDetails,
  type TravelProfile,
} from '../../shared/account';
import type { User } from '../../shared/types';
import './account.css';

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

export function PreferencesDialog({ onClose }: { onClose: () => void }) {
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
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Your kind of travel" onClose={onClose}>
      <p className="modal-intro">
        Tara uses these as a starting point for new trips. You can ask for something different at
        any time.{' '}
        {user
          ? 'Your preferences follow your account across devices.'
          : 'Your preferences are saved with this browser session and move with you when you sign in.'}
      </p>
      <form className="stack-form account-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Your pace
            <select
              value={value.pace}
              onChange={(event) =>
                setValue({ ...value, pace: event.target.value as TravelProfile['pace'] })
              }
            >
              <option value="relaxed">Slow and unhurried</option>
              <option value="balanced">A little of everything</option>
              <option value="active">See as much as possible</option>
            </select>
          </label>
          <fieldset className="interest-options">
            <legend>What draws you in?</legend>
            {interests.map((interest) => (
              <label key={interest} className="interest-option">
                <input
                  type="checkbox"
                  checked={value.interests.includes(interest)}
                  onChange={(event) =>
                    setValue({
                      ...value,
                      interests: event.target.checked
                        ? [...value.interests, interest]
                        : value.interests.filter((item) => item !== interest),
                    })
                  }
                />
                {interest}
              </label>
            ))}
          </fieldset>
          <details className="profile-section">
            <summary>
              Dietary preferences
              {value.dietaryPreferences.length ? ` (${value.dietaryPreferences.length})` : ''}
            </summary>
            <fieldset className="interest-options">
              <legend>What should Tara keep in mind for meals?</legend>
              {dietaryPreferenceOptions.map((preference) => (
                <label key={preference} className="interest-option">
                  <input
                    type="checkbox"
                    checked={value.dietaryPreferences.includes(preference)}
                    onChange={(event) =>
                      setValue({
                        ...value,
                        dietaryPreferences: event.target.checked
                          ? [...value.dietaryPreferences, preference]
                          : value.dietaryPreferences.filter((item) => item !== preference),
                      })
                    }
                  />
                  {preference}
                </label>
              ))}
            </fieldset>
            <p className="muted">
              These are planning requirements. Menus, ingredients and allergy precautions need
              direct confirmation with the venue.
            </p>
          </details>
          <details className="profile-section">
            <summary>
              Accessibility preferences
              {value.accessibilityPreferences.length
                ? ` (${value.accessibilityPreferences.length})`
                : ''}
            </summary>
            <fieldset className="interest-options">
              <legend>What access features would help?</legend>
              {accessibilityPreferenceOptions.map((preference) => (
                <label key={preference} className="interest-option">
                  <input
                    type="checkbox"
                    checked={value.accessibilityPreferences.includes(preference)}
                    onChange={(event) =>
                      setValue({
                        ...value,
                        accessibilityPreferences: event.target.checked
                          ? [...value.accessibilityPreferences, preference]
                          : value.accessibilityPreferences.filter((item) => item !== preference),
                      })
                    }
                  />
                  {preference}
                </label>
              ))}
            </fieldset>
            <p className="muted">
              Tara records what you need. Access at places, rooms and transport services must be
              confirmed directly before travel.
            </p>
          </details>
          <details className="profile-section">
            <summary>More about your travel style{value.planningNotes ? ' (saved)' : ''}</summary>
            <label>
              Anything to seek out or avoid?
              <textarea
                className="form-textarea"
                rows={3}
                maxLength={500}
                value={value.planningNotes}
                placeholder="Quiet stays, local craft markets, fewer stairs, places you want to avoid…"
                onChange={(event) => setValue({ ...value, planningNotes: event.target.value })}
              />
            </label>
            <p className="muted">
              {value.planningNotes.length}/500 characters. These notes start each new trip; edit
              that trip’s settings to change them for one journey.
            </p>
          </details>
          <div className="form-row">
            <label>
              Home airport (optional)
              <input
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
              Nationality (optional)
              <input
                placeholder="Country code, e.g. PK"
                maxLength={2}
                pattern="[A-Za-z]{2}|"
                value={value.guestNationality}
                onChange={(event) =>
                  setValue({ ...value, guestNationality: event.target.value.toUpperCase() })
                }
              />
            </label>
          </div>
          <p className="muted">
            The airport and two-letter nationality code help fill your flight and hotel research
            details. Searches run when you enable them for a trip.
          </p>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save preferences'}
          <Check size={16} />
        </button>
      </form>
    </Modal>
  );
}

export function AccountDialog({
  onClose,
  onDeleted,
  onSessionChange,
  onPreferences,
}: {
  onClose: () => void;
  onDeleted: () => Promise<void>;
  onSessionChange: () => void;
  onPreferences: () => void;
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
    <Modal title="Your account" onClose={onClose}>
      <div className="account-sections">
        <form
          className="stack-form"
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
          <p className="account-email">{user?.email}</p>
          <button type="button" className="text-link" onClick={onPreferences}>
            Travel preferences
          </button>
          <label>
            Your name
            <input
              required
              maxLength={80}
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <button className="button button-secondary" disabled={Boolean(busy)}>
            {busy === 'name' ? 'Saving…' : 'Save name'}
            <Check size={15} />
          </button>
        </form>
        <section aria-labelledby="account-password-heading">
          <h3 id="account-password-heading">Change password</h3>
          <p className="muted">
            Updating your password signs out other sessions and stops active planning requests.
          </p>
          <form
            className="stack-form"
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
            <label>
              Current password
              <input
                type="password"
                required
                maxLength={128}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label>
              New password
              <input
                type="password"
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <button className="button button-secondary" disabled={Boolean(busy)}>
              {busy === 'password' ? 'Updating…' : 'Update password'}
              <ShieldCheck size={15} />
            </button>
          </form>
        </section>
        <section aria-labelledby="account-sessions-heading">
          <h3 id="account-sessions-heading">Your signed-in sessions</h3>
          <p className="muted">
            {details
              ? `${details.otherSessions} other active ${details.otherSessions === 1 ? 'session' : 'sessions'}.`
              : 'Loading session details…'}{' '}
            This session stays signed in.
          </p>
          <form
            className="stack-form"
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
            <label>
              Password to sign out other sessions
              <input
                required
                type="password"
                maxLength={128}
                autoComplete="current-password"
                value={revokePassword}
                onChange={(event) => setRevokePassword(event.target.value)}
              />
            </label>
            <button
              className="button button-secondary"
              disabled={Boolean(busy) || !details?.otherSessions}
            >
              {busy === 'sessions' ? 'Signing out…' : 'Sign out other sessions'}
            </button>
          </form>
        </section>
        <section aria-labelledby="account-data-heading">
          <h3 id="account-data-heading">Your travel data</h3>
          <p className="muted">
            Download your profile, trips, conversations, itinerary history and wishlist as a JSON
            file.
          </p>
          <button
            className="button button-secondary"
            disabled={Boolean(busy)}
            onClick={() => void perform('export', exportData)}
          >
            <Download size={15} />
            {busy === 'export' ? 'Preparing…' : 'Download my data'}
          </button>
        </section>
        <section className="account-delete" aria-labelledby="account-delete-heading">
          <h3 id="account-delete-heading">Delete account</h3>
          <p className="muted">
            Permanently removes your account, preferences, trips, conversations, saved items and
            itinerary history. Shared links stop working and all sessions are signed out.
          </p>
          {deleting ? (
            <form
              className="stack-form"
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
              <label>
                Password to delete account
                <input
                  type="password"
                  required
                  maxLength={128}
                  autoComplete="current-password"
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)}
                />
              </label>
              <label>
                Type DELETE to confirm
                <input
                  required
                  value={confirmation}
                  autoComplete="off"
                  pattern="DELETE"
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <div className="account-delete-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    setDeleting(false);
                    setDeletePassword('');
                    setConfirmation('');
                  }}
                >
                  Keep my account
                </button>
                <button
                  className="button button-danger"
                  disabled={Boolean(busy) || confirmation !== 'DELETE'}
                >
                  {busy === 'delete' ? 'Deleting…' : 'Permanently delete account'}
                  <Trash2 size={15} />
                </button>
              </div>
            </form>
          ) : (
            <button
              className="button button-secondary"
              disabled={Boolean(busy)}
              onClick={() => setDeleting(true)}
            >
              Delete my account
            </button>
          )}
        </section>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
