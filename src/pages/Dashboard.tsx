import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { db } from '../lib/db';
import { Product, Sale, CashFlowEntry, Order } from '../types';
import { formatCurrency, cn, roundPrice, formatDate } from '../lib/utils';
import { 
  TrendingUp, 
  TrendingDown, 
  Package, 
  AlertTriangle, 
  ShoppingCart, 
  Wallet, 
  ArrowUpRight, 
  ArrowDownRight,
  Clock
} from 'lucide-react';
import { motion } from 'motion/react';

export default function Dashboard() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [cashFlow, setCashFlow] = useState<CashFlowEntry[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    
    const fetchData = async () => {
      try {
        const [p, s, cf, o] = await Promise.all([
          db.list<Product>('products', user.uid),
          db.list<Sale>('sales', user.uid),
          db.list<CashFlowEntry>('cash_flow', user.uid),
          db.list<Order>('orders', user.uid)
        ]);
        setProducts(p);
        setSales(s);
        setCashFlow(cf);
        setOrders(o);
      } catch (err) {
        console.error('Dashboard fetch error:', err);
        setError(err instanceof Error ? err.message : 'Error cargando datos');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    
    const timeout = setTimeout(() => setLoading(false), 15000);
    return () => clearTimeout(timeout);
  }, [user]);

  const { kpis, lowStockProducts, recentSales } = useMemo(() => {
    let totalCollected = 0;
    let totalExpenses = 0;
    let cashIncome = 0;
    let cashExpenses = 0;
    let bankIncome = 0;
    let bankExpenses = 0;

    for (const entry of cashFlow) {
      const isPaid = entry.status === 'Pagado';
      if (!isPaid) continue;

      if (entry.type === 'Ingreso') {
        totalCollected += entry.amount;
        if (entry.paymentMethod === 'Efectivo') cashIncome += entry.amount;
        if (entry.paymentMethod === 'Transferencia') bankIncome += entry.amount;
      } else {
        totalExpenses += entry.amount;
        if (entry.paymentMethod === 'Efectivo') cashExpenses += entry.amount;
        if (entry.paymentMethod === 'Transferencia') bankExpenses += entry.amount;
      }
    }

    let pendingSales = 0;
    let thisMonthSales = 0;
    const now = new Date();

    for (const sale of sales) {
      if (sale.status === 'No Pagado' || sale.status === 'Pendiente') {
        pendingSales += sale.total;
      }

      if (sale.status === 'Pagado') {
        const saleDate = new Date(sale.date);
        if (saleDate.getMonth() === now.getMonth() && saleDate.getFullYear() === now.getFullYear()) {
          thisMonthSales += sale.total;
        }
      }
    }

    let stockValue = 0;
    let totalInvested = 0;
    let outOfStockCount = 0;
    const lowStockProducts: Product[] = [];

    for (const product of products) {
      stockValue += roundPrice(product.salePrice) * product.stock;
      totalInvested += product.purchasePrice * product.stock;
      if (product.stock === 0) outOfStockCount += 1;
      if (product.stock <= product.minStock) {
        lowStockProducts.push(product);
      }
    }

    return {
      kpis: [
        { title: 'Balance Neto', value: totalCollected - totalExpenses, icon: Wallet, color: 'indigo' },
        { title: 'Efectivo Disponible', value: cashIncome - cashExpenses, icon: ArrowUpRight, color: 'emerald' },
        { title: 'Transferencias Disp.', value: bankIncome - bankExpenses, icon: ArrowUpRight, color: 'blue' },
        { title: 'Cobros Pendientes', value: pendingSales, icon: Clock, color: 'amber' },
        { title: 'Valor en Stock', value: stockValue, icon: Package, color: 'violet' },
        { title: 'Total Invertido', value: totalInvested, icon: TrendingDown, color: 'rose' },
        { title: 'Ganancia Potencial', value: stockValue - totalInvested, icon: TrendingUp, color: 'emerald' },
        { title: 'Productos sin Stock', value: outOfStockCount, icon: AlertTriangle, color: 'rose', isCurrency: false },
        { title: 'Ventas del Mes', value: thisMonthSales, icon: ShoppingCart, color: 'indigo' },
      ],
      lowStockProducts,
      recentSales: sales.slice(0, 5),
    };
  }, [cashFlow, products, sales]);

  if (loading) return <div className="animate-pulse space-y-8">
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {[...Array(8)].map((_, i) => <div key={i} className="h-32 bg-slate-200 dark:bg-slate-800 rounded-2xl" />)}
    </div>
  </div>;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Panel de Control</h2>
        <p className="text-slate-500 dark:text-slate-400">Resumen general de tu negocio</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => (
          <motion.div
            key={kpi.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={cn(
                "p-2 rounded-xl",
                kpi.color === 'indigo' && "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400",
                kpi.color === 'emerald' && "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400",
                kpi.color === 'rose' && "bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400",
                kpi.color === 'amber' && "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400",
                kpi.color === 'violet' && "bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400",
                kpi.color === 'blue' && "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
              )}>
                <kpi.icon size={20} />
              </div>
            </div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{kpi.title}</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {kpi.isCurrency === false ? kpi.value : formatCurrency(kpi.value as number)}
            </p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Sales */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="font-bold text-slate-900 dark:text-white">Ventas Recientes</h3>
            <button className="text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:underline">Ver todas</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold">
                <tr>
                  <th className="px-6 py-3">Fecha</th>
                  <th className="px-6 py-3">Producto</th>
                  <th className="px-6 py-3">Total</th>
                  <th className="px-6 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {recentSales.length > 0 ? recentSales.map((sale) => (
                  <tr key={sale.id} className="text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="px-6 py-4 dark:text-slate-300">{formatDate(sale.date)}</td>
                    <td className="px-6 py-4 font-medium dark:text-white">{sale.productName}</td>
                    <td className="px-6 py-4 font-bold dark:text-white">{formatCurrency(sale.total)}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                        sale.status === 'Pagado' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      )}>
                        {sale.status}
                      </span>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">No hay ventas registradas</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Low Stock Alerts */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="font-bold text-slate-900 dark:text-white">Alertas de Stock Bajo</h3>
            <button className="text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:underline">Gestionar Stock</button>
          </div>
          <div className="p-6 space-y-4">
            {lowStockProducts.slice(0, 5).map((product) => (
              <div key={product.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "p-2 rounded-lg",
                    product.stock === 0 ? "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400" : "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                  )}>
                    <AlertTriangle size={18} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white text-sm">{product.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{product.category}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-slate-900 dark:text-white text-sm">{product.stock} unidades</p>
                  <p className="text-[10px] text-slate-400 uppercase font-bold">Mínimo: {product.minStock}</p>
                </div>
              </div>
            ))}
            {lowStockProducts.length === 0 && (
              <div className="text-center py-8 text-slate-500 dark:text-slate-400">Todo el stock está al día</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
