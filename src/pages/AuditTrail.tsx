import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Eye, History, Search, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../AuthContext';
import Modal from '../components/Modal';
import { db } from '../lib/db';
import type { AuditEvent } from '../types';
import { cn, formatDate } from '../lib/utils';

const ENTITY_LABELS: Record<string, string> = {
  products: 'Producto',
  sales: 'Venta',
  cash_flow: 'Caja',
  stock_intakes: 'Ingreso de mercadería',
  cash_closing: 'Cierre de caja',
};

const ACTION_LABELS: Record<string, string> = {
  insert: 'Creado',
  update: 'Modificado',
  delete: 'Eliminado',
  cash_closing_created: 'Cierre registrado',
};

type AuditRecord = Record<string, unknown>;

function asAuditRecord(value: unknown): AuditRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as AuditRecord
    : null;
}

function getEventSnapshot(event: AuditEvent): AuditRecord | null {
  const metadata = asAuditRecord(event.metadata);
  return asAuditRecord(metadata?.after) ?? asAuditRecord(metadata?.before);
}

function firstText(record: AuditRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function getEventSubject(event: AuditEvent): string | null {
  const snapshot = getEventSnapshot(event);
  if (!snapshot) {
    if (event.entityType === 'products') return 'Nombre no capturado (evento anterior)';
    return event.entityId ? `ID ${event.entityId}` : null;
  }

  const directLabel = firstText(snapshot, [
    'name', 'product_name', 'productName', 'description', 'client',
    'customer_name', 'customerName', 'supplier_name', 'supplierName',
  ]);
  if (directLabel) return directLabel;

  if (Array.isArray(snapshot.items)) {
    const itemNames = snapshot.items
      .map((item) => asAuditRecord(item))
      .map((item) => item && firstText(item, ['product_name', 'productName', 'name']))
      .filter((name): name is string => Boolean(name));
    if (itemNames.length > 0) return itemNames.join(', ');
  }

  return event.entityId ? `ID ${event.entityId}` : null;
}

function getEventTitle(event: AuditEvent): string {
  const action = ACTION_LABELS[event.action] ?? event.action;
  const entity = ENTITY_LABELS[event.entityType] ?? event.entityType;
  const subject = getEventSubject(event);
  return subject ? `${action} · ${entity} · ${subject}` : `${action} · ${entity}`;
}

export default function AuditTrail() {
  const { user, refetchToken } = useAuth();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void db.list<AuditEvent>('audit_events', user.uid)
      .then((result) => { if (!cancelled) setEvents(result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))); })
      .catch((error) => console.error('[AuditTrail] fetch error:', error))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, refetchToken]);

  const entityTypes = useMemo(
    () => [...new Set(events.map((event) => event.entityType))].sort(),
    [events],
  );
  const filteredEvents = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    return events.filter((event) => {
      const matchesEntity = entityFilter === 'all' || event.entityType === entityFilter;
      const matchesSearch = !query || [event.action, event.entityType, event.entityId]
        .filter(Boolean).join(' ').toLowerCase().includes(query);
      return matchesEntity && matchesSearch;
    });
  }, [deferredSearch, entityFilter, events]);

  return (
    <div className="business-page operational-page space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Trazabilidad</h2>
        <p className="text-slate-500 dark:text-slate-400">Historial de altas, cambios y eliminaciones operativas.</p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por acción o entidad..." className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white" />
        </div>
        <div className="relative">
          <SlidersHorizontal size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <select value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)} className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-8 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white">
            <option value="all">Todas las entidades</option>
            {entityTypes.map((entity) => <option key={entity} value={entity}>{ENTITY_LABELS[entity] ?? entity}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {loading ? <div className="p-10 text-center text-slate-500">Cargando historial...</div> : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredEvents.map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-4 p-4 sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300"><History size={18} /></div>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 dark:text-white">{getEventTitle(event)}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">{formatDate(event.createdAt.slice(0, 10))} · {new Date(event.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                </div>
                <button onClick={() => setSelectedEvent(event)} className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800 dark:hover:text-indigo-300" title="Ver detalle"><Eye size={18} /></button>
              </div>
            ))}
            {filteredEvents.length === 0 && <div className="p-10 text-center text-slate-500">No hay eventos para mostrar.</div>}
          </div>
        )}
      </div>

      <Modal isOpen={selectedEvent !== null} onClose={() => setSelectedEvent(null)} title="Detalle del evento">
        {selectedEvent && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
              <p className="font-bold text-slate-900 dark:text-white">{getEventTitle(selectedEvent)}</p>
              {!getEventSnapshot(selectedEvent) && selectedEvent.entityType === 'products' && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  Este evento fue generado antes de guardar la información completa del producto. Los nuevos eventos conservarán su nombre y todos sus datos.
                </p>
              )}
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-500 dark:text-slate-400">Entidad</dt><dd className="font-medium text-slate-800 dark:text-slate-200">{selectedEvent.entityType}</dd></div>
                <div><dt className="text-slate-500 dark:text-slate-400">ID del registro</dt><dd className="break-all font-mono text-xs text-slate-800 dark:text-slate-200">{selectedEvent.entityId ?? '—'}</dd></div>
                <div><dt className="text-slate-500 dark:text-slate-400">Usuario</dt><dd className="break-all font-mono text-xs text-slate-800 dark:text-slate-200">{selectedEvent.actorUid ?? selectedEvent.ownerUid ?? '—'}</dd></div>
                <div><dt className="text-slate-500 dark:text-slate-400">Fecha</dt><dd className="text-slate-800 dark:text-slate-200">{new Date(selectedEvent.createdAt).toLocaleString('es-AR')}</dd></div>
              </dl>
            </div>
            <div>
              <p className="mb-2 text-sm font-bold text-slate-700 dark:text-slate-300">Datos completos del evento</p>
              <pre className={cn('max-h-[50vh] overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-relaxed text-slate-100', 'whitespace-pre-wrap break-words')}>{JSON.stringify(selectedEvent.metadata ?? {}, null, 2)}</pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
