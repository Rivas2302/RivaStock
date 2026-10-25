import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { deleteDocument, listDeletingDocuments } from '../../lib/knowledge/api';
import type { KnowledgeDocument } from '../../lib/knowledge/types';
import TaxonomyManager from './TaxonomyManager';

export default function KnowledgeAdmin() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setDocuments(await listDeletingDocuments());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las eliminaciones pendientes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const retry = async (documentId: string) => {
    setBusyDocumentId(documentId);
    setError('');
    try {
      await deleteDocument(documentId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo completar la eliminación.');
    } finally {
      setBusyDocumentId(null);
    }
  };

  return <div className="space-y-6">
    <section aria-labelledby="knowledge-organization-heading">
      <div className="mb-4"><h2 id="knowledge-organization-heading" className="text-lg font-bold">Organización</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Administrá las categorías y etiquetas de tu biblioteca.</p></div>
      <TaxonomyManager/>
    </section>

    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Eliminaciones pendientes</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Los documentos quedan acá si Storage no pudo borrar sus archivos.</p></div><button type="button" disabled={loading} onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50"><RefreshCw size={14}/>Actualizar</button></div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100">{error}</p>}
      {loading ? <div aria-label="Cargando eliminaciones" className="mt-4 h-24 animate-pulse rounded-xl bg-[var(--surface-muted)]"/> : documents.length ? <ul className="mt-4 divide-y divide-[var(--line)]">{documents.map((document) => <li key={document.id} className="flex flex-wrap items-center gap-3 py-3"><AlertCircle size={17} className="shrink-0 text-amber-600 dark:text-amber-300"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{document.title}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">Eliminación iniciada {new Date(document.updated_at).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}</p></div><button type="button" disabled={busyDocumentId !== null} onClick={() => void retry(document.id)} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50">{busyDocumentId === document.id ? <Loader2 size={14} className="animate-spin"/> : <Trash2 size={14}/>}Reintentar eliminación</button></li>)}</ul> : <p className="mt-4 rounded-xl border border-dashed border-[var(--line-strong)] p-6 text-center text-sm text-[var(--ink-muted)]">No hay eliminaciones pendientes.</p>}
    </section>
  </div>;
}
