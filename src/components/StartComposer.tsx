import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUp,
  CircleAlert,
  FileText,
  Image as ImageIcon,
  Link2,
  Mic,
  Paperclip,
  Plus,
  Square,
  X,
} from 'lucide-react';
import {
  Box,
  Button,
  Callout,
  DropdownMenu,
  Flex,
  IconButton,
  Spinner,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes';
import { api } from '../api';
import { Modal } from './ui';
import {
  previewStudioImport,
  studioImportFileProblem,
  studioImportFromFile,
  useStudioDictation,
} from './StudioImportComposer';
import type { StudioImport, StudioWorkspace } from '../../shared/studio';
import type { StudioImportInput } from '../../shared/studio-imports';
import { STUDIO_IMPORT_MAX_TEXT } from '../../shared/studio-imports';

/** A source the agent has attached but not yet committed to a workspace. Held in memory only:
    extraction runs against the workspace-free preview endpoint, and the text is written to a
    workspace by the one submit below. A refresh before submit loses these, by design for now. */
type HeldSource = {
  id: string;
  kind: StudioImport['kind'];
  /** What the chip reads: the file's name, or the label the importer gave the paste. */
  label: string;
  name: string;
  text: string;
  sourceUrl: string;
  status: 'pending' | 'ready' | 'error';
  error: string;
  /** Set once the source is on the workspace, so a retry after a later failure cannot double it. */
  saved: boolean;
};

/* The composer's errors are made of the composer's own material — the solid panel colour of the
   pill, with the tray's 16px corner and the lightest of the shadows — and keep red for the one mark
   that means "error": the icon. The failed source is already red on its own chip inside the pill.

   Two fills were tried before this and both were wrong for the hero. Radix's soft callout fills with
   an alpha red, which composited with the blue glow behind it into a muddy violet; a solid red-3 fixed
   that but became a salmon slab, a third material beside the white pill and the grey tray, and the
   heaviest thing on screen — louder than the control it was reporting on. A white notice with a red
   glyph says the same thing at the weight of a footnote.

   The text is the grey scale's high-contrast step (colour gray + highContrast), about 16:1 on the
   panel; the icon is red-11, well past the 3:1 a non-text mark owes. */
const NOTICE = {
  backgroundColor: 'var(--color-panel-solid)',
  borderRadius: 'var(--radius-6)',
  boxShadow: 'var(--shadow-1)',
} as const;
const NOTICE_ICON = { color: 'var(--red-11)' } as const;

const kindIcon = (kind: StudioImport['kind']) =>
  kind === 'image' ? ImageIcon : kind === 'url' ? Link2 : kind === 'audio' ? Mic : FileText;

/** True where the device cannot hover, so a hover-revealed control has to be shown outright. It is
    a media query rather than a width, because a wide touchscreen has no hover either. */
function useCoarsePointer() {
  const [coarse, setCoarse] = useState(() => window.matchMedia?.('(hover: none)').matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.('(hover: none)');
    if (!query) return;
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return coarse;
}

/** The composer that starts a proposal: the typed brief, the sources it arrives with, and the one
    submit that turns both into a workspace. Used by the home hero and the Studio landing, so an
    agent meets the same control wherever they begin. */
export function StartComposer({
  initialMessage = '',
  maxLength = 4000,
  heroAnchor = false,
  prepareMessage,
  tray,
}: {
  /** A brief carried in from elsewhere, e.g. an inspiration card's `?q=`. */
  initialMessage?: string;
  maxLength?: number;
  /** Marks the pill as the element the home hero's heading rises from. */
  heroAnchor?: boolean;
  /** Lets a page fold its own details into the typed brief before it is sent for review. */
  prepareMessage?: (text: string) => string;
  /** A strip attached to the pill's underside, such as the home hero's trip details. It is
      rendered here rather than beside the composer because it has to sit directly under the pill:
      it tucks its top edge behind it, so anything drawn between the two — the errors below, for
      one — would have the strip tucked behind that instead, covering it. */
  tray?: ReactNode;
} = {}) {
  const navigate = useNavigate();
  const [message, setMessage] = useState(initialMessage);
  const [sources, setSources] = useState<HeldSource[]>([]);
  const [mode, setMode] = useState<'text' | 'url' | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const coarsePointer = useCoarsePointer();
  const fileInput = useRef<HTMLInputElement>(null);
  const draftField = useRef<HTMLElement | null>(null);
  /* Submit reads the sources through this ref: it has to see extractions that settled while it was
     awaiting them, which the render closure's copy cannot show it. */
  const held = useRef<HeldSource[]>([]);
  const extracting = useRef(new Map<string, Promise<void>>());
  /* The workspace a failed submit already created, so pressing send again resumes it rather than
     leaving an empty workspace behind on every attempt. */
  const created = useRef<StudioWorkspace | null>(null);

  const apply = (change: (previous: HeldSource[]) => HeldSource[]) => {
    held.current = change(held.current);
    setSources(held.current);
  };
  const update = (id: string, patch: Partial<HeldSource>) =>
    apply((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  /* One source, one chip, one preview call. The chip exists before the call returns so the agent
     can see the source is being read, and it keeps its place whether the call succeeds or fails. */
  function attach(input: StudioImportInput, label: string) {
    const id = crypto.randomUUID();
    setError('');
    apply((previous) => [
      ...previous,
      {
        id,
        kind: input.kind,
        label,
        name: input.name,
        text: input.text || '',
        sourceUrl: '',
        status: 'pending',
        error: '',
        saved: false,
      },
    ]);
    const running = (async () => {
      try {
        const result = await previewStudioImport(input);
        update(id, {
          status: 'ready',
          kind: result.import.kind,
          name: result.import.name,
          label: result.import.name || label,
          text: result.import.text,
          sourceUrl: result.import.sourceUrl || '',
          error: '',
        });
      } catch (caught) {
        update(id, {
          status: 'error',
          error:
            caught instanceof Error
              ? caught.message
              : 'Could not read this source. Please paste the text instead.',
        });
      } finally {
        extracting.current.delete(id);
      }
    })();
    extracting.current.set(id, running);
  }

  function chooseFile(file?: File) {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    const problem = studioImportFileProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    const label = file.name.slice(0, 160);
    setError('');
    void studioImportFromFile(file).then(
      (input) => attach(input, label),
      (caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'Could not read this file.'),
    );
  }

  /* Dictation is one of the sources the + menu brings in, so it ends where the others do: a chip
     that reads itself and can be removed. The recorder itself is the in-workspace composer's,
     shared rather than copied, so the failures an agent can meet are worded once. */
  const dictation = useStudioDictation({
    onStart: () => setError(''),
    onCaptured: (input) => attach(input, 'Voice brief'),
    onError: setError,
  });

  function addDraft() {
    const value = draft.trim();
    if (!value) return;
    attach(
      mode === 'url'
        ? { kind: 'url', name: 'Tour / cruise link', url: value }
        : { kind: 'text', name: 'Client notes / PNR', text: value },
      mode === 'url' ? value : 'Client notes / PNR',
    );
    setDraft('');
    setMode(null);
  }

  function openDraft(next: 'text' | 'url') {
    setError('');
    setDraft('');
    setMode(next);
    requestAnimationFrame(() => draftField.current?.focus());
  }

  /* The whole start of a proposal, in one press: create the workspace, put every held source on
     it, then send the typed brief for review and open the canvas. Extractions still running are
     waited for rather than dropped, and nothing is created when there is nothing to send. */
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const typed = message.trim();
    if (!typed && !held.current.length) return;
    setBusy(true);
    setError('');
    try {
      if (extracting.current.size) await Promise.allSettled([...extracting.current.values()]);
      if (held.current.some((source) => source.status === 'error')) {
        setError('Remove the sources that could not be read, then start again.');
        return;
      }
      const pending = held.current.filter((source) => !source.saved && source.text.trim());
      const brief =
        (prepareMessage ? prepareMessage(message) : typed) ||
        'Review the imported client information and tell me which details need clarification.';
      let workspace: StudioWorkspace =
        created.current ??
        (
          await api<{ workspace: StudioWorkspace }>('/studio/workspaces', {
            method: 'POST',
            body: '{}',
          })
        ).workspace;
      created.current = workspace;
      for (const source of pending) {
        const result = await api<{ workspace: StudioWorkspace }>(
          `/studio/workspaces/${workspace.id}/import`,
          {
            method: 'POST',
            body: JSON.stringify({
              revision: workspace.revision,
              kind: source.kind,
              name: source.name,
              text: source.text,
              ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
            }),
          },
        );
        workspace = result.workspace;
        created.current = workspace;
        update(source.id, { saved: true });
      }
      /* Go the moment the workspace exists, and let the review run in the workspace. Reviewing
         first meant standing on this page watching a button spin for as long as the model took —
         a minute is possible — and then swapping the whole screen at once. The workspace already
         knows how to pick a carried brief up from `?q=`: it shows the turn straight away and waits
         for Tara there, beside the canvas that is about to fill in. */
      navigate(`/studio/${workspace.id}?q=${encodeURIComponent(brief)}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The workspace could not be started. Your brief and sources are still here.',
      );
    } finally {
      setBusy(false);
    }
  }

  const open = sources.length > 0 || !!mode || dictation.recording || dictation.requestingMic;
  const shown = sources.find((source) => source.id === viewing);
  return (
    <Flex direction="column" gap="3" width="100%" maxWidth="688px">
      {/* The pill and its tray are one control, so they share a gapless group of their own; the
          errors and the source viewer come after the whole of it, where they cannot come between
          the pill and the strip that is attached to it. */}
      <Flex direction="column" align="center" width="100%">
        {/* One pill holding the + menu, the sources it brings in, the prompt and the send button, so
          the start of a proposal reads as a single control rather than a card of controls. The
          surface belongs to the form, not to the field: the field keeps its own focus ring but
          drops its paint, so the three sit on one continuous pill. Pill-ness comes from Radix's
          own --radius-full, which data-radius="full" defines on this element (the theme radius is
          "medium", where that variable is 0px), so no literal radius. Once the composer holds
          something above the input row it steps down to --radius-6, which the same attribute
          scales, because a stadium corner would clip the first and last chip. The solid panel
          colour also keeps the placeholder off the drifting glow behind it. */}
        <Box
          asChild
          width="100%"
          p="2"
          data-radius="full"
          {...(heroAnchor ? { 'data-hero-composer': '' } : {})}
          position="relative"
          style={{
            background: 'var(--color-panel-solid)',
            boxShadow: 'var(--shadow-3)',
            borderRadius: open ? 'var(--radius-6)' : 'var(--radius-full)',
            /* Lifts the pill, and everything in it, above the hero heading's entrance so the text
             rises out from under an opaque bar instead of sliding across it. This is a stacking
             context inside the hero's already-lifted container, not a new layer at section
             level, so nothing else on the page changes order. */
            zIndex: 1,
          }}
        >
          <form onSubmit={submit}>
            <Flex direction="column" gap="2">
              {sources.length > 0 && (
                <Flex gap="4" wrap="wrap" px="1" pt="1" role="group" aria-label="Attached sources">
                  {sources.map((source, index) => {
                    const Icon = kindIcon(source.kind);
                    /* The cross lives inside the chip and stays out of the way until it is wanted.
                     It keeps its space at rest, so a chip is the same size hovered or not, and it
                     is revealed by focus as well as by the pointer — otherwise it could not be
                     reached by keyboard at all. Where there is no hover to give (a touchscreen,
                     whatever the window's width) it is simply always shown. */
                    const revealed =
                      coarsePointer || hovered === source.id || focused === source.id;
                    return (
                      <Flex
                        key={source.id}
                        align="center"
                        gap="2"
                        p="1"
                        maxWidth="100%"
                        style={{
                          background:
                            source.status === 'error' ? 'var(--red-a3)' : 'var(--gray-a3)',
                          borderRadius: 'var(--radius-4)',
                        }}
                        onPointerEnter={() => setHovered(source.id)}
                        onPointerLeave={() => setHovered((id) => (id === source.id ? null : id))}
                        onFocus={() => setFocused(source.id)}
                        onBlur={() => setFocused((id) => (id === source.id ? null : id))}
                      >
                        <Button
                          type="button"
                          size="3"
                          variant="ghost"
                          color={source.status === 'error' ? 'red' : 'gray'}
                          disabled={source.status === 'pending'}
                          /* Ghost keeps the chip reading as one surface; the padding restores the
                           40px target and the reset margin restores the 8px to the cross, both of
                           which the variant's own negative margin would otherwise eat. */
                          style={{ margin: 0, padding: 'var(--space-2) var(--space-3)' }}
                          onClick={() => setViewing(source.id)}
                        >
                          {source.status === 'pending' ? (
                            <Spinner size="1" />
                          ) : source.status === 'error' ? (
                            <CircleAlert size={15} aria-hidden="true" />
                          ) : (
                            <Icon size={15} aria-hidden="true" />
                          )}
                          <Text truncate style={{ maxWidth: '18ch' }}>
                            {source.label}
                          </Text>
                          {source.status === 'pending' && <Text size="1">Reading…</Text>}
                        </Button>
                        <IconButton
                          type="button"
                          size="3"
                          variant="soft"
                          color={source.status === 'error' ? 'red' : 'gray'}
                          /* Several chips can carry the same label, so the position names which. */
                          aria-label={`Remove source ${index + 1}, ${source.label}`}
                          style={{ opacity: revealed ? 1 : 0 }}
                          onClick={() => {
                            extracting.current.delete(source.id);
                            apply((previous) => previous.filter((item) => item.id !== source.id));
                          }}
                        >
                          <X size={16} />
                        </IconButton>
                      </Flex>
                    );
                  })}
                </Flex>
              )}
              {mode && (
                <Box p="2">
                  <Flex direction="column" gap="2">
                    <Text as="label" htmlFor="start-composer-source" size="2" weight="medium">
                      {mode === 'url'
                        ? 'Public tour or cruise page'
                        : 'Client email, PNR or travel notes'}
                    </Text>
                    {mode === 'url' ? (
                      <TextField.Root
                        size="3"
                        id="start-composer-source"
                        ref={(node) => {
                          draftField.current = node;
                        }}
                        type="url"
                        value={draft}
                        maxLength={2048}
                        placeholder="https://…"
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          addDraft();
                        }}
                      />
                    ) : (
                      <TextArea
                        size="3"
                        id="start-composer-source"
                        ref={(node) => {
                          draftField.current = node;
                        }}
                        rows={5}
                        value={draft}
                        maxLength={STUDIO_IMPORT_MAX_TEXT}
                        placeholder="Paste your source here. Tara will read it before anything is added."
                        onChange={(event) => setDraft(event.target.value)}
                      />
                    )}
                    <Flex gap="2" wrap="wrap">
                      <Button
                        type="button"
                        size="3"
                        variant="soft"
                        disabled={!draft.trim()}
                        onClick={addDraft}
                      >
                        Add source
                      </Button>
                      <Button
                        type="button"
                        size="3"
                        variant="soft"
                        color="gray"
                        onClick={() => {
                          setDraft('');
                          setMode(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </Flex>
                  </Flex>
                </Box>
              )}
              {(dictation.recording || dictation.requestingMic) && (
                <Box p="2">
                  <Flex align="center" justify="between" gap="3" wrap="wrap">
                    <Flex align="center" gap="2" role="status">
                      {dictation.recording ? (
                        <Mic size={16} aria-hidden="true" />
                      ) : (
                        <Spinner size="1" />
                      )}
                      <Text size="2">
                        {dictation.recording
                          ? 'Recording your brief · up to 2 minutes'
                          : 'Waiting for microphone permission'}
                      </Text>
                    </Flex>
                    <Flex gap="2" wrap="wrap">
                      <Button
                        type="button"
                        size="3"
                        variant="soft"
                        color="red"
                        disabled={!dictation.recording}
                        onClick={dictation.stop}
                      >
                        <Square size={15} /> Stop & transcribe
                      </Button>
                      <Button
                        type="button"
                        size="3"
                        variant="soft"
                        color="gray"
                        onClick={dictation.cancel}
                      >
                        Cancel recording
                      </Button>
                    </Flex>
                  </Flex>
                </Box>
              )}
              <Flex align="center" gap="2">
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    <IconButton
                      type="button"
                      size="3"
                      variant="soft"
                      color="gray"
                      radius="full"
                      aria-label="Bring in a source"
                    >
                      <Plus size={20} />
                    </IconButton>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content size="2" align="start">
                    <DropdownMenu.Label>Start from what you already have</DropdownMenu.Label>
                    <DropdownMenu.Item onSelect={() => fileInput.current?.click()}>
                      <Paperclip size={15} aria-hidden="true" /> Attach a file
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={() => openDraft('text')}>
                      <FileText size={15} aria-hidden="true" /> Paste an email or PNR
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onSelect={() => openDraft('url')}>
                      <Link2 size={15} aria-hidden="true" /> Add a tour link
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      disabled={dictation.recording || dictation.requestingMic}
                      onSelect={() => void dictation.start()}
                    >
                      <Mic size={15} aria-hidden="true" /> Dictate
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
                <input
                  ref={fileInput}
                  type="file"
                  aria-label="Attach a screenshot, PDF or audio file"
                  hidden
                  accept="image/png,image/jpeg,image/webp,application/pdf,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/webm"
                  onChange={(event) => chooseFile(event.target.files?.[0])}
                />
                <Box flexGrow="1" minWidth="0">
                  <TextField.Root
                    size="3"
                    radius="full"
                    aria-label="Tell Tara about your trip"
                    placeholder="Tell Tara about the trip…"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    maxLength={maxLength}
                    style={{ background: 'transparent', boxShadow: 'none' }}
                  />
                </Box>
                <IconButton
                  type="submit"
                  size="3"
                  radius="full"
                  loading={busy}
                  disabled={
                    busy ||
                    dictation.recording ||
                    dictation.requestingMic ||
                    (!message.trim() && !sources.length)
                  }
                  aria-label="Start planning your trip"
                >
                  <ArrowUp size={20} />
                </IconButton>
              </Flex>
            </Flex>
          </form>
        </Box>
        {tray}
      </Flex>
      {/* A source that could not be read says so twice: in red on its own chip, and in words
          under the pill. Nothing is dropped quietly. */}
      {sources
        .filter((source) => source.status === 'error')
        .map((source) => (
          <Callout.Root
            key={source.id}
            color="gray"
            size="1"
            role="alert"
            highContrast
            className={tray ? 'composer-feedback' : undefined}
            style={NOTICE}
          >
            <Callout.Icon>
              <CircleAlert size={16} style={NOTICE_ICON} />
            </Callout.Icon>
            <Callout.Text>
              {/* The name is what the agent scans for when more than one file is held, so it is
                  set apart from the reason rather than run into it. */}
              <Text weight="medium">{source.label}</Text> — {source.error}
            </Callout.Text>
          </Callout.Root>
        ))}
      {error && (
        <Callout.Root
          color="gray"
          size="1"
          role="alert"
          highContrast
          className={tray ? 'composer-feedback' : undefined}
          style={NOTICE}
        >
          <Callout.Icon>
            <CircleAlert size={16} style={NOTICE_ICON} />
          </Callout.Icon>
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      {shown && (
        <Modal title={shown.name || shown.label} onClose={() => setViewing(null)}>
          <Flex direction="column" gap="3" mt="2">
            <Text size="2" color="gray">
              {shown.status === 'error'
                ? shown.error
                : 'Extracted text. Check dates, names and prices before you send the brief.'}
            </Text>
            {shown.status === 'ready' && (
              <Box
                p="2"
                style={{
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  maxHeight: 320,
                  overflowY: 'auto',
                  background: 'var(--gray-a2)',
                  borderRadius: 'var(--radius-2)',
                }}
              >
                <Text size="2">{shown.text}</Text>
              </Box>
            )}
            {shown.sourceUrl && (
              <Text size="2" asChild>
                <a href={shown.sourceUrl} target="_blank" rel="noopener noreferrer">
                  Open source page
                </a>
              </Text>
            )}
          </Flex>
        </Modal>
      )}
    </Flex>
  );
}
