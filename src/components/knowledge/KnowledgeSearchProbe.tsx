import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, Search } from 'lucide-react';
import { semanticSearch, type KnowledgeChunkSearchResponse } from '../../lib/knowledge/search';
import { listCategories, listFolders, listTags } from '../../lib/knowledge/api';
import type { KnowledgeCategory, KnowledgeFolder, KnowledgeTag } from '../../lib/knowledge/types';

export default function KnowledgeSearchProbe() {
  const [query, setQuery] = useState('');
  const [folderId, setFolderId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [tagId, setTagId] = useState('');
  const [folders, setFolders] = useState<KnowledgeFolder[]>([]);
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [tags, setTags] = useState<KnowledgeTag[]>([]);
  const [taxonomyError, setTaxonomyError] = useState('');
  const [response, setResponse] = useState<KnowledgeChunkSearchResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([listFolders(), listCategories(), listTags()]).then(([nextFolders, nextCategories, nextTags]) => {
      if (!active) return;
      setFolders(nextFolders);
      setCategories(nextCategories);
      setTags(nextTags);
    }).catch((cause: unknown) => {
      if (active) setTaxonomyError(cause instanceof Error ? cause.message : 'No se pudieron cargar los filtros.');
    });
    return () => {
      active = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2 || loading) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError('');
    setResponse(null);
    try {
      const filters = {
        folderId: folderId || null,
        categoryId: categoryId || null,
        tagIds: tagId ? [tagId] : [],
      };
      const result = await semanticSearch(normalizedQuery, filters, 10, controller.signal);
      if (!controller.signal.aborted) setResponse(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'No se pudo completar la búsqueda de prueba.');
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  };

  return <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
    <div><h2 className="text-lg font-bold">Probar búsqueda</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Revisá los fragmentos y las fuentes que verá la IA.</p></div>
    <form onSubmit={(event) => void submit(event)} className="space-y-3">
      <label className="block text-xs font-semibold">Consulta<input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={500} disabled={loading} placeholder="Ej.: ¿Cómo configurar el DVR?" className="mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-sm font-normal outline-none focus:border-[var(--brand)] disabled:opacity-60"/></label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-xs font-semibold">Carpeta<select value={folderId} onChange={(event) => setFolderId(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-normal"><option value="">Todas las carpetas</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
        <label className="text-xs font-semibold">Categoría<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-normal"><option value="">Todas las categorías</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className="text-xs font-semibold">Etiqueta<select value={tagId} onChange={(event) => setTagId(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-normal"><option value="">Todas las etiquetas</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
      </div>
      <button type="submit" disabled={loading || query.trim().length < 2} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-4 py-2.5 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50">{loading ? <Loader2 size={15} className="animate-spin"/> : <Search size={15}/>}Probar búsqueda</button>
    </form>
    {taxonomyError && <p role="alert" className="text-xs text-amber-800 dark:text-amber-200">No se pudieron cargar algunos filtros: {taxonomyError}</p>}
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-100">{error}</p>}
    {response && <div className="space-y-3" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-[var(--brand-soft)] px-2.5 py-1 font-bold text-[var(--brand)]">{response.mode === 'semantic' ? 'Semántica' : 'Palabras clave'}</span>{response.notice && <span className="text-[var(--ink-muted)]">{response.notice}</span>}<span className="ml-auto text-[var(--ink-muted)]">{response.results.length} resultados</span></div>
      {response.results.length ? <ol className="space-y-3">{response.results.map((item, index) => <li key={item.chunk_id} className="rounded-xl border border-[var(--line)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-bold"><span className="mr-2 rounded-md bg-[var(--brand-soft)] px-2 py-1 text-xs text-[var(--brand)]">[K{index + 1}]</span>{item.title}</p><p className="mt-2 text-xs text-[var(--ink-muted)]">{item.section_path || 'Sin sección'}{item.page_from !== null && ` · Pág. ${item.page_from}${item.page_to && item.page_to !== item.page_from ? `–${item.page_to}` : ''}`}</p></div><div className="text-right text-[11px] text-[var(--ink-muted)]"><p>Similitud: {item.similarity === null ? '—' : item.similarity.toFixed(3)}</p><p>Score: {item.score.toFixed(4)}</p></div></div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{item.content}</p>
      </li>)}</ol> : <p className="rounded-xl border border-dashed border-[var(--line-strong)] p-6 text-center text-sm text-[var(--ink-muted)]">No encontramos fragmentos con estos filtros.</p>}
    </div>}
  </section>;
}
