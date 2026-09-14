import { useEffect, useRef, useState } from 'react';
import { FileText, Link, Mic, Paperclip, Square, X } from 'lucide-react';
import { api } from '../api';
import type { StudioImport, StudioWorkspace } from '../../shared/studio';
import type { StudioImportInput } from '../../shared/studio-imports';
import { STUDIO_IMPORT_MAX_BYTES, STUDIO_IMPORT_MAX_TEXT } from '../../shared/studio-imports';
import './studio-imports.css';

const fileData = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The file could not be read. Please try again.'));
    reader.readAsDataURL(file);
  });

export function StudioImportComposer({
  workspace,
  onChange,
  disabled = false,
}: {
  workspace: StudioWorkspace;
  onChange: (workspace: StudioWorkspace) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<'text' | 'url' | null>(null);
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState<StudioImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recording, setRecording] = useState(false);
  const [requestingMic, setRequestingMic] = useState(false);
  const [extractingId, setExtractingId] = useState('');
  const [extractedIds, setExtractedIds] = useState<string[]>([]);
  const requestIds = useRef(new Map<string, string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRecording = useRef(false);
  const operationVersion = useRef(0);
  const mounted = useRef(true);

  const stopTracks = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const cancel = () => {
    operationVersion.current++;
    operation.current?.abort();
    cancelledRecording.current = true;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stopTracks();
    setRecording(false);
    setRequestingMic(false);
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
    setRecording(false);
    setRequestingMic(false);
    setExtractedIds([]);
    requestIds.current.clear();
    return () => {
      mounted.current = false;
      operationVersion.current++;
      operation.current?.abort();
      cancelledRecording.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stopTracks();
    };
  }, [workspace.id]);

  const extract = async (input: StudioImportInput) => {
    const version = ++operationVersion.current;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ import: StudioImport }>('/studio/import/preview', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: controller.signal,
      });
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
    if (file.size > STUDIO_IMPORT_MAX_BYTES) {
      setError('Choose a file smaller than 5 MB.');
      return;
    }
    const mime = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : '');
    const kind = mime.startsWith('image/')
      ? 'image'
      : mime === 'application/pdf'
        ? 'pdf'
        : mime.startsWith('audio/')
          ? 'audio'
          : null;
    if (!kind) {
      setError('Choose a PNG, JPEG, WebP, PDF, MP3, WAV, M4A or WebM file, or paste the text.');
      return;
    }
    const version = operationVersion.current;
    try {
      const data = await fileData(new Blob([file], { type: mime.split(';')[0] }));
      if (mounted.current && version === operationVersion.current)
        await extract({ kind, name: file.name.slice(0, 160), data });
    } catch (caught) {
      if (mounted.current)
        setError(caught instanceof Error ? caught.message : 'Could not read this file.');
    }
    if (fileInput.current) fileInput.current.value = '';
  };

  const startRecording = async () => {
    setError('');
    setNotice('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(
        'Voice recording is unavailable in this browser. Type your brief or upload an audio file.',
      );
      return;
    }
    const version = ++operationVersion.current;
    cancelledRecording.current = false;
    setRequestingMic(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || version !== operationVersion.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!mime) {
        stopTracks();
        setError(
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
          cancelledRecording.current = true;
          recordingDevice.stop();
          stopTracks();
          if (mounted.current) {
            setRecording(false);
            setError('The recording reached 5 MB. Record a shorter brief.');
          }
        } else if (event.data.size) chunks.push(event.data);
      };
      recordingDevice.onerror = () => {
        cancelledRecording.current = true;
        stopTracks();
        if (mounted.current) {
          setRecording(false);
          setError('Recording failed. You can type your brief instead.');
        }
      };
      recordingDevice.onstop = async () => {
        stopTracks();
        if (!mounted.current || cancelledRecording.current || version !== operationVersion.current)
          return;
        setRecording(false);
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        if (!blob.size) {
          setError('No audio was captured. Try again or type your brief.');
          return;
        }
        try {
          const data = await fileData(blob);
          if (
            mounted.current &&
            !cancelledRecording.current &&
            version === operationVersion.current
          )
            await extract({ kind: 'audio', name: 'Voice brief', data });
        } catch {
          if (mounted.current)
            setError('The recording could not be read. Try again or type your brief.');
        }
      };
      recordingDevice.start(1000);
      setRecording(true);
      timer.current = setTimeout(() => {
        if (recordingDevice.state === 'recording') recordingDevice.stop();
      }, 120_000);
    } catch {
      stopTracks();
      if (mounted.current && version === operationVersion.current)
        setError(
          'Microphone access was not available. Allow it in your browser or type your brief.',
        );
    } finally {
      if (mounted.current && version === operationVersion.current) setRequestingMic(false);
    }
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

  const blocked = disabled || busy || recording || requestingMic;
  return (
    <section className="studio-import-composer" aria-label="Import client information">
      <div className="studio-import-actions">
        <button type="button" disabled={blocked} onClick={() => fileInput.current?.click()}>
          <Paperclip size={15} /> Attach
        </button>
        <button
          type="button"
          disabled={blocked}
          onClick={() => {
            setMode(mode === 'text' ? null : 'text');
            setDraft('');
            setPreview(null);
          }}
        >
          <FileText size={15} /> Paste email / PNR
        </button>
        <button
          type="button"
          disabled={blocked}
          onClick={() => {
            setMode(mode === 'url' ? null : 'url');
            setDraft('');
            setPreview(null);
          }}
        >
          <Link size={15} /> Tour link
        </button>
        <button
          type="button"
          disabled={disabled || busy || requestingMic}
          onClick={() => (recording ? recorder.current?.stop() : void startRecording())}
        >
          {recording ? <Square size={15} /> : <Mic size={15} />}
          {recording ? 'Stop & transcribe' : requestingMic ? 'Allow microphone…' : 'Dictate'}
        </button>
        <input
          ref={fileInput}
          type="file"
          aria-label="Upload screenshot, PDF or audio"
          hidden
          accept="image/png,image/jpeg,image/webp,application/pdf,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/m4a,audio/webm"
          onChange={(event) => void upload(event.target.files?.[0])}
        />
      </div>
      {(recording || requestingMic) && (
        <div className="studio-import-recording" role="status">
          <span>
            {recording
              ? 'Recording your brief · up to 2 minutes'
              : 'Waiting for microphone permission'}
          </span>
          <button type="button" onClick={cancel}>
            Cancel recording
          </button>
        </div>
      )}
      {mode && !preview && (
        <div className="studio-import-entry">
          <label htmlFor={`studio-import-${workspace.id}`}>
            {mode === 'url' ? 'Public tour or cruise page' : 'Client email, PNR or travel notes'}
          </label>
          {mode === 'url' ? (
            <input
              id={`studio-import-${workspace.id}`}
              type="url"
              value={draft}
              maxLength={2048}
              placeholder="https://…"
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          ) : (
            <textarea
              id={`studio-import-${workspace.id}`}
              rows={5}
              value={draft}
              maxLength={STUDIO_IMPORT_MAX_TEXT}
              placeholder="Paste your source here. Tara will review it before anything is added."
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
            />
          )}
          <div className="studio-import-footer">
            <button
              type="button"
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
            </button>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {preview && (
        <div className="studio-import-preview">
          <div className="studio-import-preview-heading">
            <strong>Check the extracted text</strong>
            <button type="button" disabled={busy} aria-label="Discard import" onClick={cancel}>
              <X size={16} />
            </button>
          </div>
          <label>
            Source name
            <input
              value={preview.name}
              maxLength={160}
              disabled={busy}
              onChange={(event) => setPreview({ ...preview, name: event.target.value })}
            />
          </label>
          <label>
            Review and edit
            <textarea
              rows={7}
              value={preview.text}
              maxLength={STUDIO_IMPORT_MAX_TEXT}
              disabled={busy}
              onChange={(event) => setPreview({ ...preview, text: event.target.value })}
            />
          </label>
          <p>Check dates, names and prices. Saving a source does not confirm a booking.</p>
          {preview.warnings.slice(1).map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
          <div className="studio-import-footer">
            <button
              type="button"
              disabled={blocked || !preview.text.trim() || !preview.name.trim()}
              onClick={() => void save()}
            >
              Save reviewed source
            </button>
            <button type="button" disabled={busy} onClick={cancel}>
              Discard
            </button>
          </div>
        </div>
      )}
      {busy && (
        <div className="studio-import-busy" role="status">
          {extractingId
            ? 'Extracting arrangements for review…'
            : preview
              ? 'Saving source…'
              : 'Reading your source…'}
          {!preview && !extractingId && (
            <button type="button" onClick={cancel}>
              Cancel
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="studio-import-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="studio-import-notice" role="status">
          {notice}
        </p>
      )}
      {workspace.imports.length > 0 && (
        <div className="studio-import-sources" aria-label="Private imported sources">
          {workspace.imports.map((source) => (
            <details key={source.id} className="studio-import-source">
              <summary>
                {source.name} <span>{source.kind} · private</span>
              </summary>
              <pre>{source.text}</pre>
              {source.sourceUrl && (
                <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">
                  Open source page
                </a>
              )}
              {workspace.structureAccepted ? (
                <button
                  type="button"
                  disabled={blocked || extractedIds.includes(source.id)}
                  onClick={() => void extractArrangements(source)}
                >
                  {extractingId === source.id
                    ? 'Extracting…'
                    : extractedIds.includes(source.id)
                      ? 'Candidates added for review'
                      : 'Extract arrangements'}
                </button>
              ) : (
                <p>Accept the trip structure before extracting arrangement candidates.</p>
              )}
            </details>
          ))}
        </div>
      )}
      <p className="studio-import-privacy">
        Sources stay private. Screenshots, PDFs and recordings use AI extraction; you review the
        text first.
      </p>
    </section>
  );
}
