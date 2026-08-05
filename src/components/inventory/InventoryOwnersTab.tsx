import { useState, type FormEvent } from 'react';
import { Archive, ArrowDown, ArrowUp, Check, Edit2, Plus, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useAuth } from '../../AuthContext';
import { useInventoryOwners } from '../../hooks/useInventoryOwners';
import { usePermission } from '../../hooks/usePermission';
import {
  archiveInventoryOwner,
  createInventoryOwner,
  renameInventoryOwner,
  reorderInventoryOwners,
} from '../../lib/inventoryOwners';
import { setInventoryHoldingsEnabled } from '../../lib/inventoryHoldings';
import { showToast } from '../../lib/toast';
import type { InventoryOwner } from '../../types';
import MovementHistoryPanel from './MovementHistoryPanel';

export default function InventoryOwnersTab() {
  const { user, refetchToken, holdingsEnabled, refetchData } = useAuth();
  const canReadConfig = usePermission('config', 'read');
  const canManageConfig = usePermission('config', 'write');
  const canManage = canReadConfig && canManageConfig;
  const { owners, activeOwners, loading, reload } = useInventoryOwners(user?.uid, refetchToken);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [busy, setBusy] = useState(false);
  const [rolloutBusy, setRolloutBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await operation();
      reload();
      setMessage({ text: success });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message.replace(/^\[[^\]]+\]\s*/, '') : 'No se pudo completar la operación',
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await run(() => createInventoryOwner(name), 'Titular creado.');
    setNewName('');
  };

  const handleRename = async (owner: InventoryOwner) => {
    const name = editingName.trim();
    if (!name || name === owner.name) {
      setEditingId(null);
      return;
    }
    await run(() => renameInventoryOwner(owner.id, name), 'Nombre actualizado.');
    setEditingId(null);
  };

  const handleMove = async (ownerId: string, direction: -1 | 1) => {
    const index = activeOwners.findIndex((owner) => owner.id === ownerId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= activeOwners.length) return;
    const ids = activeOwners.map((owner) => owner.id);
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    await run(() => reorderInventoryOwners(ids), 'Prioridad actualizada.');
  };

  const handleArchive = async (owner: InventoryOwner) => {
    if (owner.isPrimary) return;
    if (!confirm(`¿Archivar a "${owner.name}"? Los productos existentes conservarán esta etiqueta.`)) return;
    await run(() => archiveInventoryOwner(owner.id), 'Titular archivado.');
  };

  const handleToggleRollout = async () => {
    if (!user || rolloutBusy) return;
    const nextEnabled = !holdingsEnabled;
    const confirmText = nextEnabled
      ? 'Al activar el stock compartido, cada venta atribuirá unidades a un titular y se registrará la ganancia por titular. ¿Continuar?'
      : 'Al desactivar el stock compartido, las ventas nuevas dejarán de atribuirse por titular. El histórico se conserva. ¿Continuar?';
    if (!confirm(confirmText)) return;
    setRolloutBusy(true);
    try {
      await setInventoryHoldingsEnabled(nextEnabled);
      showToast(
        nextEnabled
          ? 'Stock compartido por titular activado.'
          : 'Stock compartido por titular desactivado.',
        'success',
      );
      refetchData();
    } catch (error) {
      const text = error instanceof Error
        ? error.message.replace(/^\[[^\]]+\]\s*/, '')
        : 'No se pudo cambiar el modo de stock.';
      showToast(text, 'error');
    } finally {
      setRolloutBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Titulares de mercadería</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Indicá a quién pertenece la mercadería de cada producto. Las ventas y las finanzas permanecen unificadas en esta cuenta.
        </p>
      </div>

      <section className={`rounded-2xl border p-4 transition-colors ${
        holdingsEnabled
          ? 'border-indigo-200 bg-indigo-50/60 dark:border-indigo-900/70 dark:bg-indigo-950/20'
          : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40'
      }`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 rounded-xl p-2 ${
              holdingsEnabled
                ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300'
                : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
            }`}>
              <Sparkles size={20} />
            </div>
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white">Stock compartido por titular</h4>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {holdingsEnabled
                  ? 'Cada venta atribuye unidades a un titular y registra cuánto ganó cada uno.'
                  : 'Activá esta opción para repartir el stock entre titulares y registrar la ganancia por venta.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:flex-col sm:items-end">
            <button
              type="button"
              role="switch"
              aria-checked={holdingsEnabled}
              aria-label="Activar stock compartido por titular"
              onClick={() => void handleToggleRollout()}
              disabled={!canManage || rolloutBusy}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                holdingsEnabled
                  ? 'border-indigo-600 bg-indigo-600'
                  : 'border-slate-300 bg-slate-200 dark:border-slate-600 dark:bg-slate-700'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  holdingsEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className={`text-xs font-bold uppercase tracking-wide ${
              holdingsEnabled
                ? 'text-indigo-700 dark:text-indigo-300'
                : 'text-slate-500 dark:text-slate-400'
            }`}>
              {holdingsEnabled ? 'Activado' : 'Desactivado'}
            </span>
          </div>
        </div>
        {!canManage && (
          <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
            Tu rol no permite activar ni desactivar el modo compartido.
          </p>
        )}
      </section>

      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${message.error
          ? 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300'
          : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'}`}
        >
          {message.text}
        </div>
      )}

      <MovementHistoryPanel />

      <form onSubmit={handleCreate} className="flex flex-col gap-2 sm:flex-row">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          maxLength={80}
          disabled={!canManage || busy}
          placeholder="Nombre del titular"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />
        <button
          type="submit"
          disabled={!canManage || busy || !newName.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 font-bold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
        >
          <Plus size={18} /> Agregar titular
        </button>
      </form>

      {!canManage && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Podés ver los titulares, pero tu rol no permite administrarlos.
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
        {loading ? (
          <p className="p-5 text-sm text-slate-500">Cargando titulares...</p>
        ) : owners.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No se encontraron titulares.</p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {owners.map((owner) => {
              const activeIndex = activeOwners.findIndex((item) => item.id === owner.id);
              const editing = editingId === owner.id;
              return (
                <li key={owner.id} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center ${owner.archivedAt ? 'bg-slate-50 opacity-70 dark:bg-slate-800/30' : ''}`}>
                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void handleRename(owner);
                          if (event.key === 'Escape') setEditingId(null);
                        }}
                        maxLength={80}
                        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-white">{owner.name}</span>
                        {owner.isPrimary && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold uppercase text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                            <ShieldCheck size={12} /> Principal predeterminado
                          </span>
                        )}
                        {owner.archivedAt && (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                            Archivado
                          </span>
                        )}
                      </div>
                    )}
                    <p className="mt-1 text-xs text-slate-400">
                      {owner.archivedAt ? 'Se conserva para las etiquetas históricas de los productos' : `Prioridad ${activeIndex + 1}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 self-end sm:self-auto">
                    {editing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleRename(owner)}
                          disabled={busy || !editingName.trim()}
                          aria-label="Guardar nombre"
                          className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 dark:hover:bg-emerald-900/20"
                        >
                          <Check size={17} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          aria-label="Cancelar edición"
                          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <X size={17} />
                        </button>
                      </>
                    ) : (
                      <>
                        {!owner.archivedAt && (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleMove(owner.id, -1)}
                              disabled={!canManage || busy || activeIndex <= 0}
                              aria-label={`Subir a ${owner.name}`}
                              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                            >
                              <ArrowUp size={17} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleMove(owner.id, 1)}
                              disabled={!canManage || busy || activeIndex === activeOwners.length - 1}
                              aria-label={`Bajar a ${owner.name}`}
                              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                            >
                              <ArrowDown size={17} />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(owner.id);
                            setEditingName(owner.name);
                          }}
                          disabled={!canManage || busy}
                          aria-label={`Renombrar a ${owner.name}`}
                          className="rounded-lg p-2 text-indigo-600 hover:bg-indigo-50 disabled:opacity-30 dark:hover:bg-indigo-900/20"
                        >
                          <Edit2 size={17} />
                        </button>
                        {!owner.isPrimary && !owner.archivedAt && (
                          <button
                            type="button"
                            onClick={() => void handleArchive(owner)}
                            disabled={!canManage || busy}
                            aria-label={`Archivar a ${owner.name}`}
                            className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-30 dark:hover:bg-rose-900/20"
                          >
                            <Archive size={17} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
