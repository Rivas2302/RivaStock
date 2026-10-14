import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  LineChart, Line,
} from 'recharts';
import { formatCurrency } from '../lib/utils';
const PIE_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6'];
 
interface Props { monthlySalesData: {label: string; total: number}[]; stockByCategoryData: {name: string; value: number}[]; monthlyBalanceData: {label: string; balance: number}[]; stockScope: string; }
export default function DashboardCharts({monthlySalesData, stockByCategoryData, monthlyBalanceData, stockScope}: Props) { return <>
      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Sales Bar Chart */}
        <div className="dashboard-panel lg:col-span-2 p-6">
          <h3 className="font-bold text-slate-900 dark:text-white mb-4">Ventas cobradas por mes</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlySalesData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => formatCurrency(v)} tick={{ fontSize: 10 }} width={72} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="total" fill="#365fad" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Stock by Category Pie */}
        <div className="dashboard-panel p-6">
          <h3 className="font-bold text-slate-900 dark:text-white mb-4">Valor en stock por categoría — {stockScope}</h3>
          {stockByCategoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={stockByCategoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  dataKey="value"
                >
                  {stockByCategoryData.map((_, idx) => (
                    <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Legend
                  formatter={(value) => <span className="text-xs text-slate-600 dark:text-slate-400">{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-400 text-sm">Sin datos</div>
          )}
        </div>
      </div>

      {/* Net Balance Line Chart */}
      <div className="dashboard-panel p-6">
        <h3 className="font-bold text-slate-900 dark:text-white mb-4">Balance neto mensual</h3>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={monthlyBalanceData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => formatCurrency(v)} tick={{ fontSize: 10 }} width={72} />
            <Tooltip formatter={(v: number) => formatCurrency(v)} />
            <Line
              type="monotone"
              dataKey="balance"
              stroke="#365fad"
              strokeWidth={2.5}
              dot={{ r: 4, fill: '#365fad' }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

</>; }
