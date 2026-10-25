import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import Pagination from '../Pagination';
import {
  deleteDocument, listDeletingDocuments, listKnowledgeAdminDocuments, reindexAll, reindexDocument, setRagEnabled,
} from '../../lib/knowledge/api';
import {
  formatDate, KNOWLEDGE_FORMAT_CLASSES, KNOWLEDGE_FORMAT_LABELS,
  KNOWLEDGE_INDEX_STATUS_CLASSES, KNOWLEDGE_INDEX_STATUS_LABELS,
} from '../../lib/knowledge/format';
import type { KnowledgeAdminDocument, KnowledgeDocument } from '../../lib/knowledge/types';

type DocumentFilter = 'available' | 'errors' | 'excluded' | 'pending';
const PAGE_SIZE = 20;
const FILTERS: Array<{ id: DocumentFilter; label: string }> = [
  { id: 'available', label: 'Disponibles' },
  { id: 'errors', label: 'Con errores' },
  { id: 'excluded', label: 'Excluidos' },
  { id: 'pending', label: 'Pendientes' },
];

export default function KnowledgeAdminDocuments({ onMutated }: { onMutated: () => void }) {
  const [filter, setFilter] = useState<DocumentFilter>('available');
  const [page, setPage] = useState(0);
  const [documents, setDocuments] = useState<KnowledgeAdminDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [deletingDocuments, setDeletingDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const [result, deleting] = await Promise.all([
        listKnowledgeAdminDocuments(filter, PAGE_SIZE, page * PAGE_SIZE),
        listDeletingDocuments(),
      ]);
      if (currentRequest === requestId.current) {
        setDocuments(result.items);
        setTotal(result.total);
        setDeletingDocuments(deleting);
      }
    } catch (cause) {
      if (currentRequest === requestId.current) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la administración de documentos.');
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggleRag = async (document: KnowledgeAdminDocument, enabled: boolean) => {
    setBusyId(document.id);
    setError('');
    setNotice('');
    try {
      await setRagEnabled(document.id, enabled);
      await refresh();
      onMutated();
      setNotice(enabled ? 'El documento quedó habilitado para la IA.' : 'El documento quedó excluido de la IA.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el uso del documento en la IA.');
    } finally {
      setBusyId(null);
    }
  };

  const reindexOne = async (document: KnowledgeAdminDocument) => {
    setBusyId(document.id);
    setError('');
    setNotice('');
    try {
      await reindexDocument(document.id);
      await refresh();
      onMutated();
      setNotice(`Se puso “${document.title}” en la cola de indexación.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo reindexar el documento.');
    } finally {
      setBusyId(null);
    }
  };

  const reindexMany = async (onlyErrors: boolean) => {
    if (!onlyErrors && !window.confirm('¿Reindexar todos los documentos publicados y habilitados para la IA?')) return;
    setBulkBusy(true);
    setError('');
    setNotice('');
    try {
      const count = await reindexAll(onlyErrors);
      setNotice(`Se pusieron ${count} documentos en la cola de indexación.`);
      await refresh();
      onMutated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron poner los documentos en la cola.');
    } finally {
      setBulkBusy(false);
    }
  };

  const retryDeletion = async (document: KnowledgeDocument) => {
    setBusyId(document.id);
    setError('');
    setNotice('');
    try {
      await deleteDocument(document.id);
      await refresh();
      onMutated();
      setNotice(`Se completó la eliminación de “${document.title}”.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar la eliminación.');
    } finally {
      setBusyId(null);
    }
  };

  return <div className="space-y-5">
    <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Documentos</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Revisá qué documentos puede consultar la IA y el estado de su índice.</p></div><button type="button" disabled={loading || bulkBusy} onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50"><RefreshCw size={14}/>Actualizar</button></div>
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Filtrar documentos">
        {FILTERS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} onClick={() => { setFilter(item.id); setPage(0); }} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${filter === item.id ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--line)] text-[var(--ink-muted)]'}`}>{item.label}</button>)}
        <span className="ml-auto text-xs text-[var(--ink-muted)]">{total} documentos</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={bulkBusy} onClick={() => void reindexMany(true)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50">{bulkBusy ? 'Procesando…' : 'Reindexar errores'}</button>
        <button type="button" disabled={bulkBusy} onClick={() => void reindexMany(false)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50">Reindexar todo</button>
      </div>
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">{notice}</p>}
      {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100"><AlertCircle size={17} className="mt-0.5 shrink-0"/>{error}</p>}
      {loading ? <div aria-label="Cargando documentos" className="h-32 animate-pulse rounded-xl bg-[var(--surface-muted)]"/> : documents.length ? <div className="overflow-x-auto rounded-xl border border-[var(--line)]"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-[var(--surface-muted)] text-xs text-[var(--ink-muted)]"><tr><th className="px-3 py-3">Documento</th><th className="px-3 py-3">Estado</th><th className="px-3 py-3">Usar en la IA</th><th className="px-3 py-3">Índice</th><th className="px-3 py-3">Fragmentos</th><th className="px-3 py-3">Última indexación</th><th className="px-3 py-3">Acciones</th></tr></thead><tbody className="divide-y divide-[var(--line)]">{documents.map((document) => <tr key={document.id} className="align-top">
        <td className="max-w-64 px-3 py-3"><p className="font-semibold">{document.title}</p><span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${KNOWLEDGE_FORMAT_CLASSES[document.format]}`}>{KNOWLEDGE_FORMAT_LABELS[document.format]}</span>{document.index_error && <p className="mt-1 max-w-56 text-xs text-rose-700 dark:text-rose-300">{document.index_error}</p>}</td>
        <td className="px-3 py-3 text-xs">{document.status === 'published' ? 'Publicado' : document.status === 'draft' ? 'Borrador' : document.status === 'in_review' ? 'En revisión' : 'Archivado'}</td>
        <td className="px-3 py-3"><label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={document.rag_enabled} disabled={busyId !== null || bulkBusy} onChange={(event) => void toggleRag(document, event.target.checked)} className="size-4 accent-[var(--brand)]"/><span>{document.rag_enabled ? 'Sí' : 'No'}</span></label></td>
        <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${KNOWLEDGE_INDEX_STATUS_CLASSES[document.index_status]}`}>{KNOWLEDGE_INDEX_STATUS_LABELS[document.index_status]}</span></td>
        <td className="px-3 py-3 text-xs">{document.chunk_count.toLocaleString('es-AR')}</td><td className="whitespace-nowrap px-3 py-3 text-xs text-[var(--ink-muted)]">{formatDate(document.last_indexed_at) || '—'}</td>
        <td className="px-3 py-3">{document.status === 'published' && document.rag_enabled && <button type="button" disabled={busyId !== null || bulkBusy} onClick={() => void reindexOne(document)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-xs font-bold disabled:opacity-50">{busyId === document.id ? <Loader2 size={13} className="animate-spin"/> : <RotateCcw size={13}/>}Reindexar</button>}</td>
      </tr>)}</tbody></table><Pagination page={page} pages={Math.ceil(total / PAGE_SIZE)} start={page * PAGE_SIZE} end={page * PAGE_SIZE + documents.length} total={total} setPage={setPage}/></div> : <p className="rounded-xl border border-dashed border-[var(--line-strong)] p-6 text-center text-sm text-[var(--ink-muted)]">No hay documentos en este filtro.</p>}
    </section>

    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm"><div><h2 className="text-lg font-bold">Eliminaciones pendientes</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Reintentá el borrado de archivos que quedaron en Storage.</p></div>
      {deletingDocuments.length ? <ul className="mt-4 divide-y divide-[var(--line)]">{deletingDocuments.map((document) => <li key={document.id} className="flex flex-wrap items-center gap-3 py-3"><AlertCircle size={17} className="shrink-0 text-amber-600 dark:text-amber-300"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{document.title}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">Eliminación iniciada {formatDate(document.updated_at)}</p></div><button type="button" disabled={busyId !== null} onClick={() => void retryDeletion(document)} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50">{busyId === document.id ? <Loader2 size={14} className="animate-spin"/> : <Trash2 size={14}/>}Reintentar eliminación</button></li>)}</ul> : <p className="mt-4 text-sm text-[var(--ink-muted)]">No hay eliminaciones pendientes.</p>}
    </section>
  </div>;
}
