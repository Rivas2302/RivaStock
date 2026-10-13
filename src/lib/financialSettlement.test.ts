import { describe, expect, it } from 'vitest';
import { buildSaleSettlements, formatFinancialAmount, isManagedCashEntry, roundFinancialAmount } from './financialSettlement';
import type { CashFlowEntry, CustomerTransaction, Sale } from '../types';

const sale = (id: string, total: number, status: Sale['status'] = 'Pendiente') => ({ id, total, status } as Sale);
const transaction = (type: 'sale' | 'payment', amount: number, relatedSaleId = 'one') => ({
  type, amount, relatedSaleId, customerId: 'customer',
} as CustomerTransaction);

describe('sale settlement projections', () => {
  it('does not hide small outstanding balances by rounding to whole pesos', () => {
    expect(formatFinancialAmount(.25)).toContain('0,25');
    expect(roundFinancialAmount(10.25)).toBe(10.25);
  });
  it('shows collected and remaining amounts for a partial payment', () => {
    expect(buildSaleSettlements([sale('one', 100)], [transaction('sale',100),transaction('payment',-40)]).get('one'))
      .toEqual({customerId:'customer',total:100,paid:40,pending:60});
  });
  it('does not treat customer credit as a second sale payment', () => {
    const values = buildSaleSettlements([sale('one',100)], [transaction('sale',100),transaction('payment',-100),transaction('payment',-50,'')]);
    expect(values.get('one')?.paid).toBe(100);
    expect(values.get('one')?.pending).toBe(0);
  });
  it('uses cents rather than accumulating floating point money', () => {
    expect(buildSaleSettlements([sale('one',.3)], [transaction('sale',.3),transaction('payment',-.1),transaction('payment',-.2)]).get('one')?.pending).toBe(0);
  });
  it('preserves cash sales without a customer ledger', () => {
    expect(buildSaleSettlements([sale('one',100,'Pagado'),sale('two',50)],[]).get('one')?.paid).toBe(100);
    expect(buildSaleSettlements([sale('two',50)],[]).get('two')?.pending).toBe(50);
  });
  it('protects historic account receipts that have no sale ID', () => {
    expect(isManagedCashEntry({source:'Venta'} as CashFlowEntry)).toBe(true);
    expect(isManagedCashEntry({source:'Manual'} as CashFlowEntry)).toBe(false);
    expect(isManagedCashEntry({source:'Manual',financialCommandId:'receipt'} as CashFlowEntry)).toBe(true);
  });
});
