import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertDialog, Badge, Button, Callout, Flex, TextField } from '@radix-ui/themes';
import { ArrowUpRight, Pencil, Plus, Search, Trash2, UserRound, Users } from 'lucide-react';
import type { StudioClientProfile } from '../../shared/studio-clients';
import type { StudioWorkspace } from '../../shared/studio';
import { api } from '../api';
import { ClientEditDialog } from '../components/ClientEditDialog';
import { clientCountryLabel, filterStudioClients } from '../components/studioClientAddressBook';
import { useStudioClients } from '../components/useStudioClients';
import '../components/ClientAddressBook.css';
import './Clients.css';

export default function Clients() {
  const book = useStudioClients();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState<StudioClientProfile | 'new' | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState<StudioClientProfile['history'] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [workspaces, setWorkspaces] = useState<StudioWorkspace[]>([]);
  const matches = filterStudioClients(book.clients, query);
  const selected = book.clients.find((client) => client.id === selectedId) || matches[0];
  useEffect(() => {
    const controller = new AbortController();
    void api<{ workspaces: StudioWorkspace[] }>('/studio/workspaces', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setWorkspaces(result.workspaces);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    setHistory(null);
    setHistoryError('');
    if (!selected) return;
    const controller = new AbortController();
    void api<{ history: StudioClientProfile['history'] }>(
      `/studio/client-profiles/${selected.id}/history`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setHistory(result.history);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setHistoryError(
            'Saved client trips are shown. Previous proposal history could not be loaded.',
          );
      });
    return () => controller.abort();
  }, [selected?.id, selected?.updatedAt]);
  async function startProposal(client: StudioClientProfile) {
    setBusy('create');
    setError('');
    try {
      const { workspace } = await api<{ workspace: StudioWorkspace }>('/studio/workspaces', {
        method: 'POST',
        body: JSON.stringify({ clientId: client.id, title: `${client.name} — new proposal` }),
      });
      navigate(`/studio/${workspace.id}`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function remove(client: StudioClientProfile) {
    setBusy('delete');
    setError('');
    try {
      await api(`/studio/client-profiles/${client.id}`, { method: 'DELETE' });
      book.setClients((current) => current.filter((item) => item.id !== client.id));
      setSelectedId('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy('');
    }
  }
  const trips = history || selected?.history || [];
  return (
    <div className="clients-page client-book">
      <header className="clients-page__header">
        <div>
          <p className="clients-page__eyebrow">YOUR PEOPLE, REMEMBERED</p>
          <h1>Existing clients</h1>
          <p className="client-book__muted">
            A place for their details, preferences and the journeys you’ve planned together.
          </p>
        </div>
        <Button size="3" onClick={() => setEditing('new')} disabled={!!busy}>
          <Plus size={16} /> New client
        </Button>
      </header>
      {(book.error || error) && (
        <Callout.Root role="alert" color="red" mb="4">
          <Callout.Text>{error || book.error}</Callout.Text>
          {book.error && (
            <Button variant="soft" color="red" onClick={book.reload}>
              Reload clients
            </Button>
          )}
        </Callout.Root>
      )}
      <div className="clients-page__workspace">
        <aside className="clients-page__list" aria-label="Client address book">
          <TextField.Root
            aria-label="Search clients"
            placeholder="Search your clients…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          >
            <TextField.Slot>
              <Search size={16} />
            </TextField.Slot>
          </TextField.Root>
          <p className="client-book__muted">
            {book.loading
              ? 'Loading clients…'
              : `${matches.length} ${matches.length === 1 ? 'client' : 'clients'}`}
          </p>
          <div className="clients-page__rows">
            {matches.map((client) => (
              <button
                type="button"
                key={client.id}
                className="clients-page__row"
                aria-pressed={selected?.id === client.id}
                onClick={() => setSelectedId(client.id)}
              >
                <span className="client-book__avatar">
                  {client.photoDataUrl ? (
                    <img src={client.photoDataUrl} alt="" />
                  ) : (
                    <UserRound size={22} aria-hidden="true" />
                  )}
                </span>
                <span>
                  <strong>{client.name}</strong>
                  <small>{clientCountryLabel(client.country) || 'Residence not supplied'}</small>
                  <small>
                    {client.interests.slice(0, 2).join(' · ') || 'Add their preferences'}
                  </small>
                </span>
              </button>
            ))}
            {!book.loading && !matches.length && (
              <div className="clients-page__empty">
                <Users size={30} aria-hidden="true" />
                <h2>{query ? 'No matching clients' : 'Start with someone you know'}</h2>
                <p className="client-book__muted">
                  {query
                    ? 'Try a name, country, interest or previous destination.'
                    : 'Save a name now. Add their preferences and travel history whenever you learn more.'}
                </p>
                {!query && (
                  <Button variant="soft" onClick={() => setEditing('new')}>
                    Add your first client
                  </Button>
                )}
              </div>
            )}
          </div>
        </aside>
        {selected ? (
          <section className="clients-page__detail" aria-label="Selected client">
            <header className="clients-page__client-header">
              <span className="client-book__avatar client-book__avatar--large">
                {selected.photoDataUrl ? (
                  <img src={selected.photoDataUrl} alt={`${selected.name} profile`} />
                ) : (
                  <UserRound size={32} aria-hidden="true" />
                )}
              </span>
              <div>
                <h2>{selected.name}</h2>
                <p className="client-book__muted">
                  {[
                    clientCountryLabel(selected.country),
                    selected.history.length
                      ? `${selected.history.length} recorded ${selected.history.length === 1 ? 'trip' : 'trips'}`
                      : 'Ready for the next journey',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <Flex gap="2" wrap="wrap">
                <Button variant="soft" disabled={!!busy} onClick={() => setEditing(selected)}>
                  <Pencil size={14} /> Edit client
                </Button>
                <Button
                  disabled={!!busy}
                  loading={busy === 'create'}
                  onClick={() => void startProposal(selected)}
                >
                  <Plus size={14} /> Start proposal
                </Button>
              </Flex>
            </header>
            <dl className="clients-page__facts">
              {[
                ['Residence', clientCountryLabel(selected.country)],
                ['Nationality', clientCountryLabel(selected.nationality)],
                ['Passport', clientCountryLabel(selected.passportNationality)],
                ['Date of birth', selected.dateOfBirth || ''],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || 'Not supplied'}</dd>
                </div>
              ))}
            </dl>
            <div className="clients-page__sections">
              <section>
                <h3>What matters to them</h3>
                {selected.interests.length ? (
                  <Flex wrap="wrap" gap="2">
                    {selected.interests.map((interest, index) => (
                      <Badge key={`${interest}-${index}`} size="2" variant="soft">
                        {interest}
                      </Badge>
                    ))}
                  </Flex>
                ) : (
                  <p className="client-book__muted">
                    Add their interests to help Tara suggest a trip that fits.
                  </p>
                )}
                {selected.foodPreferences.length > 0 && (
                  <p>
                    <strong>Food preferences:</strong> {selected.foodPreferences.join(', ')}
                  </p>
                )}
                {selected.context && <p className="clients-page__context">{selected.context}</p>}
              </section>
              <section>
                <h3>Travel history</h3>
                {historyError && <p className="client-book__muted">{historyError}</p>}
                {!trips.length ? (
                  <p className="client-book__muted">
                    No trips recorded yet. Add past destinations and what they enjoyed.
                  </p>
                ) : (
                  <div className="clients-page__history">
                    {trips.map((trip, index) => (
                      <article key={`${trip.destination}-${trip.visitedAt}-${index}`}>
                        <div>
                          <h4>
                            {trip.destination}
                            {trip.country && <span> · {clientCountryLabel(trip.country)}</span>}
                          </h4>
                          <small>
                            {[
                              trip.experience === 'planned' ? 'Planned itinerary' : 'Visited',
                              trip.visitedAt,
                              trip.feedback === 'liked'
                                ? 'Liked'
                                : trip.feedback === 'disliked'
                                  ? 'Disliked'
                                  : trip.feedback === 'neutral'
                                    ? 'Neutral'
                                    : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </small>
                        </div>
                        {trip.notes && <p>{trip.notes}</p>}
                        {!!trip.interests?.length && (
                          <p className="client-book__muted">{trip.interests.join(' · ')}</p>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </section>
              <section>
                <h3>Proposals</h3>
                {workspaces.filter((workspace) => workspace.brief.clientId === selected.id)
                  .length ? (
                  <div className="clients-page__proposals">
                    {workspaces
                      .filter((workspace) => workspace.brief.clientId === selected.id)
                      .map((workspace) => (
                        <Link key={workspace.id} to={`/studio/${workspace.id}`}>
                          <span>
                            {workspace.title}
                            <small>{workspace.brief.startDate || 'Dates to be confirmed'}</small>
                          </span>
                          <ArrowUpRight size={15} />
                        </Link>
                      ))}
                  </div>
                ) : (
                  <p className="client-book__muted">
                    The proposals you create for this client will appear here.
                  </p>
                )}
              </section>
            </div>
            <footer className="clients-page__footer">
              <p className="client-book__muted">Photo and birthday are private client records.</p>
              <AlertDialog.Root>
                <AlertDialog.Trigger>
                  <Button variant="ghost" color="red" disabled={!!busy}>
                    <Trash2 size={13} /> Delete client
                  </Button>
                </AlertDialog.Trigger>
                <AlertDialog.Content>
                  <AlertDialog.Title>Delete {selected.name}?</AlertDialog.Title>
                  <AlertDialog.Description>
                    The saved client record and photo will be removed. Existing proposals remain
                    available with their trip details.
                  </AlertDialog.Description>
                  <Flex gap="3" justify="end" mt="4">
                    <AlertDialog.Cancel>
                      <Button variant="soft" color="gray">
                        Keep client
                      </Button>
                    </AlertDialog.Cancel>
                    <AlertDialog.Action>
                      <Button color="red" onClick={() => void remove(selected)}>
                        Delete client
                      </Button>
                    </AlertDialog.Action>
                  </Flex>
                </AlertDialog.Content>
              </AlertDialog.Root>
            </footer>
          </section>
        ) : (
          <section
            className="clients-page__detail clients-page__welcome"
            aria-label="Client overview"
          >
            <UserRound size={36} aria-hidden="true" />
            <h2>Every great trip starts with a person.</h2>
            <p className="client-book__muted">
              Choose a client to see their details and travel history, or add someone new.
            </p>
          </section>
        )}
      </div>
      {editing && (
        <ClientEditDialog
          client={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(client) => {
            book.upsert(client);
            setSelectedId(client.id);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
