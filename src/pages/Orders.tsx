import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { usePagination } from '../hooks/usePagination';
import Pagination from '../components/Pagination';
import { useAuth } from '../AuthContext';
import { usePermission } from '../hooks/usePermission';
import { db, callRpc } from '../lib/db';
import { Order, Sale } from '../types';
import { formatCurrency, cn, roundPrice, formatDate, todayString } from '../lib/utils';
import { copyTextToClipboard } from '../lib/clipboard';
import { getPublicOrderTrackingUrl } from '../lib/orderTracking';
import { 
  ClipboardList, 
  MessageCircle, 
  Mail, 
  MapPin, 
  User, 
  Phone,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  Filter,
  ChevronDown,
  Trash2,
  Search,
  Copy,
  Link2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useParams } from 'react-router-dom';
import '../styles/business-redesign.css';

function getOrderDeliveryMethod(order: Order): 'pickup' | 'shipping' {
  return order.deliveryMethod === 'shipping' || (!order.deliveryMethod && Boolean(order.customerAddress?.trim()))
    ? 'shipping'
    : 'pickup';
}

function getOrderStatusLabel(status: Order['status']): string {
  switch (status) {
    case 'En Proceso': return 'En preparación';
    case 'Entregado': return 'Entregado';
    case 'Cancelado': return 'Cancelado';
    default: return 'Recibido';
  }
}

function buildOrderTrackingMessage(order: Order, trackingUrl: string): string {
  const customerName = order.customerName?.trim();
  const orderCode = order.orderCode?.trim() || 'del catálogo';
  const delivery = getOrderDeliveryMethod(order) === 'shipping' ? 'Envío' : 'Retiro';
  return [
    `Hola${customerName ? ` ${customerName}` : ''}! Te comparto el seguimiento de tu pedido ${orderCode}.`,
    `Estado actual: ${getOrderStatusLabel(order.status)}.`,
    `Total: ${formatCurrency(roundPrice(order.total))} · Entrega: ${delivery}.`,
    'Podés consultar el detalle y los cambios desde este enlace:',
    trackingUrl,
    'Guardalo para volver a consultar el estado cuando quieras.',
  ].join('\n');
}

export default function Orders() {
  const { user, refetchToken } = useAuth();
  const canWrite = usePermission('pedidos', 'write');
  const canDelete = usePermission('pedidos', 'delete');
  const navigate = useNavigate();
  const { codigo } = useParams<{ codigo?: string }>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [orderPendingDelete, setOrderPendingDelete] = useState<Order | null>(null);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const [deleteOrderError, setDeleteOrderError] = useState<string | null>(null);
  const [orderToConvert, setOrderToConvert] = useState<Order | null>(null);
  const [conversionStatus, setConversionStatus] = useState<'' | 'Pagado' | 'Pendiente'>('');
  const [conversionPaymentMethod, setConversionPaymentMethod] = useState<'' | 'Efectivo' | 'Transferencia' | 'Débito' | 'Crédito' | 'Otro'>('');
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [copyFeedback, setCopyFeedback] = useState<{ key: string; token: number; message: string } | null>(null);
  const readReceiptIds = useRef(new Set<string>());
  const deferredStatusFilter = useDeferredValue(statusFilter);

  const copyOrderContent = async (order: Order, kind: 'message' | 'link') => {
    const trackingUrl = getPublicOrderTrackingUrl(order.id);
    const value = kind === 'message' ? buildOrderTrackingMessage(order, trackingUrl) : trackingUrl;
    const copied = await copyTextToClipboard(value);
    const token = Date.now();
    const key = `${order.id}:${kind}`;
    setCopyFeedback({ key, token, message: copied ? 'Copiado' : 'No se pudo copiar' });
    window.setTimeout(() => setCopyFeedback(current => current?.token === token ? null : current), 2500);
  };

  const fetchData = async () => {
    if (!user) return;
    try {
      const o = await db.list<Order>('orders', user.uid);
      setOrders(o.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    } catch (err) {
      console.error('[Orders] fetchData error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const o = await db.list<Order>('orders', user.uid);
        if (cancelled) return;
        setOrders(o.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      } catch (err) {
        if (cancelled) return;
        console.error('[Orders] fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, refetchToken]);

  useEffect(() => {
    if (!codigo || !canWrite) return;
    const matchingOrder = orders.find(order => order.orderCode?.toLocaleLowerCase('es-AR') === codigo.trim().toLocaleLowerCase('es-AR'));
    if (!matchingOrder || matchingOrder.isRead || readReceiptIds.current.has(matchingOrder.id)) return;
    readReceiptIds.current.add(matchingOrder.id);
    setOrders(current => current.map(order => order.id === matchingOrder.id ? { ...order, isRead: true } : order));
    void Promise.resolve().then(() => db.update<Order>('orders', matchingOrder.id, { isRead: true })).catch(() => {
      setOrders(current => current.map(order => order.id === matchingOrder.id ? { ...order, isRead: false } : order));
    });
  }, [canWrite, codigo, orders]);

  const updateOrderStatus = async (id: string, status: Order['status']) => {
    await db.update<Order>('orders', id, { status, isRead: true });
    fetchData();
  };

  const handleDeleteOrder = async () => {
    if (!orderPendingDelete || !canDelete || deletingOrder) return;
    setDeletingOrder(true);
    setDeleteOrderError(null);
    try {
      await db.delete('orders', orderPendingDelete.id);
      setOrders(current => current.filter(order => order.id !== orderPendingDelete.id));
      setOrderPendingDelete(null);
    } catch {
      setDeleteOrderError('No se pudo eliminar el pedido. Revisá tu conexión e intentá de nuevo.');
    } finally {
      setDeletingOrder(false);
    }
  };

  const openOrderConversion = (order: Order) => {
    setOrderToConvert(order);
    setConversionStatus('');
    setConversionPaymentMethod('');
    setConversionError(null);
  };

  const handleConvertToSale = async () => {
    const order = orderToConvert;
    if (!order || !user || !canWrite || !conversionStatus
      || (conversionStatus === 'Pagado' && !conversionPaymentMethod) || converting) return;
    setConverting(true);
    setConversionError(null);
    try {
      const result = await callRpc<Sale[]>('convert_catalog_order_to_sale', {
        p_order_id: order.id,
        p_status: conversionStatus,
        p_payment_method: conversionStatus === 'Pagado' ? conversionPaymentMethod : null,
        p_date: todayString(),
      });
      const sale = Array.isArray(result) ? result[0] : result;
      if (!sale?.id) throw new Error('La base no devolvió el ticket de venta.');
      setOrders(current => current.map(item => item.id === order.id
        ? { ...item, convertedSaleId: sale.id, isRead: true }
        : item));
      setOrderToConvert(null);
      navigate(`/ventas?sale=${encodeURIComponent(sale.id)}`);
      void fetchData();
    } catch (error) {
      setConversionError(error instanceof Error ? error.message : 'No se pudo convertir el pedido.');
    } finally {
      setConverting(false);
    }
  };

  const filteredOrders = useMemo(
    () => {
      const routeCode = codigo?.trim().toLocaleLowerCase('es-AR') ?? '';
      const query = searchTerm.trim().toLocaleLowerCase('es-AR');
      return orders.filter(order => {
        const matchesStatus = deferredStatusFilter === 'all' || order.status === deferredStatusFilter;
        const searchableText = `${order.orderCode ?? ''} ${order.customerName} ${order.customerPhone}`.toLocaleLowerCase('es-AR');
        const matchesRoute = !routeCode || order.orderCode?.toLocaleLowerCase('es-AR') === routeCode;
        return matchesStatus && matchesRoute && (!query || searchableText.includes(query));
      });
    },
    [codigo, deferredStatusFilter, orders, searchTerm],
  );
  const pagination = usePagination(filteredOrders);

  return (
    <div className="business-page operational-page space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Pedidos del Catálogo</h2>
          <p className="text-slate-500 dark:text-slate-400">Gestiona las órdenes recibidas desde tu catálogo público</p>
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white appearance-none min-w-[200px]"
          >
            <option value="all">Todos los estados</option>
            <option value="Nuevo">Nuevos</option>
            <option value="En Proceso">En Proceso</option>
            <option value="Entregado">Entregados</option>
            <option value="Cancelado">Cancelados</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
        </div>
      </div>

      <label className="flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-[var(--ink-muted)]"><Search size={18}/><input aria-label="Buscar pedidos por código, nombre o WhatsApp" value={searchTerm} onChange={event=>setSearchTerm(event.target.value)} placeholder="Buscar por código, nombre o WhatsApp" className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"/></label>

      <div className="grid grid-cols-1 gap-4">
        {Array.isArray(filteredOrders) && filteredOrders.length > 0 ? pagination.rows.map((order) => (
          <motion.div
            key={order.id}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "bg-white dark:bg-slate-900 rounded-2xl border p-6 shadow-sm transition-all",
              !order.isRead ? "border-indigo-500 ring-1 ring-indigo-500/20" : "border-slate-200 dark:border-slate-800"
            )}
          >
            <div className="flex flex-col lg:flex-row gap-8">
              {/* Customer Info */}
              <div className="flex-1 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">{order.customerName}</h3>
                    {order.orderCode && <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-bold text-[var(--ink)]" data-testid="order-code">{order.orderCode}</span>}
                    <span data-testid="order-delivery-method" className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-300">{getOrderDeliveryMethod(order) === 'shipping' ? 'Envío' : 'Retiro'}</span>
                    {!order.isRead && (
                      <span className="bg-indigo-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded uppercase">Nuevo</span>
                    )}
                    {order.channel === 'reseller' && (
                      <span className="bg-amber-100 text-amber-800 text-[10px] font-black px-2 py-0.5 rounded uppercase">Revendedor</span>
                    )}
                    {order.orderOrigin === 'super_offer' && (
                      <span className="bg-rose-100 text-rose-800 text-[10px] font-black px-2 py-0.5 rounded uppercase">Súper oferta</span>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 font-medium">{formatDate(order.date.split('T')[0])}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <Phone size={16} className="text-indigo-500" />
                    <span>{order.customerPhone}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <Mail size={16} className="text-indigo-500" />
                    <span>{order.customerEmail}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 sm:col-span-2">
                    <MapPin size={16} className="text-indigo-500" />
                    <span>{getOrderDeliveryMethod(order) === 'shipping'
                      ? <>Envío{order.customerAddress?.trim() ? ` · ${order.customerAddress.trim()}` : ''}</>
                      : 'Retiro'}</span>
                  </div>
                </div>

                {order.customerMessage && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700 italic text-sm text-slate-600 dark:text-slate-400">
                    "{order.customerMessage}"
                  </div>
                )}
              </div>

              {/* Order Items */}
              <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 border border-slate-100 dark:border-slate-700">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Productos Solicitados</h4>
                <div className="space-y-2">
                  {order.items.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700 dark:text-slate-300">
                        <span className="font-bold text-indigo-600 dark:text-indigo-400">x{item.quantity}</span> {item.productName}
                      </span>
                      <span className="font-medium dark:text-white">{formatCurrency(roundPrice(item.price) * item.quantity)}</span>
                    </div>
                  ))}
                </div>
                {order.orderOrigin === 'super_offer' && <div className="mt-4 flex items-center justify-between text-sm text-slate-600 dark:text-slate-300"><span>Envío (por pedido)</span><span>{formatCurrency(roundPrice(order.shippingAmount ?? 0))}</span></div>}
                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <span className="font-bold text-slate-900 dark:text-white">Total del Pedido:</span>
                  <span className="text-xl font-black text-indigo-600 dark:text-indigo-400">{formatCurrency(roundPrice(order.total))}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-3 min-w-[200px]">
                <div className="relative">
                  <select
                    value={order.status}
                    onChange={(e) => updateOrderStatus(order.id, e.target.value as Order['status'])}
                    disabled={!canWrite}
                    data-testid="order-status-select"
                    className={cn(
                      "w-full appearance-none rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] py-2 pl-4 pr-10 text-sm font-bold text-[var(--ink)] [color-scheme:light] transition-all dark:[color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-50",
                    )}
                  >
                    <option className="bg-[var(--surface-raised)] text-[var(--ink)]" value="Nuevo">Nuevo</option>
                    <option className="bg-[var(--surface-raised)] text-[var(--ink)]" value="En Proceso">En Proceso</option>
                    {order.status === 'Entregado' && <option className="bg-[var(--surface-raised)] text-[var(--ink)]" value="Entregado" disabled>Entregado</option>}
                    <option className="bg-[var(--surface-raised)] text-[var(--ink)]" value="Cancelado">Cancelado</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" size={16} />
                </div>

                {order.convertedSaleId
                  ? <button
                      type="button"
                      onClick={() => navigate(`/ventas?sale=${encodeURIComponent(order.convertedSaleId ?? '')}`)}
                      title={`Ticket ${order.convertedSaleId.slice(0, 8).toUpperCase()}`}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors"
                    >
                      <CheckCircle2 size={18} />
                      Ver venta
                    </button>
                  : <button
                      type="button"
                      onClick={() => openOrderConversion(order)}
                      disabled={!canWrite || order.status === 'Cancelado'}
                      title={!canWrite ? 'Sin permiso' : order.status === 'Cancelado' ? 'No se puede convertir un pedido cancelado' : undefined}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ArrowRight size={18} />
                      Convertir en venta
                    </button>}

                {order.status !== 'Entregado' && order.status !== 'Cancelado' && (
                  <button
                    type="button"
                    onClick={() => void updateOrderStatus(order.id, 'Entregado')}
                    disabled={!canWrite}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/35"
                  >
                    <CheckCircle2 size={16} />
                    Marcar como entregado
                  </button>
                )}

                {canDelete && <button
                  type="button"
                  onClick={() => { setDeleteOrderError(null); setOrderPendingDelete(order); }}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] px-3 py-2 text-sm font-bold text-[var(--danger-ink)] transition-colors hover:brightness-95"
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Eliminar pedido
                </button>}

                {(() => {
                  const trackingUrl = getPublicOrderTrackingUrl(order.id);
                  const trackingMessage = buildOrderTrackingMessage(order, trackingUrl);
                  const phone = order.customerPhone.replace(/\D/g, '');
                  const feedback = copyFeedback?.key.startsWith(`${order.id}:`) ? copyFeedback.message : '';
                  return (
                    <div className="space-y-2">
                      <div className="grid grid-cols-[minmax(0,1fr)_3rem] gap-2">
                        {phone
                          ? <a href={`https://wa.me/${phone}?text=${encodeURIComponent(trackingMessage)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-2 text-xs font-bold text-white transition-colors hover:bg-emerald-600"><MessageCircle size={17} />Enviar seguimiento</a>
                          : <button type="button" disabled className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500/40 px-2 text-xs font-bold text-white/70"><MessageCircle size={17} />Sin WhatsApp</button>}
                        {order.customerEmail?.trim()
                          ? <a href={`mailto:${order.customerEmail}?subject=${encodeURIComponent(`Seguimiento del pedido ${order.orderCode ?? ''}`)}&body=${encodeURIComponent(trackingMessage)}`} aria-label="Enviar seguimiento por correo" title="Enviar por correo" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-500 text-white transition-colors hover:bg-blue-600"><Mail size={18} /></a>
                          : <button type="button" disabled aria-label="Correo no disponible" title="Correo no disponible" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-500/40 text-white/70"><Mail size={18} /></button>}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => void copyOrderContent(order, 'message')} aria-label="Copiar mensaje de seguimiento" className="inline-flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-1 text-[11px] font-semibold leading-4 text-[var(--ink)] transition-colors hover:bg-[var(--surface-muted)]"><Copy size={15} />{copyFeedback?.key === `${order.id}:message` ? feedback : 'Copiar mensaje'}</button>
                        <button type="button" onClick={() => void copyOrderContent(order, 'link')} aria-label="Copiar enlace de seguimiento" className="inline-flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-1 text-[11px] font-semibold leading-4 text-[var(--ink)] transition-colors hover:bg-[var(--surface-muted)]"><Link2 size={15} />{copyFeedback?.key === `${order.id}:link` ? feedback : 'Copiar enlace'}</button>
                      </div>
                      {feedback && <p role="status" aria-live="polite" className="text-center text-xs text-[var(--ink-muted)]">{feedback}</p>}
                    </div>
                  );
                })()}
              </div>
            </div>
          </motion.div>
        )) : (
          <div className="text-center py-20 bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800">
            <ClipboardList size={48} className="mx-auto text-slate-300 dark:text-slate-700 mb-4" />
            <p className="text-slate-500 dark:text-slate-400 font-medium">Todavía no hay pedidos recibidos desde tu catálogo.</p>
          </div>
        )}
      </div>
      <Pagination {...pagination} />
      {orderToConvert && <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4">
        <section role="dialog" aria-modal="true" aria-labelledby="convert-catalog-order-title" className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-[var(--line)] bg-[var(--surface)] p-5 text-[var(--ink)] shadow-2xl sm:rounded-3xl sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-indigo-500">{orderToConvert.orderCode ?? 'Pedido del catálogo'}</p>
              <h2 id="convert-catalog-order-title" className="mt-1 text-xl font-black">Convertir pedido en venta</h2>
            </div>
            <button type="button" onClick={() => setOrderToConvert(null)} disabled={converting} className="min-h-10 rounded-lg border border-[var(--line)] px-3 text-sm font-semibold disabled:opacity-50">Cerrar</button>
          </div>

          <div className="mt-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div><p className="font-bold">{orderToConvert.customerName}</p><p className="mt-1 text-xs text-[var(--ink-subtle)]">{orderToConvert.items.length} productos · {getOrderDeliveryMethod(orderToConvert) === 'shipping' ? 'Envío' : 'Retiro'}</p></div>
              <strong className="shrink-0 text-lg font-black text-indigo-600 dark:text-indigo-300">{formatCurrency(roundPrice(orderToConvert.total))}</strong>
            </div>
            <ul className="mt-3 space-y-1.5 border-t border-[var(--line)] pt-3 text-sm">
              {orderToConvert.items.map((item, index) => <li key={`${item.productId}-${index}`} className="flex justify-between gap-3">
                <span className="min-w-0 break-words"><span className="font-bold">×{item.quantity}</span> {item.productName}</span>
                <span className="shrink-0 font-semibold">{formatCurrency(roundPrice(item.price) * item.quantity)}</span>
              </li>)}
            </ul>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              Estado del cobro
              <select value={conversionStatus} onChange={event => {
                const value = event.target.value as '' | 'Pagado' | 'Pendiente';
                setConversionStatus(value);
                if (value !== 'Pagado') setConversionPaymentMethod('');
              }} className="mt-1.5 min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--ink)]">
                <option value="">Elegir estado…</option>
                <option value="Pagado">Pagado</option>
                <option value="Pendiente">Pendiente</option>
              </select>
            </label>
            {conversionStatus === 'Pagado' && <label className="text-sm font-semibold">
              Medio de pago
              <select value={conversionPaymentMethod} onChange={event => setConversionPaymentMethod(event.target.value as typeof conversionPaymentMethod)} className="mt-1.5 min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--ink)]">
                <option value="">Elegir medio…</option>
                <option value="Efectivo">Efectivo</option>
                <option value="Transferencia">Transferencia</option>
                <option value="Débito">Débito</option>
                <option value="Crédito">Crédito</option>
                <option value="Otro">Otro</option>
              </select>
            </label>}
          </div>
          {conversionStatus === 'Pendiente' && <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm leading-5 text-amber-800 dark:text-amber-200">La deuda quedará asociada al cliente del pedido. Buscaremos una ficha con su WhatsApp; si no existe, se creará una con estos datos.</p>}
          <p className="mt-3 text-xs leading-5 text-[var(--ink-subtle)]">Se registrará un único ticket con todos los productos y se actualizará el stock. El pedido conservará su estado de entrega; cuando el cliente retire o reciba los productos, marcá «Marcar como entregado».</p>
          {conversionError && <p role="alert" className="mt-3 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] px-4 py-3 text-sm text-[var(--danger-ink)]">{conversionError}</p>}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" disabled={converting} onClick={() => setOrderToConvert(null)} className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold disabled:opacity-50">Cancelar</button>
            <button type="button" disabled={converting || !conversionStatus || (conversionStatus === 'Pagado' && !conversionPaymentMethod)} onClick={() => void handleConvertToSale()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              {converting ? 'Registrando…' : 'Confirmar conversión'}
            </button>
          </div>
        </section>
      </div>}
      {orderPendingDelete && <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
        <section role="alertdialog" aria-modal="true" aria-labelledby="delete-catalog-order-title" aria-describedby="delete-catalog-order-description" className="w-full max-w-md rounded-t-2xl border border-[var(--line)] bg-[var(--surface)] p-5 text-[var(--ink)] shadow-2xl sm:rounded-2xl">
          <h2 id="delete-catalog-order-title" className="text-lg font-bold">Eliminar pedido</h2>
          <p id="delete-catalog-order-description" className="mt-2 text-sm leading-relaxed">¿Eliminar el pedido de {orderPendingDelete.customerName}? No se puede deshacer.</p>
          {deleteOrderError && <p role="alert" className="mt-3 text-sm text-[var(--danger-ink)]">{deleteOrderError}</p>}
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" disabled={deletingOrder} onClick={() => { setOrderPendingDelete(null); setDeleteOrderError(null); }} className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold disabled:opacity-50">Cancelar</button>
            <button type="button" disabled={deletingOrder || !canDelete} onClick={() => void handleDeleteOrder()} className="min-h-11 rounded-xl bg-[var(--danger-ink)] px-4 text-sm font-bold text-white disabled:opacity-50">{deletingOrder ? 'Eliminando…' : 'Eliminar pedido'}</button>
          </div>
        </section>
      </div>}
    </div>
  );
}
