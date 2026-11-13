import { useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { getLazyChunkStatus, subscribeLazyChunkStatus } from '../lib/lazyWithRetry';
import { reloadCurrentPage } from '../lib/buildRuntime';
import { showToast } from '../lib/toast';

export default function ChunkRecoveryNotice() {
  const status = useSyncExternalStore(subscribeLazyChunkStatus, getLazyChunkStatus, getLazyChunkStatus);
  const [reloadBlocked, setReloadBlocked] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (status?.state !== 'offline' || status.moduleId !== 'src/components/stock/MobileProductDetail.tsx') return;
    if (window.location.pathname !== '/stock' || !new URLSearchParams(window.location.search).has('producto')) return;
    const historyState = window.history.state?.usr as { productJustSaved?: boolean } | undefined;
    if (!historyState?.productJustSaved) return;
    navigate('/stock', { replace: true, state: {} });
    showToast('Producto guardado. No pudimos abrir el detalle; el producto sigue en Stock.', 'success');
  }, [navigate, status]);

  if (!status) return null;

  const message = status.state === 'offline'
    ? 'Sin conexión. Reintentando…'
    : status.state === 'update'
      ? 'Hay una versión nueva — Actualizar'
      : 'Cargando una parte de la app…';

  return (
    <div role="status" aria-live="polite" className="fixed left-1/2 top-[max(.75rem,env(safe-area-inset-top))] z-[200] flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-xs font-semibold text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100">
      <span>{message}</span>
      {status.state === 'update' && <button type="button" className="font-bold text-indigo-700 underline dark:text-indigo-300" onClick={() => {
        if (!reloadCurrentPage()) setReloadBlocked(true);
      }}>Actualizar</button>}
      {status.state === 'offline' && <button type="button" className="font-bold underline" onClick={() => window.dispatchEvent(new Event('online'))}>Reintentar</button>}
      {reloadBlocked && <span className="text-[10px]">Guardá o cerrá el formulario antes de actualizar.</span>}
    </div>
  );
}
