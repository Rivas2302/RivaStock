import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Clock3, Copy, Package, RefreshCw, Share2, Truck, XCircle } from 'lucide-react';
import { supabase } from '../lib/db';
import { formatCurrency } from '../lib/utils';
import { copyTextToClipboard } from '../lib/clipboard';

interface PublicOrderTracking {
  order_code: string;
  status: 'Nuevo' | 'En Proceso' | 'Entregado' | 'Cancelado';
  customer_name: string;
  items: Array<Record<string, unknown>>;
  total: number | string;
  delivery_method: 'pickup' | 'shipping';
  customer_address: string;
  shipping_amount: number | string | null;
  created_at: string;
  business_name: string | null;
  logo_url: string | null;
  whatsapp_number: string | null;
}

function formatOrderDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function orderStatusCopy(status: PublicOrderTracking['status']) {
  switch (status) {
    case 'Entregado': return { label: 'Entregado', detail: 'Tu pedido fue entregado.', icon: CheckCircle2 };
    case 'En Proceso': return { label: 'En preparación', detail: 'Estamos preparando tu pedido.', icon: Package };
    case 'Cancelado': return { label: 'Cancelado', detail: 'Este pedido fue cancelado. Contactanos si necesitás más información.', icon: XCircle };
    default: return { label: 'Recibido', detail: 'Recibimos tu pedido. Te avisaremos cuando avance.', icon: Clock3 };
  }
}

export default function OrderStatusPublic() {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<PublicOrderTracking | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [linkActionMessage, setLinkActionMessage] = useState('');

  const refresh = useCallback(async (initial = false) => {
    if (!orderId) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const { data, error: rpcError } = await supabase
        .rpc('get_public_order_tracking', { p_order_id: orderId })
        .maybeSingle();
      if (rpcError) throw rpcError;
      if (!data) {
        setNotFound(true);
        setOrder(null);
        return;
      }
      setOrder(data as unknown as PublicOrderTracking);
      setNotFound(false);
      setError(null);
    } catch {
      setError('No pudimos actualizar el seguimiento. Revisá tu conexión e intentá de nuevo.');
    } finally {
      if (initial) setLoading(false);
      setRefreshing(false);
    }
  }, [orderId]);

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const copyTrackingLink = async () => {
    const copied = await copyTextToClipboard(window.location.href);
    setLinkActionMessage(copied
      ? 'Enlace copiado. Guardalo en tus notas o enviátelo por WhatsApp.'
      : 'No se pudo copiar el enlace. Usá Compartir para guardarlo.');
  };

  const shareTrackingLink = async () => {
    const shareData = {
      title: `Seguimiento del pedido ${order?.order_code ?? ''}`.trim(),
      text: `Guardá este enlace para consultar el estado de tu pedido ${order?.order_code ?? ''}.`,
      url: window.location.href,
    };
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
        return;
      } catch (shareError) {
        if (shareError instanceof Error && shareError.name === 'AbortError') return;
      }
    }
    await copyTrackingLink();
  };

  const items = useMemo(() => (Array.isArray(order?.items) ? order.items : []).map((item, index) => {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const unitPrice = Number(item.price ?? item.unitPrice ?? 0) || 0;
    return {
      key: `${String(item.productId ?? item.product_id ?? index)}-${index}`,
      name: String(item.productName ?? item.product_name ?? item.name ?? 'Producto'),
      quantity,
      unitPrice,
      total: Number(item.lineTotal ?? item.line_total ?? (quantity * unitPrice)) || 0,
    };
  }), [order?.items]);

  if (loading) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-slate-950 px-4 text-white">
        <div className="flex items-center gap-3 text-sm font-semibold text-slate-300"><RefreshCw size={18} className="animate-spin" />Cargando el estado de tu pedido…</div>
      </main>
    );
  }

  if (notFound || !order) {
    const failedToLoad = !notFound && Boolean(error);
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-slate-950 px-4 py-10 text-white">
        <section className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-7 text-center shadow-2xl">
          <Package size={34} className="mx-auto text-emerald-400" />
          <h1 className="mt-4 text-2xl font-black">{failedToLoad ? 'No pudimos cargar el seguimiento' : 'No encontramos este pedido'}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">{failedToLoad ? error : 'Revisá que el enlace esté completo o pedile al negocio que te lo vuelva a enviar.'}</p>
          {failedToLoad && <button type="button" onClick={() => void refresh(true)} className="mt-5 min-h-11 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-slate-950">Intentar de nuevo</button>}
        </section>
      </main>
    );
  }

  const status = orderStatusCopy(order.status);
  const StatusIcon = status.icon;
  const statusTone = order.status === 'Cancelado'
    ? 'border-rose-300/20 bg-rose-300/10 text-rose-200'
    : order.status === 'Entregado'
      ? 'border-sky-300/20 bg-sky-300/10 text-sky-200'
      : 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200';
  const businessName = order.business_name?.trim() || 'RivaTech';
  const deliveryMethod = order.delivery_method === 'shipping' ? 'Envío' : 'Retiro';
  const address = order.delivery_method === 'shipping' ? order.customer_address?.trim() : '';
  const shippingAmount = Number(order.shipping_amount) || 0;
  const whatsapp = order.whatsapp_number?.replace(/\D/g, '') ?? '';
  const whatsappText = encodeURIComponent(`Hola, consulto por mi pedido ${order.order_code}.`);

  return (
    <main className="min-h-[100dvh] bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,.16),_transparent_45%),#090d12] px-4 py-8 text-white sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-7 flex items-center justify-center gap-3">
          {order.logo_url
            ? <img src={order.logo_url} alt={businessName} className="h-11 w-11 rounded-xl object-contain" />
            : <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-400 text-lg font-black text-slate-950">{businessName.slice(0, 1).toUpperCase()}</span>}
          <div>
            <p className="text-lg font-black tracking-tight">{businessName}</p>
            <p className="text-xs font-medium text-slate-400">Seguimiento de compra</p>
          </div>
        </header>

        <section className="overflow-hidden rounded-3xl border border-white/10 bg-slate-900/90 shadow-[0_28px_80px_rgba(0,0,0,.4)]">
          <div className="border-b border-white/10 px-5 py-6 sm:px-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-300">Estado de mi pedido</p>
                <h1 className="mt-2 text-2xl font-black sm:text-3xl">{order.order_code}</h1>
                <p className="mt-1 text-sm text-slate-400">{order.customer_name ? `Hola, ${order.customer_name}` : 'Gracias por tu compra'}{order.created_at ? ` · ${formatOrderDate(order.created_at)}` : ''}</p>
              </div>
              <div className={`inline-flex items-center gap-2 self-start rounded-full border px-4 py-2 text-sm font-bold sm:self-auto ${statusTone}`}>
                <StatusIcon size={17} aria-hidden="true" />{status.label}
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-300">{status.detail}</p>
          </div>

          <div className="space-y-6 px-5 py-6 sm:px-8">
            <section aria-labelledby="tracking-products">
              <h2 id="tracking-products" className="text-xs font-bold uppercase tracking-[.16em] text-slate-400">Productos</h2>
              <ul className="mt-3 divide-y divide-white/10">
                {items.map(item => (
                  <li key={item.key} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold text-white">{item.name}</p>
                      <p className="mt-1 text-xs text-slate-400">{item.quantity} {item.quantity === 1 ? 'unidad' : 'unidades'} · {formatCurrency(item.unitPrice)} c/u</p>
                    </div>
                    <span className="shrink-0 text-sm font-bold text-slate-200">{formatCurrency(item.total)}</span>
                  </li>
                ))}
                {shippingAmount > 0 && <li className="flex items-center justify-between gap-4 py-3 text-sm"><span className="text-slate-300">Envío</span><span className="font-semibold text-slate-200">{formatCurrency(shippingAmount)}</span></li>}
              </ul>
              <div className="mt-2 flex items-end justify-between border-t border-white/10 pt-4">
                <span className="text-sm font-semibold text-slate-300">Total del pedido</span>
                <strong className="text-2xl font-black tracking-tight text-emerald-300">{formatCurrency(Number(order.total) || 0)}</strong>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[.035] p-4 sm:p-5">
              <h2 className="text-xs font-bold uppercase tracking-[.16em] text-slate-400">Entrega</h2>
              <div className="mt-3 flex items-start gap-3">
                {order.delivery_method === 'shipping' ? <Truck size={19} className="mt-0.5 shrink-0 text-emerald-300" /> : <Package size={19} className="mt-0.5 shrink-0 text-emerald-300" />}
                <div>
                  <p className="font-bold text-white">{deliveryMethod}</p>
                  {address && <p className="mt-1 break-words text-sm leading-5 text-slate-300">{address}</p>}
                </div>
              </div>
            </section>

            {error && <p role="status" className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{error}</p>}

            <div className="flex flex-col gap-3 sm:flex-row">
              {whatsapp
                ? <a href={`https://wa.me/${whatsapp}?text=${whatsappText}`} target="_blank" rel="noreferrer" className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-400">Contactar por WhatsApp</a>
                : <span className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl border border-white/10 px-4 py-3 text-center text-sm font-semibold text-slate-400">WhatsApp no está disponible para este negocio</span>}
              <button type="button" onClick={() => void refresh(false)} disabled={refreshing} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm font-bold text-slate-200 transition hover:bg-white/5 disabled:opacity-60">
                <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />Actualizar estado
              </button>
            </div>
          </div>
        </section>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => void copyTrackingLink()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/15 bg-slate-900 px-4 text-sm font-bold text-slate-100 transition hover:bg-white/5"><Copy size={17}/>{linkActionMessage.startsWith('Enlace copiado') ? 'Enlace copiado' : 'Copiar enlace'}</button>
          <button type="button" onClick={() => void shareTrackingLink()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-black text-slate-950 transition hover:bg-emerald-400"><Share2 size={17}/>Compartir o guardar</button>
        </div>
        <p role="status" aria-live="polite" className="mt-3 min-h-5 text-center text-xs text-slate-400">{linkActionMessage || 'Este enlace es privado. Copialo o compartilo para volver a consultar el avance de tu pedido.'}</p>
      </div>
    </main>
  );
}
