import type { MinimumOrderRule } from '../types';
import { formatCurrency } from './utils';

export interface CommercialRuleValues {
  minimumRule: MinimumOrderRule;
  minimumOrderAmount: number;
  minimumOrderQuantity: number;
}

export function isCommercialRuleSatisfied(
  rule: CommercialRuleValues,
  total: number,
  quantity: number,
): boolean {
  const amountSatisfied = total >= Math.max(0, rule.minimumOrderAmount);
  const quantitySatisfied = quantity >= Math.max(0, rule.minimumOrderQuantity);

  if (rule.minimumRule === 'amount') return amountSatisfied;
  if (rule.minimumRule === 'quantity') return quantitySatisfied;
  if (rule.minimumRule === 'both') return amountSatisfied && quantitySatisfied;
  return true;
}

export function getCommercialRuleMessage(rule: CommercialRuleValues): string | null {
  if (rule.minimumRule === 'amount') {
    return `Compra mínima: ${formatCurrency(rule.minimumOrderAmount)}`;
  }
  if (rule.minimumRule === 'quantity') {
    return `Compra mínima: ${rule.minimumOrderQuantity} unidades`;
  }
  if (rule.minimumRule === 'both') {
    return `Compra mínima: ${formatCurrency(rule.minimumOrderAmount)} y ${rule.minimumOrderQuantity} unidades`;
  }
  return null;
}
