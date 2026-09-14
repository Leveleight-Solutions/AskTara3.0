import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  GripVertical,
  MapPin,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api, ApiError, money, readableDate } from '../api';
import { useApp } from '../context';
import { Modal, Spinner, TaraMark } from '../components/ui';
import { StudioImportComposer } from '../components/StudioImportComposer';
import StudioProposalControls, { AgencySettings } from '../components/StudioProposalControls';
import type {
  StudioAgency,
  StudioBrief,
  StudioClient,
  StudioItem,
  StudioStop,
  StudioWorkspace,
  TransportMode,
} from '../../shared/studio';
import './studio.css';

type WorkspacePatch = {
  title?: string;
  brief?: Partial<StudioBrief>;
  stops?: StudioStop[];
  items?: StudioItem[];
  recommendations?: StudioWorkspace['recommendations'];
  pricing?: StudioWorkspace['pricing'];
};
const stageLabels = ['Brief', 'Structure', 'Services', 'Recommendations', 'Proposal'];
const stages = ['brief', 'structure', 'services', 'recommendations', 'proposal'];
const blankStop = (): StudioStop => ({
  id: crypto.randomUUID(),
  name: '',
  country: '',
  nights: null,
  arrivalDate: '',
  departureDate: '',
  onwardTransport: 'undecided',
  neighbourhood: '',
  notes: '',
});
const numberOrNull = (value: string) => (value === '' ? null : Number(value));
function routeDates(stops: StudioStop[], startDate: string): StudioStop[] {
  let cursor = startDate;
  return stops.map((stop) => {
    const arrivalDate = stop.arrivalFixed ? stop.arrivalDate : cursor || '';
    let departureDate = '';
    if (arrivalDate && stop.nights !== null) {
      const date = new Date(`${arrivalDate}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + stop.nights);
      if (Number.isFinite(date.getTime())) departureDate = date.toISOString().slice(0, 10);
    }
    cursor = departureDate;
    return { ...stop, arrivalDate, departureDate };
  });
}

export default function Studio() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { ownerVersion } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [workspaces, setWorkspaces] = useState<StudioWorkspace[]>([]);
  const [workspace, setWorkspace] = useState<StudioWorkspace | null>(null);
  const [clients, setClients] = useState<StudioClient[]>([]);
  const [agency, setAgency] = useState<StudioAgency | null>(null);
  const [routeDirty, setRouteDirty] = useState(false);
  const actionLock = useRef(false);
  const requestIds = useRef(new Map<string, string>());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState(search.get('q') || '');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleting, setDeleting] = useState<StudioWorkspace | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('structure');
  const epoch = useRef(0);
  const latestWorkspace = useRef(workspace);
  latestWorkspace.current = workspace;
  useEffect(() => {
    const current = ++epoch.current;
    setLoading(true);
    setError((location.state as { reviewError?: string } | null)?.reviewError || '');
    setBusy('');
    setRouteDirty(false);
    setWorkspace(null);
    setWorkspaces([]);
    setClients([]);
    setMessage(search.get('q') || '');
    void Promise.all([
      id
        ? api<{ workspace: StudioWorkspace }>(`/studio/workspaces/${id}`)
        : api<{ workspaces: StudioWorkspace[] }>('/studio/workspaces'),
      api<{ clients: StudioClient[] }>('/studio/clients'),
      api<{ agency: StudioAgency }>('/studio/agency'),
    ])
      .then(([result, clientResult, agencyResult]) => {
        if (current !== epoch.current) return;
        if ('workspace' in result) {
          setWorkspace(result.workspace);
          setActiveTab(result.workspace.structureAccepted ? 'services' : 'structure');
        } else setWorkspaces(result.workspaces);
        setClients(clientResult.clients);
        setAgency(agencyResult.agency);
      })
      .catch((cause: Error) => {
        if (current === epoch.current) setError(cause.message);
      })
      .finally(() => {
        if (current === epoch.current) setLoading(false);
      });
    return () => {
      epoch.current++;
    };
  }, [id, ownerVersion]);

  async function act(label: string, operation: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    const currentEpoch = epoch.current;
    setBusy(label);
    setError('');
    try {
      await operation();
      return true;
    } catch (cause) {
      if (currentEpoch !== epoch.current) return false;
      setError((cause as Error).message);
      if (cause instanceof ApiError && cause.status === 409 && id) {
        try {
          const result = await api<{ workspace: StudioWorkspace }>(`/studio/workspaces/${id}`);
          setWorkspace(result.workspace);
        } catch {
          /* Keep the current local view when refresh is unavailable. */
        }
      }
      return false;
    } finally {
      actionLock.current = false;
      if (currentEpoch === epoch.current) setBusy('');
    }
  }
  async function mutate(action: string, body: Record<string, unknown>) {
    const current = latestWorkspace.current;
    if (!current) return;
    const result = await api<{ workspace: StudioWorkspace }>(
      `/studio/workspaces/${current.id}${action}`,
      {
        method: action ? 'POST' : 'PATCH',
        body: JSON.stringify({ ...body, revision: current.revision }),
      },
    );
    if (
      latestWorkspace.current?.id === current.id &&
      result.workspace.revision >= latestWorkspace.current.revision
    )
      setWorkspace(result.workspace);
    return result.workspace;
  }
  const patch = async (value: WorkspacePatch) => {
    const success = await act('Saving changes', async () => {
      await mutate('', value);
    });
    if (!success)
      throw new Error(
        'Your changes could not be saved. Check the workspace message and try again.',
      );
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if ((!message.trim() && !workspace?.imports.length) || routeDirty) return;
    const submittedEpoch = epoch.current;
    const text =
      message.trim() ||
      'Review the imported client information and tell me which details need clarification.';
    await act('Reviewing the brief', async () => {
      if (!workspace) {
        const result = await api<{ workspace: StudioWorkspace }>('/studio/workspaces', {
          method: 'POST',
          body: '{}',
        });
        if (submittedEpoch !== epoch.current) return;
        try {
          await api(`/studio/workspaces/${result.workspace.id}/review`, {
            method: 'POST',
            body: JSON.stringify({
              revision: result.workspace.revision,
              message: text,
              requestId: crypto.randomUUID(),
            }),
          });
          if (submittedEpoch === epoch.current) navigate(`/studio/${result.workspace.id}`);
        } catch (cause) {
          if (submittedEpoch !== epoch.current) return;
          navigate(`/studio/${result.workspace.id}?q=${encodeURIComponent(text)}`, {
            state: { reviewError: (cause as Error).message },
          });
        }
        return;
      }
      const requestKey = JSON.stringify({
        workspace: workspace.id,
        revision: workspace.revision,
        message: text,
      });
      const requestId = requestIds.current.get(requestKey) || crypto.randomUUID();
      requestIds.current.set(requestKey, requestId);
      await mutate('/review', { message: text, requestId });
      requestIds.current.delete(requestKey);
      if (submittedEpoch === epoch.current) setMessage('');
    });
  }
  useEffect(() => {
    if (workspace && !workspace.structureAccepted) setActiveTab('structure');
  }, [workspace?.structureAccepted]);
  const receivedWorkspace = (next: StudioWorkspace) => {
    if (latestWorkspace.current?.id !== next.id || next.revision < latestWorkspace.current.revision)
      return;
    setWorkspace(next);
    setError('');
  };
  if (loading)
    return (
      <div className="studio-loading">
        <Spinner label="Opening your agent workspace…" />
      </div>
    );
  return (
    <section className="studio-page">
      <header className="studio-topbar">
        <div>
          <Link className="studio-back" to="/studio">
            <ArrowLeft size={15} /> Agent Studio
          </Link>
          <h1>{workspace?.title || 'Good trips begin with a clear brief.'}</h1>
        </div>
        <button className="button button-outline" onClick={() => setSettingsOpen(true)}>
          <Settings2 size={16} /> Agency settings
        </button>
      </header>
      {error && (
        <div className="studio-error" role="alert">
          {error}
          <button onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      {!workspace && !id ? (
        <div className="studio-dashboard">
          <div className="studio-welcome">
            <span className="eyebrow">Your travel agent assistant</span>
            <h2>Tell Tara what you have in mind.</h2>
            <p>
              Start with a client request, your own notes, or a rough route. Review the brief, shape
              the journey, then add the details you need.
            </p>
            <form className="studio-start-form" onSubmit={submit}>
              <label htmlFor="studio-start">Client request or planning notes</label>
              <textarea
                id="studio-start"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={16000}
                rows={5}
                placeholder="The Hendersons are planning Europe in June. Paris, Amsterdam and Berlin, about 12 nights. They like boutique hotels near the station. Let’s start with the route."
              />
              <button
                className="button button-primary"
                disabled={!!busy || routeDirty || !message.trim()}
              >
                Start a workspace <ArrowRightIcon />
              </button>
            </form>
            <button
              className="studio-text-button"
              disabled={!!busy}
              onClick={() =>
                void act('Creating workspace', async () => {
                  const result = await api<{ workspace: StudioWorkspace }>('/studio/workspaces', {
                    method: 'POST',
                    body: '{}',
                  });
                  navigate(`/studio/${result.workspace.id}`);
                })
              }
            >
              <Plus size={16} /> Start blank to upload a screenshot, PNR or voice note
            </button>
          </div>
          <section className="studio-workspaces">
            <div className="studio-section-heading">
              <h2>Your workspaces</h2>
              <span>{workspaces.length}</span>
            </div>
            {!workspaces.length && (
              <p className="studio-muted">Your client briefs and proposals will appear here.</p>
            )}
            <div className="studio-workspace-grid">
              {workspaces.map((item) => (
                <article className="studio-workspace-card" key={item.id}>
                  <Link to={`/studio/${item.id}`}>
                    <span className="eyebrow">{item.brief.clientName || 'Client not named'}</span>
                    <h3>{item.title}</h3>
                    <p>{item.stops.map((stop) => stop.name).join(' → ') || 'Brief in progress'}</p>
                  </Link>
                  <div>
                    <span>{stageLabels[stages.indexOf(item.stage)]}</span>
                    <small>{readableDate(item.updatedAt.slice(0, 10))}</small>
                    <button
                      className="icon-button"
                      aria-label={`Delete workspace ${item.title}`}
                      disabled={!!busy}
                      onClick={() => setDeleting(item)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : workspace ? (
        <>
          <nav className="studio-progress" aria-label="Workspace stages">
            {stageLabels.map((label, index) => (
              <span
                key={label}
                aria-current={workspace.stage === stages[index] ? 'step' : undefined}
                className={workspace.stage === stages[index] ? 'current' : ''}
              >
                <span>{index + 1}</span>
                {label}
                {index < 4 && <ChevronRight size={13} />}
              </span>
            ))}
          </nav>
          <div className="studio-layout">
            <aside className="studio-conversation" aria-label="Planning conversation">
              <div className="studio-chat-heading">
                <TaraMark size={23} />
                <div>
                  <h2>Work with Tara</h2>
                  <p>One layer at a time.</p>
                </div>
                <button
                  className="icon-button"
                  aria-label="Edit client brief"
                  onClick={() => setBriefOpen(true)}
                  disabled={!!busy || routeDirty}
                >
                  <Settings2 size={18} />
                </button>
              </div>
              <div className="studio-chat-log" role="log" aria-live="polite">
                {!workspace.messages.length && (
                  <p className="studio-chat-intro">
                    Share the client’s request and what you already know. I’ll review it with you
                    before we build the route.
                  </p>
                )}
                {workspace.messages.map((item) => (
                  <article className={`studio-message ${item.role}`} key={item.id}>
                    <strong>{item.role === 'assistant' ? 'Tara' : 'You'}</strong>
                    <p>{item.content}</p>
                  </article>
                ))}
              </div>
              <form className="studio-chat-form" onSubmit={submit}>
                <label htmlFor="studio-message">
                  {workspace.messages.length
                    ? 'Reply or refine the route'
                    : 'Client request or planning notes'}
                </label>
                <textarea
                  id="studio-message"
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={16000}
                  placeholder="Tell me about the trip, or ask for a change…"
                  disabled={!!busy || routeDirty}
                />
                <button
                  className="button button-primary"
                  disabled={!!busy || routeDirty || (!message.trim() && !workspace.imports.length)}
                >
                  {busy ||
                    (!message.trim() && workspace.imports.length
                      ? 'Review saved sources'
                      : workspace.messages.length
                        ? 'Send to Tara'
                        : 'Review brief')}
                  <Send size={15} />
                </button>
              </form>
              {routeDirty && (
                <p className="studio-muted studio-dirty-note">
                  Save or discard the route edits before asking Tara for another change.
                </p>
              )}
              <StudioImportComposer
                workspace={workspace}
                onChange={receivedWorkspace}
                disabled={!!busy || routeDirty}
              />
              {!!workspace.brief.clientName && (
                <details className="studio-client-history">
                  <summary>Client context · {workspace.brief.clientName}</summary>
                  <p>{workspace.brief.context || 'No background context added yet.'}</p>
                  {clients
                    .filter(
                      (c) =>
                        c.name.toLocaleLowerCase() ===
                        workspace.brief.clientName.toLocaleLowerCase(),
                    )
                    .flatMap((c) => c.previousWorkspaces)
                    .filter((w) => w.id !== workspace.id)
                    .map((previous) => (
                      <Link key={previous.id} to={`/studio/${previous.id}`}>
                        {previous.title} <ChevronRight size={12} />
                      </Link>
                    ))}
                  <small>Confirm the travelling party for every new trip.</small>
                </details>
              )}
            </aside>
            <div className="studio-canvas">
              <BriefReview
                workspace={workspace}
                onAnswer={setMessage}
                onEdit={() => {
                  if (!routeDirty) setBriefOpen(true);
                  else setError('Save or discard your route edits before editing the brief.');
                }}
              />
              <div className="studio-tabs" role="tablist" aria-label="Plan details">
                {['structure', 'services', 'recommendations', 'proposal'].map((tab) => (
                  <button
                    role="tab"
                    aria-selected={activeTab === tab}
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    disabled={routeDirty || (tab !== 'structure' && !workspace.structureAccepted)}
                  >
                    {tab[0].toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
              {activeTab === 'structure' && (
                <>
                  <RouteEditor
                    key={`${workspace.id}:${workspace.revision}`}
                    workspace={workspace}
                    disabled={!!busy}
                    onSave={patch}
                    onDirty={setRouteDirty}
                  />
                  <div className="studio-action-card">
                    {workspace.stage === 'brief' || !workspace.stops.length ? (
                      <>
                        <p>
                          {workspace.stops.length
                            ? 'Continue with this draft route using what you know. Unconfirmed details stay open.'
                            : 'Tell Tara the destinations you have in mind, or add and save the first stop above.'}
                        </p>
                        <button
                          className="button button-primary"
                          disabled={!!busy || routeDirty || !workspace.stops.length}
                          onClick={() =>
                            void act('Drafting the route', async () => {
                              await mutate('/structure', {
                                skipQualification: workspace.qualification.questions.length > 0,
                              });
                            })
                          }
                        >
                          {workspace.qualification.questions.length
                            ? 'Skip questions and build structure'
                            : 'Build route structure'}
                          <Sparkles size={16} />
                        </button>
                      </>
                    ) : !workspace.structureAccepted ? (
                      <>
                        <p>
                          Review the destinations, nights and dates. Accept this structure when you
                          are ready to add services.
                        </p>
                        <button
                          className="button button-primary"
                          disabled={!!busy || routeDirty}
                          onClick={() =>
                            void act('Accepting structure', async () => {
                              await mutate('/accept-structure', {});
                              setActiveTab('services');
                            })
                          }
                        >
                          Accept structure <Check size={16} />
                        </button>
                        <button
                          className="studio-text-button"
                          disabled={!!busy || routeDirty}
                          onClick={() => {
                            setMessage(
                              'Suggest an alternative route using this brief. Keep the confirmed requirements.',
                            );
                            document.getElementById('studio-message')?.focus();
                          }}
                        >
                          Ask Tara for another route
                        </button>
                      </>
                    ) : (
                      <p className="studio-success">
                        <Check size={17} /> Structure accepted. Choose the services or
                        recommendations you want to add.
                      </p>
                    )}
                  </div>
                </>
              )}
              {activeTab === 'services' && workspace.structureAccepted && (
                <ServicesPanel
                  workspace={workspace}
                  disabled={!!busy}
                  onSave={patch}
                  onImport={() =>
                    document
                      .querySelector('.studio-import-composer')
                      ?.scrollIntoView({ behavior: 'smooth' })
                  }
                  onChange={receivedWorkspace}
                />
              )}
              {activeTab === 'recommendations' && workspace.structureAccepted && (
                <RecommendationsPanel
                  workspace={workspace}
                  disabled={!!busy}
                  onSave={patch}
                  onGenerate={async (body) => {
                    await act('Researching recommendations', async () => {
                      await mutate('/recommendations', { ...body, requestId: crypto.randomUUID() });
                    });
                  }}
                />
              )}
              {activeTab === 'proposal' && workspace.structureAccepted && agency && (
                <StudioProposalControls
                  workspace={workspace}
                  agency={agency}
                  onUpdate={receivedWorkspace}
                  onAgencyUpdate={setAgency}
                  onError={setError}
                />
              )}
            </div>
          </div>
          {briefOpen && (
            <BriefDialog
              workspace={workspace}
              clients={clients}
              onClose={() => setBriefOpen(false)}
              onSave={async (brief, title) => {
                await patch({ brief, title });
                setBriefOpen(false);
              }}
            />
          )}
        </>
      ) : (
        <p className="studio-muted">
          This workspace could not be loaded. <Link to="/studio">Return to Agent Studio.</Link>
        </p>
      )}
      {deleting && (
        <Modal title="Delete this workspace?" onClose={() => setDeleting(null)}>
          <p className="modal-intro">
            This removes “{deleting.title}”, its private sources and any published proposal link.
          </p>
          <div className="studio-route-actions">
            <button
              className="button button-primary"
              disabled={!!busy}
              onClick={() =>
                void act('Deleting workspace', async () => {
                  await api(`/studio/workspaces/${deleting.id}`, { method: 'DELETE' });
                  setWorkspaces((current) => current.filter((item) => item.id !== deleting.id));
                  setDeleting(null);
                })
              }
            >
              Delete workspace
            </button>
            <button className="button button-outline" onClick={() => setDeleting(null)}>
              Keep workspace
            </button>
          </div>
        </Modal>
      )}
      {settingsOpen && (
        <Modal title="Agency settings" onClose={() => setSettingsOpen(false)} wide>
          {agency && (
            <AgencySettings agency={agency} onAgencyUpdate={setAgency} onError={setError} />
          )}
        </Modal>
      )}
    </section>
  );
}
function ArrowRightIcon() {
  return <ChevronRight size={17} />;
}
function BriefReview({
  workspace,
  onAnswer,
  onEdit,
}: {
  workspace: StudioWorkspace;
  onAnswer: (text: string) => void;
  onEdit: () => void;
}) {
  const { qualification } = workspace;
  return (
    <section className="studio-brief-review" aria-label="Brief review">
      <div className="studio-section-heading">
        <div>
          <span className="eyebrow">Brief review</span>
          <h2>
            {qualification.score >= 80
              ? 'A clear starting point.'
              : qualification.score >= 40
                ? 'Taking shape.'
                : 'Let’s find the starting point.'}
          </h2>
        </div>
        <span className="studio-strength">{qualification.score}% complete</span>
      </div>
      <progress value={qualification.score} max={100} aria-label="Brief completeness" />
      {!!qualification.known.length && (
        <dl className="studio-known">
          {qualification.known.map((fact) => (
            <div key={fact.id}>
              <dt>
                <Check size={13} />
                {fact.label}
              </dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {!!qualification.questions.length && (
        <details open={!workspace.structureAccepted}>
          <summary>
            {qualification.questions.length}{' '}
            {qualification.questions.length === 1 ? 'detail' : 'details'} to clarify{' '}
            {qualification.skipped && '· skipped for now'}
          </summary>
          <ul className="studio-questions">
            {qualification.questions.map((question) => (
              <li key={question.id}>
                <button
                  onClick={() => {
                    onAnswer(`${question.label}\n`);
                    document.getElementById('studio-message')?.focus();
                  }}
                >
                  {question.label}
                </button>
                <span>{question.reason}</span>
              </li>
            ))}
          </ul>
          <small>You can answer in chat or continue with incomplete details.</small>
        </details>
      )}
      <button className="studio-text-button" onClick={onEdit}>
        Edit brief details <Settings2 size={13} />
      </button>
    </section>
  );
}
function RouteEditor({
  workspace,
  disabled,
  onSave,
  onDirty,
}: {
  workspace: StudioWorkspace;
  disabled: boolean;
  onSave: (patch: WorkspacePatch) => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  const [stops, setStops] = useState(workspace.stops);
  const [dragged, setDragged] = useState<string | null>(null);
  const dirty = JSON.stringify(stops) !== JSON.stringify(workspace.stops);
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  const [saveError, setSaveError] = useState('');
  const update = (id: string, patch: Partial<StudioStop>) =>
    setStops((current) =>
      routeDates(
        current.map((stop) => (stop.id === id ? { ...stop, ...patch } : stop)),
        workspace.brief.startDate,
      ),
    );
  function move(from: number, to: number) {
    if (disabled || to < 0 || to >= stops.length) return;
    setStops((current) => {
      const next = [...current];
      const [stop] = next.splice(from, 1);
      next.splice(to, 0, stop);
      return routeDates(next, workspace.brief.startDate);
    });
  }
  const totalNights = stops.reduce((sum, stop) => sum + (stop.nights || 0), 0);
  return (
    <section className="studio-route-editor" aria-label="Route structure">
      <div className="studio-section-heading">
        <div>
          <h2>The shape of the journey</h2>
          <p>
            {stops.length
              ? `${stops.length} destinations · ${totalNights} nights${stops.some((s) => s.nights === null) ? ' confirmed so far' : ''}`
              : 'Destinations, dates and how they connect.'}
          </p>
        </div>
        <MapPin size={24} />
      </div>
      {!stops.length && (
        <div className="studio-route-empty">
          <TaraMark size={32} />
          <p>
            Your route will appear here.
            <br />
            Start with a brief or add your first destination.
          </p>
        </div>
      )}
      <ol className="studio-route-list">
        {stops.map((stop, index) => (
          <li
            className="studio-route-stop"
            key={stop.id}
            draggable={!disabled}
            onDragStart={(event) => {
              setDragged(stop.id);
              event.dataTransfer.setData('text/plain', stop.id);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const from = stops.findIndex(
                (s) => s.id === (dragged || event.dataTransfer.getData('text/plain')),
              );
              if (from >= 0) move(from, index);
              setDragged(null);
            }}
          >
            <div className="studio-stop-top">
              <span className="studio-stop-number">{index + 1}</span>
              <GripVertical size={18} aria-hidden="true" />
              <strong>{stop.name || 'New destination'}</strong>
              <div className="studio-stop-actions">
                <button
                  aria-label={`Move ${stop.name || 'destination'} up`}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  aria-label={`Move ${stop.name || 'destination'} down`}
                  disabled={disabled || index === stops.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  aria-label={`Remove ${stop.name || 'destination'}`}
                  disabled={disabled}
                  onClick={() =>
                    setStops(
                      routeDates(
                        stops.filter((s) => s.id !== stop.id),
                        workspace.brief.startDate,
                      ),
                    )
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            <fieldset disabled={disabled} className="studio-stop-fields">
              <label>
                Destination
                <input
                  aria-label={`Destination ${index + 1}`}
                  value={stop.name}
                  maxLength={120}
                  onChange={(e) => update(stop.id, { name: e.target.value })}
                />
              </label>
              <label>
                Country
                <input
                  aria-label={`Country ${index + 1}`}
                  value={stop.country}
                  maxLength={100}
                  onChange={(e) => update(stop.id, { country: e.target.value })}
                />
              </label>
              <label>
                Nights
                <div className="studio-stepper">
                  <button
                    aria-label={`Decrease nights in ${stop.name}`}
                    disabled={disabled || !stop.nights}
                    onClick={() => update(stop.id, { nights: Math.max(0, (stop.nights || 0) - 1) })}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    aria-label={`Nights in ${stop.name || `destination ${index + 1}`}`}
                    min={0}
                    max={120}
                    value={stop.nights ?? ''}
                    placeholder="TBC"
                    onChange={(e) => update(stop.id, { nights: numberOrNull(e.target.value) })}
                  />
                  <button
                    aria-label={`Increase nights in ${stop.name}`}
                    onClick={() =>
                      update(stop.id, { nights: Math.min(120, (stop.nights || 0) + 1) })
                    }
                  >
                    +
                  </button>
                </div>
              </label>
              <label>
                Arrival
                <input
                  type="date"
                  aria-label={`Arrival in ${stop.name}`}
                  value={stop.arrivalDate}
                  onChange={(e) =>
                    update(stop.id, { arrivalDate: e.target.value, arrivalFixed: !!e.target.value })
                  }
                />
              </label>
              <label>
                Departure
                <input
                  type="date"
                  aria-label={`Departure from ${stop.name}`}
                  value={stop.departureDate}
                  min={stop.arrivalDate || undefined}
                  onChange={(e) =>
                    update(stop.id, {
                      departureDate: e.target.value,
                      nights:
                        stop.arrivalDate && e.target.value
                          ? Math.max(
                              0,
                              Math.round(
                                (Date.parse(e.target.value) - Date.parse(stop.arrivalDate)) /
                                  86400000,
                              ),
                            )
                          : null,
                    })
                  }
                />
              </label>
              <label>
                Onward transport
                <select
                  aria-label={`Onward transport from ${stop.name}`}
                  value={stop.onwardTransport}
                  onChange={(e) =>
                    update(stop.id, { onwardTransport: e.target.value as TransportMode })
                  }
                >
                  {['undecided', 'flight', 'train', 'car', 'ferry', 'coach', 'other'].map(
                    (mode) => (
                      <option value={mode} key={mode}>
                        {mode === 'undecided' ? 'To decide' : mode[0].toUpperCase() + mode.slice(1)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="studio-check studio-span-2">
                <input
                  type="checkbox"
                  checked={!!stop.arrivalFixed}
                  aria-label={`Keep arrival in ${stop.name} fixed`}
                  onChange={(e) => update(stop.id, { arrivalFixed: e.target.checked })}
                />{' '}
                Keep this arrival date fixed when the route changes
              </label>
              <label className="studio-span-2">
                Preferred neighbourhood
                <input
                  aria-label={`Neighbourhood in ${stop.name}`}
                  value={stop.neighbourhood}
                  maxLength={300}
                  placeholder="Central, near a station, or a specific area"
                  onChange={(e) => update(stop.id, { neighbourhood: e.target.value })}
                />
              </label>
              <label className="studio-span-2">
                Route notes
                <input
                  aria-label={`Notes for ${stop.name}`}
                  value={stop.notes}
                  maxLength={1000}
                  onChange={(e) => update(stop.id, { notes: e.target.value })}
                />
              </label>
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="studio-route-actions">
        <button
          className="button button-outline"
          disabled={disabled || stops.length >= 20}
          onClick={() => setStops(routeDates([...stops, blankStop()], workspace.brief.startDate))}
        >
          <Plus size={15} /> Add destination
        </button>
        {dirty && (
          <>
            <button
              className="button button-primary"
              disabled={disabled || stops.some((s) => !s.name.trim())}
              onClick={() => void onSave({ stops }).catch((cause) => setSaveError(cause.message))}
            >
              Save route changes
            </button>
            <button
              className="studio-text-button"
              disabled={disabled}
              onClick={() => setStops(workspace.stops)}
            >
              Discard changes
            </button>
          </>
        )}
      </div>
      {saveError && (
        <p role="alert" className="form-error">
          {saveError}
        </p>
      )}
      {dirty && (
        <p className="studio-muted">
          Save your edits before accepting the structure. Dates may need adjusting after a reorder.
          Changing the route requires accepting it again.
        </p>
      )}
    </section>
  );
}
function ServicesPanel({
  workspace,
  disabled,
  onSave,
  onImport,
  onChange,
}: {
  workspace: StudioWorkspace;
  disabled: boolean;
  onSave: (patch: WorkspacePatch) => Promise<void>;
  onImport: () => void;
  onChange: (workspace: StudioWorkspace) => void;
}) {
  const [editing, setEditing] = useState<StudioItem | 'new' | null>(null);
  return (
    <section className="studio-card">
      <h2>What would you like help with?</h2>
      <p>
        Add a service you have arranged, import a confirmation, or include a quote in the proposal.
      </p>
      <div className="studio-route-actions">
        <button
          className="button button-primary"
          disabled={disabled}
          onClick={() => setEditing('new')}
        >
          <Plus size={15} /> Add a service
        </button>
        <button className="button button-outline" onClick={onImport}>
          Import a booking or PNR
        </button>
      </div>
      <p className="studio-muted">
        Adding an item prepares the proposal. It does not make a booking.
      </p>
      <SupplierQuotes workspace={workspace} disabled={disabled} onChange={onChange} />
      <div className="studio-service-list">
        {!workspace.items.length && (
          <p className="studio-empty-note">
            No services added yet. Hotels, flights, tours, cruises, transfers and insurance can all
            sit alongside the route.
          </p>
        )}
        {workspace.items.map((item) => (
          <article key={item.id} className="studio-service-item">
            <div>
              <span className="eyebrow">
                {item.kind} · {item.status.replaceAll('_', ' ')}
              </span>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <small>
                {item.price === null
                  ? 'Unpriced'
                  : `${money(item.price, item.currency)} ${item.currency}`}{' '}
                · {item.priceStatus.replaceAll('_', ' ')}
                {item.needsReview ? ' · Review required' : ''}
              </small>
            </div>
            <div className="studio-item-actions">
              <label>
                <input
                  type="checkbox"
                  checked={item.included}
                  disabled={disabled}
                  onChange={(e) =>
                    void onSave({
                      items: workspace.items.map((i) =>
                        i.id === item.id ? { ...i, included: e.target.checked } : i,
                      ),
                    }).catch(() => {})
                  }
                />{' '}
                In proposal
              </label>
              <button
                className="studio-text-button"
                disabled={disabled}
                onClick={() => setEditing(item)}
              >
                Edit service
              </button>
              <button
                aria-label={`Remove ${item.title}`}
                className="icon-button"
                disabled={disabled}
                onClick={() =>
                  void onSave({ items: workspace.items.filter((i) => i.id !== item.id) }).catch(
                    () => {},
                  )
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <ServiceDialog
          workspace={workspace}
          item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={async (item) => {
            await onSave({ items: [...workspace.items.filter((i) => i.id !== item.id), item] });
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
function ServiceDialog({
  workspace,
  item,
  onClose,
  onSave,
}: {
  workspace: StudioWorkspace;
  item?: StudioItem;
  onClose: () => void;
  onSave: (item: StudioItem) => Promise<void>;
}) {
  const [draft, setDraft] = useState<StudioItem>(
    item || {
      id: crypto.randomUUID(),
      kind: 'hotel',
      title: '',
      description: '',
      stopId: workspace.stops[0]?.id || '',
      startDate: '',
      endDate: '',
      status: 'suggested',
      source: 'manual',
      sourceUrl: '',
      supplier: '',
      privateReference: '',
      price: null,
      currency: workspace.pricing.currency || 'AUD',
      priceStatus: 'unpriced',
      quotedAt: '',
      included: true,
      needsReview: false,
      cost: null,
    },
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const change = (patch: Partial<StudioItem>) => setDraft({ ...draft, ...patch });
  return (
    <Modal title={item ? 'Edit service' : 'Add a service to the proposal'} onClose={onClose} wide>
      <form
        className="studio-form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
          void onSave({
            ...draft,
            priceStatus:
              draft.price === null
                ? 'unpriced'
                : draft.priceStatus === 'unpriced'
                  ? 'agent_estimate'
                  : draft.priceStatus,
          })
            .catch((cause) => setFormError(cause.message))
            .finally(() => setSaving(false));
        }}
      >
        <label>
          Service type
          <select
            value={draft.kind}
            onChange={(e) => change({ kind: e.target.value as StudioItem['kind'] })}
          >
            {['hotel', 'flight', 'tour', 'cruise', 'transfer', 'insurance', 'other'].map((kind) => (
              <option key={kind} value={kind}>
                {kind[0].toUpperCase() + kind.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Destination
          <select value={draft.stopId} onChange={(e) => change({ stopId: e.target.value })}>
            <option value="">Whole trip</option>
            {workspace.stops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="studio-span-2">
          Service name
          <input
            required
            maxLength={300}
            value={draft.title}
            onChange={(e) => change({ title: e.target.value })}
          />
        </label>
        <label className="studio-span-2">
          Description
          <textarea
            rows={3}
            maxLength={4000}
            value={draft.description}
            onChange={(e) => change({ description: e.target.value })}
          />
        </label>
        <label>
          Status
          <select
            value={draft.status}
            onChange={(e) => change({ status: e.target.value as StudioItem['status'] })}
          >
            <option value="suggested">Suggested · not booked</option>
            <option value="externally_booked">Already booked elsewhere</option>
            <option value="placeholder">Placeholder</option>
          </select>
        </label>
        <label>
          Supplier
          <input
            maxLength={200}
            value={draft.supplier}
            onChange={(e) => change({ supplier: e.target.value })}
          />
        </label>
        <label>
          Start date
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => change({ startDate: e.target.value })}
          />
        </label>
        <label>
          End date
          <input
            type="date"
            value={draft.endDate}
            onChange={(e) => change({ endDate: e.target.value })}
          />
        </label>
        <label>
          Client price
          <input
            type="number"
            min={0}
            step="0.01"
            value={draft.price ?? ''}
            readOnly={draft.source === 'liteapi'}
            placeholder="Leave blank if unpriced"
            onChange={(e) => change({ price: numberOrNull(e.target.value) })}
          />
        </label>
        <label>
          Currency
          <input
            required
            minLength={3}
            maxLength={3}
            value={draft.currency}
            readOnly={draft.source === 'liteapi'}
            onChange={(e) => change({ currency: e.target.value.toUpperCase() })}
          />
        </label>
        <label>
          Price basis
          <select
            value={draft.priceStatus}
            disabled={draft.source === 'liteapi'}
            onChange={(e) => change({ priceStatus: e.target.value as StudioItem['priceStatus'] })}
          >
            <option value="unpriced">Unpriced</option>
            <option value="agent_estimate">Agent estimate</option>
            {(draft.kind !== 'insurance' || draft.source === 'liteapi') && (
              <>
                <option value="supplier_quote">Supplier quote</option>
                <option value="sandbox">Sandbox example</option>
              </>
            )}
          </select>
        </label>
        <label>
          Internal cost · private
          <input
            type="number"
            min={0}
            step="0.01"
            value={draft.cost ?? ''}
            onChange={(e) => change({ cost: numberOrNull(e.target.value) })}
          />
        </label>
        <label>
          Booking reference · private
          <input
            value={draft.privateReference}
            maxLength={300}
            onChange={(e) => change({ privateReference: e.target.value })}
          />
        </label>
        <label>
          Source link
          <input
            type="url"
            value={draft.sourceUrl}
            maxLength={2000}
            onChange={(e) => change({ sourceUrl: e.target.value })}
          />
        </label>
        {draft.kind === 'insurance' && (
          <p className="studio-muted studio-span-2">
            Enter an agent estimate or a quote you obtained. Insurance pricing requires the
            travellers’ ages and trip details; no policy is issued here.
          </p>
        )}
        <label className="studio-check studio-span-2">
          <input
            type="checkbox"
            checked={!draft.needsReview}
            onChange={(e) => change({ needsReview: !e.target.checked })}
          />{' '}
          I have reviewed these service details
        </label>
        <>
          {formError && (
            <p className="form-error studio-span-2" role="alert">
              {formError}
            </p>
          )}
        </>
        <button className="button button-primary studio-span-2" disabled={saving}>
          {saving ? 'Saving…' : 'Save service'}
        </button>
      </form>
    </Modal>
  );
}
function RecommendationsPanel({
  workspace,
  disabled,
  onSave,
  onGenerate,
}: {
  workspace: StudioWorkspace;
  disabled: boolean;
  onSave: (patch: WorkspacePatch) => Promise<void>;
  onGenerate: (body: {
    category: 'activity' | 'food';
    stopIds: string[];
    interests: string;
  }) => Promise<void>;
}) {
  const [category, setCategory] = useState<'activity' | 'food'>('activity');
  const [selected, setSelected] = useState<string[]>(workspace.stops.map((s) => s.id));
  const [interests, setInterests] = useState('');
  return (
    <section className="studio-card">
      <h2>A few thoughtful extras.</h2>
      <p>
        Add activity or food recommendations only where you need them. Your client decides how to
        spend each day.
      </p>
      <form
        className="studio-recommend-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onGenerate({ category, stopIds: selected, interests });
        }}
      >
        <fieldset disabled={disabled}>
          <legend>Which destinations?</legend>
          <div className="studio-checks">
            {workspace.stops.map((stop) => (
              <label className="studio-check" key={stop.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(stop.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, stop.id]
                        : selected.filter((id) => id !== stop.id),
                    )
                  }
                />
                {stop.name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="studio-form-grid">
          <label>
            Recommendation type
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as 'activity' | 'food')}
            >
              <option value="activity">Things to do</option>
              <option value="food">Places to eat</option>
            </select>
          </label>
          <label>
            What would suit this client?
            <input
              value={interests}
              maxLength={1500}
              onChange={(e) => setInterests(e.target.value)}
              placeholder={
                category === 'food'
                  ? 'Local food, vegetarian, adventurous…'
                  : 'Architecture, galleries, quieter places…'
              }
            />
          </label>
        </div>
        <button
          className="button button-primary"
          disabled={disabled || !selected.length || !interests.trim()}
        >
          <Sparkles size={16} /> Research recommendations
        </button>
      </form>
      {workspace.recommendations.length > 0 && (
        <p className="studio-muted" role="status">
          Ready to review. Select the recommendations you want to include in the client proposal.
        </p>
      )}
      <div className="studio-recommendations">
        {workspace.stops.map((stop) => {
          const items = workspace.recommendations.filter((r) => r.stopId === stop.id);
          return items.length ? (
            <section key={stop.id}>
              <h3>{stop.name}</h3>
              {items.map((item) => (
                <article className="studio-recommendation" key={item.id}>
                  <label className="studio-check">
                    <input
                      type="checkbox"
                      aria-label={`Include ${item.name} in client proposal`}
                      checked={item.included}
                      disabled={disabled}
                      onChange={(e) =>
                        void onSave({
                          recommendations: workspace.recommendations.map((r) =>
                            r.id === item.id ? { ...r, included: e.target.checked } : r,
                          ),
                        }).catch(() => {})
                      }
                    />
                    <strong>{item.name}</strong>
                    <span className="studio-recommend-inclusion">
                      {item.included ? 'In proposal' : 'Include in proposal'}
                    </span>
                  </label>
                  <p>{item.description}</p>
                  <div className="studio-source-links">
                    {item.sources
                      .filter((source) => /^https?:\/\//i.test(source.url))
                      .map((source) => (
                        <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                          {source.label} ↗
                        </a>
                      ))}
                  </div>
                </article>
              ))}
            </section>
          ) : null;
        })}
      </div>
    </section>
  );
}
function BriefDialog({
  workspace,
  clients,
  onClose,
  onSave,
}: {
  workspace: StudioWorkspace;
  clients: StudioClient[];
  onClose: () => void;
  onSave: (brief: StudioBrief, title: string) => Promise<void>;
}) {
  const [brief, setBrief] = useState(workspace.brief);
  const [title, setTitle] = useState(workspace.title);
  const [childAges, setChildAges] = useState(workspace.brief.childAges.join(', '));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const update = (patch: Partial<StudioBrief>) => setBrief({ ...brief, ...patch });
  const previous = clients.find(
    (client) => client.name.toLocaleLowerCase() === brief.clientName.toLocaleLowerCase(),
  );
  return (
    <Modal title="Client brief" onClose={onClose} wide>
      <p className="modal-intro">
        Keep undecided details blank. A returning client may have a different travelling party this
        time.
      </p>
      <form
        className="studio-form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          setSaving(true);
          void onSave(
            {
              ...brief,
              childAges:
                (brief.children || 0) === 0
                  ? []
                  : childAges
                      .split(',')
                      .map((age) => age.trim())
                      .filter(Boolean)
                      .map(Number),
            },
            title,
          )
            .catch((cause) => setFormError(cause.message))
            .finally(() => setSaving(false));
        }}
      >
        <label className="studio-span-2">
          Workspace title
          <input
            required
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Client name
          <input
            list="studio-client-names"
            value={brief.clientName}
            maxLength={200}
            onChange={(e) => update({ clientName: e.target.value })}
          />
          <datalist id="studio-client-names">
            {clients.map((c) => (
              <option key={c.name} value={c.name} />
            ))}
          </datalist>
        </label>
        <label>
          Departing from
          <input
            value={brief.origin}
            maxLength={200}
            onChange={(e) => update({ origin: e.target.value })}
          />
        </label>
        <label className="studio-span-2">
          Client context
          <textarea
            rows={3}
            value={brief.context}
            maxLength={6000}
            onChange={(e) => update({ context: e.target.value })}
          />
        </label>
        {previous?.context && previous.context !== brief.context && (
          <button
            type="button"
            className="studio-text-button studio-span-2"
            onClick={() => update({ context: previous.context })}
          >
            Use this client’s previous background context
          </button>
        )}
        <label>
          Start date
          <input
            type="date"
            value={brief.startDate}
            onChange={(e) => update({ startDate: e.target.value })}
          />
        </label>
        <label>
          End date
          <input
            type="date"
            value={brief.endDate}
            onChange={(e) => update({ endDate: e.target.value })}
          />
        </label>
        <label className="studio-check studio-span-2">
          <input
            type="checkbox"
            checked={brief.datesFlexible}
            onChange={(e) => update({ datesFlexible: e.target.checked })}
          />{' '}
          Dates are flexible
        </label>
        <label>
          Adults
          <input
            type="number"
            min={1}
            max={100}
            value={brief.adults ?? ''}
            onChange={(e) => update({ adults: numberOrNull(e.target.value) })}
          />
        </label>
        <label>
          Children
          <input
            type="number"
            min={0}
            max={30}
            value={brief.children ?? ''}
            onChange={(e) => update({ children: numberOrNull(e.target.value) })}
          />
        </label>
        {(brief.children || 0) > 0 && (
          <label className="studio-span-2">
            Children’s ages · comma separated
            <input
              value={childAges}
              pattern="[0-9, ]*"
              onChange={(e) => setChildAges(e.target.value)}
            />
          </label>
        )}
        <label>
          Total group budget
          <input
            type="number"
            min={0}
            value={brief.budget ?? ''}
            onChange={(e) => update({ budget: numberOrNull(e.target.value) })}
          />
        </label>
        <label>
          Budget currency
          <input
            minLength={3}
            maxLength={3}
            value={brief.currency}
            onChange={(e) => update({ currency: e.target.value.toUpperCase() })}
          />
        </label>
        <label>
          Hotel standard
          <input
            value={brief.hotelStandard}
            maxLength={300}
            placeholder="Boutique, 4 star, value…"
            onChange={(e) => update({ hotelStandard: e.target.value })}
          />
        </label>
        <label>
          Hotel location
          <input
            value={brief.hotelLocation}
            maxLength={300}
            placeholder="Central, by the station…"
            onChange={(e) => update({ hotelLocation: e.target.value })}
          />
        </label>
        <label>
          Flight cabin
          <input
            value={brief.cabin}
            maxLength={100}
            placeholder="Not discussed"
            onChange={(e) => update({ cabin: e.target.value })}
          />
        </label>
        <label>
          Desired output
          <select
            value={brief.output}
            onChange={(e) => update({ output: e.target.value as StudioBrief['output'] })}
          >
            <option value="structure">Route structure</option>
            <option value="proposal">Client proposal</option>
          </select>
        </label>
        <label className="studio-span-2">
          Interests · one per line
          <textarea
            rows={2}
            value={brief.interests.join('\n')}
            onChange={(e) => update({ interests: e.target.value.split('\n') })}
          />
        </label>
        <label className="studio-span-2">
          Requirements · one per line
          <textarea
            rows={2}
            value={brief.requirements.join('\n')}
            onChange={(e) => update({ requirements: e.target.value.split('\n') })}
          />
        </label>
        <>
          {formError && (
            <p className="form-error studio-span-2" role="alert">
              {formError}
            </p>
          )}
        </>
        <button className="button button-primary studio-span-2" disabled={saving}>
          Save brief
        </button>
      </form>
    </Modal>
  );
}
function SupplierQuotes({
  workspace,
  disabled,
  onChange,
}: {
  workspace: StudioWorkspace;
  disabled: boolean;
  onChange: (workspace: StudioWorkspace) => void;
}) {
  const [kind, setKind] = useState<'hotels' | 'flights'>('hotels');
  const [stopId, setStopId] = useState(workspace.stops[0]?.id || '');
  const [nationality, setNationality] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [cabin, setCabin] = useState('');
  const [quotes, setQuotes] = useState<StudioItem[]>([]);
  const [warning, setWarning] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [quoteRevision, setQuoteRevision] = useState<number | null>(null);
  const quoteLock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const searchEpoch = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    controller.current?.abort();
    searchEpoch.current++;
    setQuotes([]);
    setWarning('');
    setError('');
    setBusy(false);
    quoteLock.current = false;
    setQuoteRevision(null);
  }, [workspace.revision, kind]);
  const stop = workspace.stops.find((s) => s.id === stopId);
  const partyConfirmed = !!workspace.brief.adults && workspace.brief.children === 0;
  const hotelReady =
    partyConfirmed &&
    !!stop?.arrivalDate &&
    !!stop.departureDate &&
    !!workspace.brief.hotelStandard.trim() &&
    !!workspace.brief.hotelLocation.trim();
  const flightReady = partyConfirmed && !!workspace.brief.cabin.trim();
  async function search(event: FormEvent) {
    event.preventDefault();
    if (quoteLock.current) return;
    quoteLock.current = true;
    setBusy(true);
    setError('');
    setQuotes([]);
    setWarning('');
    const current = ++searchEpoch.current;
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    try {
      const body =
        kind === 'hotels'
          ? { revision: workspace.revision, stopId, guestNationality: nationality.toUpperCase() }
          : {
              revision: workspace.revision,
              origin: origin.toUpperCase(),
              destination: destination.toUpperCase(),
              departureDate,
              ...(returnDate ? { returnDate } : {}),
              adults: workspace.brief.adults,
              cabinClass: cabin,
            };
      const result = await api<{ quotes: StudioItem[]; mode: string; warning: string }>(
        `/studio/workspaces/${workspace.id}/${kind}/search`,
        { method: 'POST', body: JSON.stringify(body), signal: requestController.signal },
      );
      if (current !== searchEpoch.current) return;
      setQuotes(result.quotes);
      setQuoteRevision(workspace.revision);
      setWarning(
        result.warning ||
          (result.mode === 'test' || result.mode === 'sandbox'
            ? 'Sandbox quotes are simulated examples.'
            : 'Availability and prices require reconfirmation.'),
      );
      if (!result.quotes.length)
        setWarning(
          'No quotes were returned for these details. You can refine the search or add a service manually.',
        );
    } catch (cause) {
      if (current === searchEpoch.current && !requestController.signal.aborted)
        setError((cause as Error).message);
    } finally {
      if (current === searchEpoch.current) {
        setBusy(false);
        quoteLock.current = false;
      }
    }
  }
  async function select(quote: StudioItem) {
    if (quoteLock.current || quoteRevision !== workspace.revision) return;
    quoteLock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ workspace: StudioWorkspace }>(
        `/studio/workspaces/${workspace.id}/quotes/${quote.id}`,
        { method: 'POST', body: JSON.stringify({ revision: workspace.revision }) },
      );
      onChange(result.workspace);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
      quoteLock.current = false;
    }
  }
  return (
    <details className="studio-supplier-quotes">
      <summary>Find hotel or flight suggestions</summary>
      <p>Search only when you need a quote. Select an option to add it to the proposal.</p>
      <form onSubmit={(event) => void search(event)}>
        <fieldset disabled={disabled || busy}>
          <div className="studio-form-grid">
            <label>
              Search for
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as 'hotels' | 'flights')}
              >
                <option value="hotels">Hotels</option>
                <option value="flights">Flights</option>
              </select>
            </label>
            {kind === 'hotels' ? (
              <>
                <label>
                  Destination for hotel quotes
                  <select
                    value={stopId}
                    onChange={(e) => {
                      setStopId(e.target.value);
                      setQuotes([]);
                    }}
                  >
                    {workspace.stops.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Guest nationality · two-letter code
                  <input
                    required
                    pattern="[A-Za-z]{2}"
                    maxLength={2}
                    placeholder="e.g. AU"
                    value={nationality}
                    onChange={(e) => setNationality(e.target.value.toUpperCase())}
                  />
                </label>
                <div className="studio-muted studio-supplier-context">
                  {stop?.arrivalDate && stop.departureDate
                    ? `${readableDate(stop.arrivalDate)} – ${readableDate(stop.departureDate)}`
                    : 'Set this stop’s exact stay dates first.'}
                  <br />
                  {workspace.brief.hotelStandard}{' '}
                  {workspace.brief.hotelLocation && `· ${workspace.brief.hotelLocation}`}
                </div>
              </>
            ) : (
              <>
                <label>
                  Cabin for this search
                  <select required value={cabin} onChange={(e) => setCabin(e.target.value)}>
                    <option value="">Choose cabin</option>
                    <option value="economy">Economy</option>
                    <option value="premium_economy">Premium economy</option>
                    <option value="business">Business</option>
                    <option value="first">First</option>
                  </select>
                </label>
                <label>
                  Origin airport code
                  <input
                    required
                    minLength={3}
                    maxLength={3}
                    pattern="[A-Za-z]{3}"
                    placeholder="e.g. SYD"
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value.toUpperCase())}
                  />
                </label>
                <label>
                  Destination airport code
                  <input
                    required
                    minLength={3}
                    maxLength={3}
                    pattern="[A-Za-z]{3}"
                    placeholder="e.g. LHR"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value.toUpperCase())}
                  />
                </label>
                <label>
                  Flight departure date
                  <input
                    required
                    type="date"
                    value={departureDate}
                    onChange={(e) => setDepartureDate(e.target.value)}
                  />
                </label>
                <label>
                  Return date · optional
                  <input
                    type="date"
                    min={departureDate || undefined}
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                  />
                </label>
              </>
            )}
          </div>
          {!partyConfirmed && (
            <p className="studio-muted">
              Confirm the number of adults and children in the brief first. Supplier searches
              currently support adult-only parties; family services can be added manually.
            </p>
          )}
          {kind === 'hotels' && !hotelReady && partyConfirmed && (
            <p className="studio-muted">
              Before searching, set exact stay dates, hotel standard and hotel location in the brief
              and route.
            </p>
          )}
          {kind === 'flights' && !flightReady && partyConfirmed && (
            <p className="studio-muted">
              Confirm the client’s preferred cabin in the brief before searching.
            </p>
          )}
          <button
            className="button button-outline"
            disabled={disabled || busy || !(kind === 'hotels' ? hotelReady : flightReady)}
          >
            {busy ? 'Searching…' : `Search ${kind} quotes`}
          </button>
        </fieldset>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {warning && (
        <p className="studio-muted" role="status">
          {warning}
        </p>
      )}
      <div className="studio-quote-results">
        {quotes.map((quote) => (
          <article key={quote.id}>
            <div>
              <h3>{quote.title}</h3>
              <p>{quote.description}</p>
              <strong>
                {quote.price === null
                  ? 'Unpriced'
                  : `${money(quote.price, quote.currency)} ${quote.currency}`}
              </strong>
              <small>
                {quote.priceStatus === 'sandbox'
                  ? 'Sandbox example · not a live fare'
                  : quote.priceStatus.replaceAll('_', ' ')}
              </small>
            </div>
            <button
              className="button button-outline"
              disabled={disabled || busy || quoteRevision !== workspace.revision}
              onClick={() => void select(quote)}
            >
              Add quote to proposal
            </button>
          </article>
        ))}
      </div>
    </details>
  );
}
