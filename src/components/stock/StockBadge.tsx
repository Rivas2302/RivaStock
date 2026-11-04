import { getStockStatus } from '../../lib/stockStatus';

export interface StockBadgeProps {
  stock: number;
  minStock: number;
}

export default function StockBadge({ stock, minStock }: StockBadgeProps) {
  const status = getStockStatus(stock, minStock);
  if (status === 'ok') return null;

  if (status === 'out') {
    return <span className="inline-flex min-h-6 items-center rounded-full border border-[var(--danger-line)] bg-[var(--danger-surface)] px-2.5 text-xs font-semibold text-[var(--danger-ink)]">Sin stock</span>;
  }

  return <span className="inline-flex min-h-6 items-center rounded-full border border-[var(--warning-line)] bg-[var(--warning-surface)] px-2.5 text-xs font-semibold text-[var(--warning-ink)]">Quedan {stock}</span>;
}