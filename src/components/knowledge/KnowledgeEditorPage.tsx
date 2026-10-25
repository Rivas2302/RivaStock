import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Download, Loader2, Save, Send, Sparkles } from 'lucide-react';
import type { JSONContent } from '@tiptap/core';
import { useAuth } from '../../AuthContext';
import Modal from '../Modal';
import KnowledgeEditor from './editor/KnowledgeEditor';
import {
  createDocument,
  getDocument,
  listCategories,
  listFolders,
  listVersions,
  saveDraft,
  saveEditorVersion,
  setStatus,
} from '../../lib/knowledge/api';
import { EMPTY_DOC, contentHash, stripImageSources, toMarkdown, toPlainText } from '../../lib/knowledge/editorContent';
import { downloadKnowledgePdf, loadKnowledgePdfImage } from '../../lib/knowledge/pdfBrowser';
import { showToast } from '../../lib/toast';
import { KNOWLEDGE_STATUS_LABELS } from '../../lib/knowledge/format';
import type { KnowledgeCategory, KnowledgeDocument, KnowledgeFolder, KnowledgeStatus, KnowledgeVersion } from '../../lib/knowledge/types';

type SaveState = 'saved' | 'dirty' | 'saving' | 'offline' | 'error';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo guardar el documento.';
}

function serializableContent(doc: JSONContent): Record<string, unknown> {
  return stripImageSources(doc) as Record<string, unknown>;
}

function contentKey(doc: JSONContent): string {
  return JSON.stringify(stripImageSources(doc));
}

function statusLabel(status: KnowledgeStatus): string {
  return KNOWLEDGE_STATUS_LABELS[status] ?? status;
}

type BlockedNavigation = { kind: 'link'; href: string } | { kind: 'history'; delta: number } | null;

function useUnsavedNavigationBlocker(shouldBlock: boolean) {
  const location = useLocation();
  const navigate = useNavigate();
  const [blockedNavigation, setBlockedNavigation] = useState<BlockedNavigation>(null);
  const locationRef = useRef(location);
  const currentHistoryIndexRef = useRef<number | null>(window.history.state?.idx ?? null);
  const restorePopRef = useRef(false);
  const allowPopRef = useRef(false);

  locationRef.current = location;
  useEffect(() => {
    const index = window.history.state?.idx;
    if (typeof index === 'number') currentHistoryIndexRef.current = index;
  }, [location]);

  useEffect(() => {
    if (!shouldBlock) return undefined;
    const interceptLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target && anchor.target !== '_self' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const destination = `${url.pathname}${url.search}${url.hash}`;
      const current = `${locationRef.current.pathname}${locationRef.current.search}${locationRef.current.hash}`;
      if (destination === current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setBlockedNavigation({ kind: 'link', href: destination });
    };

    const interceptHistory = (event: PopStateEvent) => {
      if (restorePopRef.current) {
        restorePopRef.current = false;
        return;
      }
      if (allowPopRef.current) {
        allowPopRef.current = false;
        return;
      }
      const targetIndex = event.state?.idx;
      const currentIndex = currentHistoryIndexRef.current;
      const delta = typeof targetIndex === 'number' && typeof currentIndex === 'number'
        ? targetIndex - currentIndex
        : -1;
      if (delta === 0) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      setBlockedNavigation({ kind: 'history', delta });
      restorePopRef.current = true;
      window.history.go(-delta);
    };

    document.addEventListener('click', interceptLink, true);
    window.addEventListener('popstate', interceptHistory, true);
    return () => {
      document.removeEventListener('click', interceptLink, true);
      window.removeEventListener('popstate', interceptHistory, true);
    };
  }, [shouldBlock]);

  return {
    blocked: blockedNavigation !== null,
    reset: () => setBlockedNavigation(null),
    proceed: () => {
      const pending = blockedNavigation;
      setBlockedNavigation(null);
      if (pending?.kind === 'link') navigate(pending.href);
      if (pending?.kind === 'history') {
        allowPopRef.current = true;
        navigate(pending.delta);
      }
    },
  };
}

function CreateEditorDocument({ onCreated }: { onCreated(document: KnowledgeDocument): void }) {
  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [folders, setFolders] = useState<KnowledgeFolder[]>([]);
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.all([listFolders(), listCategories()])
      .then(([nextFolders, nextCategories]) => {
        if (!active) return;
        setFolders(nextFolders);
        setCategories(nextCategories);
      })
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('Ingresá un título para el documento.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const document = await createDocument('editor', cleanTitle, {
        kind: 'editor',
        folderId: folderId || null,
        categoryId: categoryId || null,
        description: '',
      });
      onCreated(document);
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  };

  if (loading) return <div className="flex min-h-64 items-center justify-center" role="status"><Loader2 className="animate-spin text-[var(--brand)]" size={28}/><span className="sr-only">Cargando opciones</span></div>;

  return (
    <form onSubmit={(event) => void create(event)} className="mx-auto max-w-3xl space-y-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm sm:p-7">
      <div>
        <label htmlFor="knowledge-document-title" className="mb-1.5 block text-sm font-semibold">Título <span className="text-[var(--danger-ink)]">*</span></label>
        <input id="knowledge-document-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} autoFocus required className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--brand)]" placeholder="Ej.: Guía de atención al cliente"/>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold">Carpeta
          <select value={folderId} onChange={(event) => setFolderId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm font-normal">
            <option value="">Sin carpeta</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold">Categoría
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm font-normal">
            <option value="">Sin categoría</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
      </div>
      {error && <p role="alert" className="rounded-lg border border-[var(--danger-line)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger-ink)]">{error}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={busy || !title.trim()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-4 py-2.5 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin"/> : <Sparkles size={16}/>}Crear documento
        </button>
      </div>
      <p className="text-xs text-[var(--ink-muted)]">El documento se crea como borrador y todavía no queda disponible para la IA.</p>
    </form>
  );
}

export default function KnowledgeEditorPage({ mode }: { mode: 'create' | 'edit' }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { documentId } = useParams<{ documentId: string }>();
  const [document, setDocument] = useState<KnowledgeDocument | null>(null);
  const [versions, setVersions] = useState<KnowledgeVersion[]>([]);
  const [content, setContent] = useState<JSONContent>(EMPTY_DOC);
  const [loading, setLoading] = useState(mode === 'edit');
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [versionNote, setVersionNote] = useState('');
  const [versionBusy, setVersionBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const documentRef = useRef<KnowledgeDocument | null>(null);
  const latestContentRef = useRef<JSONContent>(EMPTY_DOC);
  const savedContentKeyRef = useRef(contentKey(EMPTY_DOC));
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const conflictRef = useRef(false);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const saveAgainRef = useRef(false);

  const setCurrentDocument = (next: KnowledgeDocument) => {
    documentRef.current = next;
    setDocument(next);
  };

  const loadDocument = useCallback(async (id: string) => {
    setLoading(true);
    setLoadError('');
    try {
      const [nextDocument, nextVersions] = await Promise.all([getDocument(id), listVersions(id)]);
      if (nextDocument.kind !== 'editor') {
        navigate(`/ia/conocimientos/doc/${id}`, { replace: true });
        return;
      }
      const currentVersion = nextVersions.find((version) => version.id === nextDocument.current_version_id);
      const initial = (nextDocument.draft_content ?? currentVersion?.content_json ?? EMPTY_DOC) as JSONContent;
      setCurrentDocument(nextDocument);
      setVersions(nextVersions);
      latestContentRef.current = initial;
      savedContentKeyRef.current = contentKey(initial);
      revisionRef.current = nextDocument.draft_revision;
      dirtyRef.current = false;
      conflictRef.current = false;
      setContent(initial);
      setRevision(nextDocument.draft_revision);
      setSavedAt(nextDocument.draft_updated_at);
      setSaveState('saved');
      setSaveError('');
      setConflict(false);
      setEditorKey((key) => key + 1);
    } catch (cause) {
      setLoadError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (mode === 'edit' && documentId) void loadDocument(documentId);
  }, [documentId, loadDocument, mode]);

  const isReadOnly = document?.status === 'archived' || document?.status === 'deleting';

  const saveLatestDraft = useCallback(async () => {
    const currentDocument = documentRef.current;
    if (!currentDocument || isReadOnly || conflictRef.current || !dirtyRef.current) return;
    if (!navigator.onLine) {
      setSaveState('offline');
      return;
    }
    if (savePromiseRef.current) {
      saveAgainRef.current = true;
      await savePromiseRef.current;
      return;
    }

    const request = (async () => {
      do {
        saveAgainRef.current = false;
        if (!dirtyRef.current || conflictRef.current) break;
        if (!navigator.onLine) {
          setSaveState('offline');
          break;
        }
        const snapshot = latestContentRef.current;
        const snapshotKey = contentKey(snapshot);
        setSaveState('saving');
        setSaveError('');
        try {
          const saved = await saveDraft(currentDocument.id, serializableContent(snapshot), revisionRef.current);
          revisionRef.current = saved.draft_revision;
          setRevision(saved.draft_revision);
          savedContentKeyRef.current = snapshotKey;
          setSavedAt(saved.draft_updated_at);
          const stillDirty = contentKey(latestContentRef.current) !== snapshotKey;
          dirtyRef.current = stillDirty;
          setSaveState(stillDirty ? 'dirty' : 'saved');
          if (stillDirty) {
            saveAgainRef.current = true;
            setContent(latestContentRef.current);
          }
        } catch (cause) {
          const message = errorMessage(cause);
          if (message.toLowerCase().includes('cambió en otra pestaña')) {
            conflictRef.current = true;
            setConflict(true);
            setSaveError('');
            setSaveState('dirty');
          } else if (!navigator.onLine) {
            setSaveError('');
            setSaveState('offline');
          } else {
            setSaveError(message);
            setSaveState('error');
          }
          break;
        }
      } while (saveAgainRef.current && dirtyRef.current && !conflictRef.current);
    })();
    savePromiseRef.current = request;
    try {
      await request;
    } finally {
      if (savePromiseRef.current === request) savePromiseRef.current = null;
    }
  }, [isReadOnly]);

  useEffect(() => {
    if (!document || !dirtyRef.current || isReadOnly || conflict) return undefined;
    const timer = window.setTimeout(() => { void saveLatestDraft(); }, 1500);
    return () => window.clearTimeout(timer);
  }, [content, conflict, document, isReadOnly, saveLatestDraft]);

  useEffect(() => {
    const retryWhenOnline = () => {
      if (dirtyRef.current && !conflictRef.current) void saveLatestDraft();
    };
    window.addEventListener('online', retryWhenOnline);
    return () => window.removeEventListener('online', retryWhenOnline);
  }, [saveLatestDraft]);

  const hasPendingChanges = Boolean(document && dirtyRef.current);
  const blocker = useUnsavedNavigationBlocker(hasPendingChanges || saveState === 'saving');

  useEffect(() => {
    const preventClose = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventClose);
    return () => window.removeEventListener('beforeunload', preventClose);
  }, []);

  const handleEditorChange = (nextContent: JSONContent) => {
    latestContentRef.current = nextContent;
    const nextDirty = contentKey(nextContent) !== savedContentKeyRef.current;
    dirtyRef.current = nextDirty;
    setContent(nextContent);
    setSaveError('');
    setSaveState(nextDirty ? (navigator.onLine ? 'dirty' : 'offline') : 'saved');
    if (nextDirty && savePromiseRef.current) saveAgainRef.current = true;
  };

  const saveNow = async () => { await saveLatestDraft(); };

  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener('keydown', saveShortcut);
    return () => window.removeEventListener('keydown', saveShortcut);
  });

  const reloadRemoteDraft = async () => {
    if (!document || !window.confirm('Se van a descartar tus cambios locales. ¿Recargar el último borrador?')) return;
    try {
      if (savePromiseRef.current) await savePromiseRef.current;
      const [latest, nextVersions] = await Promise.all([getDocument(document.id), listVersions(document.id)]);
      const currentVersion = nextVersions.find((version) => version.id === latest.current_version_id);
      const remoteContent = (latest.draft_content ?? currentVersion?.content_json ?? EMPTY_DOC) as JSONContent;
      revisionRef.current = latest.draft_revision;
      latestContentRef.current = remoteContent;
      savedContentKeyRef.current = contentKey(remoteContent);
      dirtyRef.current = false;
      conflictRef.current = false;
      setCurrentDocument(latest);
      setVersions(nextVersions);
      setContent(remoteContent);
      setRevision(latest.draft_revision);
      setSavedAt(latest.draft_updated_at);
      setSaveState('saved');
      setConflict(false);
      setSaveError('');
      setEditorKey((key) => key + 1);
    } catch (cause) {
      const message = errorMessage(cause);
      if (message.toLowerCase().includes('cambió en otra pestaña')) {
        conflictRef.current = true;
        dirtyRef.current = true;
        setConflict(true);
        setSaveState('dirty');
      } else {
        showToast(message, 'error');
      }
    }
  };

  const saveDespiteConflict = async () => {
    if (!document) return;
    try {
      if (savePromiseRef.current) await savePromiseRef.current;
      const latest = await getDocument(document.id);
      revisionRef.current = latest.draft_revision;
      setRevision(latest.draft_revision);
      conflictRef.current = false;
      setConflict(false);
      setSaveState('dirty');
      await saveLatestDraft();
    } catch (cause) {
      const message = errorMessage(cause);
      if (message.toLowerCase().includes('cambió en otra pestaña')) {
        conflictRef.current = true;
        dirtyRef.current = true;
        setConflict(true);
        setSaveState('dirty');
      } else {
        showToast(message, 'error');
      }
    }
  };

  const flushDraft = async (): Promise<boolean> => {
    if (savePromiseRef.current) await savePromiseRef.current;
    if (conflictRef.current) return false;
    if (dirtyRef.current) await saveLatestDraft();
    return !dirtyRef.current && !conflictRef.current;
  };

  const saveVersion = async (note = ''): Promise<KnowledgeVersion | null> => {
    if (!document || isReadOnly || conflictRef.current) return null;
    const flushed = await flushDraft();
    if (!flushed) return null;
    const snapshot = latestContentRef.current;
    const hash = await contentHash(snapshot);
    const version = await saveEditorVersion(
      document.id,
      serializableContent(snapshot),
      toMarkdown(snapshot),
      toPlainText(snapshot),
      hash,
      revisionRef.current,
      note,
    );
    if (version.id === documentRef.current?.current_version_id) {
      showToast('No hay cambios desde la última versión.', 'info');
      return version;
    }

    revisionRef.current += 1;
    setRevision(revisionRef.current);
    savedContentKeyRef.current = contentKey(snapshot);
    dirtyRef.current = false;
    setContent(snapshot);
    setSaveState('saved');
    setSavedAt(new Date().toISOString());
    setCurrentDocument({ ...document, current_version_id: version.id });
    setVersions((current) => [version, ...current.filter((item) => item.id !== version.id)]);
    showToast(`Versión ${version.version_number} guardada.`, 'success');
    return version;
  };

  const saveVersionFromModal = async () => {
    setVersionBusy(true);
    try {
      const version = await saveVersion(versionNote.trim());
      if (version) {
        setVersionModalOpen(false);
        setVersionNote('');
      }
    } catch (cause) {
      const message = errorMessage(cause);
      if (message.toLowerCase().includes('cambió en otra pestaña')) {
        conflictRef.current = true;
        dirtyRef.current = true;
        setConflict(true);
        setSaveState('dirty');
      } else {
        showToast(message, 'error');
      }
    } finally {
      setVersionBusy(false);
    }
  };

  const changeStatus = async (nextStatus: 'in_review' | 'published') => {
    if (!document || isReadOnly || statusBusy) return;
    if (nextStatus === 'published') {
      const hash = await contentHash(latestContentRef.current);
      const currentHash = versions.find((version) => version.id === document.current_version_id)?.content_hash;
      const nextVersionNumber = currentHash === hash
        ? (versions.find((version) => version.id === document.current_version_id)?.version_number ?? 1)
        : Math.max(0, ...versions.map((version) => version.version_number)) + 1;
      if (!window.confirm(`La versión ${nextVersionNumber} quedará disponible para la IA (si está habilitada). ¿Publicar?`)) return;
    }
    setStatusBusy(true);
    try {
      const version = await saveVersion();
      if (!version) return;
      const updated = await setStatus(document.id, nextStatus, nextStatus === 'published' ? 'Publicado desde el editor.' : 'Enviado a revisión desde el editor.');
      setCurrentDocument(updated);
      showToast(nextStatus === 'published' ? 'Documento publicado.' : 'Documento enviado a revisión.', 'success');
    } catch (cause) {
      const message = errorMessage(cause);
      if (message.toLowerCase().includes('cambió en otra pestaña')) {
        conflictRef.current = true;
        dirtyRef.current = true;
        setConflict(true);
        setSaveState('dirty');
      } else {
        showToast(message, 'error');
      }
    } finally {
      setStatusBusy(false);
    }
  };

  const exportPdf = async () => {
    if (!document || pdfBusy) return;
    setPdfBusy(true);
    try {
      const { createKnowledgePdf } = await import('../../lib/knowledge/pdfExport');
      const currentVersion = versions.find((version) => version.id === document.current_version_id);
      const pdf = await createKnowledgePdf({
        doc: content,
        title: document.title,
        businessName: user?.businessName ?? '',
        versionNumber: currentVersion?.version_number ?? 1,
        updatedAt: document.draft_updated_at ?? document.updated_at,
        loadImage: loadKnowledgePdfImage,
      });
      downloadKnowledgePdf(pdf.blob, pdf.fileName);
    } catch (cause) {
      showToast(errorMessage(cause), 'error');
    } finally {
      setPdfBusy(false);
    }
  };

  const createAndOpen = (created: KnowledgeDocument) => {
    navigate(`/ia/conocimientos/doc/${created.id}/editar`, { replace: true });
  };

  const saveLabel = saveState === 'saving'
    ? 'Guardando…'
    : saveState === 'offline'
      ? 'Sin conexión: se guardará al reconectar'
      : saveState === 'error'
        ? 'Error al guardar — Reintentar'
        : saveState === 'saved' && savedAt
          ? `Borrador guardado a las ${new Date(savedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
          : saveState === 'saved'
            ? 'Borrador guardado'
            : 'Cambios pendientes de guardar';

  if (mode === 'create') {
    return (
      <div className="mx-auto max-w-5xl space-y-5">
        <Link to="/ia/conocimientos" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)]"><ArrowLeft size={16}/>Volver a Conocimientos</Link>
        <div><h1 className="text-2xl font-bold">Nuevo documento</h1><p className="mt-1 text-sm text-[var(--ink-muted)]">Creá un documento editable para reunir el conocimiento de tu negocio.</p></div>
        <CreateEditorDocument onCreated={createAndOpen}/>
      </div>
    );
  }

  if (loading) return <div className="flex min-h-64 items-center justify-center" role="status"><Loader2 className="animate-spin text-[var(--brand)]" size={32}/><span className="sr-only">Cargando documento</span></div>;
  if (loadError || !document) return <section role="alert" className="rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] p-5 text-sm text-[var(--danger-ink)]"><p>{loadError || 'No se encontró el documento.'}</p><Link to="/ia/conocimientos/biblioteca" className="mt-3 inline-block font-bold underline">Volver a la Biblioteca</Link></section>;

  const currentVersion = versions.find((version) => version.id === document.current_version_id);
  const publishedVersion = versions.find((version) => version.id === document.published_version_id);
  const canPublish = document.status !== 'archived' && document.status !== 'deleting'
    && !(document.status === 'published' && document.current_version_id === document.published_version_id);

  return (
    <div className="mx-auto max-w-[1360px] space-y-4 pb-24 lg:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to={`/ia/conocimientos/doc/${document.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--brand)]"><ArrowLeft size={16}/>Volver al documento</Link>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[var(--brand-soft)] px-3 py-1 text-xs font-bold text-[var(--brand)]">{statusLabel(document.status)}</span>
          <span className={`inline-flex items-center gap-1.5 text-xs ${saveState === 'error' || saveState === 'offline' ? 'text-[var(--danger-ink)]' : 'text-[var(--ink-muted)]'}`} role="status">
            {saveState === 'saving' ? <Loader2 size={13} className="animate-spin"/> : saveState === 'saved' ? <Check size={13}/> : <span className="size-1.5 rounded-full bg-current"/>}{saveLabel}
          </span>
          {saveState === 'error' && <button type="button" onClick={() => void saveNow()} className="text-xs font-bold text-[var(--brand)] underline">Reintentar</button>}
        </div>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Editor de Conocimientos</p><h1 className="mt-1 truncate text-2xl font-bold sm:text-3xl">{document.title}</h1><p className="mt-1 text-xs text-[var(--ink-muted)]">El PDF incluye el borrador actual y sus cambios no publicados.</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pdfBusy} onClick={() => void exportPdf()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold disabled:opacity-50"><Download size={15}/>{pdfBusy ? 'Generando PDF…' : 'Exportar PDF'}</button>
          <button type="button" onClick={() => setSidePanelOpen((open) => !open)} aria-expanded={sidePanelOpen} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold lg:hidden">Estado y acciones<ChevronDown size={15} className={sidePanelOpen ? 'rotate-180' : ''}/></button>
        </div>
      </header>

      {(isReadOnly || conflict) && <section role="alert" className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${conflict ? 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100' : 'border-[var(--line)] bg-[var(--surface-muted)] text-[var(--ink)]'}`}>
        <AlertTriangle size={18} className="mt-0.5 shrink-0"/>
        {conflict ? <div className="min-w-0 flex-1"><p className="font-bold">El borrador cambió en otra pestaña.</p><p className="mt-1">Recargá la última versión o guardá tus cambios sobre la versión más reciente.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void reloadRemoteDraft()} className="rounded-lg border border-current px-3 py-2 text-xs font-bold">Recargar la última versión</button><button type="button" onClick={() => void saveDespiteConflict()} className="rounded-lg bg-[var(--action-bg)] px-3 py-2 text-xs font-bold text-[var(--action-ink)]">Guardar mis cambios igual</button></div></div>
          : <div><p className="font-bold">Restaurá el documento para editarlo.</p><Link to={`/ia/conocimientos/doc/${document.id}`} className="mt-1 inline-block font-semibold underline">Ir al detalle del documento</Link></div>}
      </section>}

      {saveError && saveState === 'error' && <p role="alert" className="rounded-lg border border-[var(--danger-line)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger-ink)]">{saveError}</p>}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <main className="min-w-0"><div className="max-w-4xl">
          <KnowledgeEditor
            key={`${document.id}-${editorKey}`}
            initialContent={content}
            documentId={document.id}
            ownerUid={document.user_id}
            editable={!isReadOnly && !versionBusy && !statusBusy}
            onChange={handleEditorChange}
          />
        </div></main>
        {sidePanelOpen && <aside className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm lg:sticky lg:top-4 lg:h-fit">
          <div><h2 className="font-bold">Estado y versiones</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">{statusLabel(document.status)}</p></div>
          <dl className="space-y-2 border-y border-[var(--line)] py-3 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-[var(--ink-muted)]">Borrador</dt><dd className="font-semibold">r{revision}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[var(--ink-muted)]">Versión actual</dt><dd className="font-semibold">{currentVersion ? `v${currentVersion.version_number}` : 'Sin versión'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[var(--ink-muted)]">Publicada</dt><dd className="font-semibold">{publishedVersion ? `v${publishedVersion.version_number}` : 'Sin publicar'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-[var(--ink-muted)]">Versiones</dt><dd className="font-semibold">{versions.length}</dd></div>
          </dl>
          <div className="flex flex-col gap-2">
            <button type="button" disabled={isReadOnly || conflict || versionBusy || statusBusy} onClick={() => setVersionModalOpen(true)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm font-bold disabled:opacity-50"><Save size={15}/>Guardar versión</button>
            {document.status === 'draft' && <button type="button" disabled={isReadOnly || conflict || statusBusy} onClick={() => void changeStatus('in_review')} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm font-bold disabled:opacity-50"><Send size={15}/>Enviar a revisión</button>}
            {canPublish && <button type="button" disabled={isReadOnly || conflict || statusBusy} onClick={() => void changeStatus('published')} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--action-bg)] px-3 py-2.5 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50">{statusBusy ? <Loader2 size={15} className="animate-spin"/> : <Check size={15}/>}Publicar</button>}
          </div>
          {document.rag_enabled && <p className="rounded-lg bg-[var(--brand-soft)] p-3 text-xs text-[var(--brand)]">Al publicar una versión nueva, quedará disponible para la IA.</p>}
        </aside>}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t border-[var(--line)] bg-[var(--surface)] p-3 shadow-lg lg:hidden">
        <button type="button" disabled={isReadOnly || conflict || statusBusy} onClick={() => setVersionModalOpen(true)} className="flex-1 rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm font-bold disabled:opacity-50">Guardar versión</button>
        {document.status === 'draft' && <button type="button" disabled={isReadOnly || conflict || statusBusy} onClick={() => void changeStatus('in_review')} className="flex-1 rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm font-bold disabled:opacity-50">Enviar a revisión</button>}
        {canPublish && <button type="button" disabled={isReadOnly || conflict || statusBusy} onClick={() => void changeStatus('published')} className="flex-1 rounded-lg bg-[var(--action-bg)] px-3 py-2.5 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50">Publicar</button>}
      </div>

      <Modal isOpen={versionModalOpen} onClose={() => !versionBusy && setVersionModalOpen(false)} title="Guardar versión">
        <div className="space-y-4">
          <p className="text-sm text-[var(--ink-muted)]">Guardá una versión estable del contenido actual. El borrador seguirá disponible para editar.</p>
          <label className="block text-sm font-semibold">Nota de versión <span className="font-normal text-[var(--ink-muted)]">(opcional)</span><textarea value={versionNote} onChange={(event) => setVersionNote(event.target.value)} maxLength={300} rows={3} className="mt-1.5 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm font-normal" placeholder="Qué cambió en esta versión"/></label>
          <div className="flex justify-end gap-2"><button type="button" disabled={versionBusy} onClick={() => setVersionModalOpen(false)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold">Cancelar</button><button type="button" disabled={versionBusy || isReadOnly || conflict} onClick={() => void saveVersionFromModal()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-4 py-2 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50">{versionBusy && <Loader2 size={15} className="animate-spin"/>}Guardar versión</button></div>
        </div>
      </Modal>

      <Modal isOpen={blocker.blocked} onClose={blocker.reset} title="Cambios sin guardar">
        <div className="space-y-4"><p className="text-sm">Hay cambios pendientes. Podés seguir editando o salir y descartarlos.</p><div className="flex justify-end gap-2"><button type="button" onClick={blocker.reset} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold">Seguir editando</button><button type="button" disabled={saveState === 'saving'} onClick={blocker.proceed} className="rounded-lg bg-[var(--danger-ink)] px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Salir sin guardar</button></div></div>
      </Modal>
    </div>
  );
}
