import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowRightLeft, Calendar, Filter, Loader2, PackagePlus, Pencil, Search } from 'lucide-react';
import { useAuth } from '../../AuthContext';
import { useInventoryOwners } from '../../hooks/useInventoryOwners';
import {
  type InventoryMovement,
  type MovementType,
  listInventoryMovements,
  MOVEMENT_TYPE_BADGE_CLASS,
  MOVEMENT_TYPE_LABELS,
} from '../../lib/inventoryMovements';
import { cn, formatDate } from '../../lib/utils';

const PAGE_SIZE = 25;

const MOVEMENT_ICONS: Record<MovementType, typeof PackagePlus> = {
  intake: PackagePlus,
  transfer_in: ArrowRight,
  transfer_out: ArrowLeft,
  product_edit: Pencil,
  adjustment: ArrowRightLeft,
};

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

export default function MovementHistoryPanel() {
  const { user, refetchToken } = useAuth();
  const { owners, loading: ownersLoading } = useInventoryOwners(user?.uid, refetchToken);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const firstOfMonth = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  }, []);

  const [dateFrom, setDateFrom] = useState<string>(firstOfMonth);
  const [dateTo, setDateTo] = useState<string>(today);
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | MovementType>('all');
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState<number>(0);
  const [rows, setRows] = useState<InventoryMovement[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: { cancelled: boolean }) => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listInventoryMovements({
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        inventoryOwnerId: ownerFilter === 'all' ? null : ownerFilter,
        movementType: typeFilter === 'all' ? null : typeFilter,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      if (signal?.cancelled) return;
      setRows(result);
      setTotal(result[0]?.totalCount ?? 0);
    } catch (err) {
      if (signal?.cancelled) return;
      const text = err instanceof Error ? err.message.replace(/^\[[^\]]+\]\s*/, '') : 'No se pudo cargar el historial.';
      setError(text);
      setRows([]);
      setTotal(0);
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }, [dateFrom, dateTo, ownerFilter, typeFilter, page, user]);

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => { signal.cancelled = true; };
  }, [load, refetchToken]);

  useEffect(() => {
    setPage(0);
  }, [dateFrom, dateTo, ownerFilter, typeFilter]);

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const needle = search.toLowerCase();
    return rows.filter((row) => (
      row.productName.toLowerCase().includes(needle)
      || row.inventoryOwnerName.toLowerCase().includes(needle)
      || (row.transferReason ?? '').toLowerCase().includes(needle)
    ));
  }, [rows, search]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrev = page > 0;
  const hasNext = page + 1 < totalPages;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-white">Historial de movimientos</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Ingresos, transferencias y ajustes de stock entre titulares. Filtros por fecha, titular y tipo.
          </p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
          Desde
          <div className="relative">
            <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
          Hasta
          <div className="relative">
            <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
          Titular
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              disabled={ownersLoading}
              className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="all">Todos los titulares</option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>{owner.name}</option>
              ))}
            </select>
          </div>
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
          Tipo
          <div className="relative">
            <Filter size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'all' | MovementType)}
              className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              <option value="all">Todos los tipos</option>
              {(Object.entries(MOVEMENT_TYPE_LABELS) as Array<[MovementType, string]>).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </label>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por producto o titular..."
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2.5">Fecha</th>
              <th className="px-3 py-2.5">Tipo</th>
              <th className="px-3 py-2.5">Producto</th>
              <th className="px-3 py-2.5">Titular</th>
              <th className="px-3 py-2.5 text-right">Variación</th>
              <th className="px-3 py-2.5 text-right">Stock final</th>
              <th className="px-3 py-2.5">Motivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-500 dark:text-slate-400">
                  <Loader2 size={20} className="mx-auto animate-spin" />
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-500 dark:text-slate-400">
                  No hay movimientos para los filtros seleccionados.
                </td>
              </tr>
            ) : filteredRows.map((row) => {
              const Icon = MOVEMENT_ICONS[row.movementType];
              return (
                <tr key={row.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-700 dark:text-slate-300">
                    {formatDate(row.createdAt)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                      MOVEMENT_TYPE_BADGE_CLASS[row.movementType],
                    )}>
                      <Icon size={11} />
                      {MOVEMENT_TYPE_LABELS[row.movementType]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-white">
                    {row.productName}
                  </td>
                  <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                    {row.inventoryOwnerName}
                  </td>
                  <td className={cn(
                    'whitespace-nowrap px-3 py-2.5 text-right font-bold',
                    row.delta > 0
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-rose-700 dark:text-rose-400',
                  )}>
                    {formatDelta(row.delta)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-700 dark:text-slate-300">
                    {row.resultingStock ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                    {row.transferReason ?? row.reason}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>
          {total === 0
            ? 'Sin resultados'
            : `Página ${page + 1} de ${totalPages} · ${total} movimiento${total === 1 ? '' : 's'}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={!hasPrev || loading}
            className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext || loading}
            className="rounded-lg border border-slate-200 px-3 py-1.5 font-semibold transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Siguiente
          </button>
        </div>
      </div>
    </section>
  );
}
