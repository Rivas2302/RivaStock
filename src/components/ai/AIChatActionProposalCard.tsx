import { useEffect, useState } from 'react';
import { Check, Clock3, Loader2, RotateCcw, X } from 'lucide-react';
import { useAuth } from '../../AuthContext';
import { useBusinessWriteAccess } from '../../hooks/useBusinessWriteAccess';
import { invalidateDbCache } from '../../lib/db';
import { cancelAIAction, confirmAIChatAction, listAIChatActionRequests, undoAIChatAction, type AIChatActionRequest } from '../../lib/aiActions';

const ACTION_LABELS: Record<string, string> = {
  'product.update': 'Actualizar producto',
  'product.create': 'Crear producto',
  'stock.adjust': 'Ajustar stock',
  'price.bulk_update': 'Actualizar precios',
  'catalog.announcement': 'Cambiar la cinta de anuncios',
  'knowledge.create_document': 'Crear borrador en Conocimientos',
};

const FIELD_LABELS: Record<string, string> = {
  nombre: 'Nombre', descripcion: 'Descripción', categoria: 'Categoría', precio_venta: 'Precio de venta',
  stock: 'Stock', mostrar_en_catalogo: 'Mostrar en catálogo', cantidad: 'Cantidad', texto: 'Texto',
  activa: 'Activa', titulo: 'Título', contenido: 'Contenido', tipo: 'Tipo', valor: 'Valor',
};

function printable(value: unknown, field = ''): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (field === 'precio_venta' && typeof value === 'number' && Number.isFinite(value)) {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value);
  }
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '—';
}

function displayFields(value: unknown): Array<[string, unknown]> {
  if (value === null || value === undefined) return [];
  if (typeof value !== 'object' || Array.isArray(value)) return [['Detalle', value]];
  return Object.entries(value as Record<string, unknown>).filter(([key]) => key !== 'fingerprint');
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key.replaceAll('_', ' ');
}

function SampleDetails({ sample, actionKey }: { sample: unknown; actionKey: string }) {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return <p className="break-words rounded-lg border border-[var(--line)] px-2.5 py-2 text-xs">{printable(sample)}</p>;
  const row = sample as Record<string, unknown>;
  const title = typeof row.producto === 'string' ? row.producto : typeof row.nombre === 'string' ? row.nombre : '';
  if ('antes' in row && 'despues' in row) {
    const changedField = actionKey === 'stock.adjust' ? 'stock' : 'precio_venta';
    return <p className="break-words rounded-lg border border-[var(--line)] px-2.5 py-2 text-xs">
      {title && <strong>{title}: </strong>}{printable(row.antes, changedField)} → {printable(row.despues, changedField)}
    </p>;
  }
  return <div className="rounded-lg border border-[var(--line)] px-2.5 py-2 text-xs">
    {Object.entries(row).filter(([key]) => !['id', 'fingerprint'].includes(key)).map(([key, value]) => <p key={key} className="break-words"><span className="font-semibold">{fieldLabel(key)}:</span> {printable(value, key)}</p>)}
  </div>;
}

function statusText(request: AIChatActionRequest): string {
  if (request.status === 'confirmed') return 'Hecho';
  if (request.status === 'undone') return 'Deshecho';
  if (request.status === 'cancelled') return 'Cancelada';
  if (request.status === 'failed') return request.error || 'No se pudo aplicar';
  if (request.status === 'expired' || (request.expires_at && Date.parse(request.expires_at) <= Date.now())) return 'Venció';
  if (request.status === 'pending') {
    const minutes = request.expires_at ? Math.max(0, Math.ceil((Date.parse(request.expires_at) - Date.now()) / 60_000)) : 30;
    return `Pendiente de confirmación · vence en ${minutes} min`;
  }
  return request.status;
}

export default function AIChatActionProposalCard({
  request: initialRequest,
  requestId,
  onChanged,
}: {
  request?: AIChatActionRequest;
  requestId?: string;
  onChanged?: () => void;
}) {
  const { isOwner } = useAuth();
  const { canWrite } = useBusinessWriteAccess();
  const [request, setRequest] = useState<AIChatActionRequest | null>(initialRequest ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (initialRequest) setRequest(initialRequest); }, [initialRequest]);

  useEffect(() => {
    if (initialRequest || !requestId) return;
    let active = true;
    void listAIChatActionRequests([requestId]).then((items) => {
      if (active) setRequest(items[0] ?? null);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la propuesta.');
    });
    return () => { active = false; };
  }, [initialRequest, requestId]);

  const reload = async () => {
    if (!request) return;
    const items = await listAIChatActionRequests([request.id]);
    setRequest(items[0] ?? null);
    onChanged?.();
  };

  const confirm = async () => {
    if (!request || busy) return;
    setBusy(true); setError('');
    try {
      const result = await confirmAIChatAction(request.id);
      if (result.expired === true) setRequest((current) => current ? { ...current, status: 'expired' } : current);
      else {
        invalidateDbCache('products', 'catalog_config', 'knowledge_documents', 'knowledge_document_versions');
        await reload();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo confirmar la propuesta.');
      await reload();
    } finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!request || busy) return;
    setBusy(true); setError('');
    try { await cancelAIAction(request.id); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cancelar la propuesta.'); }
    finally { setBusy(false); }
  };

  const undo = async () => {
    if (!request || busy) return;
    setBusy(true); setError('');
    try {
      await undoAIChatAction(request.id);
      invalidateDbCache('products', 'catalog_config');
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo deshacer la acción.'); }
    finally { setBusy(false); }
  };

  if (!request) return requestId ? <div role="status" className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-xs text-[var(--ink-muted)]">{error || 'Cargando propuesta…'}</div> : null;
  const expired = request.status === 'expired' || Boolean(request.expires_at && Date.parse(request.expires_at) <= Date.now());
  const pending = request.status === 'pending' && !expired;
  const confirmed = request.status === 'confirmed';
  const canUndo = confirmed && Boolean(request.undo) && request.executed_at
    && Date.parse(request.executed_at) > Date.now() - 24 * 60 * 60_000;
  const before = displayFields(request.draft_content.before);
  const after = displayFields(request.draft_content.after);
  const samples = request.draft_content.samples ?? [];

  return <section aria-label="Propuesta de cambio de IA" className="mt-3 rounded-xl border border-[var(--brand-ring)] bg-[var(--surface)] p-3 text-sm shadow-sm sm:p-4">
    <header className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><p className="font-bold text-[var(--ink)]">{ACTION_LABELS[request.action_key] ?? 'Propuesta de cambio'}</p>
        {request.draft_content.summary && <p className="mt-1 text-[var(--ink-subtle)]">{request.draft_content.summary}</p>}
      </div>
      <p className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${pending ? 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200' : 'bg-[var(--surface-muted)] text-[var(--ink-muted)]'}`}>
        {pending ? <Clock3 size={12}/> : confirmed ? <Check size={12}/> : null}{statusText(request)}
      </p>
    </header>
    {typeof request.draft_content.count === 'number' && <p className="mt-2 text-xs font-semibold">Alcanza {request.draft_content.count} {request.draft_content.count === 1 ? 'elemento' : 'elementos'}.</p>}
    {(before.length > 0 || after.length > 0) && <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {before.length > 0 && <div className="rounded-lg bg-[var(--surface-muted)] p-2.5"><p className="text-[11px] font-bold uppercase tracking-wide text-[var(--ink-muted)]">Antes</p>{before.map(([key, value]) => <p key={key} className="mt-1 break-words text-xs"><span className="font-semibold">{fieldLabel(key)}:</span> {printable(value, key)}</p>)}</div>}
      {after.length > 0 && <div className="rounded-lg bg-[var(--brand-soft)] p-2.5"><p className="text-[11px] font-bold uppercase tracking-wide text-[var(--ink-muted)]">Después</p>{after.map(([key, value]) => <p key={key} className="mt-1 break-words text-xs"><span className="font-semibold">{fieldLabel(key)}:</span> {printable(value, key)}</p>)}</div>}
    </div>}
    {samples.length > 0 && request.draft_content.count !== 1 && <div className="mt-3 space-y-1.5"><p className="text-xs font-bold">Ejemplos</p>{samples.slice(0, 5).map((sample, index) => <SampleDetails key={index} sample={sample} actionKey={request.action_key}/>)}</div>}
    {request.status === 'failed' && request.error && <p role="alert" className="mt-3 rounded-lg bg-[var(--danger-surface)] p-2.5 text-xs text-[var(--danger-ink)]">{request.error}</p>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-[var(--danger-surface)] p-2.5 text-xs text-[var(--danger-ink)]">{error}</p>}
    {pending && <div className="mt-3 flex flex-wrap justify-end gap-2">
      {!isOwner && <p className="mr-auto self-center text-xs text-[var(--ink-muted)]">Solo el dueño puede confirmar esta propuesta.</p>}
      <button type="button" onClick={() => void cancel()} disabled={!isOwner || !canWrite || busy} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold disabled:opacity-50"><X size={13}/>Cancelar</button>
      <button type="button" onClick={() => void confirm()} disabled={!isOwner || !canWrite || busy} className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-[var(--action-bg)] px-3 text-xs font-bold text-[var(--action-ink)] disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin"/> : <Check size={13}/>}Confirmar</button>
    </div>}
    {canUndo && isOwner && <button type="button" onClick={() => void undo()} disabled={!canWrite || busy} className="mt-3 inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin"/> : <RotateCcw size={13}/>}Deshacer</button>}
  </section>;
}
