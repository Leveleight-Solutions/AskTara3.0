import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CircleAlert,
  CircleCheck,
  FileText,
  Link,
  Lock,
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
  Card,
  DropdownMenu,
  Flex,
  IconButton,
  Reset,
  Spinner,
  Text,
  TextArea,
  TextField,
} from '@radix-ui/themes';
import { api } from '../api';
import type { StudioImport, StudioWorkspace } from '../../shared/studio';
import type { StudioImportInput } from '../../shared/studio-imports';
import { STUDIO_IMPORT_MAX_BYTES, STUDIO_IMPORT_MAX_TEXT } from '../../shared/studio-imports';

const fileData = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The file could not be read. Please try again.'));
    reader.readAsDataURL(file);
  });

/** The affordance a handoff from elsewhere in the app wants this composer to open in. */
export type StudioImportMode = 'text' | 'url' | 'file';

/** The one call that turns a source into extracted text. It needs a session but no workspace, so
    the start composer uses it before a workspace exists; this composer uses it inside one. Both go
    through here so the endpoint, the request shape and the message an agent sees stay in one
    place. */
export const previewStudioImport = (input: StudioImportInput, signal?: AbortSignal) =>
  api<{ import: StudioImport }>('/studio/import/preview', {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });

const fileMime = (file: File) => file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : '');
const fileKind = (file: File): StudioImport['kind'] | null => {
  const mime = fileMime(file);
  return mime.startsWith('image/')
    ? 'image'
    : mime === 'application/pdf'
      ? 'pdf'
      : mime.startsWith('audio/')
        ? 'audio'
        : null;
};

/** Empty when the chosen file can be sent, otherwise the reason the agent needs to read. */
export function studioImportFileProblem(file: File): string {
  if (file.size > STUDIO_IMPORT_MAX_BYTES) return 'Choose a file smaller than 5 MB.';
  if (!fileKind(file))
    return 'Choose a PNG, JPEG, WebP, PDF, MP3, WAV, M4A or WebM file, or paste the text.';
  return '';
}

/** Reads a file the check above accepted into the input the preview call takes. */
export async function studioImportFromFile(file: File): Promise<StudioImportInput> {
  const kind = fileKind(file);
  if (!kind)
    throw new Error(
      'Choose a PNG, JPEG, WebP, PDF, MP3, WAV, M4A or WebM file, or paste the text.',
    );
  const data = await fileData(new Blob([file], { type: fileMime(file).split(';')[0] }));
  return { kind, name: file.name.slice(0, 160), data };
}

/** The one microphone in the app: permission, the recording itself, the two-minute and 5 MB caps,
    and the audio source it hands back. Both composers use this, so a dictated brief behaves the
    same wherever it is started and every failure an agent can meet is worded once. */
export function useStudioDictation({
  onStart,
  onCaptured,
  onError,
}: {
  /** Runs before permission is asked, so the host can clear the messages it is showing. */
  onStart?: () => void;
  /** The finished recording, ready for the preview call. */
  onCaptured: (input: StudioImportInput) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [requestingMic, setRequestingMic] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelled = useRef(false);
  /* Bumped by every cancel and unmount, so a recording that finishes afterwards is dropped
     instead of arriving in a composer that has moved on. */
  const version = useRef(0);
  const mounted = useRef(true);
  /* The host's handlers change on every render; the recorder callbacks below read them from here
     so `start` can stay stable and still call the current ones. */
  const handlers = useRef({ onStart, onCaptured, onError });
  handlers.current = { onStart, onCaptured, onError };

  const stopTracks = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /** Drops the recording and the microphone without producing a source. */
  const cancel = useCallback(() => {
    version.current++;
    cancelled.current = true;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stopTracks();
    if (mounted.current) {
      setRecording(false);
      setRequestingMic(false);
    }
  }, [stopTracks]);

  /** Ends the recording and keeps it: the audio becomes a source. */
  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    handlers.current.onStart?.();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      handlers.current.onError(
        'Voice recording is unavailable in this browser. Type your brief or upload an audio file.',
      );
      return;
    }
    const current = ++version.current;
    cancelled.current = false;
    setRequestingMic(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || current !== version.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!mime) {
        stopTracks();
        handlers.current.onError(
          'This browser cannot record a supported format. Type your brief or upload an audio file.',
        );
        return;
      }
      const recordingDevice = new MediaRecorder(media, { mimeType: mime });
      recorder.current = recordingDevice;
      const chunks: Blob[] = [];
      let bytes = 0;
      recordingDevice.ondataavailable = (event) => {
        bytes += event.data.size;
        if (bytes > STUDIO_IMPORT_MAX_BYTES) {
          cancelled.current = true;
          recordingDevice.stop();
          stopTracks();
          if (mounted.current) {
            setRecording(false);
            handlers.current.onError('The recording reached 5 MB. Record a shorter brief.');
          }
        } else if (event.data.size) chunks.push(event.data);
      };
      recordingDevice.onerror = () => {
        cancelled.current = true;
        stopTracks();
        if (mounted.current) {
          setRecording(false);
          handlers.current.onError('Recording failed. You can type your brief instead.');
        }
      };
      recordingDevice.onstop = async () => {
        stopTracks();
        if (!mounted.current || cancelled.current || current !== version.current) return;
        setRecording(false);
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        if (!blob.size) {
          handlers.current.onError('No audio was captured. Try again or type your brief.');
          return;
        }
        try {
          const data = await fileData(blob);
          if (mounted.current && !cancelled.current && current === version.current)
            await handlers.current.onCaptured({ kind: 'audio', name: 'Voice brief', data });
        } catch {
          if (mounted.current)
            handlers.current.onError(
              'The recording could not be read. Try again or type your brief.',
            );
        }
      };
      recordingDevice.start(1000);
      setRecording(true);
      timer.current = setTimeout(() => {
        if (recordingDevice.state === 'recording') recordingDevice.stop();
      }, 120_000);
    } catch {
      stopTracks();
      if (mounted.current && current === version.current)
        handlers.current.onError(
          'Microphone access was not available. Allow it in your browser or type your brief.',
        );
    } finally {
      if (mounted.current && current === version.current) setRequestingMic(false);
    }
  }, [stopTracks]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      version.current++;
      cancelled.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stopTracks();
    };
  }, [stopTracks]);

  return { recording, requestingMic, start, stop, cancel };
}

export function StudioImportComposer({
  workspace,
  onChange,
  disabled = false,
  field,
  send,
  corner,
  stacked = false,
  openMode,
}: {
  workspace: StudioWorkspace;
  onChange: (workspace: StudioWorkspace) => void;
  disabled?: boolean;
  /** The message field, rendered inside the pill. */
  field?: ReactNode;
  /** The send button. */
  send?: ReactNode;
  /** A control for the pill's top-right corner while stacked — the expand toggle. */
  corner?: ReactNode;
  /** The text has outgrown one line: the field spans the pill and the buttons drop below it. */
  stacked?: boolean;
  /** A handoff from elsewhere — the canvas asking for a source — bumped by nonce so the same
      affordance can be asked for twice. */
  openMode?: { mode: StudioImportMode; nonce: number } | null;
}) {
  const [mode, setMode] = useState<'text' | 'url' | null>(null);
  /* The focus ring belongs to the pill, not to the field inside it: a ring around the text alone
     reads as a box within a box once the field spans the stacked pill. */
  const [fieldFocused, setFieldFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState<StudioImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [extractingId, setExtractingId] = useState('');
  const [extractedIds, setExtractedIds] = useState<string[]>([]);
  const requestIds = useRef(new Map<string, string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const draftField = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const operationVersion = useRef(0);
  const mounted = useRef(true);

  const dictation = useStudioDictation({
    onStart: () => {
      setError('');
      setNotice('');
    },
    onCaptured: (input) => extract(input),
    onError: setError,
  });
  const cancelDictation = dictation.cancel;

  const cancel = () => {
    operationVersion.current++;
    operation.current?.abort();
    cancelDictation();
    setExtractingId('');
    setBusy(false);
    setPreview(null);
    setMode(null);
    setError('');
  };
  useEffect(() => {
    mounted.current = true;
    setPreview(null);
    setMode(null);
    setDraft('');
    setNotice('');
    setError('');
    setBusy(false);
    setExtractedIds([]);
    requestIds.current.clear();
    return () => {
      mounted.current = false;
      operationVersion.current++;
      operation.current?.abort();
      cancelDictation();
    };
  }, [workspace.id, cancelDictation]);

  useEffect(() => {
    if (!openMode) return;
    if (openMode.mode === 'file') {
      fileInput.current?.click();
      return;
    }
    setMode(openMode.mode);
    setDraft('');
    setPreview(null);
    pendingFocus.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMode?.nonce]);
  useEffect(() => {
    if (!mode || !pendingFocus.current) return;
    pendingFocus.current = false;
    draftField.current?.focus();
  }, [mode]);

  const extract = async (input: StudioImportInput) => {
    const version = ++operationVersion.current;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await previewStudioImport(input, controller.signal);
      if (mounted.current && version === operationVersion.current) {
        setPreview(result.import);
        setMode(null);
      }
    } catch (caught) {
      if (mounted.current && version === operationVersion.current && !controller.signal.aborted)
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not read this source. Please paste the text instead.',
        );
    } finally {
      if (mounted.current && version === operationVersion.current) setBusy(false);
    }
  };

  const upload = async (file?: File) => {
    if (!file) return;
    setError('');
    setNotice('');
    const problem = studioImportFileProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    const version = operationVersion.current;
    try {
      const input = await studioImportFromFile(file);
      if (mounted.current && version === operationVersion.current) await extract(input);
    } catch (caught) {
      if (mounted.current)
        setError(caught instanceof Error ? caught.message : 'Could not read this file.');
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const save = async () => {
    if (!preview?.text.trim()) return;
    const version = ++operationVersion.current;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ workspace: StudioWorkspace; import: StudioImport }>(
        `/studio/workspaces/${workspace.id}/import`,
        {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify({
            revision: workspace.revision,
            kind: preview.kind,
            name: preview.name,
            text: preview.text,
            ...(preview.sourceUrl ? { sourceUrl: preview.sourceUrl } : {}),
          }),
        },
      );
      if (mounted.current && version === operationVersion.current) {
        onChange(result.workspace);
        setPreview(null);
        setDraft('');
        setNotice('Source saved privately. Review the brief when you are ready to use it.');
      }
    } catch (caught) {
      if (mounted.current && version === operationVersion.current && !controller.signal.aborted)
        setError(
          caught instanceof Error
            ? caught.message
            : 'The source could not be saved. Your text is still here.',
        );
    } finally {
      if (mounted.current && version === operationVersion.current) setBusy(false);
    }
  };

  const extractArrangements = async (source: StudioImport) => {
    const version = ++operationVersion.current;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setExtractingId(source.id);
    setError('');
    setNotice('');
    if (!requestIds.current.has(source.id)) requestIds.current.set(source.id, crypto.randomUUID());
    try {
      const result = await api<{ workspace: StudioWorkspace }>(
        `/studio/workspaces/${workspace.id}/imports/${source.id}/extract`,
        {
          method: 'POST',
          signal: controller.signal,
          body: JSON.stringify({
            revision: workspace.revision,
            requestId: requestIds.current.get(source.id),
          }),
        },
      );
      if (mounted.current && version === operationVersion.current) {
        onChange(result.workspace);
        setExtractedIds((previous) => [...previous, source.id]);
        setNotice(
          'Arrangement candidates added for review. Open each service to check and include it in the proposal.',
        );
      }
    } catch (caught) {
      if (mounted.current && version === operationVersion.current && !controller.signal.aborted)
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not extract arrangements. Your saved source is unchanged.',
        );
    } finally {
      if (mounted.current && version === operationVersion.current) {
        setBusy(false);
        setExtractingId('');
      }
    }
  };

  const blocked = disabled || busy || dictation.recording || dictation.requestingMic;
  return (
    <Box asChild>
      <section id="studio-import-composer" aria-label="Import client information">
        <Flex direction="column" gap="3">
          <input
            ref={fileInput}
            type="file"
            aria-label="Upload screenshot, PDF or audio"
            hidden
            accept="image/png,image/jpeg,image/webp,application/pdf,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/webm"
            onChange={(event) => void upload(event.target.files?.[0])}
          />
          {/* Everything above the pill is transient work — a draft, a preview, a warning. It grows
              the composer while it is open, but never past the point where the field itself would
              be pushed out of the pane. */}
          <Box maxHeight="52dvh" style={{ overflowY: 'auto' }}>
            <Flex direction="column" gap="3">
              {(dictation.recording || dictation.requestingMic) && (
                <Callout.Root color="amber" size="1" role="status">
                  <Callout.Icon>
                    {dictation.recording ? <Mic size={16} /> : <Spinner size="1" />}
                  </Callout.Icon>
                  <Flex align="center" justify="between" gap="3" wrap="wrap" width="100%">
                    <Callout.Text>
                      {dictation.recording
                        ? 'Recording your brief · up to 2 minutes'
                        : 'Waiting for microphone permission'}
                    </Callout.Text>
                    <Flex gap="2" wrap="wrap">
                      <Button
                        type="button"
                        size="3"
                        variant="soft"
                        color="red"
                        disabled={!dictation.recording}
                        onClick={dictation.stop}
                      >
                        <Square size={15} /> Stop &amp; transcribe
                      </Button>
                      <Button type="button" size="3" variant="soft" color="amber" onClick={cancel}>
                        Cancel recording
                      </Button>
                    </Flex>
                  </Flex>
                </Callout.Root>
              )}
              {mode && !preview && (
                <Card size="2">
                  <Flex direction="column" gap="3">
                    <Flex direction="column" gap="1">
                      <Text
                        as="label"
                        htmlFor={`studio-import-${workspace.id}`}
                        size="2"
                        weight="medium"
                      >
                        {mode === 'url'
                          ? 'Public tour or cruise page'
                          : 'Client email, PNR or travel notes'}
                      </Text>
                      {mode === 'url' ? (
                        <TextField.Root
                          size="3"
                          ref={(node) => {
                            draftField.current = node;
                          }}
                          id={`studio-import-${workspace.id}`}
                          type="url"
                          value={draft}
                          maxLength={2048}
                          placeholder="https://…"
                          disabled={busy}
                          onChange={(event) => setDraft(event.target.value)}
                        />
                      ) : (
                        <TextArea
                          size="3"
                          ref={(node) => {
                            draftField.current = node;
                          }}
                          id={`studio-import-${workspace.id}`}
                          rows={5}
                          value={draft}
                          maxLength={STUDIO_IMPORT_MAX_TEXT}
                          placeholder="Paste your source here. Tara will review it before anything is added."
                          disabled={busy}
                          onChange={(event) => setDraft(event.target.value)}
                        />
                      )}
                    </Flex>
                    <Flex gap="2" wrap="wrap">
                      <Button
                        type="button"
                        size="3"
                        disabled={blocked || !draft.trim()}
                        onClick={() =>
                          void extract(
                            mode === 'url'
                              ? { kind: 'url', name: 'Tour / cruise link', url: draft.trim() }
                              : { kind: 'text', name: 'Client notes / PNR', text: draft.trim() },
                          )
                        }
                      >
                        Preview source
                      </Button>
                      <Button type="button" size="3" variant="soft" color="gray" onClick={cancel}>
                        Cancel
                      </Button>
                    </Flex>
                  </Flex>
                </Card>
              )}
              {preview && (
                <Card size="2">
                  <Flex direction="column" gap="3">
                    <Flex align="center" justify="between" gap="3">
                      <Text size="2" weight="bold">
                        Check the extracted text
                      </Text>
                      <IconButton
                        type="button"
                        size="3"
                        variant="soft"
                        color="gray"
                        disabled={busy}
                        aria-label="Discard import"
                        onClick={cancel}
                      >
                        <X size={16} />
                      </IconButton>
                    </Flex>
                    <label>
                      <Text as="div" size="2" weight="medium" mb="1">
                        Source name
                      </Text>
                      <TextField.Root
                        size="3"
                        value={preview.name}
                        maxLength={160}
                        disabled={busy}
                        onChange={(event) => setPreview({ ...preview, name: event.target.value })}
                      />
                    </label>
                    <label>
                      <Text as="div" size="2" weight="medium" mb="1">
                        Review and edit
                      </Text>
                      <TextArea
                        size="3"
                        rows={7}
                        value={preview.text}
                        maxLength={STUDIO_IMPORT_MAX_TEXT}
                        disabled={busy}
                        onChange={(event) => setPreview({ ...preview, text: event.target.value })}
                      />
                    </label>
                    <Text as="p" size="2" color="gray">
                      Check dates, names and prices. Saving a source does not confirm a booking.
                    </Text>
                    {preview.warnings.slice(1).map((warning, index) => (
                      <Callout.Root key={index} color="amber" size="1">
                        <Callout.Icon>
                          <CircleAlert size={16} />
                        </Callout.Icon>
                        <Callout.Text>{warning}</Callout.Text>
                      </Callout.Root>
                    ))}
                    <Flex gap="2" wrap="wrap">
                      <Button
                        type="button"
                        size="3"
                        disabled={blocked || !preview.text.trim() || !preview.name.trim()}
                        onClick={() => void save()}
                      >
                        Save reviewed source
                      </Button>
                      <Button
                        type="button"
                        size="3"
                        variant="soft"
                        color="gray"
                        disabled={busy}
                        onClick={cancel}
                      >
                        Discard
                      </Button>
                    </Flex>
                  </Flex>
                </Card>
              )}
              {busy && (
                <Callout.Root color="blue" size="1" role="status">
                  <Callout.Icon>
                    <Spinner size="1" />
                  </Callout.Icon>
                  <Flex align="center" justify="between" gap="3" wrap="wrap" width="100%">
                    <Callout.Text>
                      {extractingId
                        ? 'Extracting arrangements for review…'
                        : preview
                          ? 'Saving source…'
                          : 'Reading your source…'}
                    </Callout.Text>
                    {!preview && !extractingId && (
                      <Button type="button" size="3" variant="soft" color="blue" onClick={cancel}>
                        Cancel
                      </Button>
                    )}
                  </Flex>
                </Callout.Root>
              )}
              {error && (
                <Callout.Root color="red" size="1" role="alert">
                  <Callout.Icon>
                    <CircleAlert size={16} />
                  </Callout.Icon>
                  <Callout.Text>{error}</Callout.Text>
                </Callout.Root>
              )}
              {notice && (
                <Callout.Root color="green" size="1" role="status">
                  <Callout.Icon>
                    <CircleCheck size={16} />
                  </Callout.Icon>
                  <Callout.Text>{notice}</Callout.Text>
                </Callout.Root>
              )}
              {workspace.imports.length > 0 && (
                <Flex direction="column" gap="2" role="group" aria-label="Private imported sources">
                  {workspace.imports.map((source) => (
                    <Card key={source.id} size="1">
                      <Reset>
                        <details>
                          <Reset>
                            <summary style={{ cursor: 'pointer', overflowWrap: 'anywhere' }}>
                              <Text size="2" weight="medium">
                                {source.name}{' '}
                              </Text>
                              <Text size="1" color="gray">
                                {source.kind} · private
                              </Text>
                            </summary>
                          </Reset>
                          <Box mt="2">
                            <Reset>
                              <pre
                                style={{
                                  whiteSpace: 'pre-wrap',
                                  overflowWrap: 'anywhere',
                                  fontFamily: 'inherit',
                                  fontSize: 'var(--font-size-1)',
                                  maxHeight: 220,
                                  overflowY: 'auto',
                                  background: 'var(--gray-a2)',
                                  borderRadius: 'var(--radius-2)',
                                  padding: 'var(--space-2)',
                                }}
                              >
                                {source.text}
                              </pre>
                            </Reset>
                            {source.sourceUrl && (
                              <Box my="2">
                                <Text size="2" asChild>
                                  <a
                                    href={source.sourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    Open source page
                                  </a>
                                </Text>
                              </Box>
                            )}
                            {workspace.structureAccepted ? (
                              <Button
                                type="button"
                                size="3"
                                variant="soft"
                                mt="2"
                                loading={extractingId === source.id}
                                disabled={blocked || extractedIds.includes(source.id)}
                                onClick={() => void extractArrangements(source)}
                              >
                                {extractingId === source.id
                                  ? 'Extracting…'
                                  : extractedIds.includes(source.id)
                                    ? 'Candidates added for review'
                                    : 'Extract arrangements'}
                              </Button>
                            ) : (
                              <Flex align="center" gap="2" mt="2">
                                <Lock size={14} aria-hidden="true" />
                                <Text size="2" color="gray">
                                  Accept the trip structure before extracting arrangement
                                  candidates.
                                </Text>
                              </Flex>
                            )}
                          </Box>
                        </details>
                      </Reset>
                    </Card>
                  ))}
                </Flex>
              )}
            </Flex>
          </Box>
          {/* The same pill the home composer uses: one + menu for every way a brief can arrive,
              the field, and the send button. Kept identical on purpose — an agent should not have
              to learn this control twice.

              It is a grid so the field can change position without changing place in the React
              tree: one row ("plus field send") while the text fits on a line, and Gemini's stacked
              arrangement once it does not — the field across the top with the corner control
              beside it, the + and send buttons in a row beneath. Moving the field between
              wrappers instead would remount the textarea and drop the caret mid-sentence. */}
          <Box
            data-composer-pill=""
            p="2"
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto minmax(0, 1fr) auto',
              gridTemplateAreas: stacked
                ? '"field field corner" "plus . send"'
                : '"plus field send"',
              alignItems: 'center',
              columnGap: 'var(--space-2)',
              rowGap: 'var(--space-1)',
              background: 'var(--color-panel-solid)',
              boxShadow: 'var(--shadow-3)',
              borderRadius: 'var(--radius-6)',
              outline: fieldFocused ? '2px solid var(--focus-8)' : undefined,
              outlineOffset: -1,
            }}
          >
            <Box style={{ gridArea: 'plus', display: 'flex' }}>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <IconButton
                    ref={menuTrigger}
                    type="button"
                    size="3"
                    variant="soft"
                    color="gray"
                    radius="full"
                    disabled={blocked}
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
                  <DropdownMenu.Item
                    onSelect={() => {
                      setMode('text');
                      setDraft('');
                      setPreview(null);
                    }}
                  >
                    <FileText size={15} aria-hidden="true" /> Paste an email or PNR
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => {
                      setMode('url');
                      setDraft('');
                      setPreview(null);
                    }}
                  >
                    <Link size={15} aria-hidden="true" /> Add a tour link
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    disabled={dictation.recording || dictation.requestingMic}
                    onSelect={() => void dictation.start()}
                  >
                    <Mic size={15} aria-hidden="true" /> Dictate
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <Box px="2" pb="1" maxWidth="260px">
                    <Text as="p" size="1" color="gray">
                      <Lock size={11} aria-hidden="true" /> Sources stay private. Screenshots, PDFs
                      and recordings use AI extraction; you review the text first.
                    </Text>
                  </Box>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </Box>
            <Box
              minWidth="0"
              onFocus={() => setFieldFocused(true)}
              onBlur={() => setFieldFocused(false)}
              style={{ gridArea: 'field', alignSelf: stacked ? 'start' : 'center' }}
            >
              {field}
            </Box>
            {stacked && corner && (
              <Box style={{ gridArea: 'corner', alignSelf: 'start', display: 'flex' }}>
                {corner}
              </Box>
            )}
            <Box style={{ gridArea: 'send', display: 'flex', justifySelf: 'end' }}>{send}</Box>
          </Box>
        </Flex>
      </section>
    </Box>
  );
}
