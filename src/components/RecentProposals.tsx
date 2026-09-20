import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { EllipsisVertical, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  Box,
  Button,
  Callout,
  DropdownMenu,
  Flex,
  IconButton,
  Text,
  TextField,
} from '@radix-ui/themes';
import { api, ApiError } from '../api';
import { useApp } from '../context';
import { emitStudioWorkspaceEvent } from '../studioEvents';
import { Modal } from './ui';
import { NAV_ITEM_HEIGHT, SidebarNavItem } from './SidebarNavItem';
import type { StudioWorkspace } from '../../shared/studio';

/** Five is enough to recognise last week's work and short enough to scan without a scroll. */
const RECENT_LIMIT = 5;

type RecentItem = {
  id: string;
  title: string;
  revision: number;
  pinned: boolean;
  /** Deleting a published proposal also breaks the client's link, so the confirmation says so. */
  published: boolean;
};

export type RecentProposals = {
  state: { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: RecentItem[] };
  refresh: () => void;
};

/**
 * Recent holds proposal workspaces, not trips: the panel's primary action creates a workspace, so
 * the list underneath it is the trail that action leaves, which is exactly the relationship
 * Gemini's Recent has to New chat. Pinned proposals come first and are always shown, however many
 * there are; the rest fill in newest-updated first up to RECENT_LIMIT. The list is re-read on each
 * Studio navigation, and after anything done from its own menu.
 */
export function useRecentProposals(signedIn: boolean, ownerVersion: number): RecentProposals {
  const location = useLocation();
  const studioKey = location.pathname.startsWith('/studio') ? location.pathname : '';
  const [state, setState] = useState<RecentProposals['state']>({ status: 'loading' });
  const [version, setVersion] = useState(0);
  const loadedOwner = useRef<number | null>(null);
  useEffect(() => {
    if (!signedIn) {
      loadedOwner.current = null;
      setState({ status: 'ready', items: [] });
      return;
    }
    let cancelled = false;
    /* Only the first read shows the loading note. A refresh keeps the rows on screen and swaps
       them when the answer lands; blanking them on every Studio navigation made the list collapse
       and re-expand under the row that was just clicked. */
    const sameOwner = loadedOwner.current === ownerVersion;
    loadedOwner.current = ownerVersion;
    // A different account's rows are never kept, even for the moment before its own arrive.
    setState((previous) =>
      sameOwner && previous.status === 'ready' ? previous : { status: 'loading' },
    );
    api<{ workspaces: StudioWorkspace[] }>('/studio/workspaces')
      .then((result) => {
        if (cancelled) return;
        const pinned = result.workspaces.filter((workspace) => workspace.pinnedAt);
        const rest = result.workspaces
          .filter((workspace) => !workspace.pinnedAt)
          .slice(0, RECENT_LIMIT);
        setState({
          status: 'ready',
          items: [...pinned, ...rest].map((workspace) => ({
            id: workspace.id,
            title: workspace.title.trim() || 'Untitled proposal',
            revision: workspace.revision,
            pinned: Boolean(workspace.pinnedAt),
            published: Boolean(workspace.proposal),
          })),
        });
      })
      .catch(() => {
        // A failed refresh keeps the list it already had; only a failed first read says so.
        if (!cancelled)
          setState((previous) => (previous.status === 'ready' ? previous : { status: 'error' }));
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, ownerVersion, studioKey, version]);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  return { state, refresh };
}

/** The Recent section of the sidebar: its label, its loading/empty/error lines, and its rows. */
export function RecentProposalList({ recent }: { recent: RecentProposals }) {
  const { state, refresh } = recent;
  return (
    /* The break above the section label is what separates Recent from the navigation now that
       neither list has gaps inside it; the label itself stays a step smaller than the rows beneath
       it so it reads as their heading, not as one of them. */
    <Box mt="3">
      <Box px="3" pb="1">
        <Text as="div" size="1" weight="medium" color="gray">
          Recent proposals
        </Text>
      </Box>
      <Flex direction="column" gap="0">
        {state.status === 'loading' && <SidebarNote>Looking up your recent work…</SidebarNote>}
        {state.status === 'error' && (
          <SidebarNote>Recent proposals could not be loaded.</SidebarNote>
        )}
        {state.status === 'ready' && state.items.length === 0 && (
          <SidebarNote>No proposals yet — the ones you create appear here.</SidebarNote>
        )}
        {state.status === 'ready' &&
          state.items.map((item) => (
            <RecentProposalRow key={item.id} item={item} onChanged={refresh} />
          ))}
      </Flex>
    </Box>
  );
}

/** One line of panel prose — the loading, empty and error voices of Recent. */
function SidebarNote({ children }: { children: ReactNode }) {
  return (
    /* Its own vertical padding, because the list it sits in no longer has a gap to give it. */
    <Box px="3" py="1">
      <Text as="div" size="1" color="gray">
        {children}
      </Text>
    </Box>
  );
}

/** False on touch-only screens, where a control that waits for hover would never appear. */
function useCanHover() {
  const query = '(hover: hover)';
  const [canHover, setCanHover] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setCanHover(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return canHover;
}

/**
 * A Recent row with Gemini's overflow menu: Pin, Rename and Delete behind a ⋮ button at its
 * trailing edge. The button is a sibling laid over the link, not inside it — a button nested in an
 * <a> is invalid and breaks both. It shows while the row is hovered, focused or open, on the
 * current proposal, and always on screens that cannot hover; otherwise a pinned row shows its pin
 * there instead. It stays in the tab order even while faded out, so keyboard users reach it.
 */
function RecentProposalRow({ item, onChanged }: { item: RecentItem; onChanged: () => void }) {
  const { toast } = useApp();
  const location = useLocation();
  const canHover = useCanHover();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  /* Focus is read from the document rather than from this row's own focus/blur events: React
     bubbles focus from the portalled menu and dialogs up to this row, and pinning reorders the
     rows under a focused button, so row-local events are not a reliable record of where focus is. */
  useEffect(() => {
    const update = () => setFocused(Boolean(row.current?.contains(document.activeElement)));
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);
  // And re-read once the list has re-rendered after a change, when no focus event may follow.
  useEffect(() => {
    setFocused(Boolean(row.current?.contains(document.activeElement)));
  }, [item.pinned, item.title]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = location.pathname === `/studio/${item.id}`;
  const showMenu = hovered || focused || menuOpen || current || !canHover;
  /* Dialogs hand focus back to whatever held it when they opened. A menu item is gone by then, so
     the ⋮ button is focused first, on the frame after the menu unmounts, and closing the dialog
     lands back on it. */
  const openDialog = (kind: 'rename' | 'delete') => () =>
    requestAnimationFrame(() => {
      trigger.current?.focus();
      setDialog(kind);
    });

  async function togglePin() {
    try {
      const result = await api<{ workspace: StudioWorkspace }>(
        `/studio/workspaces/${item.id}/pin`,
        { method: 'PUT', body: JSON.stringify({ pinned: !item.pinned }) },
      );
      emitStudioWorkspaceEvent({ type: 'updated', workspace: result.workspace });
      onChanged();
    } catch (cause) {
      toast((cause as Error).message);
    }
  }

  return (
    <Box
      ref={row}
      position="relative"
      /* The menu renders in a portal, and React still bubbles its pointer events up to this row;
         only count the pointer when it is over the row's own DOM. */
      onPointerEnter={(event) =>
        event.pointerType !== 'touch' &&
        event.currentTarget.contains(event.target as Node) &&
        setHovered(true)
      }
      onPointerLeave={() => setHovered(false)}
    >
      <SidebarNavItem
        to={`/studio/${item.id}`}
        label={item.title}
        collapsed={false}
        end
        forceHover={hovered || menuOpen}
        trailingSpace
      />
      <Flex
        position="absolute"
        top="0"
        right="0"
        align="center"
        justify="center"
        style={{ width: NAV_ITEM_HEIGHT, height: NAV_ITEM_HEIGHT }}
      >
        {item.pinned && !showMenu && (
          <Flex position="absolute" style={{ color: 'var(--gray-10)', pointerEvents: 'none' }}>
            <Pin size={14} aria-hidden="true" />
          </Flex>
        )}
        <DropdownMenu.Root
          open={menuOpen}
          onOpenChange={(open) => {
            setMenuOpen(open);
            /* The menu unmounts from under the pointer, so no leave event follows and the row
               would stay "hovered". The next move over the row sets it again. */
            if (!open) setHovered(false);
          }}
        >
          <DropdownMenu.Trigger>
            <IconButton
              ref={trigger}
              size="3"
              variant="ghost"
              color="gray"
              aria-label={`More options for ${item.title}`}
              style={{
                margin: 0,
                opacity: showMenu ? 1 : 0,
                transition: 'opacity 120ms ease-out',
              }}
            >
              <EllipsisVertical size={16} />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content size="2" align="start">
            <DropdownMenu.Item onSelect={() => void togglePin()}>
              {item.pinned ? (
                <>
                  <PinOff size={15} aria-hidden="true" /> Unpin
                </>
              ) : (
                <>
                  <Pin size={15} aria-hidden="true" /> Pin
                </>
              )}
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={openDialog('rename')}>
              <Pencil size={15} aria-hidden="true" /> Rename
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item color="red" onSelect={openDialog('delete')}>
              <Trash2 size={15} aria-hidden="true" /> Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Flex>
      {dialog === 'rename' && (
        <RenameProposalDialog item={item} onClose={() => setDialog(null)} onRenamed={onChanged} />
      )}
      {dialog === 'delete' && (
        <DeleteProposalDialog
          item={item}
          current={current}
          onClose={() => setDialog(null)}
          onDeleted={onChanged}
        />
      )}
    </Box>
  );
}

function RenameProposalDialog({
  item,
  onClose,
  onRenamed,
}: {
  item: RecentItem;
  onClose: () => void;
  onRenamed: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = title.trim();
    if (!next || next === item.title) return onClose();
    setBusy(true);
    setError('');
    const save = (revision: number) =>
      api<{ workspace: StudioWorkspace }>(`/studio/workspaces/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ revision, title: next }),
      });
    try {
      let result;
      try {
        result = await save(item.revision);
      } catch (cause) {
        /* The list's revision is stale whenever the proposal was edited in Studio since the list
           was read. A title is safe to reapply on top of the latest version, so retry once. */
        if (!(cause instanceof ApiError && cause.status === 409)) throw cause;
        const latest = await api<{ workspace: StudioWorkspace }>(`/studio/workspaces/${item.id}`);
        result = await save(latest.workspace.revision);
      }
      emitStudioWorkspaceEvent({ type: 'updated', workspace: result.workspace });
      onRenamed();
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Rename proposal" onClose={onClose}>
      <form onSubmit={submit}>
        <Flex direction="column" gap="4" mt="2">
          <label>
            <Text as="div" size="2" weight="medium" mb="1">
              Proposal name
            </Text>
            <TextField.Root
              size="3"
              required
              maxLength={200}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {error && (
            <Callout.Root color="red" role="alert" size="1">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
          <Flex gap="3" justify="end">
            <Button type="button" size="3" variant="soft" color="gray" onClick={onClose}>
              Cancel
            </Button>
            <Button size="3" loading={busy} disabled={busy || !title.trim()}>
              Save
            </Button>
          </Flex>
        </Flex>
      </form>
    </Modal>
  );
}

function DeleteProposalDialog({
  item,
  current,
  onClose,
  onDeleted,
}: {
  item: RecentItem;
  current: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useApp();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api(`/studio/workspaces/${item.id}`, { method: 'DELETE' });
      emitStudioWorkspaceEvent({ type: 'deleted', id: item.id });
      // Leaving the deleted proposal's page before the list refreshes, so it never 404s in place.
      if (current) navigate('/studio');
      onDeleted();
      onClose();
      toast('Proposal deleted.');
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialog.Content maxWidth="440px">
        <AlertDialog.Title>Delete this proposal?</AlertDialog.Title>
        <AlertDialog.Description size="2">
          “{item.title}” will be permanently deleted, with its conversation, route and services.
          {item.published && ' Its published client link will stop working.'}
        </AlertDialog.Description>
        {error && (
          <Callout.Root color="red" role="alert" size="1" mt="3">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button size="3" variant="soft" color="gray" disabled={busy}>
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <Button size="3" color="red" loading={busy} onClick={() => void remove()}>
            Delete
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
