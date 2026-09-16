import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  GripVertical,
  Lock,
  MapPin,
  Minus,
  Plus,
  Send,
  Settings2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  DataList,
  Flex,
  Grid,
  Heading,
  IconButton,
  Progress,
  Reset,
  Select,
  Separator,
  Tabs,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes';
import { api, ApiError, money, readableDate } from '../api';
import { useApp } from '../context';
import { Modal, Spinner, TaraMark } from '../components/ui';
import { StudioImportComposer, type StudioImportMode } from '../components/StudioImportComposer';
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
/** Full-width row inside the two-column form grids. */
const spanAll = { gridColumn: '1 / -1' };
/** `<fieldset disabled>` is kept for its native disable cascade; this strips the UA chrome. */
const bareFieldset = { border: 0, margin: 0, padding: 0, minInlineSize: 'auto' as const };
/** Radix Select forbids an empty item value, so the "no stop" choice needs a sentinel. */
const WHOLE_TRIP = '__whole_trip__';
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

/** Text + icon status of the hard gate that gates supplier search and publishing. */
function StructureGateBadge({ accepted, size = '2' }: { accepted: boolean; size?: '1' | '2' }) {
  return (
    <Badge size={size} variant="soft" color={accepted ? 'green' : 'amber'}>
      {accepted ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <CircleDashed size={13} aria-hidden="true" />
      )}
      {accepted ? 'Structure accepted' : 'Structure not accepted'}
    </Badge>
  );
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
  /* The composer moved to the home page, so this index has no field a carried brief could seed.
     Forward rather than silently dropping the text — older links and bookmarks still exist. */
  useEffect(() => {
    if (id) return;
    const carried = search.get('q');
    if (carried) navigate(`/?q=${encodeURIComponent(carried)}`, { replace: true });
  }, [id, search, navigate]);
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
      <Flex align="center" justify="center" style={{ minHeight: '60vh' }}>
        <Spinner label="Opening your agent workspace…" />
      </Flex>
    );
  /* Exactly one solid Button is live at a time: the chat composer owns it until a route
     exists, then the canvas action for the open tab owns it. */
  const routeStarted = !!workspace?.stops.length;
  const stageIndex = workspace ? Math.max(0, stages.indexOf(workspace.stage)) : 0;
  return (
    <Box asChild maxWidth="1600px" mx="auto" px={{ initial: '4', sm: '6' }} pt="6" pb="9">
      <section>
        <Flex align="start" justify="between" gap="4" wrap="wrap" mb="5">
          <Box>
            <Text size="1" color="gray" asChild>
              <Link
                to="/studio"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
              >
                <ArrowLeft size={15} /> Agent Studio
              </Link>
            </Text>
            <Heading as="h1" size="7" mt="2">
              {workspace?.title || 'Every proposal, in one place.'}
            </Heading>
          </Box>
          <Button size="3" variant="soft" color="gray" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={16} /> Agency settings
          </Button>
        </Flex>
        {error && (
          <Callout.Root color="red" role="alert" mb="4">
            <Callout.Icon>
              <CircleAlert size={16} />
            </Callout.Icon>
            <Flex align="center" justify="between" gap="4" wrap="wrap" width="100%">
              <Callout.Text>{error}</Callout.Text>
              <Button size="3" variant="soft" color="red" onClick={() => setError('')}>
                Dismiss
              </Button>
            </Flex>
          </Callout.Root>
        )}
        {!workspace && !id ? (
          /* The index, and only the index: every proposal an agent has started, with its stage,
             when it last moved and a way to remove it. A proposal now begins in the one composer
             on the home page, so this page no longer offers a second one. */
          <Box maxWidth="1040px" mx="auto" my="7">
            <Box asChild>
              <section>
                <Flex align="center" justify="between" gap="3" mb="4">
                  <Heading as="h2" size="6">
                    Your workspaces
                  </Heading>
                  <Badge size="2" color="gray" variant="soft">
                    {workspaces.length}
                  </Badge>
                </Flex>
                {!workspaces.length && (
                  /* With no list and no composer, this is the whole page: it has to say where a
                     proposal begins and take the agent there. */
                  <Card size="3" variant="surface">
                    <Flex direction="column" align="start" gap="4">
                      <Text as="p" size="2" color="gray">
                        Your client briefs and proposals will appear here.
                      </Text>
                      <Button size="3" asChild>
                        <Link to="/">
                          <Plus size={16} /> Start a proposal
                        </Link>
                      </Button>
                    </Flex>
                  </Card>
                )}
                <Grid columns={{ initial: '1', sm: '2', lg: '3' }} gap="4">
                  {workspaces.map((item) => (
                    <Card asChild size="2" key={item.id}>
                      <article>
                        <Link to={`/studio/${item.id}`} style={{ display: 'block' }}>
                          <Text size="1" color="gray">
                            {item.brief.clientName || 'Client not named'}
                          </Text>
                          <Heading as="h3" size="4" my="2">
                            {item.title}
                          </Heading>
                          <Text as="p" size="2" color="gray">
                            {item.stops.map((stop) => stop.name).join(' → ') || 'Brief in progress'}
                          </Text>
                        </Link>
                        <Flex align="center" justify="between" gap="2" mt="4" wrap="wrap">
                          <Badge color="gray" variant="soft">
                            {stageLabels[stages.indexOf(item.stage)]}
                          </Badge>
                          <Flex align="center" gap="2">
                            <Text size="1" color="gray">
                              {readableDate(item.updatedAt.slice(0, 10))}
                            </Text>
                            <IconButton
                              size="3"
                              variant="soft"
                              color="gray"
                              aria-label={`Delete workspace ${item.title}`}
                              disabled={!!busy}
                              onClick={() => setDeleting(item)}
                            >
                              <Trash2 size={15} />
                            </IconButton>
                          </Flex>
                        </Flex>
                      </article>
                    </Card>
                  ))}
                </Grid>
              </section>
            </Box>
          </Box>
        ) : workspace ? (
          <>
            <Card size="2" mb="4">
              <Flex direction="column" gap="3">
                <Flex align="center" justify="between" gap="3" wrap="wrap">
                  <Text size="2" weight="medium">
                    Step {stageIndex + 1} of {stageLabels.length} · {stageLabels[stageIndex]}
                  </Text>
                  <StructureGateBadge accepted={workspace.structureAccepted} />
                </Flex>
                <Flex asChild align="center" gap="2" wrap="wrap">
                  <nav aria-label="Workspace stages">
                    {stageLabels.map((label, index) => {
                      const current = workspace.stage === stages[index];
                      const done = index < stageIndex;
                      return (
                        <Flex
                          key={label}
                          align="center"
                          gap="2"
                          aria-current={current ? 'step' : undefined}
                        >
                          <Badge
                            size="2"
                            variant={current ? 'solid' : 'soft'}
                            color={done ? 'green' : current ? undefined : 'gray'}
                          >
                            {done ? <Check size={12} aria-hidden="true" /> : index + 1} {label}
                          </Badge>
                          {index < 4 && <Separator orientation="horizontal" size="1" />}
                        </Flex>
                      );
                    })}
                  </nav>
                </Flex>
              </Flex>
            </Card>
            <Grid
              columns={{ initial: '1', md: 'minmax(290px, 370px) minmax(0, 1fr)' }}
              gap="5"
              align="start"
            >
              <Box asChild position={{ initial: 'static', md: 'sticky' }} top="5">
                <aside aria-label="Planning conversation">
                  <Card size="2">
                    <Flex direction="column" gap="3">
                      <Flex align="center" gap="3">
                        <TaraMark size={23} />
                        <Box flexGrow="1">
                          <Heading as="h2" size="3">
                            Work with Tara
                          </Heading>
                          <Text size="1" color="gray">
                            One layer at a time.
                          </Text>
                        </Box>
                        <IconButton
                          size="3"
                          variant="soft"
                          color="gray"
                          aria-label="Edit client brief"
                          onClick={() => setBriefOpen(true)}
                          disabled={!!busy || routeDirty}
                        >
                          <Settings2 size={18} />
                        </IconButton>
                      </Flex>
                      <Separator size="4" />
                      <Box
                        role="log"
                        aria-live="polite"
                        maxHeight="430px"
                        overflowY="auto"
                        style={{ overflowWrap: 'anywhere' }}
                      >
                        <Flex direction="column" gap="3">
                          {!workspace.messages.length && (
                            <Text as="p" size="2" color="gray">
                              Share the client’s request and what you already know. I’ll review it
                              with you before we build the route.
                            </Text>
                          )}
                          {workspace.messages.map((item) => (
                            <Card
                              asChild
                              key={item.id}
                              size="1"
                              variant={item.role === 'user' ? 'classic' : 'surface'}
                              ml={item.role === 'user' ? '4' : '0'}
                            >
                              <article>
                                <Text as="div" size="1" weight="bold" color="gray">
                                  {item.role === 'assistant' ? 'Tara' : 'You'}
                                </Text>
                                <Text as="p" size="2" mt="1" style={{ whiteSpace: 'pre-wrap' }}>
                                  {item.content}
                                </Text>
                              </article>
                            </Card>
                          ))}
                        </Flex>
                      </Box>
                      <form onSubmit={submit}>
                        <Flex direction="column" gap="2">
                          <Text as="label" htmlFor="studio-message" size="2" weight="medium">
                            {workspace.messages.length
                              ? 'Reply or refine the route'
                              : 'Client request or planning notes'}
                          </Text>
                          <TextArea
                            size="3"
                            id="studio-message"
                            rows={4}
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            maxLength={16000}
                            placeholder="Tell me about the trip, or ask for a change…"
                            disabled={!!busy || routeDirty}
                          />
                          <Button
                            size="3"
                            variant={routeStarted ? 'soft' : 'solid'}
                            loading={!!busy}
                            disabled={
                              !!busy || routeDirty || (!message.trim() && !workspace.imports.length)
                            }
                          >
                            {busy ||
                              (!message.trim() && workspace.imports.length
                                ? 'Review saved sources'
                                : workspace.messages.length
                                  ? 'Send to Tara'
                                  : 'Review brief')}
                            <Send size={15} />
                          </Button>
                        </Flex>
                      </form>
                      {routeDirty && (
                        <Callout.Root color="amber" size="1">
                          <Callout.Icon>
                            <CircleAlert size={16} />
                          </Callout.Icon>
                          <Callout.Text>
                            Save or discard the route edits before asking Tara for another change.
                          </Callout.Text>
                        </Callout.Root>
                      )}
                      <StudioImportComposer
                        workspace={workspace}
                        onChange={receivedWorkspace}
                        disabled={!!busy || routeDirty}
                      />
                      {!!workspace.brief.clientName && (
                        <>
                          <Separator size="4" />
                          <Reset>
                            <details>
                              <Reset>
                                <summary style={{ cursor: 'pointer' }}>
                                  <Text size="2" weight="medium">
                                    Client context · {workspace.brief.clientName}
                                  </Text>
                                </summary>
                              </Reset>
                              <Box mt="2">
                                <Text as="p" size="2" color="gray">
                                  {workspace.brief.context || 'No background context added yet.'}
                                </Text>
                                {clients
                                  .filter(
                                    (c) =>
                                      c.name.toLocaleLowerCase() ===
                                      workspace.brief.clientName.toLocaleLowerCase(),
                                  )
                                  .flatMap((c) => c.previousWorkspaces)
                                  .filter((w) => w.id !== workspace.id)
                                  .map((previous) => (
                                    <Text key={previous.id} size="2" asChild>
                                      <Link
                                        to={`/studio/${previous.id}`}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 'var(--space-1)',
                                          paddingBlock: 'var(--space-2)',
                                        }}
                                      >
                                        {previous.title} <ChevronRight size={12} />
                                      </Link>
                                    </Text>
                                  ))}
                                <Text as="p" size="1" color="gray" mt="2">
                                  Confirm the travelling party for every new trip.
                                </Text>
                              </Box>
                            </details>
                          </Reset>
                        </>
                      )}
                    </Flex>
                  </Card>
                </aside>
              </Box>
              <Box minWidth="0">
                <BriefReview
                  workspace={workspace}
                  onAnswer={setMessage}
                  onEdit={() => {
                    if (!routeDirty) setBriefOpen(true);
                    else setError('Save or discard your route edits before editing the brief.');
                  }}
                />
                <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
                  <Tabs.List aria-label="Plan details">
                    {['structure', 'services', 'recommendations', 'proposal'].map((tab) => {
                      const gated = tab !== 'structure' && !workspace.structureAccepted;
                      return (
                        <Tabs.Trigger key={tab} value={tab} disabled={routeDirty || gated}>
                          <Flex align="center" gap="1">
                            {gated && <Lock size={12} aria-hidden="true" />}
                            {tab[0].toUpperCase() + tab.slice(1)}
                          </Flex>
                        </Tabs.Trigger>
                      );
                    })}
                  </Tabs.List>
                  <Box pt="4">
                    <Tabs.Content value="structure">
                      <RouteEditor
                        key={`${workspace.id}:${workspace.revision}`}
                        workspace={workspace}
                        disabled={!!busy}
                        onSave={patch}
                        onDirty={setRouteDirty}
                      />
                      <Card size="3" mt="5">
                        {workspace.stage === 'brief' || !workspace.stops.length ? (
                          <Flex direction="column" gap="3" align="start">
                            <Text as="p" size="2">
                              {workspace.stops.length
                                ? 'Continue with this draft route using what you know. Unconfirmed details stay open.'
                                : 'Tell Tara the destinations you have in mind, or add and save the first stop above.'}
                            </Text>
                            <Button
                              size="3"
                              variant={routeStarted && !routeDirty ? 'solid' : 'soft'}
                              loading={!!busy}
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
                            </Button>
                          </Flex>
                        ) : !workspace.structureAccepted ? (
                          <Flex direction="column" gap="3" align="start">
                            <StructureGateBadge accepted={false} />
                            <Text as="p" size="2">
                              Review the destinations, nights and dates. Accept this structure when
                              you are ready to add services.
                            </Text>
                            <Flex gap="3" wrap="wrap" align="center">
                              <Button
                                size="3"
                                variant={routeDirty ? 'soft' : 'solid'}
                                loading={!!busy}
                                disabled={!!busy || routeDirty}
                                onClick={() =>
                                  void act('Accepting structure', async () => {
                                    await mutate('/accept-structure', {});
                                    setActiveTab('services');
                                  })
                                }
                              >
                                Accept structure <Check size={16} />
                              </Button>
                              <Button
                                size="3"
                                variant="soft"
                                color="gray"
                                disabled={!!busy || routeDirty}
                                onClick={() => {
                                  setMessage(
                                    'Suggest an alternative route using this brief. Keep the confirmed requirements.',
                                  );
                                  document.getElementById('studio-message')?.focus();
                                }}
                              >
                                Ask Tara for another route
                              </Button>
                            </Flex>
                          </Flex>
                        ) : (
                          <Callout.Root color="green">
                            <Callout.Icon>
                              <Check size={17} />
                            </Callout.Icon>
                            <Callout.Text>
                              Structure accepted. Choose the services or recommendations you want to
                              add.
                            </Callout.Text>
                          </Callout.Root>
                        )}
                      </Card>
                    </Tabs.Content>
                    <Tabs.Content value="services">
                      {workspace.structureAccepted && (
                        <ServicesPanel
                          workspace={workspace}
                          disabled={!!busy}
                          onSave={patch}
                          onImport={() =>
                            document
                              .getElementById('studio-import-composer')
                              ?.scrollIntoView({ behavior: 'smooth' })
                          }
                          onChange={receivedWorkspace}
                        />
                      )}
                    </Tabs.Content>
                    <Tabs.Content value="recommendations">
                      {workspace.structureAccepted && (
                        <RecommendationsPanel
                          workspace={workspace}
                          disabled={!!busy}
                          onSave={patch}
                          onGenerate={async (body) => {
                            await act('Researching recommendations', async () => {
                              await mutate('/recommendations', {
                                ...body,
                                requestId: crypto.randomUUID(),
                              });
                            });
                          }}
                        />
                      )}
                    </Tabs.Content>
                    <Tabs.Content value="proposal">
                      {workspace.structureAccepted && agency && (
                        <StudioProposalControls
                          workspace={workspace}
                          agency={agency}
                          onUpdate={receivedWorkspace}
                          onAgencyUpdate={setAgency}
                          onError={setError}
                        />
                      )}
                    </Tabs.Content>
                  </Box>
                </Tabs.Root>
              </Box>
            </Grid>
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
          <Text as="p" size="2" color="gray">
            This workspace could not be loaded. <Link to="/studio">Return to Agent Studio.</Link>
          </Text>
        )}
        {deleting && (
          <Modal title="Delete this workspace?" onClose={() => setDeleting(null)}>
            <Text as="p" size="2" color="gray" mb="4">
              This removes “{deleting.title}”, its private sources and any published proposal link.
            </Text>
            <Flex gap="3" wrap="wrap">
              <Button
                size="3"
                color="red"
                loading={!!busy}
                disabled={!!busy}
                onClick={() =>
                  void act('Deleting workspace', async () => {
                    await api(`/studio/workspaces/${deleting.id}`, { method: 'DELETE' });
                    setWorkspaces((current) => current.filter((item) => item.id !== deleting.id));
                    setDeleting(null);
                  })
                }
              >
                <Trash2 size={15} /> Delete workspace
              </Button>
              <Button size="3" variant="soft" color="gray" onClick={() => setDeleting(null)}>
                Keep workspace
              </Button>
            </Flex>
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
    </Box>
  );
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
    <Card asChild size="3" mb="4">
      <section aria-label="Brief review">
        <Flex align="start" justify="between" gap="3" wrap="wrap">
          <Box>
            <Text size="1" color="gray">
              Brief review
            </Text>
            <Heading as="h2" size="6" mt="1">
              {qualification.score >= 80
                ? 'A clear starting point.'
                : qualification.score >= 40
                  ? 'Taking shape.'
                  : 'Let’s find the starting point.'}
            </Heading>
          </Box>
          <Badge
            size="2"
            variant="soft"
            color={
              qualification.score >= 80 ? 'green' : qualification.score >= 40 ? 'blue' : 'gray'
            }
          >
            {qualification.score}% complete
          </Badge>
        </Flex>
        <Box mt="3">
          <Progress
            size="3"
            value={qualification.score}
            max={100}
            aria-label="Brief completeness"
          />
        </Box>
        {!!qualification.known.length && (
          <DataList.Root mt="4" orientation={{ initial: 'vertical', sm: 'horizontal' }}>
            {qualification.known.map((fact) => (
              <DataList.Item key={fact.id}>
                <DataList.Label minWidth="140px">
                  <Flex align="center" gap="1">
                    <Check size={13} aria-hidden="true" />
                    {fact.label}
                  </Flex>
                </DataList.Label>
                <DataList.Value>
                  <Text size="2" style={{ overflowWrap: 'anywhere' }}>
                    {fact.value}
                  </Text>
                </DataList.Value>
              </DataList.Item>
            ))}
          </DataList.Root>
        )}
        {!!qualification.questions.length && (
          <Box mt="4">
            <Reset>
              <details open={!workspace.structureAccepted}>
                <Reset>
                  <summary style={{ cursor: 'pointer' }}>
                    <Text size="2" weight="medium">
                      {qualification.questions.length}{' '}
                      {qualification.questions.length === 1 ? 'detail' : 'details'} to clarify{' '}
                      {qualification.skipped && '· skipped for now'}
                    </Text>
                  </summary>
                </Reset>
                {/* The list's own `margin: 0` reset beats Radix's `mt` utility class, so the
                    space below the summary has to be set inline. It clears the ghost buttons'
                    own negative margins, which would otherwise let the first question's hover
                    box overlap the summary above it. */}
                <Grid asChild gap="5">
                  <ul
                    style={{
                      listStyle: 'none',
                      margin: 0,
                      marginTop: 'var(--space-5)',
                      padding: 0,
                    }}
                  >
                    {qualification.questions.map((question) => (
                      <li key={question.id} style={{ listStyle: 'none' }}>
                        <Flex direction="column" align="start" gap="1">
                          <Button
                            size="3"
                            variant="ghost"
                            onClick={() => {
                              onAnswer(`${question.label}\n`);
                              document.getElementById('studio-message')?.focus();
                            }}
                          >
                            {question.label}
                          </Button>
                          <Text size="1" color="gray">
                            {question.reason}
                          </Text>
                        </Flex>
                      </li>
                    ))}
                  </ul>
                </Grid>
                <Text as="p" size="1" color="gray" mt="3">
                  You can answer in chat or continue with incomplete details.
                </Text>
              </details>
            </Reset>
          </Box>
        )}
        {/* mt-4 rather than mt-3: the ghost's own -6px margin comes off the top, and this
            control sits directly under the details summary, which is a target too. */}
        <Box mt="4">
          <Button size="3" variant="ghost" color="gray" onClick={onEdit}>
            Edit brief details <Settings2 size={13} />
          </Button>
        </Box>
      </section>
    </Card>
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
    <Box asChild>
      <section aria-label="Route structure">
        <Flex align="center" justify="between" gap="3" mb="4" wrap="wrap">
          <Box>
            <Heading as="h2" size="6">
              The shape of the journey
            </Heading>
            <Text as="p" size="2" color="gray" mt="1">
              {stops.length
                ? `${stops.length} destinations · ${totalNights} nights${stops.some((s) => s.nights === null) ? ' confirmed so far' : ''}`
                : 'Destinations, dates and how they connect.'}
            </Text>
          </Box>
          <MapPin size={24} aria-hidden="true" />
        </Flex>
        {!stops.length && (
          <Card size="3" variant="surface">
            <Flex direction="column" align="center" gap="3" py="5">
              <TaraMark size={32} />
              <Text as="p" size="2" color="gray" align="center">
                Your route will appear here.
                <br />
                Start with a brief or add your first destination.
              </Text>
            </Flex>
          </Card>
        )}
        <Grid asChild gap="4">
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {stops.map((stop, index) => (
              <Card asChild key={stop.id} size="2">
                <li
                  style={{ listStyle: 'none' }}
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
                  <Flex align="center" gap="2" wrap="wrap">
                    <Badge size="2" radius="full" color="gray" variant="soft">
                      {index + 1}
                    </Badge>
                    <Flex
                      align="center"
                      justify="center"
                      style={{ width: 40, height: 40, cursor: disabled ? 'default' : 'grab' }}
                      aria-hidden="true"
                    >
                      <GripVertical size={18} />
                    </Flex>
                    <Text size="2" weight="bold">
                      {stop.name || 'New destination'}
                    </Text>
                    <Flex gap="2" ml="auto">
                      <IconButton
                        size="3"
                        variant="soft"
                        color="gray"
                        aria-label={`Move ${stop.name || 'destination'} up`}
                        disabled={disabled || index === 0}
                        onClick={() => move(index, index - 1)}
                      >
                        <ArrowUp size={16} />
                      </IconButton>
                      <IconButton
                        size="3"
                        variant="soft"
                        color="gray"
                        aria-label={`Move ${stop.name || 'destination'} down`}
                        disabled={disabled || index === stops.length - 1}
                        onClick={() => move(index, index + 1)}
                      >
                        <ArrowDown size={16} />
                      </IconButton>
                      <IconButton
                        size="3"
                        variant="soft"
                        color="gray"
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
                      </IconButton>
                    </Flex>
                  </Flex>
                  <Separator size="4" my="3" />
                  <Reset>
                    <fieldset disabled={disabled} style={bareFieldset}>
                      <Grid columns={{ initial: '1', sm: '2', lg: '3' }} gap="3">
                        <label>
                          <Text as="div" size="2" weight="medium" mb="1">
                            Destination
                          </Text>
                          <TextField.Root
                            size="3"
                            aria-label={`Destination ${index + 1}`}
                            value={stop.name}
                            maxLength={120}
                            onChange={(e) => update(stop.id, { name: e.target.value })}
                          />
                        </label>
                        <label>
                          <Text as="div" size="2" weight="medium" mb="1">
                            Country
                          </Text>
                          <TextField.Root
                            size="3"
                            aria-label={`Country ${index + 1}`}
                            value={stop.country}
                            maxLength={100}
                            onChange={(e) => update(stop.id, { country: e.target.value })}
                          />
                        </label>
                        <Box>
                          <Text as="div" size="2" weight="medium" mb="1">
                            Nights
                          </Text>
                          <Flex align="center" gap="2">
                            <IconButton
                              size="3"
                              variant="soft"
                              color="gray"
                              aria-label={`Decrease nights in ${stop.name}`}
                              disabled={disabled || !stop.nights}
                              onClick={() =>
                                update(stop.id, { nights: Math.max(0, (stop.nights || 0) - 1) })
                              }
                            >
                              <Minus size={16} />
                            </IconButton>
                            <TextField.Root
                              size="3"
                              style={{ flexGrow: 1, minWidth: 64 }}
                              type="number"
                              aria-label={`Nights in ${stop.name || `destination ${index + 1}`}`}
                              min={0}
                              max={120}
                              value={stop.nights ?? ''}
                              placeholder="TBC"
                              onChange={(e) =>
                                update(stop.id, { nights: numberOrNull(e.target.value) })
                              }
                            />
                            <IconButton
                              size="3"
                              variant="soft"
                              color="gray"
                              aria-label={`Increase nights in ${stop.name}`}
                              onClick={() =>
                                update(stop.id, { nights: Math.min(120, (stop.nights || 0) + 1) })
                              }
                            >
                              <Plus size={16} />
                            </IconButton>
                          </Flex>
                        </Box>
                        <label>
                          <Text as="div" size="2" weight="medium" mb="1">
                            Arrival
                          </Text>
                          <TextField.Root
                            size="3"
                            type="date"
                            aria-label={`Arrival in ${stop.name}`}
                            value={stop.arrivalDate}
                            onChange={(e) =>
                              update(stop.id, {
                                arrivalDate: e.target.value,
                                arrivalFixed: !!e.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          <Text as="div" size="2" weight="medium" mb="1">
                            Departure
                          </Text>
                          <TextField.Root
                            size="3"
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
                                          (Date.parse(e.target.value) -
                                            Date.parse(stop.arrivalDate)) /
                                            86400000,
                                        ),
                                      )
                                    : null,
                              })
                            }
                          />
                        </label>
                        <Box>
                          <Text as="div" size="2" weight="medium" mb="1">
                            Onward transport
                          </Text>
                          <Select.Root
                            size="3"
                            disabled={disabled}
                            value={stop.onwardTransport}
                            onValueChange={(value) =>
                              update(stop.id, { onwardTransport: value as TransportMode })
                            }
                          >
                            <Select.Trigger
                              aria-label={`Onward transport from ${stop.name}`}
                              style={{ width: '100%' }}
                            />
                            <Select.Content>
                              {[
                                'undecided',
                                'flight',
                                'train',
                                'car',
                                'ferry',
                                'coach',
                                'other',
                              ].map((mode) => (
                                <Select.Item value={mode} key={mode}>
                                  {mode === 'undecided'
                                    ? 'To decide'
                                    : mode[0].toUpperCase() + mode.slice(1)}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select.Root>
                        </Box>
                        <Text as="label" size="2" style={spanAll}>
                          <Flex align="center" gap="2" style={{ minHeight: 44 }}>
                            <Checkbox
                              size="3"
                              checked={!!stop.arrivalFixed}
                              aria-label={`Keep arrival in ${stop.name} fixed`}
                              onCheckedChange={(checked) =>
                                update(stop.id, { arrivalFixed: checked === true })
                              }
                            />{' '}
                            Keep this arrival date fixed when the route changes
                          </Flex>
                        </Text>
                        <label style={spanAll}>
                          <Text as="div" size="2" weight="medium" mb="1">
                            Preferred neighbourhood
                          </Text>
                          <TextField.Root
                            size="3"
                            aria-label={`Neighbourhood in ${stop.name}`}
                            value={stop.neighbourhood}
                            maxLength={300}
                            placeholder="Central, near a station, or a specific area"
                            onChange={(e) => update(stop.id, { neighbourhood: e.target.value })}
                          />
                        </label>
                        <label style={spanAll}>
                          <Text as="div" size="2" weight="medium" mb="1">
                            Route notes
                          </Text>
                          <TextField.Root
                            size="3"
                            aria-label={`Notes for ${stop.name}`}
                            value={stop.notes}
                            maxLength={1000}
                            onChange={(e) => update(stop.id, { notes: e.target.value })}
                          />
                        </label>
                      </Grid>
                    </fieldset>
                  </Reset>
                </li>
              </Card>
            ))}
          </ol>
        </Grid>
        <Flex align="center" gap="3" wrap="wrap" mt="4" mb="2">
          <Button
            size="3"
            variant="soft"
            color="gray"
            disabled={disabled || stops.length >= 20}
            onClick={() => setStops(routeDates([...stops, blankStop()], workspace.brief.startDate))}
          >
            <Plus size={15} /> Add destination
          </Button>
          {dirty && (
            <>
              <Button
                size="3"
                disabled={disabled || stops.some((s) => !s.name.trim())}
                onClick={() => void onSave({ stops }).catch((cause) => setSaveError(cause.message))}
              >
                Save route changes
              </Button>
              <Button
                size="3"
                variant="soft"
                color="gray"
                disabled={disabled}
                onClick={() => setStops(workspace.stops)}
              >
                Discard changes
              </Button>
            </>
          )}
        </Flex>
        {saveError && (
          <Callout.Root color="red" role="alert" mt="3">
            <Callout.Icon>
              <CircleAlert size={16} />
            </Callout.Icon>
            <Callout.Text>{saveError}</Callout.Text>
          </Callout.Root>
        )}
        {dirty && (
          <Callout.Root color="amber" size="1" mt="3">
            <Callout.Icon>
              <CircleAlert size={16} />
            </Callout.Icon>
            <Callout.Text>
              Save your edits before accepting the structure. Dates may need adjusting after a
              reorder. Changing the route requires accepting it again.
            </Callout.Text>
          </Callout.Root>
        )}
      </section>
    </Box>
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
    <Card asChild size="3">
      <section aria-label="Proposal services">
        <Heading as="h2" size="6">
          What would you like help with?
        </Heading>
        <Text as="p" size="2" color="gray" mt="2" mb="4">
          Add a service you have arranged, import a confirmation, or include a quote in the
          proposal.
        </Text>
        <Flex align="center" gap="3" wrap="wrap">
          <Button size="3" disabled={disabled} onClick={() => setEditing('new')}>
            <Plus size={15} /> Add a service
          </Button>
          <Button size="3" variant="soft" color="gray" onClick={onImport}>
            Import a booking or PNR
          </Button>
        </Flex>
        <Text as="p" size="2" color="gray" mt="3">
          Adding an item prepares the proposal. It does not make a booking.
        </Text>
        <SupplierQuotes workspace={workspace} disabled={disabled} onChange={onChange} />
        <Flex direction="column" gap="3" mt="5">
          {!workspace.items.length && (
            <Card size="2" variant="surface">
              <Text as="p" size="2" color="gray">
                No services added yet. Hotels, flights, tours, cruises, transfers and insurance can
                all sit alongside the route.
              </Text>
            </Card>
          )}
          {workspace.items.map((item) => (
            <Card asChild key={item.id} size="2">
              <article>
                <Flex justify="between" gap="4" direction={{ initial: 'column', sm: 'row' }}>
                  <Box>
                    <Flex align="center" gap="2" wrap="wrap">
                      <Badge color="gray" variant="soft">
                        {item.kind}
                      </Badge>
                      <Badge color="gray" variant="soft">
                        {item.status.replaceAll('_', ' ')}
                      </Badge>
                      {item.needsReview && (
                        <Badge color="amber" variant="soft">
                          <CircleAlert size={12} aria-hidden="true" /> Review required
                        </Badge>
                      )}
                    </Flex>
                    <Heading as="h3" size="4" mt="2" mb="1">
                      {item.title}
                    </Heading>
                    <Text as="p" size="2" color="gray" style={{ whiteSpace: 'pre-wrap' }}>
                      {item.description}
                    </Text>
                    <Text as="p" size="1" color="gray" mt="2">
                      {item.price === null
                        ? 'Unpriced'
                        : `${money(item.price, item.currency)} ${item.currency}`}{' '}
                      · {item.priceStatus.replaceAll('_', ' ')}
                      {item.needsReview ? ' · Review required' : ''}
                    </Text>
                  </Box>
                  <Flex
                    direction={{ initial: 'row', sm: 'column' }}
                    align={{ initial: 'center', sm: 'end' }}
                    justify="between"
                    gap="3"
                    minWidth="100px"
                  >
                    <Text as="label" size="2">
                      <Flex align="center" gap="2" style={{ minHeight: 44 }}>
                        <Checkbox
                          size="3"
                          checked={item.included}
                          disabled={disabled}
                          onCheckedChange={(checked) =>
                            void onSave({
                              items: workspace.items.map((i) =>
                                i.id === item.id ? { ...i, included: checked === true } : i,
                              ),
                            }).catch(() => {})
                          }
                        />{' '}
                        In proposal
                      </Flex>
                    </Text>
                    <Button
                      size="3"
                      variant="soft"
                      color="gray"
                      disabled={disabled}
                      onClick={() => setEditing(item)}
                    >
                      Edit service
                    </Button>
                    <IconButton
                      size="3"
                      variant="soft"
                      color="gray"
                      aria-label={`Remove ${item.title}`}
                      disabled={disabled}
                      onClick={() =>
                        void onSave({
                          items: workspace.items.filter((i) => i.id !== item.id),
                        }).catch(() => {})
                      }
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </Flex>
                </Flex>
              </article>
            </Card>
          ))}
        </Flex>
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
    </Card>
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
        <Grid columns={{ initial: '1', sm: '2' }} gap="3" mt="4">
          <Box>
            <Text as="div" size="2" weight="medium" mb="1">
              Service type
            </Text>
            <Select.Root
              size="3"
              value={draft.kind}
              onValueChange={(value) => change({ kind: value as StudioItem['kind'] })}
            >
              <Select.Trigger aria-label="Service type" style={{ width: '100%' }} />
              <Select.Content>
                {['hotel', 'flight', 'tour', 'cruise', 'transfer', 'insurance', 'other'].map(
                  (kind) => (
                    <Select.Item key={kind} value={kind}>
                      {kind[0].toUpperCase() + kind.slice(1)}
                    </Select.Item>
                  ),
                )}
              </Select.Content>
            </Select.Root>
          </Box>
          <Box>
            <Text as="div" size="2" weight="medium" mb="1">
              Destination
            </Text>
            <Select.Root
              size="3"
              value={draft.stopId || WHOLE_TRIP}
              onValueChange={(value) => change({ stopId: value === WHOLE_TRIP ? '' : value })}
            >
              <Select.Trigger aria-label="Destination" style={{ width: '100%' }} />
              <Select.Content>
                <Select.Item value={WHOLE_TRIP}>Whole trip</Select.Item>
                {workspace.stops.map((s) => (
                  <Select.Item key={s.id} value={s.id}>
                    {s.name}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Box>
          <label style={spanAll}>
            <Text as="div" size="2" weight="medium" mb="1">
              Service name
            </Text>
            <TextField.Root
              size="3"
              required
              maxLength={300}
              value={draft.title}
              onChange={(e) => change({ title: e.target.value })}
            />
          </label>
          <label style={spanAll}>
            <Text as="div" size="2" weight="medium" mb="1">
              Description
            </Text>
            <TextArea
              size="3"
              rows={3}
              maxLength={4000}
              value={draft.description}
              onChange={(e) => change({ description: e.target.value })}
            />
          </label>
          <Box>
            <Text as="div" size="2" weight="medium" mb="1">
              Status
            </Text>
            <Select.Root
              size="3"
              value={draft.status}
              onValueChange={(value) => change({ status: value as StudioItem['status'] })}
            >
              <Select.Trigger aria-label="Status" style={{ width: '100%' }} />
              <Select.Content>
                <Select.Item value="suggested">Suggested · not booked</Select.Item>
                <Select.Item value="externally_booked">Already booked elsewhere</Select.Item>
                <Select.Item value="placeholder">Placeholder</Select.Item>
              </Select.Content>
            </Select.Root>
          </Box>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Supplier
            </Text>
            <TextField.Root
              size="3"
              maxLength={200}
              value={draft.supplier}
              onChange={(e) => change({ supplier: e.target.value })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Start date
            </Text>
            <TextField.Root
              size="3"
              type="date"
              value={draft.startDate}
              onChange={(e) => change({ startDate: e.target.value })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              End date
            </Text>
            <TextField.Root
              size="3"
              type="date"
              value={draft.endDate}
              onChange={(e) => change({ endDate: e.target.value })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Client price
            </Text>
            <TextField.Root
              size="3"
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
            <Text as="div" size="2" weight="medium" mb="1">
              Currency
            </Text>
            <TextField.Root
              size="3"
              required
              minLength={3}
              maxLength={3}
              value={draft.currency}
              readOnly={draft.source === 'liteapi'}
              onChange={(e) => change({ currency: e.target.value.toUpperCase() })}
            />
          </label>
          <Box>
            <Text as="div" size="2" weight="medium" mb="1">
              Price basis
            </Text>
            <Select.Root
              size="3"
              value={draft.priceStatus}
              disabled={draft.source === 'liteapi'}
              onValueChange={(value) => change({ priceStatus: value as StudioItem['priceStatus'] })}
            >
              <Select.Trigger aria-label="Price basis" style={{ width: '100%' }} />
              <Select.Content>
                <Select.Item value="unpriced">Unpriced</Select.Item>
                <Select.Item value="agent_estimate">Agent estimate</Select.Item>
                {(draft.kind !== 'insurance' || draft.source === 'liteapi') && (
                  <>
                    <Select.Item value="supplier_quote">Supplier quote</Select.Item>
                    <Select.Item value="sandbox">Sandbox example</Select.Item>
                  </>
                )}
              </Select.Content>
            </Select.Root>
          </Box>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Internal cost · private
            </Text>
            <TextField.Root
              size="3"
              type="number"
              min={0}
              step="0.01"
              value={draft.cost ?? ''}
              onChange={(e) => change({ cost: numberOrNull(e.target.value) })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Booking reference · private
            </Text>
            <TextField.Root
              size="3"
              value={draft.privateReference}
              maxLength={300}
              onChange={(e) => change({ privateReference: e.target.value })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Source link
            </Text>
            <TextField.Root
              size="3"
              type="url"
              value={draft.sourceUrl}
              maxLength={2000}
              onChange={(e) => change({ sourceUrl: e.target.value })}
            />
          </label>
          {draft.kind === 'insurance' && (
            <Box style={spanAll}>
              <Callout.Root color="blue" size="1">
                <Callout.Icon>
                  <CircleAlert size={16} />
                </Callout.Icon>
                <Callout.Text>
                  Enter an agent estimate or a quote you obtained. Insurance pricing requires the
                  travellers’ ages and trip details; no policy is issued here.
                </Callout.Text>
              </Callout.Root>
            </Box>
          )}
          <Text as="label" size="2" style={spanAll}>
            <Flex align="center" gap="2" style={{ minHeight: 44 }}>
              <Checkbox
                size="3"
                checked={!draft.needsReview}
                onCheckedChange={(checked) => change({ needsReview: !(checked === true) })}
              />{' '}
              I have reviewed these service details
            </Flex>
          </Text>
          <>
            {formError && (
              <Box style={spanAll}>
                <Callout.Root color="red" role="alert">
                  <Callout.Icon>
                    <CircleAlert size={16} />
                  </Callout.Icon>
                  <Callout.Text>{formError}</Callout.Text>
                </Callout.Root>
              </Box>
            )}
          </>
          <Box style={spanAll}>
            <Button size="3" loading={saving} disabled={saving}>
              {saving ? 'Saving…' : 'Save service'}
            </Button>
          </Box>
        </Grid>
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
    <Card asChild size="3">
      <section aria-label="Recommendations">
        <Heading as="h2" size="6">
          A few thoughtful extras.
        </Heading>
        <Text as="p" size="2" color="gray" mt="2" mb="4">
          Add activity or food recommendations only where you need them. Your client decides how to
          spend each day.
        </Text>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onGenerate({ category, stopIds: selected, interests });
          }}
        >
          <Flex direction="column" gap="4" align="start">
            <Reset>
              <fieldset disabled={disabled} style={bareFieldset}>
                <Reset>
                  <legend>
                    <Text size="2" weight="medium">
                      Which destinations?
                    </Text>
                  </legend>
                </Reset>
                <Flex gap="4" wrap="wrap" mt="2">
                  {workspace.stops.map((stop) => (
                    <Text as="label" size="2" key={stop.id}>
                      <Flex align="center" gap="2" style={{ minHeight: 44 }}>
                        <Checkbox
                          size="3"
                          checked={selected.includes(stop.id)}
                          onCheckedChange={(checked) =>
                            setSelected(
                              checked === true
                                ? [...selected, stop.id]
                                : selected.filter((id) => id !== stop.id),
                            )
                          }
                        />
                        {stop.name}
                      </Flex>
                    </Text>
                  ))}
                </Flex>
              </fieldset>
            </Reset>
            <Grid columns={{ initial: '1', sm: '2' }} gap="3" width="100%">
              <Box>
                <Text as="div" size="2" weight="medium" mb="1">
                  Recommendation type
                </Text>
                <Select.Root
                  size="3"
                  value={category}
                  onValueChange={(value) => setCategory(value as 'activity' | 'food')}
                >
                  <Select.Trigger aria-label="Recommendation type" style={{ width: '100%' }} />
                  <Select.Content>
                    <Select.Item value="activity">Things to do</Select.Item>
                    <Select.Item value="food">Places to eat</Select.Item>
                  </Select.Content>
                </Select.Root>
              </Box>
              <label>
                <Text as="div" size="2" weight="medium" mb="1">
                  What would suit this client?
                </Text>
                <TextField.Root
                  size="3"
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
            </Grid>
            <Button size="3" disabled={disabled || !selected.length || !interests.trim()}>
              <Sparkles size={16} /> Research recommendations
            </Button>
          </Flex>
        </form>
        {workspace.recommendations.length > 0 && (
          <Callout.Root color="blue" size="1" mt="4" role="status">
            <Callout.Icon>
              <Sparkles size={16} />
            </Callout.Icon>
            <Callout.Text>
              Ready to review. Select the recommendations you want to include in the client
              proposal.
            </Callout.Text>
          </Callout.Root>
        )}
        <Flex direction="column" gap="5" mt="5">
          {workspace.stops.map((stop) => {
            const items = workspace.recommendations.filter((r) => r.stopId === stop.id);
            return items.length ? (
              <Box asChild key={stop.id}>
                <section>
                  <Heading as="h3" size="5" mb="3">
                    {stop.name}
                  </Heading>
                  <Flex direction="column" gap="3">
                    {items.map((item) => (
                      <Card asChild key={item.id} size="2">
                        <article>
                          <Text as="label" size="2">
                            <Flex align="center" gap="2" wrap="wrap" style={{ minHeight: 44 }}>
                              <Checkbox
                                size="3"
                                aria-label={`Include ${item.name} in client proposal`}
                                checked={item.included}
                                disabled={disabled}
                                onCheckedChange={(checked) =>
                                  void onSave({
                                    recommendations: workspace.recommendations.map((r) =>
                                      r.id === item.id ? { ...r, included: checked === true } : r,
                                    ),
                                  }).catch(() => {})
                                }
                              />
                              <Text weight="bold">{item.name}</Text>
                              <Box ml="auto">
                                <Badge
                                  color={item.included ? 'green' : 'gray'}
                                  variant="soft"
                                  size="1"
                                >
                                  {item.included ? (
                                    <Check size={11} aria-hidden="true" />
                                  ) : (
                                    <CircleDashed size={11} aria-hidden="true" />
                                  )}
                                  {item.included ? 'In proposal' : 'Include in proposal'}
                                </Badge>
                              </Box>
                            </Flex>
                          </Text>
                          <Text as="p" size="2" color="gray" mt="2">
                            {item.description}
                          </Text>
                          <Flex gap="3" wrap="wrap" mt="2">
                            {item.sources
                              .filter((source) => /^https?:\/\//i.test(source.url))
                              .map((source) => (
                                <Text key={source.url} size="1" asChild>
                                  <a href={source.url} target="_blank" rel="noreferrer">
                                    {source.label} ↗
                                  </a>
                                </Text>
                              ))}
                          </Flex>
                        </article>
                      </Card>
                    ))}
                  </Flex>
                </section>
              </Box>
            ) : null;
          })}
        </Flex>
      </section>
    </Card>
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
      <Text as="p" size="2" color="gray" mb="4">
        Keep undecided details blank. A returning client may have a different travelling party this
        time.
      </Text>
      <form
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
        <Grid columns={{ initial: '1', sm: '2' }} gap="3">
          <label style={spanAll}>
            <Text as="div" size="2" weight="medium" mb="1">
              Workspace title
            </Text>
            <TextField.Root
              size="3"
              required
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Client name
            </Text>
            <TextField.Root
              size="3"
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
            <Text as="div" size="2" weight="medium" mb="1">
              Departing from
            </Text>
            <TextField.Root
              size="3"
              value={brief.origin}
              maxLength={200}
              onChange={(e) => update({ origin: e.target.value })}
            />
          </label>
          <label style={spanAll}>
            <Text as="div" size="2" weight="medium" mb="1">
              Client context
            </Text>
            <TextArea
              size="3"
              rows={3}
              value={brief.context}
              maxLength={6000}
              onChange={(e) => update({ context: e.target.value })}
            />
          </label>
          {previous?.context && previous.context !== brief.context && (
            <Box style={spanAll}>
              <Button
                type="button"
                size="3"
                variant="soft"
                color="gray"
                onClick={() => update({ context: previous.context })}
              >
                Use this client’s previous background context
              </Button>
            </Box>
          )}
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Start date
            </Text>
            <TextField.Root
              size="3"
              type="date"
              value={brief.startDate}
              onChange={(e) => update({ startDate: e.target.value })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              End date
            </Text>
            <TextField.Root
              size="3"
              type="date"
              value={brief.endDate}
              onChange={(e) => update({ endDate: e.target.value })}
            />
          </label>
          <Text as="label" size="2" style={spanAll}>
            <Flex align="center" gap="2" style={{ minHeight: 44 }}>
              <Checkbox
                size="3"
                checked={brief.datesFlexible}
                onCheckedChange={(checked) => update({ datesFlexible: checked === true })}
              />{' '}
              Dates are flexible
            </Flex>
          </Text>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Adults
            </Text>
            <TextField.Root
              size="3"
              type="number"
              min={1}
              max={100}
              value={brief.adults ?? ''}
              onChange={(e) => update({ adults: numberOrNull(e.target.value) })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Children
            </Text>
            <TextField.Root
              size="3"
              type="number"
              min={0}
              max={30}
              value={brief.children ?? ''}
              onChange={(e) => update({ children: numberOrNull(e.target.value) })}
            />
          </label>
          {(brief.children || 0) > 0 && (
            <label style={spanAll}>
              <Text as="div" size="2" weight="medium" mb="1">
                Children’s ages · comma separated
              </Text>
              <TextField.Root
                size="3"
                value={childAges}
                pattern="[0-9, ]*"
                onChange={(e) => setChildAges(e.target.value)}
              />
            </label>
          )}
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Total group budget
            </Text>
            <TextField.Root
              size="3"
              type="number"
              min={0}
              value={brief.budget ?? ''}
              onChange={(e) => update({ budget: numberOrNull(e.target.value) })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Budget currency
            </Text>
            <TextField.Root
              size="3"
              minLength={3}
              maxLength={3}
              value={brief.currency}
              onChange={(e) => update({ currency: e.target.value.toUpperCase() })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Hotel standard
            </Text>
            <TextField.Root
              size="3"
              value={brief.hotelStandard}
              maxLength={300}
              placeholder="Boutique, 4 star, value…"
              onChange={(e) => update({ hotelStandard: e.target.value })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Hotel location
            </Text>
            <TextField.Root
              size="3"
              value={brief.hotelLocation}
              maxLength={300}
              placeholder="Central, by the station…"
              onChange={(e) => update({ hotelLocation: e.target.value })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Flight cabin
            </Text>
            <TextField.Root
              size="3"
              value={brief.cabin}
              maxLength={100}
              placeholder="Not discussed"
              onChange={(e) => update({ cabin: e.target.value })}
            />
          </label>
          <Box>
            <Text as="div" size="2" weight="medium" mb="1">
              Desired output
            </Text>
            <Select.Root
              size="3"
              value={brief.output}
              onValueChange={(value) => update({ output: value as StudioBrief['output'] })}
            >
              <Select.Trigger aria-label="Desired output" style={{ width: '100%' }} />
              <Select.Content>
                <Select.Item value="structure">Route structure</Select.Item>
                <Select.Item value="proposal">Client proposal</Select.Item>
              </Select.Content>
            </Select.Root>
          </Box>
          <label style={spanAll}>
            <Text as="div" size="2" weight="medium" mb="1">
              Interests · one per line
            </Text>
            <TextArea
              size="3"
              rows={2}
              value={brief.interests.join('\n')}
              onChange={(e) => update({ interests: e.target.value.split('\n') })}
            />
          </label>
          <label style={spanAll}>
            <Text as="div" size="2" weight="medium" mb="1">
              Requirements · one per line
            </Text>
            <TextArea
              size="3"
              rows={2}
              value={brief.requirements.join('\n')}
              onChange={(e) => update({ requirements: e.target.value.split('\n') })}
            />
          </label>
          <>
            {formError && (
              <Box style={spanAll}>
                <Callout.Root color="red" role="alert">
                  <Callout.Icon>
                    <CircleAlert size={16} />
                  </Callout.Icon>
                  <Callout.Text>{formError}</Callout.Text>
                </Callout.Root>
              </Box>
            )}
          </>
          <Box style={spanAll}>
            <Button size="3" loading={saving} disabled={saving}>
              Save brief
            </Button>
          </Box>
        </Grid>
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
    <Card size="2" mt="4" variant="surface">
      <Reset>
        <details>
          <Reset>
            <summary style={{ cursor: 'pointer' }}>
              <Text size="2" weight="medium">
                Find hotel or flight suggestions
              </Text>
            </summary>
          </Reset>
          <Box mt="3">
            <Text as="p" size="2" color="gray" mb="3">
              Search only when you need a quote. Select an option to add it to the proposal.
            </Text>
            <form onSubmit={(event) => void search(event)}>
              <Reset>
                <fieldset disabled={disabled || busy} style={bareFieldset}>
                  <Grid columns={{ initial: '1', sm: '2' }} gap="3">
                    <Box>
                      <Text as="div" size="2" weight="medium" mb="1">
                        Search for
                      </Text>
                      <Select.Root
                        size="3"
                        value={kind}
                        onValueChange={(value) => setKind(value as 'hotels' | 'flights')}
                      >
                        <Select.Trigger aria-label="Search for" style={{ width: '100%' }} />
                        <Select.Content>
                          <Select.Item value="hotels">Hotels</Select.Item>
                          <Select.Item value="flights">Flights</Select.Item>
                        </Select.Content>
                      </Select.Root>
                    </Box>
                    {kind === 'hotels' ? (
                      <>
                        <Box>
                          <Text as="div" size="2" weight="medium" mb="1">
                            Destination for hotel quotes
                          </Text>
                          <Select.Root
                            size="3"
                            value={stopId}
                            onValueChange={(value) => {
                              setStopId(value);
                              setQuotes([]);
                            }}
                          >
                            <Select.Trigger
                              aria-label="Destination for hotel quotes"
                              placeholder="Choose a destination"
                              style={{ width: '100%' }}
                            />
                            <Select.Content>
                              {workspace.stops.map((s) => (
                                <Select.Item key={s.id} value={s.id}>
                                  {s.name}
                                </Select.Item>
                              ))}
                            </Select.Content>
                          </Select.Root>
                        </Box>
                        <label>
                          <Text as="div" size="2" weight="medium" mb="1">
                            Guest nationality · two-letter code
                          </Text>
                          <TextField.Root
                            size="3"
                            required
                            pattern="[A-Za-z]{2}"
                            maxLength={2}
                            placeholder="e.g. AU"
                            value={nationality}
                            onChange={(e) => setNationality(e.target.value.toUpperCase())}
                          />
                        </label>
                        <Flex align="center">
                          <Text size="2" color="gray">
                            {stop?.arrivalDate && stop.departureDate
                              ? `${readableDate(stop.arrivalDate)} – ${readableDate(stop.departureDate)}`
                              : 'Set this stop’s exact stay dates first.'}
                            <br />
                            {workspace.brief.hotelStandard}{' '}
                            {workspace.brief.hotelLocation && `· ${workspace.brief.hotelLocation}`}
                          </Text>
                        </Flex>
                      </>
                    ) : (
                      <>
                        <Box>
                          <Text as="div" size="2" weight="medium" mb="1">
                            Cabin for this search
                          </Text>
                          <Select.Root
                            size="3"
                            required
                            value={cabin}
                            onValueChange={(value) => setCabin(value)}
                          >
                            <Select.Trigger
                              aria-label="Cabin for this search"
                              placeholder="Choose cabin"
                              style={{ width: '100%' }}
                            />
                            <Select.Content>
                              <Select.Item value="economy">Economy</Select.Item>
                              <Select.Item value="premium_economy">Premium economy</Select.Item>
                              <Select.Item value="business">Business</Select.Item>
                              <Select.Item value="first">First</Select.Item>
                            </Select.Content>
                          </Select.Root>
                        </Box>
                        <label>
                          <Text as="div" size="2" weight="medium" mb="1">
                            Origin airport code
                          </Text>
                          <TextField.Root
                            size="3"
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
                          <Text as="div" size="2" weight="medium" mb="1">
                            Destination airport code
                          </Text>
                          <TextField.Root
                            size="3"
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
                          <Text as="div" size="2" weight="medium" mb="1">
                            Flight departure date
                          </Text>
                          <TextField.Root
                            size="3"
                            required
                            type="date"
                            value={departureDate}
                            onChange={(e) => setDepartureDate(e.target.value)}
                          />
                        </label>
                        <label>
                          <Text as="div" size="2" weight="medium" mb="1">
                            Return date · optional
                          </Text>
                          <TextField.Root
                            size="3"
                            type="date"
                            min={departureDate || undefined}
                            value={returnDate}
                            onChange={(e) => setReturnDate(e.target.value)}
                          />
                        </label>
                      </>
                    )}
                  </Grid>
                  {!partyConfirmed && (
                    <Callout.Root color="amber" size="1" mt="3">
                      <Callout.Icon>
                        <CircleAlert size={16} />
                      </Callout.Icon>
                      <Callout.Text>
                        Confirm the number of adults and children in the brief first. Supplier
                        searches currently support adult-only parties; family services can be added
                        manually.
                      </Callout.Text>
                    </Callout.Root>
                  )}
                  {kind === 'hotels' && !hotelReady && partyConfirmed && (
                    <Callout.Root color="amber" size="1" mt="3">
                      <Callout.Icon>
                        <CircleAlert size={16} />
                      </Callout.Icon>
                      <Callout.Text>
                        Before searching, set exact stay dates, hotel standard and hotel location in
                        the brief and route.
                      </Callout.Text>
                    </Callout.Root>
                  )}
                  {kind === 'flights' && !flightReady && partyConfirmed && (
                    <Callout.Root color="amber" size="1" mt="3">
                      <Callout.Icon>
                        <CircleAlert size={16} />
                      </Callout.Icon>
                      <Callout.Text>
                        Confirm the client’s preferred cabin in the brief before searching.
                      </Callout.Text>
                    </Callout.Root>
                  )}
                  <Box mt="4">
                    <Button
                      size="3"
                      variant="soft"
                      loading={busy}
                      disabled={disabled || busy || !(kind === 'hotels' ? hotelReady : flightReady)}
                    >
                      {busy ? 'Searching…' : `Search ${kind} quotes`}
                    </Button>
                  </Box>
                </fieldset>
              </Reset>
            </form>
            {error && (
              <Callout.Root color="red" role="alert" mt="3">
                <Callout.Icon>
                  <CircleAlert size={16} />
                </Callout.Icon>
                <Callout.Text>{error}</Callout.Text>
              </Callout.Root>
            )}
            {warning && (
              <Callout.Root color="amber" size="1" mt="3" role="status">
                <Callout.Icon>
                  <CircleAlert size={16} />
                </Callout.Icon>
                <Callout.Text>{warning}</Callout.Text>
              </Callout.Root>
            )}
            <Flex direction="column" gap="3" mt="4">
              {quotes.map((quote) => (
                <Card asChild key={quote.id} size="2">
                  <article>
                    <Flex
                      align={{ initial: 'start', sm: 'center' }}
                      justify="between"
                      gap="4"
                      direction={{ initial: 'column', sm: 'row' }}
                    >
                      <Box>
                        <Heading as="h3" size="3" mb="1">
                          {quote.title}
                        </Heading>
                        <Text as="p" size="2" color="gray" mb="2">
                          {quote.description}
                        </Text>
                        <Text size="2" weight="bold">
                          {quote.price === null
                            ? 'Unpriced'
                            : `${money(quote.price, quote.currency)} ${quote.currency}`}
                        </Text>
                        <Box mt="1">
                          <Badge
                            size="1"
                            variant="soft"
                            color={quote.priceStatus === 'sandbox' ? 'amber' : 'gray'}
                          >
                            {quote.priceStatus === 'sandbox' ? (
                              <CircleAlert size={11} aria-hidden="true" />
                            ) : null}
                            {quote.priceStatus === 'sandbox'
                              ? 'Sandbox example · not a live fare'
                              : quote.priceStatus.replaceAll('_', ' ')}
                          </Badge>
                        </Box>
                      </Box>
                      <Button
                        size="3"
                        variant="soft"
                        style={{ flexShrink: 0 }}
                        disabled={disabled || busy || quoteRevision !== workspace.revision}
                        onClick={() => void select(quote)}
                      >
                        Add quote to proposal
                      </Button>
                    </Flex>
                  </article>
                </Card>
              ))}
            </Flex>
          </Box>
        </details>
      </Reset>
    </Card>
  );
}
