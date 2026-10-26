import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import { AlertTriangle, ImagePlus, Loader2, Sparkles, X } from 'lucide-react';
import Modal from '../../Modal';
import { CODEX_MODELS, PROVIDERS } from '../../../lib/aiOptions';
import { getAIBridgeState, type AIProviderId, type CodexModelId, type CodexReasoningEffort } from '../../../lib/aiBridge';
import {
  getKnowledgeOrganizeJob,
  registerAsset,
  requestKnowledgeOrganize,
  resolveKnowledgeProposal,
  type PendingKnowledgeProposal,
} from '../../../lib/knowledge/api';
import { buildNotesFromDraft, proposalToTiptap, validateProposal, type KnowledgeImageMap } from '../../../lib/knowledge/organize';
import { removePaths, signedUrl, uploadAsset } from '../../../lib/knowledge/storage';

const KnowledgeEditorPreview = lazy(() => import('./KnowledgeEditor'));
const MAX_NOTES_LENGTH = 7500;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_ORGANIZE_IMAGES = 12;
const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

type RequestState = 'idle' | 'submitting' | 'pending' | 'processing' | 'completed' | 'failed';
type OrganizeRequest = { jobId: string; proposalId: string; imageMap: KnowledgeImageMap };
type OrganizeResult = OrganizeRequest & { output: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo organizar el documento.';
}

export default function OrganizeWithAIDialog({
  isOpen,
  onClose,
  documentId,
  ownerUid,
  currentDraft,
  initialProposal = null,
  onApply,
  onResolved,
}: {
  isOpen: boolean;
  onClose(): void;
  documentId: string;
  ownerUid: string;
  currentDraft: JSONContent;
  initialProposal?: PendingKnowledgeProposal | null;
  onApply(mode: 'replace' | 'append', content: JSONContent): Promise<void>;
  onResolved(): void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const draftSource = useMemo(() => buildNotesFromDraft(currentDraft), [currentDraft]);
  const [source, setSource] = useState<'notes' | 'draft'>('notes');
  const [notes, setNotes] = useState('');
  const [draftNotes, setDraftNotes] = useState(draftSource.notes);
  const [uploadedImages, setUploadedImages] = useState<KnowledgeImageMap>({});
  const [imageUrls, setImageUrls] = useState<Record<string, string | null>>({});
  const [provider, setProvider] = useState<AIProviderId>('codex');
  const [modelId, setModelId] = useState<CodexModelId>('gpt-6-luna');
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort>('low');
  const [bridgeState, setBridgeState] = useState<'offline' | 'idle' | 'busy' | null>(null);
  const [requestState, setRequestState] = useState<RequestState>(initialProposal ? 'completed' : 'idle');
  const [activeRequest, setActiveRequest] = useState<OrganizeRequest | null>(null);
  const [result, setResult] = useState<OrganizeResult | null>(initialProposal ? {
    jobId: initialProposal.jobId,
    proposalId: initialProposal.id,
    imageMap: initialProposal.imageMap,
    output: initialProposal.output,
  } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const activeNotes = source === 'notes' ? notes : draftNotes;
  const activeImageMap = source === 'notes' ? uploadedImages : draftSource.imageMap;
  const connected = bridgeState === 'idle' || bridgeState === 'busy';
  const awaitingJob = requestState === 'pending' || requestState === 'processing';

  const preview = useMemo(() => {
    if (!result) return null;
    try {
      const proposal = validateProposal(JSON.parse(result.output) as unknown);
      const converted = proposalToTiptap(proposal, result.imageMap);
      return { proposal, ...converted, error: '' };
    } catch (cause) {
      return { proposal: null, doc: null, warnings: [], error: errorMessage(cause) };
    }
  }, [result]);

  const refreshBridgeState = useCallback(async () => {
    try {
      const status = await getAIBridgeState();
      setBridgeState(status.state);
    } catch {
      setBridgeState('offline');
    }
  }, []);

  useEffect(() => {
    void refreshBridgeState();
    const interval = window.setInterval(() => void refreshBridgeState(), 10_000);
    return () => window.clearInterval(interval);
  }, [refreshBridgeState]);

  useEffect(() => {
    if (!initialProposal || requestState !== 'idle') return;
    setResult({
      jobId: initialProposal.jobId,
      proposalId: initialProposal.id,
      imageMap: initialProposal.imageMap,
      output: initialProposal.output,
    });
    setActiveRequest(null);
    setRequestState('completed');
  }, [initialProposal, requestState]);

  useEffect(() => {
    let active = true;
    const entries = Object.entries(activeImageMap);
    if (!entries.length) {
      setImageUrls({});
      return undefined;
    }
    void Promise.all(entries.map(async ([id, image]) => {
      if (!image.assetPath) return [id, null] as const;
      try { return [id, await signedUrl(image.assetPath, 3600)] as const; }
      catch { return [id, null] as const; }
    })).then((values) => {
      if (active) setImageUrls(Object.fromEntries(values));
    });
    return () => { active = false; };
  }, [activeImageMap]);

  useEffect(() => {
    if (!activeRequest || result?.proposalId === activeRequest.proposalId) return undefined;
    let cancelled = false;
    let timer = 0;
    const poll = async () => {
      try {
        const job = await getKnowledgeOrganizeJob(activeRequest.jobId);
        if (cancelled) return;
        setRequestState(job.status);
        if (job.status === 'failed') {
          setError(job.error || 'La tarea de organización falló.');
          return;
        }
        if (job.status === 'completed') {
          if (!job.output) {
            setError('La tarea terminó sin una propuesta.');
            setRequestState('failed');
            return;
          }
          setResult({ ...activeRequest, output: job.output });
          return;
        }
      } catch (cause) {
        if (cancelled) return;
        setError(errorMessage(cause));
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeRequest, result?.proposalId]);

  const insertUploadedImage = async (file: File) => {
    if (Object.keys(uploadedImages).length >= MAX_ORGANIZE_IMAGES) {
      setError(`Podés organizar hasta ${MAX_ORGANIZE_IMAGES} capturas por vez.`);
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
      setError('Usá imágenes PNG, JPEG o WebP.');
      return;
    }
    if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
      setError('La imagen debe pesar hasta 10 MB.');
      return;
    }
    setBusy(true);
    setError('');
    let uploadedPath: string | null = null;
    let registered = false;
    try {
      const uploaded = await uploadAsset(ownerUid, documentId, file);
      uploadedPath = uploaded.path;
      await registerAsset(documentId, uploaded.path, uploaded.mimeType, uploaded.file.size);
      registered = true;
      const nextNumber = Math.max(0, ...Object.keys(uploadedImages).map((id) => Number(id.slice(3)) || 0)) + 1;
      const imageId = `IMG${nextNumber}`;
      const marker = `[[${imageId}]]`;
      const currentNotes = notes;
      const field = textareaRef.current;
      const start = field?.selectionStart ?? currentNotes.length;
      const end = field?.selectionEnd ?? start;
      const updatedNotes = `${currentNotes.slice(0, start)}${marker}${currentNotes.slice(end)}`;
      const imageMapEntry = { assetPath: uploaded.path, alt: file.name.replace(/\.[^.]+$/, '').trim() || 'Captura' };
      setUploadedImages((current) => ({ ...current, [imageId]: imageMapEntry }));
      setNotes(updatedNotes);
      setImageUrls((current) => ({ ...current, [imageId]: null }));
      requestAnimationFrame(() => {
        field?.focus();
        field?.setSelectionRange(start + marker.length, start + marker.length);
      });
    } catch (cause) {
      if (uploadedPath && !registered) {
        try { await removePaths([uploadedPath]); } catch { /* Preserve the upload error. */ }
      }
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleImageFiles = (files: FileList | null) => {
    if (!files?.length) return;
    void insertUploadedImage(files[0]);
  };

  const submit = async () => {
    if (!connected || !activeNotes.trim() || activeNotes.length > MAX_NOTES_LENGTH || busy || awaitingJob) return;
    if (Object.keys(activeImageMap).length > MAX_ORGANIZE_IMAGES) {
      setError(`Podés organizar hasta ${MAX_ORGANIZE_IMAGES} capturas por vez.`);
      return;
    }
    setBusy(true);
    setRequestState('submitting');
    setError('');
    setResult(null);
    try {
      const request = await requestKnowledgeOrganize({
        documentId,
        idempotencyKey: crypto.randomUUID(),
        provider,
        notes: activeNotes,
        modelId,
        reasoningEffort,
        imageMap: activeImageMap,
      });
      setActiveRequest({ ...request, imageMap: activeImageMap });
      setRequestState('pending');
    } catch (cause) {
      setRequestState('failed');
      const message = errorMessage(cause);
      setError(message.includes('Tipo de tarea no permitido.')
        ? 'Actualizá el AI Bridge a la versión 1.7.0 o posterior desde IA → Conexión.'
        : message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async (mode: 'replace' | 'append') => {
    if (!result || !preview?.doc || busy) return;
    setBusy(true);
    setError('');
    try {
      await onApply(mode, preview.doc);
      await resolveKnowledgeProposal(result.proposalId, 'applied');
      onResolved();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!result || busy) return;
    setBusy(true);
    setError('');
    try {
      await resolveKnowledgeProposal(result.proposalId, 'discarded');
      onResolved();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Organizar con IA" className="max-w-5xl">
      <div className="space-y-5">
        {!result && <>
          <p className="text-sm text-[var(--ink-muted)]">La IA prepara una propuesta editable. No guarda ni publica el documento hasta que la apliques.</p>
          <p className="text-sm text-[var(--ink-muted)]">La IA ve tus capturas (con Codex) y puede usar lo que muestran. Revisá siempre la propuesta antes de aplicarla.</p>
          <div className="flex gap-2 border-b border-[var(--line)]">
            <button type="button" aria-pressed={source === 'notes'} onClick={() => setSource('notes')} className={`border-b-2 px-3 py-2 text-sm font-semibold ${source === 'notes' ? 'border-[var(--brand)] text-[var(--brand)]' : 'border-transparent text-[var(--ink-muted)]'}`}>Desde notas</button>
            <button type="button" aria-pressed={source === 'draft'} onClick={() => setSource('draft')} className={`border-b-2 px-3 py-2 text-sm font-semibold ${source === 'draft' ? 'border-[var(--brand)] text-[var(--brand)]' : 'border-transparent text-[var(--ink-muted)]'}`}>Desde el borrador actual</button>
          </div>
          <label className="block space-y-1.5 text-sm font-semibold" htmlFor="knowledge-organize-notes">
            <span>{source === 'notes' ? 'Notas desordenadas' : 'Notas extraídas del borrador'}</span>
            <textarea
              ref={textareaRef}
              id="knowledge-organize-notes"
              value={activeNotes}
              onChange={(event) => source === 'notes' ? setNotes(event.target.value) : setDraftNotes(event.target.value)}
              maxLength={MAX_NOTES_LENGTH}
              rows={8}
              className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm font-normal outline-none focus:border-[var(--brand)]"
              placeholder="Pegá pasos, observaciones y datos que quieras ordenar…"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink-muted)]">
            <span>{activeNotes.length.toLocaleString('es-AR')} / {MAX_NOTES_LENGTH} caracteres</span>
            {source === 'notes' && <>
              <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Elegir una captura" disabled={busy || Object.keys(uploadedImages).length >= MAX_ORGANIZE_IMAGES} onChange={(event) => { handleImageFiles(event.currentTarget.files); event.currentTarget.value = ''; }}/>
              <button type="button" disabled={busy || Object.keys(uploadedImages).length >= MAX_ORGANIZE_IMAGES} onClick={() => uploadRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 font-semibold disabled:opacity-50"><ImagePlus size={14}/>Agregar captura</button>
            </>}
            <span>{Object.keys(activeImageMap).length} / {MAX_ORGANIZE_IMAGES} capturas</span>
          </div>
          {Object.keys(activeImageMap).length > 0 && <div className="flex flex-wrap gap-2">
            {Object.entries(activeImageMap).map(([imageId, image]) => <div key={imageId} className="flex items-center gap-2 rounded-lg border border-[var(--line)] p-2 text-xs">
              {imageUrls[imageId] ? <img src={imageUrls[imageId] ?? undefined} alt={image.alt} className="size-12 rounded object-cover"/> : <span className="flex size-12 items-center justify-center rounded bg-[var(--surface-muted)]"><ImagePlus size={16}/></span>}
              <span><strong>{imageId}</strong><span className="block max-w-40 truncate text-[var(--ink-muted)]">{image.alt || 'Captura'}</span></span>
              {source === 'notes' && uploadedImages[imageId] && <button type="button" aria-label={`Quitar ${imageId}`} onClick={() => {
                const marker = `[[${imageId}]]`;
                setNotes((current) => current.replace(marker, '').trim());
                setUploadedImages((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== imageId)));
              }} className="rounded p-1 text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"><X size={14}/></button>}
            </div>)}
          </div>}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1.5 text-xs font-semibold"><span>Agente</span><select value={provider} onChange={(event) => setProvider(event.target.value as AIProviderId)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2.5 text-sm font-normal">{PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            {provider === 'codex' && <>
              <label className="block space-y-1.5 text-xs font-semibold"><span>Modelo</span><select value={modelId} onChange={(event) => setModelId(event.target.value as CodexModelId)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2.5 text-sm font-normal">{CODEX_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
              <label className="block space-y-1.5 text-xs font-semibold"><span>Razonamiento</span><select value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value as CodexReasoningEffort)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2.5 text-sm font-normal"><option value="low">Bajo</option><option value="medium">Medio</option><option value="high">Alto</option><option value="xhigh">Muy alto</option></select></label>
            </>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--surface-muted)] p-3">
            <div className="flex items-center gap-2 text-sm">
              {bridgeState === null ? <Loader2 size={15} className="animate-spin"/> : <span className={`size-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-rose-500'}`}/>}
              <span>{bridgeState === null ? 'Consultando la PC vinculada…' : connected ? 'PC vinculada conectada' : 'La PC vinculada está desconectada'}</span>
            </div>
            <button type="button" disabled={!connected || busy || awaitingJob || !activeNotes.trim() || activeNotes.length > MAX_NOTES_LENGTH} onClick={() => void submit()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-4 py-2.5 text-sm font-bold text-[var(--action-ink)] disabled:cursor-not-allowed disabled:opacity-50">
              {busy || awaitingJob ? <Loader2 size={15} className="animate-spin"/> : <Sparkles size={15}/>}Organizar
            </button>
          </div>
          {(requestState === 'pending' || requestState === 'processing') && <p role="status" className="text-sm text-[var(--ink-muted)]">{requestState === 'pending' ? 'En cola…' : 'La IA está organizando…'}</p>}
        </>}

         {result && preview && <section className="space-y-4">
           {preview.error ? <p role="alert" className="rounded-lg border border-[var(--danger-line)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger-ink)]">{preview.error}</p> : <>
            {preview.proposal?.missing_information.length ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"><h3 className="font-bold">Información faltante</h3><ul className="mt-2 list-disc space-y-1 pl-5">{preview.proposal.missing_information.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div> : null}
            {preview.warnings.length > 0 && <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"><div className="flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0"/><ul className="list-disc space-y-1 pl-4">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div></div>}
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 sm:p-5">
              <div className="mb-3"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Vista previa · {preview.proposal?.title}</p></div>
              <Suspense fallback={<div role="status" className="py-8 text-center text-sm text-[var(--ink-muted)]">Cargando vista previa…</div>}>
                <KnowledgeEditorPreview initialContent={preview.doc ?? { type: 'doc' }} documentId={documentId} ownerUid={ownerUid} editable={false} onChange={() => undefined}/>
              </Suspense>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--line)] pt-4">
              <button type="button" disabled={busy} onClick={() => void discard()} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold disabled:opacity-50">Descartar</button>
              <button type="button" disabled={busy || Boolean(preview.error)} onClick={() => void apply('append')} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold disabled:opacity-50">Agregar al final</button>
              <button type="button" disabled={busy || Boolean(preview.error)} onClick={() => void apply('replace')} className="rounded-lg bg-[var(--action-bg)] px-3 py-2 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50">Reemplazar el borrador</button>
            </div>
           </>}
           {preview.error && <div className="flex justify-end border-t border-[var(--line)] pt-4"><button type="button" disabled={busy} onClick={() => void discard()} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold disabled:opacity-50">Descartar propuesta</button></div>}
        </section>}

        {error && <p role="alert" className="rounded-lg border border-[var(--danger-line)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger-ink)]">{error}</p>}
      </div>
    </Modal>
  );
}
