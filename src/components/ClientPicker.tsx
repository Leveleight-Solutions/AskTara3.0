import { useState } from 'react';
import { Button, Callout, Flex, TextField } from '@radix-ui/themes';
import { Check, Plus, Search, UserRound } from 'lucide-react';
import type { StudioClientProfile } from '../../shared/studio-clients';
import type { StudioWorkspace } from '../../shared/studio';
import { api } from '../api';
import { Modal } from './ui';
import { ClientEditDialog } from './ClientEditDialog';
import { clientCountryLabel, filterStudioClients } from './studioClientAddressBook';
import { useStudioClients } from './useStudioClients';
import './ClientAddressBook.css';

export function ClientPicker({
  clients,
  selectedId,
  onSelect,
  disabled = false,
}: {
  clients: StudioClientProfile[];
  selectedId?: string;
  onSelect: (client: StudioClientProfile) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const matches = filterStudioClients(clients, query);
  return (
    <div className="client-book__picker">
      <TextField.Root
        aria-label="Search clients"
        placeholder="Search name, country or interests…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      >
        <TextField.Slot>
          <Search size={15} />
        </TextField.Slot>
      </TextField.Root>
      <div className="client-book__picker-list" role="group" aria-label="Choose a client">
        {matches.map((client) => (
          <button
            key={client.id}
            type="button"
            disabled={disabled}
            aria-pressed={selectedId === client.id}
            onClick={() => onSelect(client)}
            className="client-book__picker-row"
          >
            <span className="client-book__avatar">
              {client.photoDataUrl ? (
                <img src={client.photoDataUrl} alt="" />
              ) : (
                <UserRound size={20} />
              )}
            </span>
            <span className="client-book__picker-copy">
              <strong>{client.name}</strong>
              <small>
                {[
                  clientCountryLabel(client.country),
                  client.history.length
                    ? `${client.history.length} recorded ${client.history.length === 1 ? 'trip' : 'trips'}`
                    : '',
                  ...client.interests.slice(0, 2),
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Saved client'}
              </small>
            </span>
            {selectedId === client.id && <Check size={17} aria-hidden="true" />}
          </button>
        ))}
        {!matches.length && (
          <p className="client-book__muted">
            {clients.length
              ? 'No clients match this search.'
              : 'Your first client starts here. Add their name and fill in the rest whenever you like.'}
          </p>
        )}
      </div>
    </div>
  );
}

export function ClientPickerDialog({
  onClose,
  onSelect,
  initialClient,
  title = 'Who is this proposal for?',
  confirmLabel = 'Continue with client',
}: {
  onClose: () => void;
  onSelect: (client: StudioClientProfile) => void | Promise<void>;
  initialClient?: StudioClientProfile;
  title?: string;
  confirmLabel?: string;
}) {
  const book = useStudioClients();
  const [selectedId, setSelectedId] = useState(initialClient?.id || '');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = book.clients.find((client) => client.id === selectedId);
  if (adding)
    return (
      <ClientEditDialog
        onClose={() => setAdding(false)}
        onSaved={(client) => {
          book.upsert(client);
          setSelectedId(client.id);
          setAdding(false);
        }}
      />
    );
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="client-book">
        <p className="client-book__muted">
          Choose a saved client or add someone new. Their preferences and past trips help shape the
          next journey.
        </p>
        {book.loading ? (
          <p role="status">Loading clients…</p>
        ) : (
          <ClientPicker
            clients={book.clients}
            selectedId={selectedId}
            disabled={busy}
            onSelect={(client) => setSelectedId(client.id)}
          />
        )}
        {(error || book.error) && (
          <Callout.Root color="red" role="alert" size="1" mt="3">
            <Callout.Text>{error || book.error}</Callout.Text>
          </Callout.Root>
        )}
        {book.error && (
          <Button variant="soft" onClick={book.reload}>
            Reload clients
          </Button>
        )}
        <Flex justify="between" align="center" gap="3" mt="4" wrap="wrap">
          <Button variant="soft" color="gray" disabled={busy} onClick={() => setAdding(true)}>
            <Plus size={14} /> New client
          </Button>
          <Button
            loading={busy}
            disabled={busy || !selected}
            onClick={() => {
              if (!selected) return;
              setBusy(true);
              setError('');
              void Promise.resolve()
                .then(() => onSelect(selected))
                .catch((cause) => setError((cause as Error).message))
                .finally(() => setBusy(false));
            }}
          >
            {confirmLabel}
          </Button>
        </Flex>
      </div>
    </Modal>
  );
}

export function CreateProposalDialog({
  onClose,
  onCreated,
  initialClient,
}: {
  onClose: () => void;
  onCreated: (workspace: StudioWorkspace) => void;
  initialClient?: StudioClientProfile;
}) {
  return (
    <ClientPickerDialog
      onClose={onClose}
      initialClient={initialClient}
      confirmLabel="Start proposal"
      onSelect={async (client) => {
        const { workspace } = await api<{ workspace: StudioWorkspace }>('/studio/workspaces', {
          method: 'POST',
          body: JSON.stringify({ clientId: client.id, title: `${client.name} — new proposal` }),
        });
        onClose();
        onCreated(workspace);
      }}
    />
  );
}
