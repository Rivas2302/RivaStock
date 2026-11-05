import { roundFinancialAmount } from './financialSettlement';

export interface SaleTotals {
  subtotal: number;
  adjustment: number;
  total: number;
}

export function calculateSaleTotals(quantity: number, unitPrice: number, adjustment: number): SaleTotals {
  const safeQuantity = Number(quantity) || 0;
  const safeUnitPrice = Number(unitPrice) || 0;
  const safeAdjustment = Number(adjustment) || 0;
  return {
    subtotal: roundFinancialAmount(safeQuantity * safeUnitPrice),
    adjustment: roundFinancialAmount(safeAdjustment),
    total: roundFinancialAmount((safeQuantity * safeUnitPrice) + safeAdjustment),
  };
}
