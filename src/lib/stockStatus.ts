export type StockStatus = 'out' | 'low' | 'ok';

export function getStockStatus(stock: number, minStock: number): StockStatus {
  if (stock === 0) return 'out';
  if (stock > 0 && stock <= minStock) return 'low';
  return 'ok';
}