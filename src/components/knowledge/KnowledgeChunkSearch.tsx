import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { keywordChunkSearch, semanticSearch, type KnowledgeChunkResult, type KnowledgeChunkSearchResponse } from '../../lib/knowledge/search';
import type { KnowledgeSearchFilters } from '../../lib/knowledge/types';

type SearchMode = 'keyword' | 'semantic';

export default function KnowledgeChunkSearch({ filters }: { filters: KnowledgeSearchFilters }) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('keyword');
  const [response, setResponse] = useState<KnowledgeChunkSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const controllerRef = useRef<AbortController | null>(null);

  const groups = useMemo(() => groupResults(response?.results ?? []), [response?.results]);
  const maxScore = useMemo(() => Math.max(0, ...(response?.results ?? []).map((item) => item.score)), [response?.results]);

  useEffect(() => () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
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
    setExpanded(new Set());
    try {
      const nextResponse = mode === 'semantic'
        ? await semanticSearch(normalizedQuery, filters, 10, controller.signal)
        : { mode: 'keyword' as const, notice: null, results: await keywordChunkSearch(normalizedQuery, filters, 10) };
      if (!controller.signal.aborted) setResponse(nextResponse);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'No se pudo buscar en el contenido.');
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  };

  const selectMode = (nextMode: SearchMode) => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setLoading(false);
    setMode(nextMode);
    setResponse(null);
    setError('');
  };

  const toggleExpanded = (chunkId: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(chunkId)) next.delete(chunkId);
    else next.add(chunkId);
    return next;
  });

  return <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-bold">Buscar en el contenido</h2><p className="mt-0.5 text-xs text-[var(--ink-muted)]">Busca fragmentos de documentos publicados y disponibles para la IA.</p></div>
      <div className="inline-flex rounded-lg border border-[var(--line)] p-1" role="group" aria-label="Modo de búsqueda">
        <button type="button" aria-pressed={mode === 'keyword'} onClick={() => selectMode('keyword')} className={`rounded-md px-3 py-1.5 text-xs font-bold ${mode === 'keyword' ? 'bg-[var(--brand-soft)] text-[var(--brand)]' : 'text-[var(--ink-muted)]'}`}>Palabras clave</button>
        <button type="button" aria-pressed={mode === 'semantic'} onClick={() => selectMode('semantic')} className={`rounded-md px-3 py-1.5 text-xs font-bold ${mode === 'semantic' ? 'bg-[var(--brand-soft)] text-[var(--brand)]' : 'text-[var(--ink-muted)]'}`}>Semántica</button>
      </div>
    </div>

    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2 sm:flex-row">
      <label className="relative min-w-0 flex-1"><span className="sr-only">Buscar en los fragmentos</span><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]"/><input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={500} disabled={loading} placeholder="¿Qué querés encontrar?" className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--brand)] disabled:opacity-60"/></label>
      <button type="submit" disabled={loading || query.trim().length < 2} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--action-bg)] px-4 py-2.5 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50">{loading ? <Loader2 size={15} className="animate-spin"/> : <Search size={15}/>}Buscar</button>
    </form>

    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-100">{error}</p>}
    {response && <div className="space-y-3" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-[var(--brand-soft)] px-2.5 py-1 font-bold text-[var(--brand)]">{response.mode === 'semantic' ? 'Búsqueda semántica' : 'Búsqueda por palabras clave'}</span>
        {response.notice && <span className="text-[var(--ink-muted)]">{response.notice}</span>}
        <span className="ml-auto text-[var(--ink-muted)]">{response.results.length} fragmentos</span>
      </div>
      {response.results.length === 0 ? <p className="rounded-lg border border-dashed border-[var(--line-strong)] p-5 text-center text-sm text-[var(--ink-muted)]">No encontramos fragmentos para esta búsqueda.</p> : groups.map((group) => <section key={group.documentId} className="rounded-xl border border-[var(--line)] p-3">
        <h3 className="text-sm font-bold"><Link to={`/ia/conocimientos/doc/${group.documentId}`} className="text-[var(--brand)] hover:underline">{group.title}</Link></h3>
        <div className="mt-2 space-y-3">{group.chunks.map((chunk) => {
          const isExpanded = expanded.has(chunk.chunk_id);
          const excerpt = chunk.content.length > 300 && !isExpanded ? `${chunk.content.slice(0, 300).trimEnd()}…` : chunk.content;
          const relevance = maxScore > 0 ? Math.round(Math.max(0, chunk.score) / maxScore * 100) : 0;
          const pageLabel = chunk.page_from === null ? '' : `Pág. ${chunk.page_from}${chunk.page_to && chunk.page_to !== chunk.page_from ? `–${chunk.page_to}` : ''}`;
          return <article key={chunk.chunk_id} className="border-t border-[var(--line)] pt-3 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--ink-muted)]">
              {chunk.section_path && <span>{chunk.section_path}</span>}
              {pageLabel && <span>{pageLabel}</span>}
              <span className="ml-auto" aria-label={`Relevancia relativa ${relevance}%`}>Relevancia {relevance}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]" aria-hidden="true"><div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${relevance}%` }}/></div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{excerpt}</p>
            {chunk.content.length > 300 && <button type="button" onClick={() => toggleExpanded(chunk.chunk_id)} className="mt-1 text-xs font-bold text-[var(--brand)] hover:underline">{isExpanded ? 'Ver menos' : 'Ver más'}</button>}
          </article>;
        })}</div>
      </section>)}
    </div>}
  </section>;
}

function groupResults(results: KnowledgeChunkResult[]): Array<{ documentId: string; title: string; chunks: KnowledgeChunkResult[] }> {
  const groups = new Map<string, { documentId: string; title: string; chunks: KnowledgeChunkResult[] }>();
  for (const result of results) {
    const group = groups.get(result.document_id) ?? { documentId: result.document_id, title: result.title, chunks: [] };
    group.chunks.push(result);
    groups.set(result.document_id, group);
  }
  return [...groups.values()];
}
