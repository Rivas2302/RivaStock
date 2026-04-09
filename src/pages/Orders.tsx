import { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { db } from '../lib/db';
import { Order, Product } from '../types';
import { formatCurrency, cn, roundPrice } from '../lib/utils';
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
  Search,
  Filter,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';

export default function Orders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchData = async () => {
    if (!user) return;
    const o = await db.list<Order>('orders', user.uid);
    setOrders(o.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const updateOrderStatus = async (id: string, status: Order['status']) => {
    await db.update<Order>('orders', id, { status, isRead: true });
    fetchData();
  };

  const handleConvertToSale = async (order: Order) => {
    // 1. Validate stock
    const products = await db.list<Product>('products', user!.uid);
    const insufficientStock = order.items.filter(item => {
      const product = products.find(p => p.id === item.productId);
      return !product || product.stock < item.quantity;
    });

    if (insufficientStock.length > 0) {
      alert(`No hay suficiente stock para: ${insufficientStock.map(i => i.productName).join(', ')}`);
      return;
    }

    // 2. Create sale
    try {
      for (const item of order.items) {
        const product = products.find(p => p.id === item.productId)!;
        
        // Create sale entry
        await db.create('sales', {
          id: crypto.randomUUID(),
          date: new Date().toISOString().split('T')[0],
          productId: item.productId,
          productName: item.productName,
          unitPrice: item.price,
          quantity: item.quantity,
          adjustment: 0,
          total: item.price * item.quantity,
          status: 'Pagado',
          paymentMethod: 'Efectivo',
          client: order.customerName,
          ownerUid: user!.uid
        });

        // Reduce stock
        await db.update('products', product.id, { stock: product.stock - item.quantity });
      }

      // 3. Update order status
      await updateOrderStatus(order.id, 'Entregado');
      alert('Pedido convertido en venta exitosamente.');
      fetchData();
    } catch (error) {
      console.error('Error converting order to sale:', error);
      alert('Error al convertir el pedido en venta.');
    }
  };

  const filteredOrders = orders.filter(o => 
    statusFilter === 'all' || o.status === statusFilter
  );

  console.log('Rendering Orders page:', {
    loading,
    ordersCount: orders.length,
    filteredOrdersCount: filteredOrders.length,
    user: user?.uid
  });

  return (
    <div className="space-y-6">
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
        {Array.isArray(filteredOrders) && filteredOrders.length > 0 ? filteredOrders.map((order) => (
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
                    {!order.isRead && (
                      <span className="bg-indigo-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded uppercase">Nuevo</span>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 font-medium">{new Date(order.date).toLocaleString('es-AR')}</span>
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
                    className={cn(
                      "w-full pl-4 pr-10 py-2 rounded-xl text-sm font-bold border-2 appearance-none transition-all",
                      order.status === 'Nuevo' && "bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/20 dark:border-indigo-800 dark:text-indigo-400",
                      order.status === 'En Proceso' && "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400",
                      order.status === 'Entregado' && "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400",
                      order.status === 'Cancelado' && "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-900/20 dark:border-rose-800 dark:text-rose-400",
                    )}
                  >
                    <option value="Nuevo">Nuevo</option>
                    <option value="En Proceso">En Proceso</option>
                    <option value="Entregado">Entregado</option>
                    <option value="Cancelado">Cancelado</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" size={16} />
                </div>

                <button 
                  onClick={() => handleConvertToSale(order)}
                  className="w-full bg-slate-900 dark:bg-white dark:text-slate-900 text-white py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                >
                  <ArrowRight size={18} />
                  Convertir en Venta
                </button>

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
            <p className="text-slate-500 dark:text-slate-400 font-medium">No hay pedidos para mostrar</p>
          </div>
        )}
      </div>
    </div>
  );
}
