import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Archive, Brain, Check, Clock3, Loader2, Plus, RefreshCw, RotateCcw, Save, Search, Sparkles, Trash2, X } from 'lucide-react';
import {
  archiveAIMemory,
  createAIMemory,
  deleteAIMemory,
  getAIMemoryMetrics,
  getAIMemorySettings,
  getLatestAIMemoryArchiveEvents,
  listAIMemoryOriginChats,
  listAIMemories,
  reviewAIMemoryProposal,
  undoAIMemoryEvent,
  updateAIMemory,
  updateAIMemorySettings,
  type AIMemory,
  type AIMemoryKind,
  type AIMemoryMetric,
  type AIMemoryOriginChat,
  type AIMemorySettings,
} from '../lib/aiMemory';

type MemoryView = 'active' | 'archived' | 'proposed';
type KindFilter = 'all' | AIMemoryKind;
type OriginFilter = 'all' | 'chat' | 'manual';

const KIND_LABELS: Record<AIMemoryKind, string> = {
  fact: 'Hecho',
  preference: 'Preferencia',
  summary: 'Resumen',
};

const DEFAULT_SETTINGS: AIMemorySettings = {
  mode: 'auto',
  top_k: 5,
  include_summaries: true,
  updated_at: null,
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

function sumMetric(metrics: AIMemoryMetric[], key: keyof Omit<AIMemoryMetric, 'metric_date'>): number {
  return metrics.reduce((total, item) => total + item[key], 0);
}

export default function AIMemory({
  initialSelectedId,
  onOpenChat,
}: {
  initialSelectedId: string | null;
  onOpenChat: (chatId: string) => void;
}) {
  const [memories, setMemories] = useState<AIMemory[]>([]);
  const [metrics, setMetrics] = useState<AIMemoryMetric[]>([]);
  const [settings, setSettings] = useState<AIMemorySettings>(DEFAULT_SETTINGS);
  const [chats, setChats] = useState<AIMemoryOriginChat[]>([]);
  const [archiveEvents, setArchiveEvents] = useState<Record<string, string>>({});
  const [view, setView] = useState<MemoryView>('active');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<AIMemoryKind>('fact');
  const [newContent, setNewContent] = useState('');
  const [newPinned, setNewPinned] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editPinned, setEditPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextMemories, nextSettings, nextMetrics] = await Promise.all([
        listAIMemories(), getAIMemorySettings(), getAIMemoryMetrics(30),
      ]);
      setMemories(nextMemories);
      setSettings(nextSettings);
      setMetrics(nextMetrics);
      setArchiveEvents(await getLatestAIMemoryArchiveEvents(
        nextMemories.filter((item) => item.status === 'archived').map((item) => item.id),
      ));
      setChats(await listAIMemoryOriginChats(nextMemories.flatMap((item) => item.source_chat_id ? [item.source_chat_id] : [])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la memoria.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!initialSelectedId) return;
    const selected = memories.find((item) => item.id === initialSelectedId);
    if (!selected) return;
    setView(selected.status === 'proposed' ? 'proposed' : selected.status === 'archived' ? 'archived' : 'active');
    window.requestAnimationFrame(() => document.getElementById(`ai-memory-${initialSelectedId}`)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }));
  }, [initialSelectedId, memories]);

  const chatById = useMemo(() => new Map(chats.map((chat) => [chat.id, chat])), [chats]);
  const counts = useMemo(() => ({
    active: memories.filter((item) => item.status === 'active').length,
    archived: memories.filter((item) => item.status === 'archived').length,
    proposed: memories.filter((item) => item.status === 'proposed').length,
  }), [memories]);
  const filteredMemories = useMemo(() => memories.filter((item) => {
    if (item.status !== view) return false;
    if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
    if (originFilter === 'chat' && !item.source_chat_id) return false;
    if (originFilter === 'manual' && item.source_chat_id) return false;
    return item.content.toLocaleLowerCase('es-AR').includes(query.trim().toLocaleLowerCase('es-AR'));
  }), [kindFilter, memories, originFilter, query, view]);

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      setSettings(await updateAIMemorySettings({
        mode: settings.mode,
        top_k: settings.top_k,
        include_summaries: settings.include_summaries,
      }));
      setNotice('Configuración de memoria guardada.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la configuración.');
    } finally {
      setSaving(false);
    }
  };

  const addMemory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await createAIMemory({ kind: newKind, content: newContent, pinned: newPinned });
      setNewContent('');
      setNewPinned(false);
      setAdding(false);
      setView('active');
      await refresh();
      setNotice('Recuerdo agregado.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo agregar el recuerdo.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (memory: AIMemory) => {
    setEditingId(memory.id);
    setEditContent(memory.content);
    setEditPinned(memory.pinned);
    setError('');
  };

  const saveEdit = async (event: FormEvent<HTMLFormElement>, memory: AIMemory) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await updateAIMemory({ id: memory.id, content: editContent, pinned: memory.kind === 'preference' && editPinned });
      setEditingId(null);
      await refresh();
      setNotice('Recuerdo actualizado.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el recuerdo.');
    } finally {
      setSaving(false);
    }
  };

  const runMemoryAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await action();
      setEditingId(null);
      await refresh();
      setNotice(successMessage);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la memoria.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (memory: AIMemory) => {
    if (!window.confirm('Este recuerdo se borrará definitivamente. No se puede deshacer.')) return;
    void runMemoryAction(() => deleteAIMemory(memory.id), 'Recuerdo borrado.');
  };

  const metricTotals = {
    executed: sumMetric(metrics, 'extractions_executed'),
    prefilter: sumMetric(metrics, 'skipped_prefilter'),
    deduplication: sumMetric(metrics, 'skipped_deduplication'),
    local: sumMetric(metrics, 'provider_local'),
    codex: sumMetric(metrics, 'provider_codex'),
  };

  return <section className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="flex items-center gap-2 text-xl font-bold"><Brain size={21} className="text-[var(--brand)]"/>Memoria compartida</h3><p className="mt-1 max-w-3xl text-sm text-[var(--ink-muted)]">La memoria es compartida por todos tus chats y tareas, con Codex y con Claude. Nunca guarda contraseñas, tarjetas ni datos bancarios.</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => { setAdding((current) => !current); setError(''); }} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-3 py-2 text-sm font-bold text-[var(--action-ink)]"><Plus size={15}/>Agregar recuerdo</button><button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Actualizar memoria" className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/>Actualizar</button></div>
    </header>

    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">No se pudo cargar o guardar la memoria. {error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{notice}</p>}

    {adding && <form onSubmit={(event) => void addMemory(event)} className="grid gap-3 rounded-2xl border border-[var(--brand)] bg-[var(--surface)] p-4 md:grid-cols-[12rem_minmax(0,1fr)_auto] md:items-end">
      <label className="block space-y-1.5"><span className="text-xs font-semibold">Tipo</span><select value={newKind} onChange={(event) => { setNewKind(event.target.value as AIMemoryKind); if (event.target.value !== 'preference') setNewPinned(false); }} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-sm text-[var(--ink)]"><option value="fact">Hecho</option><option value="preference">Preferencia</option><option value="summary">Resumen</option></select></label>
      <label className="block space-y-1.5"><span className="text-xs font-semibold">Recuerdo</span><textarea required maxLength={newKind === 'summary' ? 2000 : 500} rows={2} value={newContent} onChange={(event) => setNewContent(event.target.value)} className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-sm text-[var(--ink)]"/></label>
      <div className="flex items-center gap-2 md:pb-1">{newKind === 'preference' && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={newPinned} onChange={(event) => setNewPinned(event.target.checked)} className="accent-[#365fad]"/>Fijar</label>}<button type="submit" disabled={saving || !newContent.trim()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-3 py-2 text-xs font-bold text-[var(--action-ink)] disabled:opacity-50"><Save size={14}/>{saving ? 'Guardando…' : 'Guardar'}</button><button type="button" onClick={() => setAdding(false)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-semibold">Cancelar</button></div>
    </form>}

    <form onSubmit={(event) => void saveSettings(event)} className="grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-end">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1.5"><span className="text-xs font-semibold">Modo de memoria</span><select value={settings.mode} onChange={(event) => setSettings((current) => ({ ...current, mode: event.target.value as AIMemorySettings['mode'] }))} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-sm text-[var(--ink)]"><option value="auto">Automática (recomendado)</option><option value="confirm">Con mi confirmación</option><option value="off">Apagada</option></select></label>
        <label className="block space-y-1.5"><span className="text-xs font-semibold">Recuerdos por respuesta</span><input type="number" min={1} max={10} step={1} required value={settings.top_k} onChange={(event) => setSettings((current) => ({ ...current, top_k: Number(event.target.value) }))} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-sm text-[var(--ink)]"/></label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={settings.include_summaries} onChange={(event) => setSettings((current) => ({ ...current, include_summaries: event.target.checked }))} className="accent-[#365fad]"/>Incluir conversaciones anteriores</label>
      </div>
      <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={saving || loading} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-3 py-2 text-xs font-bold text-[var(--action-ink)] disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}Guardar ajustes</button><span className="text-[11px] text-[var(--ink-muted)]">Automática guarda recuerdos útiles después de responder.</span></div>
    </form>

    <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex items-start gap-2"><Sparkles size={17} className="mt-0.5 text-[var(--brand)]"/><div><h4 className="font-bold">Uso de la memoria</h4><p className="mt-0.5 text-xs text-[var(--ink-muted)]">Métricas de los últimos 30 días. Las consultas se resuelven con embedding y SQL, sin llamada adicional a un modelo.</p></div></div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Extracciones ejecutadas" value={metricTotals.executed}/><Metric label="Evitadas por prefiltro" value={metricTotals.prefilter}/><Metric label="Evitadas por duplicado" value={metricTotals.deduplication}/><Metric label="Proveedor local" value={metricTotals.local}/><Metric label="Codex" value={metricTotals.codex}/>
      </div>
    </section>

    <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Estado de recuerdos">
          {([
            ['active', 'Activos'], ['archived', 'Archivados'], ['proposed', 'Propuestas'],
          ] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold ${view === id ? 'bg-[var(--brand-soft)] text-[var(--brand)]' : 'text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]'}`}>{label} <span className="ml-1 opacity-70">{counts[id]}</span></button>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="relative"><span className="sr-only">Buscar recuerdos</span><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar" className="w-36 rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] py-2 pl-8 pr-2 text-xs text-[var(--ink)]"/></label>
          <label><span className="sr-only">Filtrar por tipo</span><select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as KindFilter)} className="rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2 text-xs text-[var(--ink)]"><option value="all">Todos los tipos</option><option value="fact">Hechos</option><option value="preference">Preferencias</option><option value="summary">Resúmenes</option></select></label>
          <label><span className="sr-only">Filtrar por origen</span><select value={originFilter} onChange={(event) => setOriginFilter(event.target.value as OriginFilter)} className="rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2 text-xs text-[var(--ink)]"><option value="all">Todos los orígenes</option><option value="chat">Chats</option><option value="manual">Agregados manualmente</option></select></label>
        </div>
      </div>

      {loading ? <p className="flex items-center gap-2 py-8 text-sm text-[var(--ink-muted)]"><Loader2 size={16} className="animate-spin"/>Cargando recuerdos…</p>
        : filteredMemories.length ? <ul className="space-y-3">{filteredMemories.map((memory) => {
          const sourceChat = memory.source_chat_id ? chatById.get(memory.source_chat_id) : undefined;
          const maxLength = memory.kind === 'summary' ? 2000 : 500;
          return <li id={`ai-memory-${memory.id}`} key={memory.id} className={`rounded-xl border p-4 transition-colors ${initialSelectedId === memory.id ? 'border-[var(--brand)] bg-[var(--brand-soft)]/40' : 'border-[var(--line)]'}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-bold uppercase tracking-wide">{KIND_LABELS[memory.kind]}</span>{memory.pinned && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-200">Fijado</span>}{memory.status === 'proposed' && <span className="rounded-full bg-violet-100 px-2 py-1 text-[10px] font-bold text-violet-900 dark:bg-violet-950 dark:text-violet-200">{memory.proposal_action === 'update' ? 'Actualizar' : memory.proposal_action === 'archive' ? 'Archivar' : 'Agregar'}</span>}<span className="text-[10px] text-[var(--ink-muted)]">M-{memory.id.slice(0, 4).toUpperCase()}</span></div>
                {editingId === memory.id ? <form onSubmit={(event) => void saveEdit(event, memory)} className="mt-3 space-y-3">
                  <label className="block"><span className="sr-only">Editar recuerdo</span><textarea required maxLength={maxLength} rows={3} value={editContent} onChange={(event) => setEditContent(event.target.value)} className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-sm text-[var(--ink)]"/></label>
                  {memory.kind === 'preference' && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={editPinned} onChange={(event) => setEditPinned(event.target.checked)} className="accent-[#365fad]"/>Fijar esta preferencia</label>}
                  <div className="flex gap-2"><button type="submit" disabled={saving || !editContent.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--action-bg)] px-3 py-2 text-xs font-bold text-[var(--action-ink)] disabled:opacity-50"><Check size={14}/>Guardar</button><button type="button" onClick={() => setEditingId(null)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-semibold"><X size={14}/>Cancelar</button></div>
                </form> : <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{memory.content}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--ink-muted)]"><span className="inline-flex items-center gap-1"><Clock3 size={12}/>Creado {formatDate(memory.created_at)}</span><span>Usado {memory.use_count} {memory.use_count === 1 ? 'vez' : 'veces'}</span>{memory.last_used_at && <span>Último uso {formatDate(memory.last_used_at)}</span>}{memory.source_chat_id && (sourceChat ? <button type="button" onClick={() => onOpenChat(memory.source_chat_id!)} className="font-semibold text-[var(--brand)] hover:underline">Chat: {sourceChat.title}</button> : <span>Chat de origen eliminado</span>)}{!memory.source_chat_id && <span>Agregado manualmente</span>}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {memory.status === 'active' && <><button type="button" onClick={() => startEdit(memory)} className="rounded-lg border border-[var(--line)] px-2.5 py-2 text-[11px] font-semibold">Editar</button><button type="button" onClick={() => void runMemoryAction(() => archiveAIMemory(memory.id), 'Recuerdo archivado.')} disabled={saving} className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-2.5 py-2 text-[11px] font-semibold disabled:opacity-50"><Archive size={13}/>Archivar</button></>}
                {memory.status === 'archived' && <button type="button" onClick={() => { const eventId = archiveEvents[memory.id]; if (eventId) void runMemoryAction(() => undoAIMemoryEvent(eventId), 'Recuerdo restaurado.'); }} disabled={saving || !archiveEvents[memory.id]} title={archiveEvents[memory.id] ? undefined : 'No hay un evento de archivado que se pueda deshacer'} className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-2.5 py-2 text-[11px] font-semibold disabled:opacity-50"><RotateCcw size={13}/>Restaurar</button>}
                {memory.status === 'proposed' && <><button type="button" onClick={() => void runMemoryAction(() => reviewAIMemoryProposal(memory.id, true), 'Propuesta aceptada.')} disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-2 text-[11px] font-bold text-white disabled:opacity-50"><Check size={13}/>Aceptar</button><button type="button" onClick={() => void runMemoryAction(() => reviewAIMemoryProposal(memory.id, false), 'Propuesta descartada.')} disabled={saving} className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-2.5 py-2 text-[11px] font-semibold disabled:opacity-50"><X size={13}/>Descartar</button></>}
                {memory.status !== 'proposed' && <button type="button" onClick={() => confirmDelete(memory)} disabled={saving} aria-label={`Borrar definitivamente ${memory.content.slice(0, 40)}`} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-2 text-[11px] font-semibold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300"><Trash2 size={13}/>Borrar</button>}
              </div>
            </div>
          </li>;
        })}</ul> : <p className="rounded-xl border border-dashed border-[var(--line-strong)] p-6 text-center text-sm text-[var(--ink-muted)]">{query || kindFilter !== 'all' || originFilter !== 'all' ? 'No hay recuerdos que coincidan con estos filtros.' : view === 'active' ? 'Todavía no hay recuerdos activos.' : view === 'archived' ? 'No hay recuerdos archivados.' : 'No hay propuestas pendientes.'}</p>}
    </section>
  </section>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-[10px] font-semibold leading-4 text-[var(--ink-muted)]">{label}</p><p className="mt-1 text-lg font-bold">{value.toLocaleString('es-AR')}</p></div>;
}
