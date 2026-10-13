import { describe, expect, it } from 'vitest';
import { getExpenseCategories, matchesExpenseCategory } from './expenseCategories';
import type { CashFlowEntry } from '../types';

const entry = (category: string, type: CashFlowEntry['type'] = 'Gasto') => ({ category, type } as CashFlowEntry);

describe('expense category filters', () => {
  it('uses only expense categories, sorted without case or whitespace duplicates', () => {
    expect(getExpenseCategories([entry(' Servicios '), entry('servicios'), entry('Alquiler'), entry('Venta','Ingreso')]))
      .toEqual([{value:'alquiler',label:'Alquiler'},{value:'servicios',label:'Servicios'}]);
  });
  it('matches the whole category rather than a partial search', () => {
    expect(matchesExpenseCategory(entry(' SERVICIOS '),'servicios')).toBe(true);
    expect(matchesExpenseCategory(entry('Servicios extras'),'servicios')).toBe(false);
    expect(matchesExpenseCategory(entry('Servicios','Ingreso'),'servicios')).toBe(false);
    expect(matchesExpenseCategory(entry('Alquiler'),'')).toBe(true);
  });
  it('groups uncategorized historic expenses without changing their stored data', () => {
    expect(getExpenseCategories([entry(''),entry(' ')] )).toEqual([{value:'sin categoría',label:'Sin categoría'}]);
    expect(matchesExpenseCategory(entry(''),'sin categoría')).toBe(true);
  });
});
