import type { CashFlowEntry, CustomerTransaction, Sale } from '../types';

const cents = (amount: number) => Math.round(amount * 100);
export const roundFinancialAmount = (amount: number) => cents(amount) / 100;
const financialFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency', currency: 'ARS', minimumFractionDigits: 0, maximumFractionDigits: 2,
});
export const formatFinancialAmount = (amount: number) => financialFormatter.format(amount).replace('ARS', '$');

/** The linked ledger, not a status toggle, determines the remaining debt. */
export function buildSaleSettlements(sales: Sale[], transactions: CustomerTransaction[]) {
  const ledger = new Map<string, { customerId: string; debt: number; payments: number }>();
  for (const transaction of transactions) {
    if (!transaction.relatedSaleId) continue;
    const value = ledger.get(transaction.relatedSaleId) ?? {
      customerId: transaction.customerId, debt: 0, payments: 0,
    };
    if (transaction.type === 'sale') value.debt += cents(transaction.amount);
    if (transaction.type === 'payment') value.payments -= cents(transaction.amount);
    ledger.set(transaction.relatedSaleId, value);
  }
  return new Map(sales.map(sale => {
    const linked = ledger.get(sale.id);
    const total = Math.max(0, cents(sale.total));
    const paid = linked ? Math.max(0, Math.min(total, linked.payments))
      : sale.status === 'Pagado' ? total : 0;
    return [sale.id, { customerId: linked?.customerId, total: total / 100, paid: paid / 100, pending: (total - paid) / 100 }] as const;
  }));
}

export function isManagedCashEntry(entry: CashFlowEntry) {
  // Old account receipts have no saleId. Their source still identifies them.
  return entry.source === 'Venta' || !!entry.saleId || !!entry.financialCommandId;
}
