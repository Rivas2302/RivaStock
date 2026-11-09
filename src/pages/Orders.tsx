import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { usePagination } from '../hooks/usePagination';
import Pagination from '../components/Pagination';
import { useAuth } from '../AuthContext';
import { usePermission } from '../hooks/usePermission';
import { db, callRpc } from '../lib/db';
import { Order, Sale } from '../types';
import { formatCurrency, cn, roundPrice, formatDate, todayString } from '../lib/utils';
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
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useParams } from 'react-router-dom';
import '../styles/business-redesign.css';

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
  const deferredStatusFilter = useDeferredValue(statusFilter);

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

  const handleConvertToSale = async (order: Order) => {
    if (!user) return;
    const today = todayString();
    const createdSaleIds: string[] = [];
    try {
      for (const item of order.items) {
        const result = await callRpc<Sale[]>('register_sale', {
          p_date: today,
          p_product_id: item.productId,
          p_quantity: item.quantity,
          p_unit_price: item.price,
          p_adjustment: 0,
          p_status: 'Pagado',
          p_payment_method: 'Efectivo',
          p_client: order.customerName,
          p_customer_id: null,
        });
        const sale = Array.isArray(result) ? result[0] : result;
        if (sale?.id) createdSaleIds.push(sale.id);
      }
      await updateOrderStatus(order.id, 'Entregado');
      alert('Pedido convertido en venta exitosamente.');
      fetchData();
    } catch (error) {
      await Promise.allSettled(createdSaleIds.map(id => callRpc('delete_sale', { p_sale_id: id })));
      alert(`Error: ${(error as Error).message}. Se revirtieron las ventas parciales.`);
      fetchData();
    }
  };

  const filteredOrders = useMemo(
    () => {
      const query = codigo?.trim().toLocaleLowerCase('es-AR') ?? '';
      return orders.filter(order => {
        const matchesStatus = deferredStatusFilter === 'all' || order.status === deferredStatusFilter;
        return matchesStatus && (!query || order.orderCode?.toLocaleLowerCase('es-AR') === query);
      });
    },
    [codigo, deferredStatusFilter, orders],
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
                    {!order.isRead && (
                      <span className="bg-indigo-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded uppercase">Nuevo</span>
                    )}
                    {order.channel === 'reseller' && (
                      <span className="bg-amber-100 text-amber-800 text-[10px] font-black px-2 py-0.5 rounded uppercase">Revendedor</span>
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
                    <span>{order.customerAddress}</span>
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
                      "w-full rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] py-2 pl-4 pr-10 text-sm font-bold text-[var(--ink)] [color-scheme:light] transition-all dark:[color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-50",
                    )}
                  >
                    <option className="bg-[var(--surface-raised)] text-[var(--ink)]" value="Nuevo">Nuevo</option>
                    <option className="bg-[var(--surface-raised)] text-[var(--ink)]" value="En Proceso">En Proceso</option>
                    <option className="bg-[var(--surface-raised)] text-[var(--ink)]" value="Entregado">Entregado</option>
                    <option className="bg-[var(--surface-raised)] text-[var(--ink)]" value="Cancelado">Cancelado</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" size={16} />
                </div>

                <button
                  onClick={() => handleConvertToSale(order)}
                  disabled={!canWrite}
                  title={!canWrite ? 'Sin permiso' : undefined}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowRight size={18} />
                  Convertir en Venta
                </button>

                {canDelete && <button
                  type="button"
                  onClick={() => { setDeleteOrderError(null); setOrderPendingDelete(order); }}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] px-3 py-2 text-sm font-bold text-[var(--danger-ink)] transition-colors hover:brightness-95"
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Eliminar pedido
                </button>}

                <div className="grid grid-cols-2 gap-2">
                  <a 
                    href={`https://wa.me/${order.customerPhone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center p-2.5 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors"
                  >
                    <MessageCircle size={20} />
                  </a>
                  <a 
                    href={`mailto:${order.customerEmail}`}
                    className="flex items-center justify-center p-2.5 bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition-colors"
                  >
                    <Mail size={20} />
                  </a>
                </div>
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
