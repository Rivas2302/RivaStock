import type { CashFlowEntry } from '../types';

export function expenseCategoryKey(category?: string) {
  return (category?.trim() || 'Sin categoría').toLocaleLowerCase('es-AR');
}

export function getExpenseCategories(entries: CashFlowEntry[]) {
  const categories = new Map<string, string>();
  for (const entry of entries) {
    if (entry.type !== 'Gasto') continue;
    const key = expenseCategoryKey(entry.category);
    if (!categories.has(key)) categories.set(key, entry.category?.trim() || 'Sin categoría');
  }
  return [...categories].map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'es-AR'));
}

export function matchesExpenseCategory(entry: CashFlowEntry, selected: string) {
  return !selected || (entry.type === 'Gasto' && expenseCategoryKey(entry.category) === selected);
}
