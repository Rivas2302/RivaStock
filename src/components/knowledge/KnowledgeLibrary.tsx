import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, Check, ChevronDown, FileText, Filter, FolderTree as FolderTreeIcon, Loader2, RefreshCw, Search, Upload, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import FolderTree from './library/FolderTree';
import KnowledgeChunkSearch from './KnowledgeChunkSearch';
import Pagination from '../Pagination';
import { getDocument, listCategories, listFolders, listTags, searchDocuments, setStatus, updateMetadata } from '../../lib/knowledge/api';
import {
  formatDate,
  KNOWLEDGE_FORMAT_CLASSES,
  KNOWLEDGE_FORMAT_LABELS,
  KNOWLEDGE_INDEX_STATUS_CLASSES,
  KNOWLEDGE_INDEX_STATUS_LABELS,
  KNOWLEDGE_STATUS_CLASSES,
  KNOWLEDGE_STATUS_LABELS,
} from '../../lib/knowledge/format';
import type {
  KnowledgeCategory,
  KnowledgeFormat,
  KnowledgeFolder,
  KnowledgeIndexStatus,
  KnowledgeListItem,
  KnowledgeSearchResult,
  KnowledgeSort,
  KnowledgeStatus,
  KnowledgeTag,
} from '../../lib/knowledge/types';

const PAGE_SIZE = 30;
const FORMAT_OPTIONS: Array<{ value: KnowledgeFormat; label: string }> = Object.entries(KNOWLEDGE_FORMAT_LABELS).map(([value, label]) => ({ value: value as KnowledgeFormat, label }));
const STATUS_OPTIONS: Array<{ value: KnowledgeStatus; label: string }> = Object.entries(KNOWLEDGE_STATUS_LABELS).filter(([value]) => value !== 'deleting').map(([value, label]) => ({ value: value as KnowledgeStatus, label }));
const INDEX_OPTIONS: Array<{ value: KnowledgeIndexStatus; label: string }> = Object.entries(KNOWLEDGE_INDEX_STATUS_LABELS).map(([value, label]) => ({ value: value as KnowledgeIndexStatus, label }));

function dateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function nextDateString(value: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function isKnowledgeSort(value: string | null): value is KnowledgeSort {
  return value === 'updated_desc' || value === 'updated_asc' || value === 'title_asc' || value === 'relevance';
}

function selectedPageNumber(params: URLSearchParams): number {
  const page = Number.parseInt(params.get('page') ?? '0', 10);
  return Number.isFinite(page) && page > 0 ? page : 0;
}

function ToggleFilter<V extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Array<{ value: V; label: string }>;
  selected: V[];
  onToggle: (value: V, checked: boolean) => void;
}) {
  return <details className="relative">
    <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--surface-muted)]">
      {label}{selected.length > 0 && <span className="rounded-full bg-[var(--brand-soft)] px-1.5 text-[var(--brand)]">{selected.length}</span>}<ChevronDown size={13}/>
    </summary>
    <div className="absolute left-0 z-30 mt-2 max-h-72 min-w-52 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface)] p-2 shadow-xl">
      {options.map((option) => <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-[var(--surface-muted)]">
        <input type="checkbox" checked={selected.includes(option.value)} onChange={(event) => onToggle(option.value, event.target.checked)} className="accent-[var(--brand)]"/>
        <span>{option.label}</span>
      </label>)}
    </div>
  </details>;
}

function StatusBadge({ label, className }: { label: string; className: string }) {
  return <span className={`inline-flex max-w-full items-center truncate rounded-full px-2 py-1 text-[10px] font-bold leading-4 ${className}`}>{label}</span>;
}

export default function KnowledgeLibrary({ refreshKey = 0 }: { refreshKey?: number }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const paramsKey = searchParams.toString();
  const searchQuery = searchParams.get('q') ?? '';
  const page = selectedPageNumber(searchParams);
  const [searchText, setSearchText] = useState(searchQuery);
  const [results, setResults] = useState<KnowledgeSearchResult>({ total: 0, items: [] });
  const [folders, setFolders] = useState<KnowledgeFolder[]>([]);
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [tags, setTags] = useState<KnowledgeTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [taxonomyLoading, setTaxonomyLoading] = useState(true);
  const [error, setError] = useState('');
  const [taxonomyError, setTaxonomyError] = useState('');
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Map<string, KnowledgeListItem>>(() => new Map());
  const [bulkAction, setBulkAction] = useState<'move' | 'category' | null>(null);
  const [bulkTarget, setBulkTarget] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkNotice, setBulkNotice] = useState('');
  const [bulkErrors, setBulkErrors] = useState<Array<{ title: string; error: string }>>([]);

  const updateParams = useCallback((updates: Record<string, string | null>, resetPage = true) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        next.delete(key);
        if (value !== null && value !== '') next.set(key, value);
      }
      if (resetPage) next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const toggleParam = useCallback((key: string, value: string, checked: boolean) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      const values = next.getAll(key).filter((item) => item !== value);
      next.delete(key);
      for (const item of checked ? [...values, value] : values) next.append(key, item);
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => { setSearchText(searchQuery); }, [searchQuery]);
  useEffect(() => {
    const query = searchText.trim();
    if (query === searchQuery) return;
    const timeout = window.setTimeout(() => updateParams({ q: query || null }), 300);
    return () => window.clearTimeout(timeout);
  }, [searchText, searchQuery, updateParams]);

  const loadTaxonomy = useCallback(async () => {
    setTaxonomyLoading(true);
    setTaxonomyError('');
    try {
      const [nextFolders, nextCategories, nextTags] = await Promise.all([listFolders(), listCategories(), listTags()]);
      setFolders(nextFolders);
      setCategories(nextCategories);
      setTags(nextTags);
    } catch (cause) {
      setTaxonomyError(cause instanceof Error ? cause.message : 'No se pudieron cargar las carpetas y los filtros.');
    } finally {
      setTaxonomyLoading(false);
    }
  }, []);

  useEffect(() => { void loadTaxonomy(); }, [loadTaxonomy]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(paramsKey);
    const page = selectedPageNumber(params);
    const query = params.get('q') ?? '';
    const from = params.get('from');
    const to = params.get('to');
    const rawSort = params.get('sort');
    const sort = isKnowledgeSort(rawSort) ? rawSort : 'updated_desc';
    setLoading(true);
    setError('');
    searchDocuments({
      query,
      folderId: params.get('folder'),
      includeSubfolders: true,
      categoryId: params.get('category'),
      tagIds: params.getAll('tag'),
      formats: params.getAll('format') as KnowledgeFormat[],
      statuses: params.getAll('status') as KnowledgeStatus[],
      indexStatuses: params.getAll('index') as KnowledgeIndexStatus[],
      updatedFrom: from ? `${from}T00:00:00.000Z` : null,
      updatedTo: to && nextDateString(to) ? `${nextDateString(to)}T00:00:00.000Z` : null,
      sort: sort === 'relevance' && !query.trim() ? 'updated_desc' : sort,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }).then((next) => {
      if (active) setResults(next);
    }).catch((cause: unknown) => {
      if (active) {
        setError(cause instanceof Error ? cause.message : 'No se pudo cargar la Biblioteca.');
        setResults({ total: 0, items: [] });
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [paramsKey, refreshCounter, refreshKey]);

  useEffect(() => { setSelected(new Map()); }, [paramsKey]);

  useEffect(() => {
    const pages = Math.ceil(results.total / PAGE_SIZE);
    if (page > 0 && page >= pages) updateParams({ page: pages > 0 ? String(pages - 1) : null }, false);
  }, [page, results.total, updateParams]);

  const filtersActive = ['q', 'folder', 'category', 'tag', 'format', 'status', 'index', 'from', 'to'].some((key) => searchParams.has(key));
  const selectedTagIds = searchParams.getAll('tag');
  const currentPageAllSelected = results.items.length > 0 && results.items.every((item) => selected.has(item.id));
  const tagNames = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.name])), [tags]);

  const applyBulkAction = async (action: 'move' | 'category' | 'archive', target: string | null) => {
    const items = [...selected.values()];
    if (!items.length || bulkBusy) return;
    setBulkBusy(true);
    setBulkProgress(0);
    setBulkErrors([]);
    setBulkNotice('');
    const failures: Array<{ title: string; error: string }> = [];
    let succeeded = 0;
    for (const [index, item] of items.entries()) {
      try {
        if (action === 'archive') {
          if (item.status !== 'archived') {
            await setStatus(item.id, 'archived');
            await getDocument(item.id);
          }
        } else {
          await updateMetadata(item.id, {
            title: item.title,
            description: item.description,
            folderId: action === 'move' ? target : item.folder_id,
            categoryId: action === 'category' ? target : item.category_id,
            tagIds: item.tag_ids,
          });
        }
        succeeded += 1;
      } catch (cause) {
        failures.push({ title: item.title, error: cause instanceof Error ? cause.message : 'No se pudo actualizar el documento.' });
      }
      setBulkProgress(index + 1);
    }
    setBulkErrors(failures);
    setBulkNotice(`Se procesaron ${succeeded} de ${items.length} documentos${failures.length ? `; ${failures.length} con error` : ''}.`);
    setSelected(new Map());
    setBulkAction(null);
    setBulkTarget('');
    setBulkBusy(false);
    setRefreshCounter((value) => value + 1);
  };

  const toggleSelection = (item: KnowledgeListItem, checked: boolean) => setSelected((current) => {
    const next = new Map(current);
    if (checked) next.set(item.id, item);
    else next.delete(item.id);
    return next;
  });

  const toggleCurrentPage = (checked: boolean) => setSelected((current) => {
    const next = new Map(current);
    for (const item of results.items) {
      if (checked) next.set(item.id, item);
      else next.delete(item.id);
    }
    return next;
  });

  const filterPanel = <FolderTree
    folders={folders}
    categories={categories}
    tags={tags}
    selectedFolderId={searchParams.get('folder')}
    selectedCategoryId={searchParams.get('category')}
    selectedTagIds={selectedTagIds}
    onSelectFolder={(folderId) => updateParams({ folder: folderId })}
    onSelectCategory={(categoryId) => updateParams({ category: categoryId })}
    onToggleTag={(tagId) => toggleParam('tag', tagId, !selectedTagIds.includes(tagId))}
    onRefresh={loadTaxonomy}
  />;

  const openUpload = () => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    next.set('upload', '1');
    return next;
  }, { replace: true });

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-soft)] px-3 py-1.5 text-xs font-bold text-[var(--brand)]"><Search size={13}/>Palabras clave</span>
        <span className="text-sm text-[var(--ink-muted)]">{results.total.toLocaleString('es-AR')} documentos</span>
      </div>
      <div className="flex items-center gap-2">
        <Link to="/ia/conocimientos/nuevo" className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold"><FileText size={15}/>Nuevo documento</Link>
        <button type="button" onClick={openUpload} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-3 py-2 text-sm font-bold text-[var(--action-ink)]"><Upload size={15}/>Subir archivos</button>
        <button type="button" onClick={() => setMobileFiltersOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold md:hidden"><FolderTreeIcon size={16}/>Carpetas y filtros</button>
      </div>
    </div>

    <KnowledgeChunkSearch filters={{
      folderId: searchParams.get('folder'),
      categoryId: searchParams.get('category'),
      tagIds: selectedTagIds,
    }}/>

    <div className="grid gap-5 md:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="hidden md:block"><div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
        {taxonomyLoading ? <p className="py-4 text-sm text-[var(--ink-muted)]">Cargando carpetas y filtros…</p> : filterPanel}
        {taxonomyError && <div role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200"><p>{taxonomyError}</p><button type="button" onClick={() => void loadTaxonomy()} className="mt-2 font-bold underline">Reintentar</button></div>}
      </div></aside>

      <main className="min-w-0 space-y-4">
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1"><span className="sr-only">Buscar documentos</span><Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]"/><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Buscar por título, descripción o contenido…" className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[var(--brand)]"/></label>
            <label className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-muted)]">Ordenar<select value={searchParams.get('sort') ?? 'updated_desc'} onChange={(event) => updateParams({ sort: event.target.value === 'updated_desc' ? null : event.target.value })} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2.5 py-2 text-sm text-[var(--ink)]">
              <option value="updated_desc">Recientes</option><option value="updated_asc">Más antiguos</option><option value="title_asc">Título A–Z</option>{searchQuery.trim() && <option value="relevance">Relevancia</option>}
            </select></label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ToggleFilter label="Formato" options={FORMAT_OPTIONS} selected={searchParams.getAll('format') as KnowledgeFormat[]} onToggle={(value, checked) => toggleParam('format', value, checked)}/>
            <ToggleFilter label="Estado" options={STATUS_OPTIONS} selected={searchParams.getAll('status') as KnowledgeStatus[]} onToggle={(value, checked) => toggleParam('status', value, checked)}/>
            <ToggleFilter label="Índice" options={INDEX_OPTIONS} selected={searchParams.getAll('index') as KnowledgeIndexStatus[]} onToggle={(value, checked) => toggleParam('index', value, checked)}/>
            <ToggleFilter label="Etiqueta" options={tags.map((tag) => ({ value: tag.id, label: tag.name }))} selected={selectedTagIds} onToggle={(value, checked) => toggleParam('tag', value, checked)}/>
            <details className="relative">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--surface-muted)]">Actualizado<ChevronDown size={13}/></summary>
              <div className="absolute left-0 z-30 mt-2 w-64 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-xl">
                <div className="flex gap-2"><button type="button" onClick={() => { const today = dateString(new Date()); const from = new Date(); from.setDate(from.getDate() - 7); updateParams({ from: dateString(from), to: today }); }} className="flex-1 rounded-lg border border-[var(--line)] px-2 py-1.5 text-xs font-semibold">7 días</button><button type="button" onClick={() => { const today = dateString(new Date()); const from = new Date(); from.setDate(from.getDate() - 30); updateParams({ from: dateString(from), to: today }); }} className="flex-1 rounded-lg border border-[var(--line)] px-2 py-1.5 text-xs font-semibold">30 días</button></div>
                <label className="mt-3 block text-xs font-semibold">Desde<input type="date" value={searchParams.get('from') ?? ''} onChange={(event) => updateParams({ from: event.target.value || null })} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm font-normal"/></label>
                <label className="mt-2 block text-xs font-semibold">Hasta<input type="date" value={searchParams.get('to') ?? ''} onChange={(event) => updateParams({ to: event.target.value || null })} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm font-normal"/></label>
                {(searchParams.has('from') || searchParams.has('to')) && <button type="button" onClick={() => updateParams({ from: null, to: null })} className="mt-2 text-xs font-semibold text-[var(--brand)]">Quitar fechas</button>}
              </div>
            </details>
            {filtersActive && <button type="button" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold text-[var(--brand)] hover:bg-[var(--brand-soft)]"><X size={13}/>Limpiar filtros</button>}
          </div>
        </section>

        {selected.size > 0 && <section className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--brand)] bg-[var(--brand-soft)] p-3">
          <span className="mr-1 text-sm font-bold">{selected.size} seleccionados</span>
          <button type="button" disabled={bulkBusy} onClick={() => { setBulkAction('move'); setBulkTarget(''); setBulkNotice(''); }} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-bold disabled:opacity-50">Mover a carpeta</button>
          <button type="button" disabled={bulkBusy} onClick={() => { setBulkAction('category'); setBulkTarget(''); setBulkNotice(''); }} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-bold disabled:opacity-50">Cambiar categoría</button>
          <button type="button" disabled={bulkBusy} onClick={() => void applyBulkAction('archive', null)} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-bold disabled:opacity-50">Archivar</button>
          <button type="button" onClick={() => setSelected(new Map())} disabled={bulkBusy} className="ml-auto rounded-lg px-2 py-2 text-xs font-semibold">Cancelar</button>
          {bulkAction && <div className="flex w-full flex-wrap items-center gap-2 pt-2">
            <label className="sr-only" htmlFor="knowledge-bulk-target">Destino de la acción</label>
            <select id="knowledge-bulk-target" value={bulkTarget} onChange={(event) => setBulkTarget(event.target.value)} className="min-w-52 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm">
              <option value="">{bulkAction === 'move' ? 'Nivel principal' : 'Sin categoría'}</option>
              {bulkAction === 'move' ? folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>) : categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <button type="button" disabled={bulkBusy} onClick={() => void applyBulkAction(bulkAction, bulkTarget || null)} className="rounded-lg bg-[var(--action-bg)] px-3 py-2 text-sm font-bold text-[var(--action-ink)]">Aplicar</button>
          </div>}
          {bulkBusy && <p role="status" className="flex w-full items-center gap-2 pt-2 text-xs"><Loader2 size={14} className="animate-spin"/>Procesando {bulkProgress + 1} de {selected.size}…</p>}
        </section>}
        {bulkNotice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">{bulkNotice}</p>}
        {bulkErrors.length > 0 && <section role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100"><h3 className="font-bold">No se pudieron actualizar estos documentos</h3><ul className="mt-2 list-disc space-y-1 pl-5">{bulkErrors.map((item) => <li key={`${item.title}:${item.error}`}><strong>{item.title}:</strong> {item.error}</li>)}</ul></section>}

        {loading ? <div aria-label="Cargando documentos" className="space-y-3 animate-pulse"><div className="h-16 rounded-xl bg-[var(--surface-muted)]"/>{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-20 rounded-xl bg-[var(--surface-muted)]"/> )}</div> : error ? <section role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100"><div className="flex items-start gap-3"><AlertCircle size={18}/><div><h3 className="font-bold">No se pudo cargar la Biblioteca</h3><p className="mt-1 text-sm">{error}</p><button type="button" onClick={() => setRefreshCounter((value) => value + 1)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-current px-3 py-2 text-sm font-semibold"><RefreshCw size={14}/>Reintentar</button></div></div></section> : results.total === 0 ? filtersActive ? <section className="rounded-2xl border border-dashed border-[var(--line-strong)] p-10 text-center"><Filter className="mx-auto text-[var(--ink-muted)]" size={26}/><h3 className="mt-3 font-bold">Sin resultados{searchQuery ? ` para “${searchQuery}”` : ''}</h3><p className="mt-1 text-sm text-[var(--ink-muted)]">Probá cambiar o quitar algunos filtros.</p><button type="button" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })} className="mt-4 text-sm font-bold text-[var(--brand)]">Limpiar filtros</button></section> : <section className="rounded-2xl border border-dashed border-[var(--line-strong)] p-10 text-center"><Upload className="mx-auto text-[var(--brand)]" size={28}/><h3 className="mt-3 font-bold">Todavía no hay documentos</h3><p className="mt-1 text-sm text-[var(--ink-muted)]">Subí archivos para empezar a organizar la información.</p><Link to="/ia/conocimientos/biblioteca?upload=1" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-4 py-2.5 text-sm font-bold text-[var(--action-ink)]"><Upload size={15}/>Subir archivos</Link></section> : <>
          <div className="hidden overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm md:block">
            <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-[var(--surface-muted)] text-xs text-[var(--ink-muted)]"><tr>
              <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Seleccionar documentos de esta página" checked={currentPageAllSelected} onChange={(event) => toggleCurrentPage(event.target.checked)} className="accent-[var(--brand)]"/></th><th className="px-3 py-3">Documento</th><th className="px-3 py-3">Formato</th><th className="px-3 py-3">Estado</th><th className="px-3 py-3">Índice</th><th className="px-3 py-3">Actualizado</th><th className="px-3 py-3">Etiquetas</th>
            </tr></thead><tbody className="divide-y divide-[var(--line)]">{results.items.map((item) => <tr key={item.id} className="hover:bg-[var(--surface-muted)]/60">
              <td className="px-4 py-3"><input type="checkbox" aria-label={`Seleccionar ${item.title}`} checked={selected.has(item.id)} onChange={(event) => toggleSelection(item, event.target.checked)} className="accent-[var(--brand)]"/></td>
              <td className="max-w-[22rem] px-3 py-3"><Link to={`/ia/conocimientos/doc/${item.id}`} className="font-semibold text-[var(--brand)] hover:underline">{item.title}</Link>{item.snippet && <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--ink-muted)]">{item.snippet}</p>}{item.has_unpublished_changes && <p className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">Hay cambios sin publicar</p>}</td>
              <td className="px-3 py-3"><StatusBadge label={KNOWLEDGE_FORMAT_LABELS[item.format]} className={KNOWLEDGE_FORMAT_CLASSES[item.format]}/></td>
              <td className="px-3 py-3"><StatusBadge label={KNOWLEDGE_STATUS_LABELS[item.status]} className={KNOWLEDGE_STATUS_CLASSES[item.status]}/></td>
              <td className="px-3 py-3"><StatusBadge label={KNOWLEDGE_INDEX_STATUS_LABELS[item.index_status]} className={KNOWLEDGE_INDEX_STATUS_CLASSES[item.index_status]}/></td>
              <td className="whitespace-nowrap px-3 py-3 text-xs text-[var(--ink-muted)]">{formatDate(item.updated_at)}</td>
              <td className="px-3 py-3"><div className="flex max-w-40 flex-wrap gap-1">{item.tag_ids.map((tagId) => tagNames.get(tagId)).filter((name): name is string => Boolean(name)).slice(0, 4).map((name) => <span key={name} className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px]">{name}</span>)}</div></td>
            </tr>)}</tbody></table></div>
            <Pagination page={page} pages={Math.ceil(results.total / PAGE_SIZE)} start={page * PAGE_SIZE} end={page * PAGE_SIZE + results.items.length} total={results.total} setPage={(nextPage) => updateParams({ page: nextPage > 0 ? String(nextPage) : null }, false)}/>
          </div>

          <div className="space-y-3 md:hidden">{results.items.map((item) => <article key={item.id} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
            <div className="flex items-start gap-3"><input type="checkbox" aria-label={`Seleccionar ${item.title}`} checked={selected.has(item.id)} onChange={(event) => toggleSelection(item, event.target.checked)} className="mt-1 accent-[var(--brand)]"/><div className="min-w-0 flex-1"><Link to={`/ia/conocimientos/doc/${item.id}`} className="font-bold text-[var(--brand)] hover:underline">{item.title}</Link>{item.description && <p className="mt-1 line-clamp-2 text-xs text-[var(--ink-muted)]">{item.description}</p>}{item.snippet && <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--ink-muted)]">{item.snippet}</p>}</div></div>
            <div className="mt-3 flex flex-wrap gap-1.5"><StatusBadge label={KNOWLEDGE_FORMAT_LABELS[item.format]} className={KNOWLEDGE_FORMAT_CLASSES[item.format]}/><StatusBadge label={KNOWLEDGE_STATUS_LABELS[item.status]} className={KNOWLEDGE_STATUS_CLASSES[item.status]}/><StatusBadge label={KNOWLEDGE_INDEX_STATUS_LABELS[item.index_status]} className={KNOWLEDGE_INDEX_STATUS_CLASSES[item.index_status]}/>{item.tag_ids.map((tagId) => tagNames.get(tagId)).filter((name): name is string => Boolean(name)).map((name) => <span key={name} className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px]">{name}</span>)}</div>
            <p className="mt-2 text-[11px] text-[var(--ink-muted)]">Actualizado {formatDate(item.updated_at)}</p>
          </article>)}<Pagination page={page} pages={Math.ceil(results.total / PAGE_SIZE)} start={page * PAGE_SIZE} end={page * PAGE_SIZE + results.items.length} total={results.total} setPage={(nextPage) => updateParams({ page: nextPage > 0 ? String(nextPage) : null }, false)}/></div>
        </>}
      </main>
    </div>

    <AnimatePresence>
      {mobileFiltersOpen && <>
        <motion.button type="button" aria-label="Cerrar carpetas y filtros" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileFiltersOpen(false)} className="fixed inset-0 z-[40] bg-black/50 md:hidden"/>
        <motion.aside initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'tween', duration: 0.2 }} className="fixed inset-y-0 left-0 z-[50] w-[min(21rem,90vw)] overflow-y-auto bg-[var(--surface)] p-4 shadow-2xl md:hidden" aria-label="Carpetas y filtros">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">Carpetas y filtros</h2><button type="button" aria-label="Cerrar" onClick={() => setMobileFiltersOpen(false)} className="grid size-9 place-items-center rounded-lg border border-[var(--line)]"><X size={17}/></button></div>
          {taxonomyLoading ? <p className="py-4 text-sm text-[var(--ink-muted)]">Cargando carpetas y filtros…</p> : filterPanel}
          {taxonomyError && <div role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200"><p>{taxonomyError}</p><button type="button" onClick={() => void loadTaxonomy()} className="mt-2 font-bold underline">Reintentar</button></div>}
        </motion.aside>
      </>}
    </AnimatePresence>
  </div>;
}
