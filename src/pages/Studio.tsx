import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  GripVertical,
  Lock,
  Maximize2,
  MessageCircle,
  Minimize2,
  Minus,
  PanelsTopLeft,
  Plus,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Checkbox,
  Flex,
  Grid,
  Heading,
  IconButton,
  Progress,
  Reset,
  Select,
  Separator,
  Spinner as InlineSpinner,
  Tabs,
  Text,
  TextArea,
  TextField,
  Tooltip,
} from '@radix-ui/themes';
import { api, ApiError, money, readableDate } from '../api';
import { useApp } from '../context';
import { Modal, Spinner, TaraMark } from '../components/ui';
import { useRouteLoading } from '../components/TopLoadingBar';
import { useComposerLayout } from '../components/useComposerLayout';
import { StudioImportComposer, type StudioImportMode } from '../components/StudioImportComposer';
import StudioProposalControls from '../components/StudioProposalControls';
import StudioHotelResults from '../components/StudioHotelResults';
import type { StudioHotelSearchResult } from '../../shared/studio-hotels';
import { StudioTravelResearch } from '../components/StudioTravelResearch';
import { StudioClientProfiles } from '../components/StudioClientProfiles';
import { StudioClientDesk } from '../components/StudioClientDesk';
import { StudioGuidedBrief } from '../components/StudioGuidedBrief';
import { StudioTripBriefingPanel } from '../components/StudioTripBriefingPanel';
import { useStudioTripBriefing } from '../components/useStudioTripBriefing';
import './Studio.css';
import { StudioCruiseImport } from '../components/StudioCruiseImport';
import type { StudioCruiseDraft } from '../../shared/studio-cruise';
import type { StudioClientProfile } from '../../shared/studio-clients';
import { studioCountries } from '../../shared/studio-travel-research';
import { StudioItineraryPanel } from '../components/StudioItineraryPanel';
import { SplitWorkspace, type PaneTab } from '../components/SplitWorkspace';
import { AuroraBackground } from '../components/AuroraBackground';
import { StudioTripCanvas, type StudioCanvasTool } from '../components/StudioTripCanvas';
import { StudioDayEditorDialog } from '../components/StudioDayEditorDialog';
import { StudioChatActions } from '../components/StudioChatActions';
import { StudioChatIdeas } from '../components/StudioChatIdeas';
import { StudioClientInspiration } from '../components/StudioClientInspiration';
import { useStudioClientInspiration } from '../components/useStudioClientInspiration';
import { StudioChatOffers, type StudioChatOfferAction } from '../components/StudioChatOffers';
import { ClientPickerDialog, CreateProposalDialog } from '../components/ClientPicker';
import type { StudioAssistantAction } from '../../shared/studio-assistant';
import type { StudioDestinationCandidate } from '../../shared/studio-travel-research';
import '../components/StudioAgentConversation.css';
import { onStudioWorkspaceEvent } from '../studioEvents';
import { ChatTurn } from '../components/ChatTurn';
import { PlanningModeNotice } from '../components/PlanningModeNotice';
import MarkdownText from '../components/MarkdownText';
import type {
  StudioAgency,
  StudioQualification,
  StudioQuestion,
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
  itinerary?: StudioWorkspace['itinerary'];
};
const tabLabels: Record<string, string> = {
  client: 'Client & trip',
  structure: 'Route',
  services: 'Accommodation',
  itinerary: 'Daily activities',
  recommendations: 'Optional ideas',
  proposal: 'Proposal',
};
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

function StayDateChoices({
  workspace,
  disabled,
  onChoose,
}: {
  workspace: StudioWorkspace;
  disabled: boolean;
  onChoose: (message: string) => void;
}) {
  const clarification = workspace.clarification;
  if (clarification?.kind !== 'stay_dates') return null;
  const stop = workspace.stops.find((item) => item.id === clarification.stopId);
  if (!stop) return null;
  const { arrivalDate, departureDate, statedNights, proposedNights } = clarification;
  const shorterDeparture = new Date(`${arrivalDate}T12:00:00Z`);
  shorterDeparture.setUTCDate(shorterDeparture.getUTCDate() + statedNights);
  if (!Number.isFinite(shorterDeparture.getTime())) return null;
  const statedDeparture = shorterDeparture.toISOString().slice(0, 10);
  const showYear = arrivalDate.slice(0, 4) !== departureDate.slice(0, 4);
  const shortDate = (value: string) =>
    new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      ...(showYear ? { year: 'numeric' as const } : {}),
      timeZone: 'UTC',
    });
  const sameMonth = arrivalDate.slice(0, 7) === departureDate.slice(0, 7);
  const range = sameMonth
    ? `${Number(arrivalDate.slice(8))}–${shortDate(departureDate)}`
    : `${shortDate(arrivalDate)}–${shortDate(departureDate)}`;
  const choose = (end: string, nights: number) =>
    onChoose(`Use arrival ${arrivalDate} and return ${end} for ${nights} nights in ${stop.name}.`);
  const nightsLabel = (nights: number) => `${nights} ${nights === 1 ? 'night' : 'nights'}`;
  return (
    <Flex direction="column" gap="2" role="group" aria-label="Resolve trip dates">
      <Text size="2" weight="medium">
        Confirm the stay in {stop.name}
      </Text>
      <Flex gap="2" wrap="wrap">
        <Button
          type="button"
          size="2"
          variant="soft"
          disabled={disabled}
          onClick={() => choose(departureDate, proposedNights)}
        >
          Use {nightsLabel(proposedNights)} · {range}
        </Button>
        <Button
          type="button"
          size="2"
          variant="outline"
          disabled={disabled}
          onClick={() => choose(statedDeparture, statedNights)}
        >
          Keep {nightsLabel(statedNights)} · leave {shortDate(statedDeparture)}
        </Button>
      </Flex>
    </Flex>
  );
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

/* The workspace chrome, compressed into one row so the panes below get the rest of the viewport.
   Deliberately plain: the stages are words, not a coloured stepper, with the current one darker,
   and the structure gate is explained in a sentence under the title instead of a status tag. The stages stay an ordered list in a <nav> with
   `aria-current="step"`, so they still read as steps to assistive tech. */
function StudioTopBar({
  workspace,
  activeTab,
  onPreview,
  disabled,
}: {
  workspace: StudioWorkspace;
  activeTab: string;
  onPreview: () => void;
  disabled: boolean;
}) {
  return (
    <header className="studio-topbar">
      <Flex align="center" gap="3" minWidth="0" style={{ flex: 1 }}>
        <IconButton asChild size="2" variant="ghost" color="gray">
          <Link to="/studio" aria-label="Back to Agent Studio">
            <ArrowLeft size={17} />
          </Link>
        </IconButton>
        <Box minWidth="0" style={{ flex: 1 }}>
          <Text as="div" size="1" color="gray" weight="medium">
            AGENT STUDIO <span aria-hidden="true"> / </span> {tabLabels[activeTab]}
          </Text>
          <Heading as="h1" size="4" mt="1" truncate>
            {workspace.title}
          </Heading>
        </Box>
      </Flex>
      <Flex gap="3" align="center" wrap="wrap" style={{ flexShrink: 0 }}>
        <Badge color={workspace.structureAccepted ? 'green' : 'gray'} variant="soft">
          {workspace.proposal
            ? 'Shared proposal'
            : workspace.structureAccepted
              ? 'Route approved'
              : 'Draft proposal'}
        </Badge>
        <Button
          size="2"
          variant="outline"
          aria-label="Preview proposal"
          disabled={disabled || !workspace.structureAccepted}
          style={!workspace.structureAccepted ? { display: 'none' } : undefined}
          onClick={onPreview}
        >
          <span className="studio-preview-desktop-label">Preview proposal</span>
          <span className="studio-preview-mobile-label" aria-hidden="true">
            Preview
          </span>
          <ChevronRight size={14} />
        </Button>
      </Flex>
    </header>
  );
}

export default function Studio() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { ownerVersion, integrations } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [workspaces, setWorkspaces] = useState<StudioWorkspace[]>([]);
  const [workspace, setWorkspace] = useState<StudioWorkspace | null>(null);
  const [clients, setClients] = useState<StudioClient[]>([]);
  const [profiles, setProfiles] = useState<StudioClientProfile[]>([]);
  const [selectedCruise, setSelectedCruise] = useState<string>('');
  const [agency, setAgency] = useState<StudioAgency | null>(null);
  const [routeDirty, setRouteDirty] = useState(false);
  const actionLock = useRef<{ epoch: number } | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState(search.get('q') || '');
  const composer = useComposerLayout(message);
  const [deleting, setDeleting] = useState<StudioWorkspace | null>(null);
  const [briefOpen, setBriefOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('client');
  const [pane, setPane] = useState<PaneTab>('primary');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [answerQuestion, setAnswerQuestion] = useState<string | null>(null);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [dayEditing, setDayEditing] = useState<number | null>(null);
  const [offerKind, setOfferKind] = useState<StudioChatOfferAction | null>(null);
  const [offerStopId, setOfferStopId] = useState<string | undefined>();
  const [supplierBusy, setSupplierBusy] = useState(false);
  const supplierBusyRef = useRef(false);
  const [actionNotice, setActionNotice] = useState('');
  /* The turn the agent has just sent, held locally until the server echoes it back. Nothing in
     this app streams, and a brief review can run for a minute or more, so without this the pane
     simply sits there and the agent cannot tell whether the send landed. */
  const [pendingTurn, setPendingTurn] = useState('');
  const logEnd = useRef<HTMLDivElement>(null);
  const [importRequest, setImportRequest] = useState<{
    mode: StudioImportMode;
    nonce: number;
  } | null>(null);
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
  /* Which account the page's current content, clients and agency belong to. Moving between
     proposals keeps all three: the open proposal stays on screen, dimmed and inert, until the next
     one arrives and replaces it in a single render — clearing it first blanked the page to a
     spinner and back on every click. A different account starts from nothing. */
  const loadedOwner = useRef<number | null>(null);
  const [switching, setSwitching] = useState(false);
  useRouteLoading(loading || switching);
  useEffect(() => {
    const current = ++epoch.current;
    const sameOwner = loadedOwner.current === ownerVersion;
    const carriedError = (location.state as { reviewError?: string } | null)?.reviewError || '';
    const carriedMessage = search.get('q') || '';
    setPendingTurn('');
    setSelectedCruise('');
    setToolsOpen(false);
    setAnswerQuestion(null);
    setClientPickerOpen(false);
    setDayEditing(null);
    setOfferKind(null);
    setOfferStopId(undefined);
    setActionNotice('');
    setSupplierBusy(false);
    supplierBusyRef.current = false;
    if (sameOwner) {
      setSwitching(true);
    } else {
      setLoading(true);
      setError(carriedError);
      setBusy('');
      setRouteDirty(false);
      setWorkspace(null);
      setWorkspaces([]);
      setClients([]);
      setProfiles([]);
      setMessage(carriedMessage);
    }
    void Promise.all([
      id
        ? api<{ workspace: StudioWorkspace }>(`/studio/workspaces/${id}`)
        : api<{ workspaces: StudioWorkspace[] }>('/studio/workspaces'),
      // Clients and the agency belong to the account, not the proposal.
      sameOwner ? null : api<{ clients: StudioClient[] }>('/studio/clients'),
      sameOwner ? null : api<{ agency: StudioAgency }>('/studio/agency'),
    ])
      .then(([result, clientResult, agencyResult]) => {
        if (current !== epoch.current) return;
        if ('workspace' in result) {
          setWorkspace(result.workspace);
          setWorkspaces([]);
          setActiveTab(
            result.workspace.structureAccepted
              ? result.workspace.itinerary || result.workspace.stage === 'itinerary'
                ? 'itinerary'
                : 'services'
              : result.workspace.stops.length
                ? 'structure'
                : 'client',
          );
        } else {
          setWorkspace(null);
          setWorkspaces(result.workspaces);
        }
        if (clientResult) setClients(clientResult.clients);
        if (agencyResult) setAgency(agencyResult.agency);
        loadedOwner.current = ownerVersion;
        if (sameOwner) {
          setError(carriedError);
          setBusy('');
          setRouteDirty(false);
          setMessage(carriedMessage);
        }
      })
      .catch((cause: Error) => {
        if (current !== epoch.current) return;
        /* A failed switch must not leave the previous proposal on screen under the new address,
           where an edit would land on the wrong one. */
        if (sameOwner) {
          setWorkspace(null);
          setWorkspaces([]);
        }
        setError(cause.message);
      })
      .finally(() => {
        if (current !== epoch.current) return;
        setLoading(false);
        setSwitching(false);
      });
    return () => {
      epoch.current++;
    };
  }, [id, ownerVersion]);

  async function act(label: string, operation: () => Promise<void>) {
    if (supplierBusyRef.current) return false;
    if (switching || (id && latestWorkspace.current?.id !== id)) return false;
    if (actionLock.current?.epoch === epoch.current) return false;
    const lock = { epoch: epoch.current };
    actionLock.current = lock;
    const currentEpoch = lock.epoch;
    setBusy(label);
    setError('');
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (currentEpoch !== epoch.current) return false;
      await operation();
      return true;
    } catch (cause) {
      if (currentEpoch !== epoch.current) return false;
      setError((cause as Error).message);
      if (cause instanceof ApiError && cause.status === 409 && id) {
        try {
          const result = await api<{ workspace: StudioWorkspace }>(`/studio/workspaces/${id}`);
          if (currentEpoch === epoch.current && latestWorkspace.current?.id === id) {
            latestWorkspace.current = result.workspace;
            setWorkspace(result.workspace);
          }
        } catch {
          /* Keep the current local view when refresh is unavailable. */
        }
      }
      return false;
    } finally {
      if (actionLock.current === lock) actionLock.current = null;
      if (currentEpoch === epoch.current) setBusy('');
    }
  }
  async function mutate(action: string, body: Record<string, unknown>) {
    const current = latestWorkspace.current;
    if (!current) return;
    const currentEpoch = epoch.current;
    const result = await api<{
      workspace: StudioWorkspace;
      nextAction?: 'structure' | 'itinerary' | 'services' | 'recommendations' | 'proposal';
    }>(`/studio/workspaces/${current.id}${action}`, {
      method: action ? 'POST' : 'PATCH',
      body: JSON.stringify({ ...body, revision: current.revision }),
    });
    if (
      currentEpoch === epoch.current &&
      latestWorkspace.current?.id === current.id &&
      result.workspace.revision >= latestWorkspace.current.revision
    ) {
      latestWorkspace.current = result.workspace;
      setWorkspace(result.workspace);
      if (result.nextAction)
        setActiveTab(result.workspace.structureAccepted ? result.nextAction : 'structure');
      return result.workspace;
    }
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
  /* One turn, from either source: the agent pressing send, or a brief carried in from the home
     page. Shows the turn and empties the composer straight away, and hands the words back if it
     fails, so a failed send never costs the agent what they typed. */
  async function sendToTara(text: string) {
    if (
      actionLock.current?.epoch === epoch.current ||
      supplierBusyRef.current ||
      switching ||
      (id && latestWorkspace.current?.id !== id)
    )
      return;
    const submittedEpoch = epoch.current;
    setPendingTurn(text);
    setMessage('');
    const sent = await act('Planning your trip', async () => {
      const current = latestWorkspace.current;
      if (!current) return;
      const requestKey = JSON.stringify({
        workspace: current.id,
        revision: current.revision,
        message: text,
      });
      const requestId = requestIds.current.get(requestKey) || crypto.randomUUID();
      requestIds.current.set(requestKey, requestId);
      await mutate('/review', { message: text, requestId });
      requestIds.current.delete(requestKey);
    });
    if (submittedEpoch !== epoch.current) return;
    setPendingTurn('');
    if (!sent) setMessage(text);
    if (
      sent &&
      latestWorkspace.current?.structureAccepted &&
      /\b(hotels?|rooms?|accommodation|flights?|airfare|cruises?|sailing)\b/i.test(text)
    ) {
      setOfferKind(
        /\b(flights?|airfare)\b/i.test(text)
          ? 'flights'
          : /\b(cruises?|sailing)\b/i.test(text)
            ? 'cruises'
            : 'hotels',
      );
    }
  }
  /* A brief typed on the home page arrives as `?q=`. The home composer navigates the moment the
     workspace exists rather than waiting out the review, so the review runs here, where there is a
     conversation to show it in. Fired once per workspace, and the parameter is dropped straight
     away so a refresh does not send it again. */
  const autoReviewed = useRef('');
  useEffect(() => {
    if (!id || !workspace || loading || switching || workspace.id !== id) return;
    const carried = search.get('q');
    if (!carried || autoReviewed.current === id) return;
    autoReviewed.current = id;
    navigate(`/studio/${id}`, { replace: true });
    void sendToTara(carried);
  }, [id, workspace, loading, switching, search, navigate]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if ((!message.trim() && !workspace?.imports.length) || routeDirty) return;
    const text =
      message.trim() ||
      'Review the imported client information and tell me which details need clarification.';
    if (workspace) {
      void sendToTara(text);
      return;
    }
    const submittedEpoch = epoch.current;
    setPendingTurn(text);
    setMessage('');
    const sent = await act('Planning with Tara', async () => {
      {
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
    });
    if (submittedEpoch !== epoch.current) return;
    setPendingTurn('');
    if (!sent) setMessage(text);
  }
  useEffect(() => {
    if (workspace && !workspace.structureAccepted)
      setActiveTab((current) =>
        ['client', 'structure'].includes(current)
          ? current
          : workspace.stops.length
            ? 'structure'
            : 'client',
      );
  }, [workspace?.structureAccepted]);
  useEffect(() => {
    document
      .getElementById(`studio-stage-${activeTab}`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab, pane]);
  /* The log fills the pane now rather than a 430px box, so the newest turn has to be brought to
     the agent the way the concierge planner does it. */
  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [workspace?.messages.length, pendingTurn]);
  /* Below md only one pane is on screen. A canvas action that drives the composer has to bring the
     conversation back first — focusing or scrolling to a display:none element does nothing. */
  function askTara(text: string) {
    if (routeDirty) return;
    setToolsOpen(false);
    setMessage(text);
    setPane('primary');
    requestAnimationFrame(() => document.getElementById('studio-message')?.focus());
  }
  function revealImportComposer() {
    setPane('primary');
    setImportRequest((current) => ({ mode: 'text', nonce: (current?.nonce ?? 0) + 1 }));
  }
  const receivedWorkspace = (next: StudioWorkspace) => {
    if (latestWorkspace.current?.id !== next.id || next.revision < latestWorkspace.current.revision)
      return;
    latestWorkspace.current = next;
    setWorkspace(next);
    setError('');
  };
  async function refreshCurrentWorkspace() {
    await act('Refreshing client details', async () => {
      const current = latestWorkspace.current;
      if (!current) return;
      const currentEpoch = epoch.current;
      const result = await api<{ workspace: StudioWorkspace }>(`/studio/workspaces/${current.id}`);
      if (currentEpoch === epoch.current) receivedWorkspace(result.workspace);
    });
  }
  const tripBriefing = useStudioTripBriefing({
    workspace: !loading && !switching && workspace?.id === id ? workspace : null,
    enabled: integrations.ai,
    paused: !!busy || supplierBusy || routeDirty || switching,
    interrupt: !!busy || supplierBusy,
    onUpdate: (next) => {
      const current = latestWorkspace.current;
      if (current?.id === next.id && next.revision >= current.revision) {
        latestWorkspace.current = next;
        setWorkspace(next);
      }
    },
  });
  useEffect(() => {
    if (loading || switching || !id) return;
    const currentEpoch = epoch.current;
    void api<{ clients: StudioClientProfile[] }>('/studio/client-profiles')
      .then((result) => {
        if (currentEpoch === epoch.current) setProfiles(result.clients);
      })
      .catch(() => {
        /* The trip remains usable while the address book is unavailable. */
      });
  }, [id, ownerVersion, loading, switching]);
  const inspiration = useStudioClientInspiration({
    workspace: !loading && !switching && workspace?.id === id ? workspace : null,
    enabled: integrations.ai,
    profile: profiles.find((profile) => profile.id === workspace?.brief.clientId),
    paused: !!busy || supplierBusy || routeDirty || switching,
    onUpdate: (next) => {
      const current = latestWorkspace.current;
      if (current?.id === next.id && next.revision >= current.revision) {
        latestWorkspace.current = next;
        setWorkspace(next);
      }
    },
  });
  function openTool(tool: StudioCanvasTool) {
    if (routeDirty && tool !== 'structure') return;
    setActiveTab(tool);
    setToolsOpen(true);
  }
  async function approveRoute() {
    const approved = await act('Approving the route', async () => {
      await mutate('/accept-structure', {});
    });
    if (approved)
      setActionNotice('Route confirmed. Choose rooms, flights and daily ideas right here.');
  }
  async function chooseDestination(candidate: StudioDestinationCandidate) {
    if (!candidate.recommendable || candidate.status === 'blocked') return;
    const current = latestWorkspace.current;
    if (!current || current.stops.length || routeDirty || supplierBusyRef.current) return;
    await patch({
      brief: {
        preferredDestination: candidate.destination,
        destinationCountry: candidate.countryCode,
      },
      stops: [
        {
          id: crypto.randomUUID(),
          name: candidate.destination,
          country: candidate.countryCode,
          nights: Math.max(1, candidate.suggestedDays - 1),
          arrivalDate: current.brief.startDate,
          departureDate: '',
          arrivalFixed: Boolean(current.brief.startDate),
          onwardTransport: 'undecided',
          neighbourhood: '',
          notes: '',
        },
      ],
    });
    setActionNotice(
      `${candidate.destination} added as a draft route. Confirm dates and stay length together.`,
    );
  }
  async function generateDailyPlan() {
    const generated = await act('Building the day-by-day itinerary', async () => {
      const current = latestWorkspace.current;
      if (!current) return;
      const requestKey = JSON.stringify({
        workspace: current.id,
        revision: current.revision,
        action: 'chat-itinerary',
      });
      const requestId = requestIds.current.get(requestKey) || crypto.randomUUID();
      requestIds.current.set(requestKey, requestId);
      await mutate('/itinerary', {
        instructions:
          'Build the complete itinerary around the stated route, travel purpose, client preferences, selected services and available travel guidance.',
        requestId,
      });
      requestIds.current.delete(requestKey);
    });
    if (generated)
      setActionNotice(
        'The daily itinerary is ready. Choose a day in the canvas to review or edit it.',
      );
  }
  async function handleChatAction(action: StudioAssistantAction) {
    if (action.kind === 'answer') {
      if (action.questionId === 'clarification') {
        document.getElementById('studio-stay-choices')?.scrollIntoView({ block: 'nearest' });
        return;
      }
      setAnswerQuestion(action.questionId || '');
    } else if (action.kind === 'approve_route') await approveRoute();
    else if (action.kind === 'hotels' || action.kind === 'flights' || action.kind === 'cruises') {
      setOfferStopId(action.stopId);
      setOfferKind(action.kind);
    } else if (action.kind === 'destinations') {
      if (integrations.ai) inspiration.refresh();
      else setAnswerQuestion('route');
    } else if (action.kind === 'generate_itinerary') await generateDailyPlan();
    else if (action.kind === 'activities' || action.kind === 'food') {
      const category = action.kind === 'food' ? 'food' : 'activity';
      const current = latestWorkspace.current;
      if (!current) return;
      const researched = await act(
        category === 'food' ? 'Researching food ideas' : 'Researching activities',
        async () => {
          await mutate('/recommendations', {
            category,
            stopIds: current.stops.map((stop) => stop.id),
            interests:
              [
                ...current.brief.interests,
                ...(category === 'food' ? current.brief.foodPreferences || [] : []),
              ]
                .join(', ')
                .slice(0, 1500) || 'Suit the stated trip purpose, pace and client preferences.',
            requestId: crypto.randomUUID(),
          });
        },
      );
      if (researched)
        setActionNotice(
          'Sourced ideas are ready below. Choose an itinerary day for any you would like to include.',
        );
    } else if (action.kind === 'preview') openTool('proposal');
  }
  /* Renames, pins and deletes made from the sidebar's Recent menu (src/studioEvents.ts). Taking
     the renamed workspace keeps this view on the latest revision, so its next save does not
     conflict; a deleted one drops out of the index. */
  useEffect(
    () =>
      onStudioWorkspaceEvent((event) => {
        if (event.type === 'deleted') {
          setWorkspaces((list) => list.filter((item) => item.id !== event.id));
          return;
        }
        const next = event.workspace;
        const current = latestWorkspace.current;
        if (current?.id === next.id && next.revision >= current.revision) setWorkspace(next);
        setWorkspaces((list) => list.map((item) => (item.id === next.id ? next : item)));
      }),
    [],
  );
  if (loading)
    return (
      <Flex
        align="center"
        justify="center"
        position={id ? 'relative' : 'static'}
        style={
          id
            ? { height: 'calc(100dvh - var(--app-header-height))', minHeight: 0 }
            : { minHeight: '60vh' }
        }
      >
        {/* Still the hero's gathered glow, because this is the frame right after leaving it — the
            workspace behind opens it out once there is a workspace to open it into. */}
        {id && <AuroraBackground />}
        <Box position="relative" style={{ zIndex: 1 }}>
          <Spinner label="Opening your agent workspace…" />
        </Box>
      </Flex>
    );
  /* Exactly one solid Button is live at a time: the chat composer owns it until a route
     exists, then the canvas action for the open tab owns it. */
  const routeStarted = !!workspace?.stops.length;
  const dialogs = (
    <>
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
    </>
  );
  /* The workspace is a room you work in: chrome on top, conversation and canvas side by side,
     each scrolling on its own. The index below is still an ordinary page. */
  if (id && workspace)
    return (
      <div
        key={workspace.id}
        className="studio-workspace"
        inert={switching || workspace.id !== id}
        aria-busy={switching || workspace.id !== id || undefined}
        style={{
          opacity: switching || workspace.id !== id ? 0.6 : 1,
          transition: switching ? 'opacity 160ms ease 120ms' : 'opacity 120ms ease',
        }}
      >
        <SplitWorkspace
          surface="islands"
          background={<AuroraBackground variant="spread" />}
          topBar={
            <>
              <StudioTopBar
                workspace={workspace}
                activeTab={activeTab}
                disabled={!!busy || supplierBusy || routeDirty}
                onPreview={() => openTool('proposal')}
              />
              {/* Errors come from both panes, so they belong to neither. Outside both scroll
                  containers this can never be scrolled out of sight. */}
              {error && (
                <Box px={{ initial: '3', md: '4' }} pt="3">
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
                </Box>
              )}
            </>
          }
          tab={pane}
          onTabChange={setPane}
          tabsLabel="Workspace panes"
          tabs={{
            primary: { label: 'Chat with Tara', icon: <MessageCircle size={15} /> },
            secondary: { label: 'Trip workspace', icon: <PanelsTopLeft size={15} /> },
          }}
          columns={{ initial: '1', md: 'minmax(0, 3fr) minmax(0, 2fr)' }}
          primaryAs="aside"
          primaryLabel="Planning conversation"
          primaryPadding="4"
          primary={
            <Flex direction="column" gap="3">
              <PlanningModeNotice />
              <Flex align="center" gap="2" className="studio-tara-intro">
                <TaraMark size={24} />
                <Box style={{ flex: 1 }}>
                  <Text as="div" size="3" weight="bold">
                    Plan with Tara
                  </Text>
                  <Text size="1" color="gray">
                    Your route, rooms, journeys and days — together.
                  </Text>
                </Box>
                <Button
                  size="1"
                  variant="ghost"
                  color="gray"
                  disabled={!!busy || supplierBusy || routeDirty}
                  onClick={() => setBriefOpen(true)}
                >
                  Trip details
                </Button>
                <Button
                  size="1"
                  variant="ghost"
                  color="gray"
                  disabled={!!busy || supplierBusy || routeDirty}
                  onClick={revealImportComposer}
                >
                  <Plus size={13} /> Notes
                </Button>
              </Flex>
              <StudioClientInspiration
                workspace={workspace}
                profile={profiles.find((profile) => profile.id === workspace.brief.clientId)}
                researching={inspiration.loading}
                busy={!!busy || supplierBusy || routeDirty}
                onClient={() => setClientPickerOpen(true)}
                onChoose={(candidate) => void chooseDestination(candidate).catch(() => {})}
                onResearch={inspiration.refresh}
                onReview={() => openTool('structure')}
              />
              {inspiration.error && (
                <Text size="1" color="gray" role="status">
                  {inspiration.error}
                </Text>
              )}
              {workspace.brief.context && (
                <details className="studio-client-background">
                  <summary>Private client notes</summary>
                  <Text as="p" size="2" color="gray" mt="2">
                    {workspace.brief.context}
                  </Text>
                  <Button
                    size="1"
                    variant="ghost"
                    disabled={!!busy || supplierBusy || routeDirty}
                    onClick={() => openTool('client')}
                  >
                    Edit client & trip
                  </Button>
                </details>
              )}

              <Box role="log" aria-live="polite" style={{ overflowWrap: 'anywhere' }}>
                <Flex direction="column" gap="3">
                  {workspace.messages.map((item) => (
                    <ChatTurn key={item.id} role={item.role === 'assistant' ? 'assistant' : 'user'}>
                      {item.role === 'assistant' ? (
                        /* Tara's replies carry lists and emphasis; they were being printed with
                           their markdown showing. */
                        <MarkdownText text={item.content} />
                      ) : (
                        <Text as="p" size="2" style={{ whiteSpace: 'pre-wrap' }}>
                          {item.content}
                        </Text>
                      )}
                    </ChatTurn>
                  ))}
                  {pendingTurn && (
                    <>
                      <ChatTurn role="user">
                        <Text as="p" size="2" style={{ whiteSpace: 'pre-wrap' }}>
                          {pendingTurn}
                        </Text>
                      </ChatTurn>
                      <ChatTurn role="assistant">
                        <Flex align="center" gap="2">
                          <InlineSpinner />
                          <Text as="p" size="2" color="gray">
                            {busy || 'Planning with Tara'}…
                          </Text>
                        </Flex>
                      </ChatTurn>
                    </>
                  )}
                </Flex>
              </Box>
              <StudioChatActions
                workspace={workspace}
                busy={!!busy || supplierBusy || routeDirty}
                onAction={(action) => void handleChatAction(action)}
                notice={actionNotice}
              />
              <StudioChatOffers
                key={`offers:${workspace.id}`}
                workspace={workspace}
                busy={!!busy || routeDirty}
                hotelsEnabled={integrations.hotels}
                flightsEnabled={integrations.flights}
                selectedKind={offerKind}
                selectedStopId={offerStopId}
                showActions={!workspace.structureAccepted}
                onKindChange={setOfferKind}
                onBusyChange={(active) => {
                  supplierBusyRef.current = active;
                  setSupplierBusy(active);
                }}
                onUpdateWorkspace={(next) => {
                  const previous = latestWorkspace.current;
                  receivedWorkspace(next);
                  if (
                    next.items.some(
                      (item) =>
                        item.included &&
                        !previous?.items.some((old) => old.id === item.id && old.included),
                    )
                  )
                    setActionNotice(
                      'Travel option added to the itinerary. This saves a proposal item; no reservation has been made.',
                    );
                }}
                onSaveBrief={async (brief) => {
                  await patch({ brief });
                  return latestWorkspace.current || undefined;
                }}
                onEditRoute={() => openTool('structure')}
                onOpenCruise={(cruiseId) => {
                  setSelectedCruise(cruiseId || '');
                  openTool('structure');
                }}
                onPlanActivities={() => {
                  if (workspace.itinerary) openTool('itinerary');
                  else void generateDailyPlan();
                }}
                onAddManualService={() => openTool('services')}
              />
              <StudioChatIdeas
                key={`ideas:${workspace.id}`}
                workspace={workspace}
                busy={!!busy || supplierBusy || routeDirty}
                onAdd={async (recommendationId, day, period) => {
                  const added = await act('Adding the idea to your day', async () => {
                    await mutate(`/recommendations/${recommendationId}/add-to-day`, {
                      day,
                      period,
                    });
                  });
                  if (!added)
                    throw new Error(
                      'This idea could not be added. Check the workspace message and try again.',
                    );
                  setActionNotice(`Idea added to day ${day}, with its research sources.`);
                }}
              />
              <div ref={logEnd} />
            </Flex>
          }
          primaryFooter={
            /* The whole composer is one pinned unit: the + menu for every way a brief can arrive,
               the field, and send — the same pill the home page opens with. */
            <Flex
              direction="column"
              gap="2"
              p="3"
              style={{ borderTop: '1px solid var(--gray-a5)' }}
            >
              <div id="studio-stay-choices">
                <StayDateChoices
                  workspace={workspace}
                  disabled={!!busy || supplierBusy || !!pendingTurn || routeDirty || switching}
                  onChoose={(text) => void sendToTara(text)}
                />
              </div>
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
              <form onSubmit={submit}>
                <StudioImportComposer
                  workspace={workspace}
                  onChange={receivedWorkspace}
                  disabled={!!busy || supplierBusy || routeDirty}
                  openMode={importRequest}
                  stacked={composer.stacked}
                  corner={
                    <Tooltip content={composer.expanded ? 'Collapse' : 'Expand'}>
                      <IconButton
                        type="button"
                        size="3"
                        variant="ghost"
                        color="gray"
                        radius="full"
                        aria-label={
                          composer.expanded ? 'Collapse message box' : 'Expand message box'
                        }
                        aria-expanded={composer.expanded}
                        onClick={() => composer.setExpanded((value) => !value)}
                        style={{ margin: 0 }}
                      >
                        {composer.expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                      </IconButton>
                    </Tooltip>
                  }
                  field={
                    /* One line at rest; useComposerLayout grows it with the text and switches the
                       pill to the stacked layout once it wraps. Radix gives a size-3 TextArea an
                       80px minimum height, which is what made the resting field two lines tall. */
                    <TextArea
                      ref={composer.field}
                      size="3"
                      id="studio-message"
                      rows={1}
                      resize="none"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          e.currentTarget.form?.requestSubmit();
                        }
                      }}
                      maxLength={16000}
                      aria-label={
                        workspace.messages.length
                          ? 'Reply or refine the route'
                          : 'Client request or planning notes'
                      }
                      /* Short enough to fit the single-line field in the narrow chat column; the
                         longer wording wrapped and was cut off. */
                      placeholder={
                        workspace.messages.length
                          ? 'Ask Tara for a change…'
                          : 'Tell Tara about the trip…'
                      }
                      disabled={!!busy || supplierBusy || routeDirty}
                      style={{
                        background: 'transparent',
                        boxShadow: 'none',
                        minHeight: 0,
                        // The pill draws the focus ring (StudioImportComposer).
                        outline: 'none',
                      }}
                    />
                  }
                  send={
                    <IconButton
                      type="submit"
                      size="3"
                      radius="full"
                      loading={!!busy}
                      disabled={
                        !!busy ||
                        supplierBusy ||
                        routeDirty ||
                        (!message.trim() && !workspace.imports.length)
                      }
                      /* The name still says which turn this is — it is what the agent is told, and
                       what the suite asserts on. */
                      aria-label={
                        !message.trim() && workspace.imports.length
                          ? 'Review saved sources'
                          : workspace.messages.length
                            ? 'Send to Tara'
                            : 'Review brief'
                      }
                    >
                      <ArrowUp size={20} />
                    </IconButton>
                  }
                />
              </form>
            </Flex>
          }
          secondaryLabel="Proposal canvas"
          secondaryPadding="4"
          /* Tabs.Root has to enclose both bands so the list stays pinned while the content
             scrolls under it. */
          secondaryWrap={(bands) => (
            <Flex asChild direction="column" flexGrow="1" minHeight="0">
              <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
                {bands}
              </Tabs.Root>
            </Flex>
          )}
          secondaryHeader={
            <Flex
              className="studio-canvas-header"
              px="4"
              py="3"
              align="center"
              justify="between"
              gap="2"
            >
              <Text size="2" weight="medium">
                Trip canvas
              </Text>
              <Button
                size="1"
                variant="ghost"
                color="gray"
                disabled={!!busy || supplierBusy}
                onClick={() => openTool(workspace.structureAccepted ? 'itinerary' : 'client')}
              >
                Edit trip <Settings2 size={13} />
              </Button>
            </Flex>
          }
          secondary={
            <>
              <StudioTripCanvas
                workspace={workspace}
                busy={!!busy || supplierBusy || routeDirty}
                onEdit={openTool}
                onEditDay={setDayEditing}
                onSuggest={(text) => {
                  setPane('primary');
                  if (text.startsWith('Build the complete')) void generateDailyPlan();
                  else void sendToTara(text);
                }}
                onApprove={() => void approveRoute()}
                onAddService={(kind) => {
                  setPane('primary');
                  setOfferStopId(undefined);
                  setOfferKind(kind);
                }}
              />
              {toolsOpen && (
                <Modal
                  title={`Edit ${tabLabels[activeTab].toLowerCase()}`}
                  wide
                  onClose={() => {
                    if (routeDirty) {
                      setError('Save or discard your route edits before closing.');
                      return;
                    }
                    if (busy) return;
                    setToolsOpen(false);
                  }}
                >
                  <div className="studio-agent-tool-modal">
                    <Tabs.List className="studio-workflow-tabs" aria-label="Plan details">
                      {[
                        'client',
                        'structure',
                        'services',
                        'itinerary',
                        'recommendations',
                        'proposal',
                      ].map((tab) => {
                        const gated =
                          !['client', 'structure'].includes(tab) && !workspace.structureAccepted;
                        return (
                          <Tabs.Trigger
                            id={`studio-stage-${tab}`}
                            key={tab}
                            value={tab}
                            disabled={(routeDirty && tab !== 'structure') || gated || !!busy}
                          >
                            <Flex align="center" gap="1">
                              {gated && <Lock size={12} aria-hidden="true" />}
                              {tabLabels[tab]}
                            </Flex>
                          </Tabs.Trigger>
                        );
                      })}
                    </Tabs.List>
                    <div className="studio-agent-tool-content">
                      <Tabs.Content
                        value="client"
                        className="studio-client-stage"
                        forceMount
                        hidden={activeTab !== 'client'}
                        inert={activeTab !== 'client'}
                      >
                        <Flex direction="column" gap="4">
                          <Box className="studio-intake-intro">
                            <Text size="1" color="gray" weight="medium">
                              START WITH THE PEOPLE
                            </Text>
                            <Heading as="h2" size="6" mt="1">
                              A trip that feels like them.
                            </Heading>
                            <Text as="p" size="2" color="gray" mt="2">
                              Add your client’s details, then shape the journey together. Everything
                              saves to this proposal.
                            </Text>
                          </Box>
                          <StudioClientDesk
                            workspace={workspace}
                            disabled={!!busy || routeDirty}
                            initiallyOpen={
                              !workspace.brief.clientName &&
                              !workspace.brief.clientId &&
                              window.matchMedia('(min-width: 768px)').matches
                            }
                            selectedProfile={profiles.find(
                              (profile) => profile.id === workspace.brief.clientId,
                            )}
                            onSave={(brief) => patch({ brief })}
                            profileContent={
                              <StudioClientProfiles
                                workspace={workspace}
                                disabled={!!busy || routeDirty}
                                onProfiles={setProfiles}
                                onDeleted={async () => {
                                  await act('Refreshing client profile', async () => {
                                    const current = latestWorkspace.current!;
                                    const currentEpoch = epoch.current;
                                    const result = await api<{ workspace: StudioWorkspace }>(
                                      `/studio/workspaces/${current.id}`,
                                    );
                                    if (currentEpoch === epoch.current)
                                      setWorkspace(result.workspace);
                                  });
                                }}
                                onSelect={async (profile) => {
                                  if (!profile) {
                                    await patch({ brief: { clientId: '' } });
                                    return;
                                  }
                                  // Profile defaults initialise a newly selected client. Updating an
                                  // already-linked profile must retain this trip's explicit preferences.
                                  if (latestWorkspace.current?.brief.clientId !== profile.id)
                                    await patch({
                                      brief: {
                                        clientId: profile.id,
                                        clientName: profile.name,
                                        context: profile.context,
                                        passportNationality: profile.passportNationality,
                                        interests: profile.interests,
                                        foodPreferences: profile.foodPreferences,
                                      },
                                    });
                                  else await refreshCurrentWorkspace();
                                }}
                              />
                            }
                          />
                          <StudioGuidedBrief
                            workspace={workspace}
                            disabled={!!busy || routeDirty}
                            onSave={patch}
                            onContinue={() => setActiveTab('structure')}
                            onAsk={askTara}
                          />
                          <StudioTripBriefingPanel
                            workspace={workspace}
                            loading={tripBriefing.loading}
                            error={tripBriefing.error}
                            onRefresh={tripBriefing.refresh}
                          />
                          <Button
                            variant="outline"
                            disabled={!!busy || routeDirty}
                            onClick={() => setActiveTab('structure')}
                            style={{ alignSelf: 'flex-start' }}
                          >
                            Review route <ChevronRight size={15} />
                          </Button>
                        </Flex>
                      </Tabs.Content>
                      <Tabs.Content value="structure">
                        <StudioTripBriefingPanel
                          workspace={workspace}
                          loading={tripBriefing.loading}
                          error={tripBriefing.error}
                          onRefresh={tripBriefing.refresh}
                        />
                        <details
                          className="studio-details studio-tool-disclosure"
                          open={Boolean(workspace.destinationResearch && !workspace.stops.length)}
                        >
                          <summary>
                            <Sparkles size={16} /> Destination inspiration & detailed entry research
                          </summary>
                          <Box mt="4">
                            {' '}
                            <StudioTravelResearch
                              workspace={workspace}
                              history={
                                profiles.find((profile) => profile.id === workspace.brief.clientId)
                                  ?.history || []
                              }
                              busy={!!busy || routeDirty}
                              research={workspace.destinationResearch}
                              entryResults={workspace.entryRequirements}
                              onResearch={() =>
                                act('Researching destinations', async () => {
                                  await mutate('/destinations/research', {
                                    requestId: crypto.randomUUID(),
                                  });
                                })
                              }
                              onCheckEntry={(stopId) =>
                                act('Checking entry requirements', async () => {
                                  await mutate('/entry-requirements', {
                                    requestId: crypto.randomUUID(),
                                    ...(stopId ? { stopId } : {}),
                                  });
                                })
                              }
                              onChooseDestination={async (candidate) => {
                                const existing = workspace.stops.find(
                                  (stop) =>
                                    stop.name.toLowerCase() ===
                                      candidate.destination.toLowerCase() &&
                                    stop.country.toLowerCase() === candidate.country.toLowerCase(),
                                );
                                const stop = {
                                  ...blankStop(),
                                  name: candidate.destination,
                                  country: candidate.country,
                                };
                                await patch({
                                  brief: {
                                    preferredDestination: candidate.destination,
                                    destinationCountry: candidate.countryCode,
                                  },
                                  stops:
                                    workspace.brief.tripType === 'single'
                                      ? [existing || stop]
                                      : existing
                                        ? workspace.stops
                                        : [...workspace.stops, stop],
                                });
                              }}
                            />
                          </Box>
                        </details>
                        <details
                          className="studio-details studio-tool-disclosure"
                          open={Boolean(workspace.cruises?.length)}
                        >
                          <summary>
                            <PanelsTopLeft size={16} /> Add a cruise or edit a sailing
                          </summary>
                          <Box my="4">
                            {!!workspace.cruises?.length && (
                              <label>
                                <Text size="2">Saved cruise to edit</Text>
                                <select
                                  aria-label="Saved cruise to edit"
                                  value={selectedCruise}
                                  disabled={!!busy || routeDirty}
                                  onChange={(e) => setSelectedCruise(e.target.value)}
                                >
                                  <option value="">Import another cruise</option>
                                  {workspace.cruises.map((cruise) => (
                                    <option key={cruise.id} value={cruise.id}>
                                      {cruise.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                            <StudioCruiseImport
                              disabled={!!busy || routeDirty}
                              initialDraft={workspace.cruises?.find(
                                (cruise) => cruise.id === selectedCruise,
                              )}
                              onExtract={async (input) => {
                                let cruise: StudioCruiseDraft | undefined;
                                await act('Reading cruise itinerary', async () => {
                                  const current = latestWorkspace.current!;
                                  const currentEpoch = epoch.current;
                                  const result = await api<{
                                    workspace: StudioWorkspace;
                                    cruise: StudioCruiseDraft;
                                  }>(`/studio/workspaces/${current.id}/cruises/preview`, {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      revision: current.revision,
                                      requestId: crypto.randomUUID(),
                                      input,
                                    }),
                                  });
                                  if (
                                    currentEpoch === epoch.current &&
                                    latestWorkspace.current?.id === current.id
                                  ) {
                                    latestWorkspace.current = result.workspace;
                                    setWorkspace(result.workspace);
                                    cruise = result.cruise;
                                  }
                                });
                                return cruise;
                              }}
                              onApply={async (cruise) => {
                                let saved: StudioCruiseDraft | undefined;
                                await act('Saving cruise itinerary', async () => {
                                  const updated = await mutate('/cruises/apply', { cruise });
                                  saved = updated?.cruises?.find((value) => value.id === cruise.id);
                                  if (saved) setSelectedCruise(cruise.id);
                                });
                                return saved;
                              }}
                            />
                          </Box>
                        </details>
                        <RouteEditor
                          key={workspace.id}
                          workspace={workspace}
                          disabled={!!busy}
                          onSave={async (value) => {
                            await patch(value);
                            return latestWorkspace.current!.stops;
                          }}
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
                                      skipQualification:
                                        workspace.qualification.questions.length > 0,
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
                                Review the destinations, nights and dates. Accept this structure
                                when you are ready to add services.
                              </Text>
                              <Flex gap="3" wrap="wrap" align="center">
                                <Button
                                  size="3"
                                  variant={routeDirty ? 'soft' : 'solid'}
                                  loading={!!busy}
                                  disabled={!!busy || routeDirty}
                                  onClick={() =>
                                    void act('Accepting structure', async () => {
                                      const accepted = await mutate('/accept-structure', {});
                                      if (accepted) setActiveTab('services');
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
                                  onClick={() =>
                                    askTara(
                                      'Suggest an alternative route using this brief. Keep the confirmed requirements.',
                                    )
                                  }
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
                                Structure accepted. Choose accommodation, then add and edit daily
                                activities. You can also add flight and cruise services.
                              </Callout.Text>
                            </Callout.Root>
                          )}
                        </Card>
                      </Tabs.Content>
                      <Tabs.Content value="itinerary">
                        <details className="studio-details studio-tool-disclosure">
                          <summary>Travel checks · visa & seasonal weather</summary>
                          <StudioTripBriefingPanel
                            workspace={workspace}
                            loading={tripBriefing.loading}
                            error={tripBriefing.error}
                            onRefresh={tripBriefing.refresh}
                          />
                        </details>
                        {workspace.structureAccepted && (
                          <StudioItineraryPanel
                            workspace={workspace}
                            disabled={!!busy}
                            onSave={async (itinerary) =>
                              act('Saving daily activities', async () => {
                                await mutate('', { itinerary });
                              })
                            }
                            building={busy === 'Building the day-by-day itinerary'}
                            onGenerate={async (instructions) =>
                              act('Building the day-by-day itinerary', async () => {
                                const requestKey = JSON.stringify({
                                  workspace: workspace.id,
                                  revision: workspace.revision,
                                  action: 'itinerary',
                                  instructions,
                                });
                                const requestId =
                                  requestIds.current.get(requestKey) || crypto.randomUUID();
                                requestIds.current.set(requestKey, requestId);
                                const generated = await mutate('/itinerary', {
                                  instructions,
                                  requestId,
                                });
                                requestIds.current.delete(requestKey);
                                if (generated) setActiveTab('itinerary');
                              })
                            }
                            onRefine={() => askTara('Refine the day-by-day itinerary: ')}
                            onReview={() => setActiveTab('proposal')}
                          />
                        )}
                      </Tabs.Content>
                      <Tabs.Content value="services">
                        {workspace.structureAccepted && (
                          <ServicesPanel
                            workspace={workspace}
                            disabled={!!busy}
                            onSave={patch}
                            onImport={revealImportComposer}
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
                    </div>
                  </div>
                </Modal>
              )}
            </>
          }
        />
        {answerQuestion !== null && (
          <Modal
            title="Choose trip details"
            onClose={() => {
              if (!busy) setAnswerQuestion(null);
            }}
          >
            <StudioGuidedBrief
              workspace={workspace}
              questionId={answerQuestion}
              disabled={!!busy || supplierBusy}
              onSave={async (value) => {
                await patch(value);
                setAnswerQuestion(null);
                setActionNotice('Trip details saved. Tara’s next step has been updated.');
              }}
              onContinue={() => {
                setAnswerQuestion(null);
                openTool('structure');
              }}
              onAsk={(text) => {
                setAnswerQuestion(null);
                askTara(text);
              }}
            />
          </Modal>
        )}
        {clientPickerOpen && (
          <ClientPickerDialog
            initialClient={profiles.find((profile) => profile.id === workspace.brief.clientId)}
            title="Select the client for this proposal"
            confirmLabel="Use this client"
            onClose={() => {
              if (!busy) setClientPickerOpen(false);
            }}
            onSelect={async (profile) => {
              if (latestWorkspace.current?.brief.clientId !== profile.id)
                await patch({
                  brief: {
                    clientId: profile.id,
                    clientName: profile.name,
                    context: profile.context,
                    passportNationality: profile.passportNationality,
                    interests: profile.interests,
                    foodPreferences: profile.foodPreferences,
                  },
                });
              else await refreshCurrentWorkspace();
              setProfiles((current) => [
                ...current.filter((item) => item.id !== profile.id),
                profile,
              ]);
              setClientPickerOpen(false);
              setActionNotice(
                `${profile.name} selected. Confirm this trip’s dates and travelling party separately.`,
              );
            }}
          />
        )}
        {dayEditing !== null && workspace.itinerary?.days[dayEditing] && (
          <StudioDayEditorDialog
            key={`${workspace.id}:${dayEditing}`}
            workspace={workspace}
            index={dayEditing}
            busy={!!busy || supplierBusy}
            onClose={() => setDayEditing(null)}
            onSave={async (day) => {
              const itinerary = latestWorkspace.current?.itinerary;
              if (!itinerary)
                throw new Error(
                  'The daily plan is no longer available. Reopen the latest itinerary.',
                );
              await patch({
                itinerary: {
                  ...itinerary,
                  days: itinerary.days.map((item, index) => (index === dayEditing ? day : item)),
                },
              });
              setActionNotice(`Day ${day.day} updated. All other days are kept.`);
            }}
          />
        )}
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
        {dialogs}
      </div>
    );
  return (
    <Box
      asChild
      maxWidth="1600px"
      mx="auto"
      px={{ initial: '4', sm: '6' }}
      pt="6"
      pb="9"
      style={{
        /* Mid-switch the outgoing proposal is still painted, so it is dimmed and made inert:
           nothing on it can be edited while the next one is on its way. The 120ms delay keeps a
           fast switch from blinking the page. */
        opacity: switching ? 0.6 : 1,
        transition: switching ? 'opacity 160ms ease 120ms' : 'opacity 120ms ease',
      }}
    >
      <section inert={switching} aria-busy={switching || undefined}>
        {/* Agency settings live on the settings page (/settings/agency), not here. */}
        <Heading as="h1" size="7" mb="5">
          Every proposal, in one place.
        </Heading>
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
        {id ? (
          <Text as="p" size="2" color="gray">
            This workspace could not be loaded. <Link to="/studio">Return to Agent Studio.</Link>
          </Text>
        ) : (
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
                      <Button size="3" onClick={() => setCreatingProposal(true)}>
                        <Plus size={16} /> Start a proposal
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
                            {tabLabels[item.stage] || 'Brief'}
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
        )}
        {creatingProposal && (
          <CreateProposalDialog
            onClose={() => setCreatingProposal(false)}
            onCreated={(created) => {
              setCreatingProposal(false);
              navigate(`/studio/${created.id}`);
            }}
          />
        )}
        {dialogs}
      </section>
    </Box>
  );
}
/* The server builds each fact as a display string, which keeps its shape simple but leaves dates
   as ISO and money as a bare code and number. Presentation belongs here, where the app's own
   formatters live, so the card reads the way the rest of the app does rather than the way the
   record is stored. Anything unrecognised is passed through untouched. */
function factValue(id: string, value: string): string {
  if (id === 'departureDate' || id === 'startDate' || id === 'endDate')
    return readableDate(value) || value;
  if (id === 'route') return value.split(' → ').map(titleCase).join(' → ');
  if (id === 'budget') {
    const [currency, amount] = value.split(' ');
    const total = Number(amount);
    return currency && Number.isFinite(total) ? money(total, currency) : value;
  }
  if (id === 'hotelStandard') return /^\d+$/.test(value.trim()) ? `${value.trim()}-star` : value;
  if (id === 'hotelLocation' || id === 'cabin') return titleCase(value);
  return value;
}
const titleCase = (value: string) =>
  value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()).trim();

/* The one line the collapsed card has to earn its place with: where, when, and who. Counts are
   spelled out — "3 · 3" is not a party, and the labels are the half that carries the meaning once
   the table they came from is closed. */
function briefSummary(known: StudioQualification['known']): string {
  const value = (id: string) => known.find((fact) => fact.id === id)?.value;
  const parts: string[] = [];
  const route = value('route');
  if (route) parts.push(factValue('route', route));
  const start = value('startDate');
  const end = value('endDate');
  const nights = value('nights');
  if (start && end) parts.push(`${readableDate(start)} – ${readableDate(end)}`);
  else if (nights) parts.push(nights);
  else if (start) parts.push(readableDate(start));
  else if (value('dates')) parts.push('Flexible dates');
  const party: string[] = [];
  const adults = Number(value('adults'));
  const children = Number(value('children'));
  if (Number.isFinite(adults) && adults > 0)
    party.push(`${adults} adult${adults === 1 ? '' : 's'}`);
  if (Number.isFinite(children) && children > 0)
    party.push(`${children} ${children === 1 ? 'child' : 'children'}`);
  if (party.length) parts.push(party.join(', '));
  return parts.join(' · ');
}

function RouteEditor({
  workspace,
  disabled,
  onSave,
  onDirty,
}: {
  workspace: StudioWorkspace;
  disabled: boolean;
  onSave: (patch: WorkspacePatch) => Promise<StudioStop[]>;
  onDirty: (dirty: boolean) => void;
}) {
  const [stops, setStops] = useState(workspace.stops);
  const previousStops = useRef(workspace.stops);
  useEffect(() => {
    if (JSON.stringify(stops) === JSON.stringify(previousStops.current)) setStops(workspace.stops);
    previousStops.current = workspace.stops;
  }, [workspace.stops]);
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
        <Box mb="4">
          <Heading as="h2" size="6">
            The shape of the journey
          </Heading>
          <Text as="p" size="2" color="gray" mt="1">
            {stops.length
              ? `${stops.length} destinations · ${totalNights} nights${stops.some((s) => s.nights === null) ? ' confirmed so far' : ''}`
              : 'Destinations, dates and how they connect.'}
          </Text>
        </Box>
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
                onClick={() => {
                  setSaveError('');
                  void onSave({ stops })
                    .then(setStops)
                    .catch((cause) => setSaveError(cause.message));
                }}
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
  const previous = undefined as StudioClient | undefined;
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
              onChange={(e) => update({ clientName: e.target.value, clientId: '' })}
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
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Passport nationality
            </Text>
            <select
              aria-label="Passport nationality"
              value={brief.passportNationality || ''}
              onChange={(e) => update({ passportNationality: e.target.value })}
              style={{ width: '100%', padding: 10 }}
            >
              <option value="">Not supplied</option>
              {studioCountries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Trip type
            </Text>
            <select
              aria-label="Trip type"
              value={brief.tripType || 'undecided'}
              onChange={(e) => update({ tripType: e.target.value as StudioBrief['tripType'] })}
              style={{ width: '100%', padding: 10 }}
            >
              <option value="undecided">Not decided</option>
              <option value="single">Single destination</option>
              <option value="multiple">Multiple destinations · keep my order</option>
            </select>
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Travel purpose
            </Text>
            <select
              aria-label="Travel purpose"
              value={brief.tripPurpose || 'undecided'}
              onChange={(e) =>
                update({ tripPurpose: e.target.value as StudioBrief['tripPurpose'] })
              }
              style={{ width: '100%', padding: 10 }}
            >
              <option value="undecided">Not specified</option>
              <option value="tourism">Tourism / holiday</option>
              <option value="business">Business visit</option>
              <option value="study">Study</option>
              <option value="employment">Employment / paid work</option>
              <option value="other">Other / mixed purposes</option>
            </select>
          </label>
          {(['outboundTransport', 'returnTransport'] as const).map((field) => (
            <label key={field}>
              <Text as="div" size="2" weight="medium" mb="1">
                {field === 'outboundTransport' ? 'Arrival transport' : 'Return transport'}
              </Text>
              <select
                aria-label={
                  field === 'outboundTransport' ? 'Arrival transport' : 'Return transport'
                }
                value={brief[field] || 'undecided'}
                onChange={(e) => update({ [field]: e.target.value })}
                style={{ width: '100%', padding: 10 }}
              >
                <option value="undecided">Not decided</option>
                <option value="flight">Flight</option>
                <option value="cruise">Cruise</option>
              </select>
            </label>
          ))}
          <label style={spanAll}>
            <Text as="div" size="2" weight="medium" mb="1">
              Food preferences · comma separated
            </Text>
            <TextField.Root
              value={(brief.foodPreferences || []).join(', ')}
              onChange={(e) =>
                update({ foodPreferences: e.target.value.split(',').map((value) => value.trim()) })
              }
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
              Departure from origin
            </Text>
            <TextField.Root
              size="3"
              type="date"
              value={brief.departureDate || ''}
              onChange={(e) => update({ departureDate: e.target.value })}
            />
          </label>
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Arrival at first destination
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
  const [nationality, setNationality] = useState(workspace.brief.passportNationality || '');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [cabin, setCabin] = useState('');
  const [quotes, setQuotes] = useState<StudioItem[]>([]);
  const [hotelResult, setHotelResult] = useState<StudioHotelSearchResult | null>(null);
  const [warning, setWarning] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [quotedKey, setQuotedKey] = useState<string | null>(null);
  // Research metadata does not change supplier eligibility. Match actual trip/search inputs.
  const currentQuoteKey = JSON.stringify({
    workspace: workspace.id,
    accepted: workspace.structureAccepted,
    startDate: workspace.brief.startDate,
    endDate: workspace.brief.endDate,
    stops: workspace.stops.map(
      ({
        id,
        name,
        country,
        nights,
        arrivalDate,
        departureDate,
        onwardTransport,
        neighbourhood,
      }) => ({
        id,
        name,
        country,
        nights,
        arrivalDate,
        departureDate,
        onwardTransport,
        neighbourhood,
      }),
    ),
    adults: workspace.brief.adults,
    children: workspace.brief.children,
    childAges: workspace.brief.childAges,
    passportNationality: workspace.brief.passportNationality,
    currency: workspace.brief.currency,
    pricingCurrency: workspace.pricing.currency,
    hotelStandard: workspace.brief.hotelStandard,
    hotelLocation: workspace.brief.hotelLocation,
    cabin: workspace.brief.cabin,
    origin: workspace.brief.origin,
    departureDate: workspace.brief.departureDate || '',
    outbound: workspace.brief.outboundTransport || 'undecided',
    returning: workspace.brief.returnTransport || 'undecided',
    query: { kind, stopId, nationality, origin, destination, departureDate, returnDate, cabin },
  });
  const quoteLock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const searchEpoch = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    controller.current?.abort();
    searchEpoch.current++;
    setQuotes([]);
    setHotelResult(null);
    setWarning('');
    setError('');
    setBusy(false);
    quoteLock.current = false;
    setQuotedKey(null);
  }, [currentQuoteKey]);
  const stop = workspace.stops.find((s) => s.id === stopId);
  const partyConfirmed =
    !!workspace.brief.adults &&
    workspace.brief.children !== null &&
    workspace.brief.childAges.length === workspace.brief.children;
  const hotelReady =
    partyConfirmed &&
    !!stop?.arrivalDate &&
    !!stop.departureDate &&
    !!workspace.brief.hotelStandard.trim() &&
    !!workspace.brief.hotelLocation.trim();
  const flightReady =
    partyConfirmed && workspace.brief.children === 0 && !!workspace.brief.cabin.trim();
  async function search(event?: FormEvent, offset = 0) {
    event?.preventDefault();
    if (quoteLock.current) return;
    quoteLock.current = true;
    setBusy(true);
    setError('');
    if (!offset) {
      setQuotes([]);
      setHotelResult(null);
      setWarning('');
    }
    const current = ++searchEpoch.current;
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    try {
      const body =
        kind === 'hotels'
          ? {
              revision: workspace.revision,
              stopId,
              guestNationality: nationality.toUpperCase(),
              ...(offset ? { offset } : {}),
            }
          : {
              revision: workspace.revision,
              origin: origin.toUpperCase(),
              destination: destination.toUpperCase(),
              departureDate,
              ...(returnDate ? { returnDate } : {}),
              adults: workspace.brief.adults,
              cabinClass: cabin,
            };
      const result = await api<StudioHotelSearchResult>(
        `/studio/workspaces/${workspace.id}/${kind}/search`,
        { method: 'POST', body: JSON.stringify(body), signal: requestController.signal },
      );
      if (current !== searchEpoch.current) return;
      if (offset && hotelResult && Array.isArray(result.hotels)) {
        const key = (hotel: StudioHotelSearchResult['hotels'][number]) =>
          JSON.stringify([
            hotel.hotelKey,
            hotel.room,
            hotel.board,
            hotel.price,
            hotel.currency,
            hotel.checkin,
            hotel.checkout,
          ]);
        const seen = new Set(hotelResult.hotels.map(key));
        const additional = result.hotels.filter((hotel) => {
          const id = key(hotel);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        const hotels = [...hotelResult.hotels, ...additional];
        const quoteIds = new Set(additional.map((hotel) => hotel.quoteId));
        const combinedQuotes = [
          ...quotes,
          ...result.quotes.filter((quote) => quoteIds.has(quote.id)),
        ];
        setQuotes(combinedQuotes);
        setHotelResult({
          ...hotelResult,
          quotes: combinedQuotes,
          hotels,
          inventory: {
            ...result.inventory,
            returnedHotels: new Set(hotels.map((hotel) => hotel.hotelKey)).size,
            returnedQuotes: hotels.length,
            pagesSearched: hotelResult.inventory.pagesSearched + result.inventory.pagesSearched,
            limit: hotelResult.inventory.limit + result.inventory.limit,
            incomplete: hotelResult.inventory.incomplete || result.inventory.incomplete,
          },
        });
      } else {
        setQuotes(result.quotes);
        if (kind === 'hotels' && Array.isArray(result.hotels)) setHotelResult(result);
      }
      setQuotedKey(currentQuoteKey);
      setWarning(
        result.warning ||
          (result.mode === 'test'
            ? 'Sandbox quotes are simulated examples.'
            : 'Availability and prices require reconfirmation.'),
      );
      if (!result.quotes.length && !offset)
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
    if (quoteLock.current || quotedKey !== currentQuoteKey) return;
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
                              setHotelResult(null);
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
                        Confirm adults, children and each child’s age in the brief. Hotel searches
                        support families; flight searches currently support adults only.
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
                        Confirm the preferred cabin for an adults-only flight search. Family flights
                        can be added manually.
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
            {kind === 'hotels' && hotelResult && (
              <StudioHotelResults
                result={hotelResult}
                onLoadMore={() => search(undefined, hotelResult.inventory.nextOffset || 0)}
                loadingMore={busy}
                disabled={disabled || busy || quotedKey !== currentQuoteKey}
                onSelect={(quoteId) => {
                  const quote = quotes.find((q) => q.id === quoteId);
                  if (quote) return select(quote);
                }}
              />
            )}
            <Flex direction="column" gap="3" mt="4">
              {(kind === 'hotels' && hotelResult ? [] : quotes).map((quote) => (
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
                        disabled={disabled || busy || quotedKey !== currentQuoteKey}
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
