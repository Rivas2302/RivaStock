import {
  Area, AreaChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { formatCurrency } from '../lib/utils';

const PIE_COLORS = ['#34d399', '#60a5fa', '#a78bfa', '#fb7185', '#fbbf24', '#22d3ee', '#f472b6', '#4ade80'];

interface Props {
  dailySalesData: { date: string; label: string; sold: number; collected: number }[];
  stockByCategoryData: { name: string; value: number }[];
  monthlyBalanceData: { label: string; balance: number }[];
  stockScope: string;
}

const tooltipStyle = {
  backgroundColor: 'rgba(15, 23, 42, 0.96)',
  border: '1px solid rgba(148,163,184,0.18)',
  borderRadius: '12px',
  color: '#f8fafc',
  boxShadow: '0 16px 36px rgba(2,6,23,0.34)',
  fontSize: '12px',
};

export default function DashboardCharts({ dailySalesData, stockByCategoryData, monthlyBalanceData, stockScope }: Props) {
  const chartTick = { fontSize: 10, fill: '#94a3b8' };
  return <div className="space-y-6">
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <section className="dashboard-panel relative overflow-hidden p-5 sm:p-6 lg:col-span-2">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--brand)]">Ritmo comercial</p><h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">Vendido y cobrado por día</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Últimos 14 días · la venta y su cobro usan sus propias fechas</p></div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-xs font-semibold text-[var(--ink-subtle)]">14 días</div>
        </div>
        <ResponsiveContainer width="100%" height={258}>
          <AreaChart data={dailySalesData} margin={{ top: 8, right: 8, left: 2, bottom: 0 }}>
            <defs>
              <linearGradient id="soldGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity={0.34} /><stop offset="94%" stopColor="#34d399" stopOpacity={0.015} /></linearGradient>
              <linearGradient id="collectedGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#60a5fa" stopOpacity={0.28} /><stop offset="94%" stopColor="#60a5fa" stopOpacity={0.015} /></linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="rgba(148,163,184,0.16)" />
            <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} />
            <YAxis tickFormatter={value => formatCurrency(value)} tick={chartTick} width={78} axisLine={false} tickLine={false} />
            <Tooltip formatter={(value: number, name: string) => [formatCurrency(value), name === 'sold' ? 'Vendido' : 'Cobrado']} labelFormatter={label => 'Día ' + label} contentStyle={tooltipStyle} />
            <Legend formatter={value => <span className="text-xs text-slate-600 dark:text-slate-300">{value === 'sold' ? 'Vendido' : 'Cobrado'}</span>} />
            <Area type="monotone" dataKey="sold" name="sold" stroke="#34d399" strokeWidth={3} fill="url(#soldGradient)" activeDot={{ r: 5, stroke: '#ecfdf5', strokeWidth: 2 }} />
            <Area type="monotone" dataKey="collected" name="collected" stroke="#60a5fa" strokeWidth={2.7} fill="url(#collectedGradient)" activeDot={{ r: 5, stroke: '#eff6ff', strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      <section className="dashboard-panel p-5 sm:p-6">
        <div className="mb-4"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--brand)]">Capital</p><h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">Stock por categoría</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Titular: {stockScope}</p></div>
        {stockByCategoryData.length > 0 ? <ResponsiveContainer width="100%" height={258}>
          <PieChart>
            <defs>{PIE_COLORS.map((color, index) => <linearGradient key={color} id={'categoryGradient' + index} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={color} /><stop offset="100%" stopColor={color} stopOpacity={0.62} /></linearGradient>)}</defs>
            <Pie data={stockByCategoryData} cx="50%" cy="46%" innerRadius={56} outerRadius={90} paddingAngle={3} cornerRadius={5} dataKey="value" stroke="rgba(15,23,42,0.22)" strokeWidth={1}>
              {stockByCategoryData.map((_, index) => <Cell key={index} fill={'url(#categoryGradient' + (index % PIE_COLORS.length) + ')'} />)}
            </Pie>
            <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={tooltipStyle} />
            <Legend verticalAlign="bottom" iconType="circle" iconSize={7} formatter={value => <span className="text-[11px] text-slate-600 dark:text-slate-300">{value}</span>} />
          </PieChart>
        </ResponsiveContainer> : <div className="flex h-[258px] items-center justify-center text-sm text-slate-400">Sin datos de stock</div>}
      </section>
    </div>

    <section className="dashboard-panel overflow-hidden p-5 sm:p-6">
      <div className="mb-4"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--brand)]">Caja</p><h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">Balance neto mensual</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Ingresos pagados menos gastos pagados, por fecha del movimiento</p></div>
      <ResponsiveContainer width="100%" height={210}>
        <AreaChart data={monthlyBalanceData} margin={{ top: 8, right: 12, left: 2, bottom: 0 }}>
          <defs><linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#818cf8" stopOpacity={0.28} /><stop offset="100%" stopColor="#818cf8" stopOpacity={0.015} /></linearGradient></defs>
          <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="rgba(148,163,184,0.16)" />
          <XAxis dataKey="label" tick={chartTick} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={value => formatCurrency(value)} tick={chartTick} width={78} axisLine={false} tickLine={false} />
          <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={tooltipStyle} />
          <Area type="monotone" dataKey="balance" stroke="#818cf8" strokeWidth={3} fill="url(#balanceGradient)" activeDot={{ r: 5, stroke: '#eef2ff', strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </section>
  </div>;
}
