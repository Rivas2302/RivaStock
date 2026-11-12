import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, RefreshCw, Send, X } from 'lucide-react';
import { useAuth } from '../../AuthContext';
import { usePermission } from '../../hooks/usePermission';
import { db } from '../../lib/db';
import { cancelAIAction, listPendingAIActions, listPendingAIChatActionRequests, type AIActionRequest, type AIChatActionRequest } from '../../lib/aiActions';
import type { Product } from '../../types';
import { startVisiblePolling } from '../../lib/visiblePolling';
import AIChatActionProposalCard from './AIChatActionProposalCard';

const FacebookPublicationModal = lazy(() => import('../FacebookPublicationModal'));

interface ActiveReview {
  request: AIActionRequest;
  product: Product;
}

export default function AIActionInbox() {
  const { isOwner } = useAuth();
  const canPublish = usePermission('stock', 'write');
  const [requests, setRequests] = useState<AIActionRequest[]>([]);
  const [chatRequests, setChatRequests] = useState<AIChatActionRequest[]>([]);
  const [review, setReview] = useState<ActiveReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [facebookRequests, pendingChatRequests] = await Promise.all([
        listPendingAIActions(), listPendingAIChatActionRequests(),
      ]);
      setRequests(facebookRequests);
      setChatRequests(pendingChatRequests);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron actualizar las acciones pendientes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOwner) {
      setLoading(false);
      return;
    }
    void refresh();
    return startVisiblePolling(() => refresh(), 30_000);
  }, [isOwner, refresh]);

  async function openReview(request: AIActionRequest) {
    setBusyId(request.id);
    setError('');
    setNotice('');
    try {
      const product = await db.get<Product>('products', request.params.product_id);
      if (!product) throw new Error('El producto de esta solicitud ya no está disponible.');
      setReview({ request, product });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo abrir la solicitud.');
    } finally {
      setBusyId(null);
    }
  }

  async function discard(request: AIActionRequest) {
    if (busyId) return;
    setBusyId(request.id);
    setError('');
    setNotice('');
    try {
      await cancelAIAction(request.id);
      setRequests(current => current.filter(item => item.id !== request.id));
      if (review?.request.id === request.id) setReview(null);
      setNotice('La solicitud quedó descartada.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo descartar la solicitud.');
    } finally {
      setBusyId(null);
    }
  }

  if (!isOwner) return null;

  return <section aria-label="Acciones de IA pendientes" className="space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/20 sm:p-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300"><CheckCircle2 size={15}/>Revisión del dueño</p>
        <h3 className="mt-1 text-lg font-bold">Acciones pendientes{requests.length + chatRequests.length ? ` · ${requests.length + chatRequests.length}` : ''}</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Revisá y confirmá cada propuesta antes de que se aplique. Las publicaciones de Facebook siguen su revisión habitual.</p>
      </div>
      <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-indigo-300 px-3 py-2 text-xs font-semibold disabled:opacity-50 dark:border-indigo-800"><RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>Actualizar</button>
    </header>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">{notice}</p>}
    {loading ? <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin"/>Cargando solicitudes…</p>
        : requests.length === 0 && chatRequests.length === 0 ? <p className="rounded-xl border border-dashed border-indigo-300 p-4 text-sm text-slate-600 dark:border-indigo-800 dark:text-slate-300">No hay acciones pendientes de revisión.</p>
        : <ul className="space-y-3">{requests.map(request => <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-white p-3 dark:border-indigo-900 dark:bg-slate-900">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold"><Send size={15} className="shrink-0 text-indigo-500"/>Preparar publicación de producto</p>
            <p className="mt-1 text-xs text-slate-500">Origen: {request.source} · {new Date(request.created_at).toLocaleString('es-AR')}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300"><Clock3 size={13}/>Pendiente de tu revisión y confirmación</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!canPublish || busyId !== null} onClick={() => void openReview(request)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{busyId === request.id ? 'Abriendo…' : 'Revisar borrador'}</button>
            <button type="button" disabled={busyId !== null} onClick={() => void discard(request)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50 dark:border-slate-700"><X size={14}/>Descartar</button>
          </div>
        </li>)}{chatRequests.map(request => <li key={request.id} className="rounded-xl border border-indigo-200 bg-white p-3 dark:border-indigo-900 dark:bg-slate-900"><AIChatActionProposalCard request={request} onChanged={() => void refresh()}/></li>)}</ul>}
    {review && <Suspense fallback={<p role="status" className="text-sm text-slate-500">Cargando revisión…</p>}><FacebookPublicationModal
      key={`${review.product.id}:${review.request.id}`}
      product={review.product}
      actionRequest={review.request}
      onClose={() => { setReview(null); void refresh(); }}
      onApproved={() => { setReview(null); setNotice('Acción confirmada. El envío quedó sujeto a los controles y al estado de la cola de Facebook.'); void refresh(); }}
    /></Suspense>}
  </section>;
}
