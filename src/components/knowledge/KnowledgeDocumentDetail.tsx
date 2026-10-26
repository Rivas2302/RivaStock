import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AlertCircle, Archive, ArrowLeft, Check, Download, Eye, FileClock, FileText, History, Loader2, RotateCcw, Save, Send, Upload, WandSparkles } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { JSONContent } from '@tiptap/core';
import { useAuth } from '../../AuthContext';
import {
  createTag,
  deleteDocument,
  getDocument,
  getLatestKnowledgeOcrStats,
  listCategories,
  listDocumentTagIds,
  listEvents,
  listFolders,
  listTags,
  listVersions,
  reindexDocument,
  restoreVersion,
  setRagEnabled,
  setStatus,
  updateMetadata,
  uploadNewFileVersion,
} from '../../lib/knowledge/api';
import {
  formatBytes,
  formatDate,
  KNOWLEDGE_FORMAT_CLASSES,
  KNOWLEDGE_FORMAT_LABELS,
  KNOWLEDGE_INDEX_STATUS_CLASSES,
  KNOWLEDGE_INDEX_STATUS_LABELS,
  KNOWLEDGE_STATUS_CLASSES,
  KNOWLEDGE_STATUS_LABELS,
} from '../../lib/knowledge/format';
import { signedUrl } from '../../lib/knowledge/storage';
import { renderMarkdownSafe } from '../../lib/knowledge/markdown';
import { diffLines, type LineDiffCell, type LineDiffRow } from '../../lib/knowledge/lineDiff';
import { toPlainText } from '../../lib/knowledge/editorContent';
import { downloadKnowledgePdf, loadKnowledgePdfImage } from '../../lib/knowledge/pdfBrowser';
import PdfPreview from './PdfPreview';
import type {
  KnowledgeCategory,
  KnowledgeDocument,
  KnowledgeEvent,
  KnowledgeExtractionStatus,
  KnowledgeFolder,
  KnowledgeIndexStatus,
  KnowledgeStatus,
  KnowledgeTag,
  KnowledgeVersion,
} from '../../lib/knowledge/types';

type DetailTab = 'preview' | 'info' | 'versions' | 'history';

const KnowledgeEditor = lazy(() => import('./editor/KnowledgeEditor'));

function folderLabel(folder: KnowledgeFolder, folders: KnowledgeFolder[]): string {
  const byId = new Map(folders.map((item) => [item.id, item]));
  const parts = [folder.name];
  let parentId = folder.parent_id;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;
    parts.push(parent.name);
    parentId = parent.parent_id;
  }
  return parts.reverse().join(' / ');
}

function actorLabel(uid: string | null, currentUid: string | undefined): string {
  if (!uid) return 'Sistema';
  return uid === currentUid ? 'Vos' : 'Colaborador';
}

function eventDescription(event: KnowledgeEvent): string {
  const details = event.details ?? {};
  const from = typeof details.from === 'string' ? KNOWLEDGE_STATUS_LABELS[details.from as KnowledgeStatus] ?? details.from : '';
  const to = typeof details.to === 'string' ? KNOWLEDGE_STATUS_LABELS[details.to as KnowledgeStatus] ?? details.to : '';
  switch (event.action) {
    case 'created': return 'Creó el documento';
    case 'version_added': return `Agregó la versión ${String(details.version ?? '')}`.trim();
    case 'status_changed': return `Cambió el estado de ${from} a ${to}`;
    case 'metadata_updated': return 'Actualizó los metadatos';
    case 'rag_enabled': return 'Habilitó el uso en la IA';
    case 'rag_disabled': return 'Excluyó el documento de la IA';
    case 'version_restored': return `Restauró una versión${details.from_version ? ` desde v${String(details.from_version)}` : ''}`;
    case 'imported': return 'Importó el documento desde la Biblioteca anterior';
    case 'indexed': return 'Indexó el documento para la IA';
    case 'index_failed': return 'Falló la indexación del documento';
    case 'delete_started': return 'Inició la eliminación';
    case 'deleted': return 'Eliminó el documento';
    default: return event.action.replaceAll('_', ' ');
  }
}

function sourceLabel(source: KnowledgeVersion['source']): string {
  return ({ upload: 'Carga', editor: 'Editor', import: 'Importación', restore: 'Restauración' })[source];
}

function extractionMessage(status: KnowledgeExtractionStatus): string {
  return ({
    pending: 'El texto se extraerá cuando tu PC vinculada procese el documento.',
    done: '',
    not_supported: 'La extracción de texto no está disponible para este formato.',
    error: 'No se pudo extraer el texto de esta versión.',
  })[status];
}

function fileAccept(format: KnowledgeDocument['format']): string {
  return ({ pdf: '.pdf', docx: '.docx', txt: '.txt', md: '.md', image: '.png,.jpg,.jpeg,.webp', editor: '' })[format];
}

export default function KnowledgeDocumentDetail() {
  const { documentId = '' } = useParams();
  const navigate = useNavigate();
  const { authUser, user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const signedAtRef = useRef(0);
  const [document, setDocument] = useState<KnowledgeDocument | null>(null);
  const [versions, setVersions] = useState<KnowledgeVersion[]>([]);
  const [events, setEvents] = useState<KnowledgeEvent[]>([]);
  const [ocrStats, setOcrStats] = useState<{ ocr: boolean; ocr_notice: string | null } | null>(null);
  const [folders, setFolders] = useState<KnowledgeFolder[]>([]);
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [tags, setTags] = useState<KnowledgeTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTab>('preview');
  const [reviewVersionId, setReviewVersionId] = useState<string | null>(null);
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewUrlPath, setPreviewUrlPath] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [folderId, setFolderId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);

  const load = useCallback(async () => {
    if (!documentId) return;
    setLoading(true);
    setPageError('');
    try {
      const [nextDocument, nextVersions, nextEvents, nextFolders, nextCategories, nextTags, nextTagIds, nextOcrStats] = await Promise.all([
        getDocument(documentId),
        listVersions(documentId),
        listEvents(documentId),
        listFolders(),
        listCategories(),
        listTags(),
        listDocumentTagIds(documentId),
        getLatestKnowledgeOcrStats(documentId),
      ]);
      setDocument(nextDocument);
      setVersions(nextVersions);
      setReviewVersionId(null);
      setCompareVersionId(null);
      setEvents(nextEvents);
      setOcrStats(nextOcrStats);
      setFolders(nextFolders);
      setCategories(nextCategories);
      setTags(nextTags);
      setPreviewVersionId(nextDocument.current_version_id);
      setTitle(nextDocument.title);
      setDescription(nextDocument.description);
      setFolderId(nextDocument.folder_id ?? '');
      setCategoryId(nextDocument.category_id ?? '');
      setSelectedTagIds(nextTagIds);
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : 'No se pudo cargar el documento.');
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!document) return;
    let active = true;
    const refreshOcrStats = async () => {
      try {
        const stats = await getLatestKnowledgeOcrStats(documentId);
        if (active) setOcrStats(stats);
      } catch {
        // Preserve the last known OCR status while retrying on a later refresh.
      }
    };
    if (document.index_status !== 'queued' && document.index_status !== 'processing') {
      void refreshOcrStats();
      return () => { active = false; };
    }
    let checking = false;
    const refreshStatus = async () => {
      if (!active || checking || window.document.visibilityState !== 'visible') return;
      checking = true;
      try {
        const refreshed = await getDocument(documentId);
        if (active) setDocument(refreshed);
      } catch {
        // Keep the last known status and retry on the next visible poll.
      } finally {
        checking = false;
      }
    };
    const onVisibilityChange = () => { if (window.document.visibilityState === 'visible') void refreshStatus(); };
    const timer = window.setInterval(() => void refreshStatus(), 5_000);
    window.document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [document?.index_status, documentId]);

  const currentVersion = useMemo(
    () => versions.find((version) => version.id === document?.current_version_id) ?? null,
    [versions, document?.current_version_id],
  );
  const reviewVersion = useMemo(
    () => versions.find((version) => version.id === reviewVersionId) ?? null,
    [versions, reviewVersionId],
  );
  const previewVersion = useMemo(
    () => versions.find((version) => version.id === previewVersionId) ?? currentVersion,
    [versions, previewVersionId, currentVersion],
  );
  const hasUnpublishedChanges = Boolean(document?.published_version_id && document.current_version_id !== document.published_version_id);
  const publishedEvent = events.find((event) => event.action === 'status_changed'
    && event.details.to === 'published'
    && (!document?.published_version_id || event.details.version_id === document.published_version_id));
  const displayedEditorVersion = activeTab === 'versions' && reviewVersion ? reviewVersion : previewVersion;

  const refreshPreviewUrl = useCallback(async (path?: string) => {
    const targetPath = path ?? previewVersion?.storage_path ?? '';
    if (!targetPath) return;
    setPreviewError('');
    try {
      const url = await signedUrl(targetPath, 300);
      setPreviewUrl(url);
      setPreviewUrlPath(targetPath);
      signedAtRef.current = Date.now();
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : 'No se pudo abrir el archivo.');
    }
  }, [previewVersion?.storage_path]);

  useEffect(() => {
    const needsSignedUrl = document?.format === 'pdf' || document?.format === 'image' || document?.format === 'docx';
    const path = activeTab === 'preview' && needsSignedUrl ? previewVersion?.storage_path : null;
    if (path && (path !== previewUrlPath || Date.now() - signedAtRef.current > 240_000)) void refreshPreviewUrl(path);
  }, [activeTab, document?.format, previewVersion?.storage_path, previewUrlPath, refreshPreviewUrl]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      const needsSignedUrl = document?.format === 'pdf' || document?.format === 'image' || document?.format === 'docx';
      if (window.document.visibilityState === 'visible' && activeTab === 'preview' && needsSignedUrl && Date.now() - signedAtRef.current > 240_000) {
        void refreshPreviewUrl();
      }
    };
    window.addEventListener('focus', refreshWhenVisible);
    window.document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      window.document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [activeTab, document?.format, refreshPreviewUrl]);

  const downloadVersion = async (version: KnowledgeVersion) => {
    if (!version.storage_path) return;
    try {
      const url = await signedUrl(version.storage_path, 300, version.original_filename ?? true);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = version.original_filename ?? `version-${version.version_number}`;
      anchor.rel = 'noreferrer';
      anchor.target = '_blank';
      anchor.click();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo descargar el archivo.');
    }
  };

  const exportPdf = async (version: KnowledgeVersion) => {
    if (!document || pdfBusy || !version.content_json) return;
    setPdfBusy(true);
    setActionError('');
    try {
      const { createKnowledgePdf } = await import('../../lib/knowledge/pdfExport');
      const pdf = await createKnowledgePdf({
        doc: version.content_json as JSONContent,
        title: document.title,
        businessName: user?.businessName ?? '',
        versionNumber: version.version_number,
        publishedAt: version.id === document.published_version_id ? document.published_at : null,
        updatedAt: version.created_at,
        loadImage: loadKnowledgePdfImage,
      });
      downloadKnowledgePdf(pdf.blob, pdf.fileName);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo generar el PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  const changeStatus = async (status: KnowledgeStatus, successMessage: string) => {
    if (!document || busy) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await setStatus(document.id, status);
      setDocument(await getDocument(document.id));
      await load();
      setNotice(successMessage);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo cambiar el estado.');
    } finally {
      setBusy(false);
    }
  };

  const removeCurrentDocument = async () => {
    if (!document || busy) return;
    if (document.status === 'published') {
      const typedTitle = window.prompt(`Para eliminar el documento publicado, escribí su título exacto:\n${document.title}`);
      if (typedTitle !== document.title) return;
    } else if (!window.confirm(`¿Eliminar “${document.title}”? Esta acción borra sus archivos y versiones.`)) return;
    setBusy(true);
    setActionError('');
    try {
      await deleteDocument(document.id);
      navigate('/ia/conocimientos/biblioteca');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo eliminar el documento.');
    } finally {
      setBusy(false);
    }
  };

  const handleVersionUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !document) return;
    setUploadBusy(true);
    setActionError('');
    setNotice('');
    try {
      const version = await uploadNewFileVersion(document.id, file);
      await load();
      setActiveTab('preview');
      setPreviewVersionId(version.id);
      setNotice(`Se agregó la versión ${version.version_number}.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo agregar la versión.');
    } finally {
      setUploadBusy(false);
    }
  };

  const restore = async (version: KnowledgeVersion) => {
    if (!document || busy || !window.confirm(`¿Restaurar v${version.version_number} como la versión actual? Se creará una versión nueva.`)) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const restored = await restoreVersion(document.id, version.id);
      if (document.kind === 'editor') {
        navigate(`/ia/conocimientos/doc/${document.id}/editar`);
        return;
      }
      await load();
      setPreviewVersionId(restored.id);
      setActiveTab('preview');
      setNotice(`Se creó la versión ${restored.version_number} a partir de v${version.version_number}.`);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo restaurar la versión.');
    } finally {
      setBusy(false);
    }
  };

  const saveMetadata = async () => {
    if (!document || busy) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await updateMetadata(document.id, { title, description, folderId: folderId || null, categoryId: categoryId || null, tagIds: selectedTagIds });
      await load();
      setNotice('Se guardaron los metadatos.');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudieron guardar los metadatos.');
    } finally {
      setBusy(false);
    }
  };

  const toggleAI = async (enabled: boolean) => {
    if (!document || busy) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await setRagEnabled(document.id, enabled);
      setDocument(await getDocument(document.id));
      await load();
      setNotice(enabled ? 'El documento quedó habilitado para la IA.' : 'El documento quedó excluido de la IA.');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo cambiar el uso en la IA.');
    } finally {
      setBusy(false);
    }
  };

  const retryIndexing = async () => {
    if (!document || busy) return;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      await reindexDocument(document.id);
      setDocument(await getDocument(document.id));
      setNotice('Se volvió a poner el documento en la cola de indexación.');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo volver a indexar el documento.');
    } finally {
      setBusy(false);
    }
  };

  const addTagInline = async () => {
    if (!newTagName.trim() || creatingTag) return;
    setCreatingTag(true);
    setActionError('');
    try {
      const tag = await createTag(newTagName.trim());
      setTags((current) => [...current, tag].sort((a, b) => a.name.localeCompare(b.name, 'es')));
      setSelectedTagIds((current) => current.includes(tag.id) ? current : [...current, tag.id]);
      setNewTagName('');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo crear la etiqueta.');
    } finally {
      setCreatingTag(false);
    }
  };

  if (loading) return <div aria-label="Cargando documento" className="animate-pulse space-y-4"><div className="h-24 rounded-2xl bg-[var(--surface-muted)]"/><div className="h-96 rounded-2xl bg-[var(--surface-muted)]"/></div>;
  if (pageError || !document) return <section role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100"><h3 className="font-bold">No se pudo abrir el documento</h3><p className="mt-1 text-sm">{pageError || 'Documento inexistente.'}</p><Link to="/ia/conocimientos/biblioteca" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold underline"><ArrowLeft size={15}/>Volver a la Biblioteca</Link></section>;

  const visibleIndexStatus = document.index_status as KnowledgeIndexStatus;
  const tabs: Array<{ id: DetailTab; label: string; icon: typeof Eye }> = [
    { id: 'preview', label: 'Vista previa', icon: Eye },
    { id: 'info', label: 'Información', icon: FileText },
    { id: 'versions', label: 'Versiones', icon: FileClock },
    { id: 'history', label: 'Historial', icon: History },
  ];

  return <div className="space-y-5">
    <header className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <Link to="/ia/conocimientos/biblioteca" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)] hover:underline"><ArrowLeft size={14}/>Biblioteca</Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-xl font-bold md:text-2xl">{document.title}</h1>
          {document.description && <p className="mt-1 max-w-3xl text-sm text-[var(--ink-muted)]">{document.description}</p>}
          <div className="mt-3 flex flex-wrap gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${KNOWLEDGE_STATUS_CLASSES[document.status]}`}>{KNOWLEDGE_STATUS_LABELS[document.status]}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${KNOWLEDGE_INDEX_STATUS_CLASSES[visibleIndexStatus]}`}>{KNOWLEDGE_INDEX_STATUS_LABELS[visibleIndexStatus]}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${KNOWLEDGE_FORMAT_CLASSES[document.format]}`}>{KNOWLEDGE_FORMAT_LABELS[document.format]}</span></div>
          {hasUnpublishedChanges && <p role="status" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-100"><AlertCircle size={15}/>Hay una versión nueva sin publicar</p>}
        </div>
        <div className="flex max-w-xl flex-wrap gap-2">
          {document.status === 'draft' && <button type="button" disabled={busy} onClick={() => void changeStatus('in_review', 'Se envió el documento a revisión.')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50"><Send size={14}/>Enviar a revisión</button>}
          {(['draft', 'in_review'].includes(document.status) || (document.status === 'published' && hasUnpublishedChanges)) && <button type="button" disabled={busy} onClick={() => void changeStatus('published', 'Se publicó la versión actual.')} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-3 py-2 text-xs font-bold text-[var(--action-ink)] disabled:opacity-50"><Check size={14}/>{hasUnpublishedChanges ? `Publicar versión ${versions.find((version) => version.id === document.current_version_id)?.version_number ?? ''}` : 'Publicar'}</button>}
          {['in_review', 'published'].includes(document.status) && <button type="button" disabled={busy} onClick={() => void changeStatus('draft', 'El documento volvió a borrador.')} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50">Volver a borrador</button>}
          {['draft', 'in_review', 'published'].includes(document.status) && <button type="button" disabled={busy} onClick={() => void changeStatus('archived', 'Se archivó el documento.')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50"><Archive size={14}/>Archivar</button>}
          {document.status === 'archived' && <button type="button" disabled={busy} onClick={() => void changeStatus('draft', 'Se restauró el documento como borrador.')} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50"><RotateCcw size={14}/>Restaurar</button>}
          {currentVersion?.storage_path && <button type="button" onClick={() => void downloadVersion(currentVersion)} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold"><Download size={14}/>Descargar</button>}
          {document.kind === 'editor' && displayedEditorVersion?.content_json && <button type="button" disabled={pdfBusy} onClick={() => void exportPdf(displayedEditorVersion)} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50"><Download size={14}/>{pdfBusy ? 'Generando PDF…' : `Exportar PDF · v${displayedEditorVersion.version_number}`}</button>}
          {document.kind === 'file' && document.status !== 'archived' && document.status !== 'deleting' && <><input ref={fileInputRef} type="file" accept={fileAccept(document.format)} onChange={(event) => void handleVersionUpload(event)} className="sr-only"/><button type="button" disabled={uploadBusy || busy} onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50">{uploadBusy ? <Loader2 size={14} className="animate-spin"/> : <Upload size={14}/>}Subir nueva versión</button></>}
          {document.status !== 'deleting' && <button type="button" disabled={busy} onClick={() => void removeCurrentDocument()} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300">Eliminar</button>}
        </div>
      </div>
    </header>

    {actionError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100">{actionError}</p>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">{notice}</p>}
    {visibleIndexStatus === 'error' && <section role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100"><div><h2 className="text-sm font-bold">No se pudo indexar este documento</h2><p className="mt-1 text-sm">{document.index_error || 'La última indexación terminó con un error.'}</p></div>{document.status === 'published' && document.rag_enabled && <button type="button" disabled={busy} onClick={() => void retryIndexing()} className="inline-flex items-center gap-2 rounded-lg border border-current px-3 py-2 text-sm font-bold disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin"/> : <RotateCcw size={14}/>}Reintentar indexación</button>}</section>}
    {(visibleIndexStatus === 'queued' || visibleIndexStatus === 'processing') && <p role="status" className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-soft)] px-4 py-3 text-sm font-semibold text-[var(--brand)]"><Loader2 size={16} className="animate-spin"/>La PC vinculada está procesando este documento.</p>}

    <nav className="flex gap-1 overflow-x-auto border-b border-[var(--line)]" aria-label="Secciones del documento">
      {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setActiveTab(id)} aria-current={activeTab === id ? 'page' : undefined} className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold ${activeTab === id ? 'border-[var(--brand)] text-[var(--brand)]' : 'border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}><Icon size={16}/>{label}</button>)}
    </nav>

    {activeTab === 'preview' && <>
      {ocrStats?.ocr && <p role="note" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Texto obtenido por OCR, puede contener errores.{ocrStats.ocr_notice ? ` ${ocrStats.ocr_notice}.` : ''}</p>}
      <PreviewPane document={document} version={previewVersion} signedUrl={previewUrlPath === previewVersion?.storage_path ? previewUrl : ''} signedError={previewError} onOpenPdf={() => previewUrl && window.open(previewUrl, '_blank', 'noopener,noreferrer')}/>
    </>}

    {activeTab === 'info' && <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
        <h2 className="text-lg font-bold">Metadatos</h2>
        <div className="mt-4 space-y-4">
          <label className="block text-sm font-semibold">Título<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-normal"/></label>
          <label className="block text-sm font-semibold">Descripción<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} rows={3} className="mt-1 w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-normal"/></label>
          <label className="block text-sm font-semibold">Carpeta<select value={folderId} onChange={(event) => setFolderId(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-normal"><option value="">Sin carpeta</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folderLabel(folder, folders)}</option>)}</select></label>
          <label className="block text-sm font-semibold">Categoría<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-normal"><option value="">Sin categoría</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <fieldset><legend className="text-sm font-semibold">Etiquetas</legend><div className="mt-2 flex flex-wrap gap-2">{tags.map((tag) => <label key={tag.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold ${selectedTagIds.includes(tag.id) ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--line)]'}`}><input type="checkbox" checked={selectedTagIds.includes(tag.id)} onChange={() => setSelectedTagIds((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])} className="sr-only"/>{tag.name}</label>)}</div>
            <div className="mt-3 flex gap-2"><input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addTagInline(); } }} maxLength={40} placeholder="Nueva etiqueta" className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm"/><button type="button" disabled={!newTagName.trim() || creatingTag} onClick={() => void addTagInline()} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50">{creatingTag ? 'Creando…' : 'Crear etiqueta'}</button></div>
          </fieldset>
          <button type="button" disabled={busy || !title.trim()} onClick={() => void saveMetadata()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-4 py-2.5 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50"><Save size={15}/>Guardar cambios</button>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
          <h2 className="text-lg font-bold">Datos del documento</h2>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <InfoRow label="Formato" value={KNOWLEDGE_FORMAT_LABELS[document.format]}/>
            <InfoRow label="Tamaño actual" value={currentVersion?.file_size == null ? '—' : formatBytes(currentVersion.file_size)}/>
            <InfoRow label="Páginas" value={currentVersion?.page_count == null ? '—' : String(currentVersion.page_count)}/>
            <InfoRow label="Creado" value={`${formatDate(document.created_at)} · ${actorLabel(document.created_by, authUser?.uid)}`}/>
            <InfoRow label="Actualizado" value={`${formatDate(document.updated_at)} · ${actorLabel(document.updated_by, authUser?.uid)}`}/>
            <InfoRow label="Publicado" value={document.published_at ? `${formatDate(document.published_at)} · ${actorLabel(publishedEvent?.actor_uid ?? document.created_by, authUser?.uid)}` : 'Nunca'}/>
            <InfoRow label="Última indexación" value={formatDate(document.last_indexed_at) || 'Nunca'}/>
            <InfoRow label="Fragmentos" value={String(document.chunk_count)}/>
          </dl>
          {document.index_error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200">{document.index_error}</p>}
        </section>
        <section className="flex items-start justify-between gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
          <span><h2 className="font-bold">Usar en la IA</h2><p className="mt-1 text-xs text-[var(--ink-muted)]">Los documentos excluidos no se recuperan como contexto.</p></span>
          <button type="button" role="switch" aria-checked={document.rag_enabled} aria-label="Usar documento en la IA" disabled={busy || document.status === 'deleting'} onClick={() => void toggleAI(!document.rag_enabled)} className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${document.rag_enabled ? 'bg-[var(--brand)]' : 'bg-slate-300 dark:bg-slate-700'}`}><span className={`absolute top-1 size-4 rounded-full bg-white transition-transform ${document.rag_enabled ? 'translate-x-6' : 'translate-x-1'}`}/></button>
        </section>
      </aside>
    </div>}

    {activeTab === 'versions' && <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
      <div className="border-b border-[var(--line)] p-5"><h2 className="text-lg font-bold">Versiones</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Cada restauración crea una versión nueva para conservar el historial.</p></div>
      {document.kind === 'editor' && reviewVersion && <EditorVersionReview
        key={reviewVersion.id}
        document={document}
        version={reviewVersion}
        currentVersion={currentVersion}
        comparing={compareVersionId === reviewVersion.id}
        onClose={() => { setReviewVersionId(null); setCompareVersionId(null); }}
        onToggleComparison={() => setCompareVersionId((id) => id === reviewVersion.id ? null : reviewVersion.id)}
      />}
      {versions.length ? <ul className="divide-y divide-[var(--line)]">{versions.map((version) => <li key={version.id} className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">v{version.version_number}</h3>{document.current_version_id === version.id && <span className="rounded-full bg-[var(--brand-soft)] px-2 py-1 text-[10px] font-bold text-[var(--brand)]">Actual</span>}{document.published_version_id === version.id && <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Publicada</span>}</div><p className="mt-1 text-xs text-[var(--ink-muted)]">{formatDate(version.created_at)} · {sourceLabel(version.source)} · {version.file_size == null ? 'Contenido de texto' : formatBytes(version.file_size)}</p>{version.change_note && <p className="mt-1 text-xs">{version.change_note}</p>}</div>
        <div className="flex flex-wrap gap-2">
          {version.storage_path && <button type="button" onClick={() => void downloadVersion(version)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold">Descargar</button>}
          {document.kind === 'editor' ? <>
            <button type="button" onClick={() => { setReviewVersionId(version.id); setCompareVersionId(null); }} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold">Ver</button>
            {version.id !== currentVersion?.id && version.content_json && currentVersion?.content_json && <button type="button" onClick={() => { setReviewVersionId(version.id); setCompareVersionId(version.id); }} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold">Comparar con la actual</button>}
          </> : <button type="button" onClick={() => { setPreviewVersionId(version.id); setActiveTab('preview'); }} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold">Ver</button>}
          {document.status !== 'archived' && document.status !== 'deleting' && document.current_version_id !== version.id && <button type="button" disabled={busy} onClick={() => void restore(version)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50">Restaurar como actual</button>}
        </div>
      </li>)}</ul> : <p className="p-5 text-sm text-[var(--ink-muted)]">Todavía no hay versiones guardadas.</p>}
    </section>}

    {activeTab === 'history' && <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm"><h2 className="text-lg font-bold">Historial</h2>{events.length ? <ol className="mt-4 space-y-4">{events.map((event) => <li key={event.id} className="flex gap-3"><span className="mt-1 size-2 shrink-0 rounded-full bg-[var(--brand)]"/><div className="min-w-0"><p className="text-sm font-semibold">{eventDescription(event)}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{formatDate(event.created_at)} · {actorLabel(event.actor_uid, authUser?.uid)}</p></div></li>)}</ol> : <p className="mt-4 text-sm text-[var(--ink-muted)]">Todavía no hay actividad registrada.</p>}</section>}
  </div>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-[var(--ink-muted)]">{label}</dt><dd className="mt-1 break-words text-xs font-semibold">{value}</dd></div>;
}

function EditorVersionReview({
  document,
  version,
  currentVersion,
  comparing,
  onClose,
  onToggleComparison,
}: {
  document: KnowledgeDocument;
  version: KnowledgeVersion;
  currentVersion: KnowledgeVersion | null;
  comparing: boolean;
  onClose(): void;
  onToggleComparison(): void;
}) {
  const versionContent = version.content_json as JSONContent | null;
  const currentContent = currentVersion?.content_json as JSONContent | null | undefined;
  const beforeText = versionContent ? toPlainText(versionContent) : '';
  const currentText = currentContent ? toPlainText(currentContent) : '';
  const comparison = useMemo(
    () => comparing && versionContent && currentContent ? diffLines(beforeText, currentText) : null,
    [beforeText, comparing, currentText, currentContent, versionContent],
  );

  return (
    <section className="space-y-4 border-b border-[var(--line)] bg-[var(--surface-muted)] p-4 sm:p-5" aria-label={`Revisión de la versión ${version.version_number}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-bold">Versión v{version.version_number}</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">Vista de solo lectura</p></div>
        <div className="flex flex-wrap gap-2">
          {currentContent && version.id !== currentVersion?.id && <button type="button" onClick={onToggleComparison} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-bold">{comparing ? 'Ocultar comparación' : 'Comparar con la actual'}</button>}
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-bold">Cerrar</button>
        </div>
      </div>
      {versionContent ? <Suspense fallback={<div role="status" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 text-sm text-[var(--ink-muted)]"><Loader2 size={16} className="mr-2 inline animate-spin"/>Cargando visor de versión…</div>}>
        <KnowledgeEditor
          key={`${document.id}-${version.id}`}
          initialContent={versionContent}
          documentId={document.id}
          ownerUid={document.user_id}
          editable={false}
          onChange={() => undefined}
        />
      </Suspense> : <p role="status" className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 text-sm text-[var(--ink-muted)]">Esta versión no tiene contenido editorial para mostrar.</p>}

      {comparing && comparison && <div className="space-y-3">
        {comparison.approximate && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">El documento es extenso; se muestran los bloques cambiados con una alineación simplificada.</p>}
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          <DiffColumn title={`Versión v${version.version_number}`} rows={comparison.rows} side="before"/>
          <DiffColumn title={`Actual v${currentVersion?.version_number ?? '—'}`} rows={comparison.rows} side="after"/>
        </div>
      </div>}
    </section>
  );
}

function DiffColumn({ title, rows, side }: { title: string; rows: LineDiffRow[]; side: 'before' | 'after' }) {
  return <section className="min-w-0 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)]">
    <h4 className="border-b border-[var(--line)] px-3 py-2 text-xs font-bold">{title}</h4>
    <ol className="kb-diff-lines" aria-label={title}>{rows.map((row, index) => {
      const cell = row[side] as LineDiffCell | null;
      const changeClass = cell?.kind === 'added' ? 'kb-diff-added' : cell?.kind === 'removed' ? 'kb-diff-removed' : '';
      return <li key={`${index}-${cell?.kind ?? 'empty'}`} className={`kb-diff-line ${changeClass}`}>
        <span className="kb-diff-number" aria-hidden="true">{cell ? index + 1 : ''}</span>
        <code>{cell?.text || ' '}</code>
      </li>;
    })}</ol>
  </section>;
}

function PreviewPane({ document, version, signedUrl, signedError, onOpenPdf }: {
  document: KnowledgeDocument;
  version: KnowledgeVersion | null;
  signedUrl: string;
  signedError: string;
  onOpenPdf: () => void;
}) {
  const markdown = version?.content_markdown ?? version?.extracted_text ?? '';
  const supportsMarkdown = document.format === 'md' || document.format === 'editor';
  const markdownCanRender = Boolean(version && supportsMarkdown
    && version.extraction_status !== 'pending'
    && version.extraction_status !== 'error'
    && version.extraction_status !== 'not_supported');
  const [renderedMarkdown, setRenderedMarkdown] = useState<{ source: string; html: string } | null>(null);
  const [markdownFailure, setMarkdownFailure] = useState<{ source: string; message: string } | null>(null);

  useEffect(() => {
    if (!markdownCanRender) return;
    let cancelled = false;
    setRenderedMarkdown(null);
    setMarkdownFailure(null);
    void renderMarkdownSafe(markdown).then((html) => {
      if (!cancelled) setRenderedMarkdown({ source: markdown, html });
    }).catch(() => {
      if (!cancelled) setMarkdownFailure({ source: markdown, message: 'No se pudo procesar la vista previa Markdown.' });
    });
    return () => { cancelled = true; };
  }, [markdown, markdownCanRender]);

  if (!version) return <section className="rounded-2xl border border-dashed border-[var(--line-strong)] p-10 text-center"><FileText className="mx-auto text-[var(--ink-muted)]" size={28}/><h2 className="mt-3 font-bold">No hay una versión para mostrar</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Guardá una versión del documento para ver su contenido.</p></section>;
  if (document.format === 'pdf') return <PdfPreview
    title={document.title}
    versionNumber={version.version_number}
    extractionMessage={version.extraction_status !== 'done' ? extractionMessage(version.extraction_status) : null}
    signedUrl={signedUrl}
    signedError={signedError}
    onOpenPdf={onOpenPdf}
  />;

  if (document.format === 'image') return <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
    {signedError && <p role="alert" className="p-4 text-sm text-rose-700 dark:text-rose-300">{signedError}</p>}
    {signedUrl ? <img src={signedUrl} alt={document.title} className="mx-auto max-h-[70dvh] max-w-full object-contain"/> : !signedError && <div className="grid h-60 place-items-center"><Loader2 className="animate-spin text-[var(--brand)]"/></div>}
  </section>;

  if (document.format === 'docx') return <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 shadow-sm"><div><h2 className="font-bold">Vista previa no disponible para Word.</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Descargá el archivo para abrirlo en una aplicación compatible.</p></div>{signedUrl && version.storage_path && <a href={signedUrl} download={version.original_filename ?? undefined} target="_blank" rel="noreferrer" className="inline-flex rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-bold">Descargar</a>}{version.extraction_status === 'done' && version.extracted_text && <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--surface-muted)] p-4 text-sm">{version.extracted_text}</pre>}{extractionMessage(version.extraction_status) && <p className="text-sm text-[var(--ink-muted)]">{extractionMessage(version.extraction_status)}</p>}</section>;

  if (version.extraction_status === 'pending') return <PreviewMessage title="Extracción pendiente" message={extractionMessage('pending')}/>;

  if (version.extraction_status === 'error' || version.extraction_status === 'not_supported') return <PreviewMessage title="No se pudo mostrar el contenido" message={extractionMessage(version.extraction_status)}/>;
  if (supportsMarkdown) {
    if (markdownFailure?.source === markdown) return <PreviewMessage title="No se pudo mostrar el contenido" message={markdownFailure.message}/>;
    if (renderedMarkdown?.source !== markdown) return <div role="status" className="flex min-h-40 items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 text-sm text-[var(--ink-muted)]"><Loader2 className="animate-spin text-[var(--brand)]" size={18}/>Cargando vista previa…</div>;
    return <article className="kb-prose rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm md:p-8" dangerouslySetInnerHTML={{ __html: renderedMarkdown.html }}/>;
  }
  return <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm"><pre className="whitespace-pre-wrap break-words text-sm leading-6">{version.extracted_text ?? 'No hay texto extraído para esta versión.'}</pre></section>;
}

function PreviewMessage({ title, message }: { title: string; message: string }) {
  return <section className="rounded-2xl border border-dashed border-[var(--line-strong)] p-10 text-center"><WandSparkles className="mx-auto text-[var(--brand)]" size={26}/><h2 className="mt-3 font-bold">{title}</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">{message}</p></section>;
}
