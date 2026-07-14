import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Download, Eye, FileSpreadsheet, History, Search, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '../AuthContext';
import Modal from '../components/Modal';
import { db } from '../lib/db';
import type { AuditEvent } from '../types';
import { formatAuditEventTimestamp } from '../lib/auditEvent';
import { getAuditDetailRows, getAuditSnapshots, formatAuditValue } from '../lib/auditDetails';
import { exportToExcel, exportToPDF } from '../lib/exportUtils';
import { cn } from '../lib/utils';

const ENTITY_LABELS: Record<string, string> = {
  products: 'Producto',
  sales: 'Venta',
  cash_flow: 'Caja',
  stock_intakes: 'Ingreso de mercadería',
  cash_closing: 'Cierre de caja',
  cash_closings: 'Cierre de caja',
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
  const { before, after } = getAuditSnapshots(event);
  return after ?? before;
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

function getActorLabel(
  event: AuditEvent,
  currentUser: { uid: string; displayName?: string; email?: string } | null,
): string {
  const metadata = asAuditRecord(event.metadata);
  const storedName = firstText(metadata ?? {}, ['actorDisplayName', 'actor_display_name', 'actorName', 'actor_name']);
  if (storedName) return storedName;
  if (currentUser && event.actorUid === currentUser.uid) {
    return currentUser.displayName?.trim() || currentUser.email?.trim() || 'Usuario actual';
  }
  return event.actorUid ?? event.ownerUid ?? '—';
}

export default function AuditTrail() {
  const { user, refetchToken } = useAuth();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
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
      const matchesSearch = !query || [event.action, event.entityType, event.entityId, getEventSubject(event)]
        .filter(Boolean).join(' ').toLowerCase().includes(query);
      return matchesEntity && matchesSearch;
    });
  }, [deferredSearch, entityFilter, events]);

  const handleExport = async (format: 'excel' | 'pdf') => {
    if (!user || exporting) return;
    setExporting(format);
    const generatedAt = new Date().toISOString().slice(0, 10);
    const filterSummary = [
      entityFilter === 'all' ? 'Todas las entidades' : (ENTITY_LABELS[entityFilter] ?? entityFilter),
      deferredSearch.trim() ? `búsqueda: ${deferredSearch.trim()}` : null,
    ].filter(Boolean).join(' · ');
    const rows = filteredEvents.map((event) => ({
      fecha: formatAuditEventTimestamp(event),
      accion: ACTION_LABELS[event.action] ?? event.action,
      entidad: ENTITY_LABELS[event.entityType] ?? event.entityType,
      registro: getEventSubject(event) ?? 'Sin identificar',
      usuario: getActorLabel(event, user),
      id: event.entityId ?? '—',
    }));

    try {
      if (format === 'excel') {
        exportToExcel(rows, [
          { header: 'Fecha', value: row => row.fecha, width: 22 },
          { header: 'Acción', value: row => row.accion, width: 18 },
          { header: 'Entidad', value: row => row.entidad, width: 18 },
          { header: 'Registro afectado', value: row => row.registro, width: 32 },
          { header: 'Usuario', value: row => row.usuario, width: 28 },
          { header: 'ID del registro', value: row => row.id, width: 38 },
        ], `trazabilidad-${generatedAt}.xlsx`, 'Trazabilidad', {
          summary: [
            { label: 'Negocio', value: user.businessName },
            { label: 'Filtros', value: filterSummary },
            { label: 'Eventos exportados', value: String(rows.length) },
          ],
        });
      } else {
        await exportToPDF({
          businessName: user.businessName,
          currencySymbol: user.currencySymbol,
          rangeLabel: filterSummary,
        }, {
          title: 'Informe de trazabilidad',
          columns: [
            { header: 'Fecha', dataKey: 'fecha' },
            { header: 'Acción', dataKey: 'accion' },
            { header: 'Entidad', dataKey: 'entidad' },
            { header: 'Registro', dataKey: 'registro' },
            { header: 'Usuario', dataKey: 'usuario' },
          ],
          rows,
          fileName: `trazabilidad-${generatedAt}.pdf`,
        });
      }
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="business-page operational-page space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Trazabilidad</h2>
          <p className="text-slate-500 dark:text-slate-400">Historial de altas, cambios y eliminaciones operativas.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void handleExport('excel')} disabled={exporting !== null} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <FileSpreadsheet size={16} className="mr-1.5 inline" />{exporting === 'excel' ? 'Generando...' : 'Excel'}
          </button>
          <button onClick={() => void handleExport('pdf')} disabled={exporting !== null} className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50">
            <Download size={16} className="mr-1.5 inline" />{exporting === 'pdf' ? 'Generando...' : 'PDF'}
          </button>
        </div>
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
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">{formatAuditEventTimestamp(event)}</p>
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
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
              <p className="font-bold text-slate-900 dark:text-white">{getEventTitle(selectedEvent)}</p>
              {!getEventSnapshot(selectedEvent) && selectedEvent.entityType === 'products' && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                  Este evento fue generado antes de guardar la información completa del producto. Los nuevos eventos conservarán su nombre y todos sus datos.
                </p>
              )}
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-slate-500 dark:text-slate-400">Entidad</dt><dd className="font-medium text-slate-800 dark:text-slate-200">{ENTITY_LABELS[selectedEvent.entityType] ?? selectedEvent.entityType}</dd></div>
                <div><dt className="text-slate-500 dark:text-slate-400">ID del registro</dt><dd className="break-all font-mono text-xs text-slate-800 dark:text-slate-200">{selectedEvent.entityId ?? '—'}</dd></div>
                <div><dt className="text-slate-500 dark:text-slate-400">Usuario</dt><dd className="break-all text-xs text-slate-800 dark:text-slate-200">{getActorLabel(selectedEvent, user)}</dd></div>
                <div><dt className="text-slate-500 dark:text-slate-400">Fecha</dt><dd className="text-slate-800 dark:text-slate-200">{formatAuditEventTimestamp(selectedEvent)}</dd></div>
              </dl>
            </div>
            <div>
              {(() => {
                const rows = getAuditDetailRows(selectedEvent);
                const isUpdate = selectedEvent.action === 'update';
                const heading = isUpdate ? 'Cambios realizados' : selectedEvent.action === 'delete' ? 'Datos antes de eliminar' : 'Datos registrados';

                return (
                  <>
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{heading}</p>
                      {isUpdate && rows.length > 0 && <span className="text-xs text-slate-500">{rows.length} {rows.length === 1 ? 'campo modificado' : 'campos modificados'}</span>}
                    </div>
                    {rows.length > 0 ? (
                      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                        {rows.map((row) => (
                          <div key={row.field} className={cn(
                            'grid gap-2 border-b border-slate-100 p-3 last:border-b-0 dark:border-slate-800 sm:items-center',
                            isUpdate ? 'sm:grid-cols-[minmax(8rem,0.7fr)_1fr_1fr]' : 'sm:grid-cols-[minmax(10rem,0.7fr)_1.5fr]',
                          )}>
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{row.label}</p>
                            {isUpdate && <div><p className="text-xs text-slate-500">Antes</p><p className="whitespace-pre-line break-words text-sm text-slate-600 dark:text-slate-400">{formatAuditValue(row.before, row.field, user?.currencySymbol)}</p></div>}
                            <div><p className="text-xs text-slate-500">{isUpdate ? 'Después' : 'Valor'}</p><p className={cn('whitespace-pre-line break-words text-sm font-medium text-slate-900 dark:text-white', row.field.toLowerCase().endsWith('id') && 'font-mono text-xs')}>{formatAuditValue(selectedEvent.action === 'delete' ? row.before : row.after, row.field, user?.currencySymbol)}</p></div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                        No hay datos campo por campo para este evento histórico.
                      </p>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
