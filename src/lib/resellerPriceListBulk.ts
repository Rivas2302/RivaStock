import type { PriceListAvailability, PriceListItem } from '../types';

export type ResellerPriceListBulkMutation =
  | { type: 'remove'; productIds: string[] }
  | { type: 'add'; items: PriceListItem[] }
  | { type: 'prices'; items: PriceListItem[] }
  | { type: 'availability'; productIds: string[]; availability: PriceListAvailability };

export interface ResellerPriceListBulkProgress {
  completed: number;
  total: number;
}

export function getBulkActionProductIds(
  action: 'add' | 'remove' | PriceListAvailability,
  productIds: string[],
  items: PriceListItem[],
  allowedToAdd: ReadonlySet<string> = new Set(productIds),
): string[] {
  const included = new Map(items.map(item => [item.productId, item]));
  return Array.from(new Set(productIds)).filter(productId => {
    const item = included.get(productId);
    if (action === 'add') return !item && allowedToAdd.has(productId);
    if (action === 'remove') return Boolean(item);
    return Boolean(item && item.availability !== action);
  });
}

export function toPriceListBulkRow(item: PriceListItem): Record<string, unknown> {
  return {
    user_id: item.ownerUid,
    price_list_id: item.priceListId,
    product_id: item.productId,
    pricing_mode: item.pricingMode,
    discount_percent: item.pricingMode === 'discount' ? item.discountPercent : null,
    fixed_price: item.pricingMode === 'fixed' ? item.fixedPrice : null,
    availability: item.availability,
    supplier_list_id: item.supplierListId ?? null,
    sort_order: item.sortOrder,
  };
}

export async function applyResellerPriceListBulkMutations(
  mutations: ResellerPriceListBulkMutation[],
  writeBatch: (mutation: ResellerPriceListBulkMutation) => Promise<void>,
  onProgress?: (progress: ResellerPriceListBulkProgress) => void,
  batchSize = 100,
): Promise<void> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error('El tamaño de tanda no es válido.');
  }

  const total = mutations.reduce((sum, mutation) => (
    sum + (mutation.type === 'add' || mutation.type === 'prices' ? mutation.items.length : mutation.productIds.length)
  ), 0);
  let completed = 0;
  onProgress?.({ completed, total });

  for (const mutation of mutations) {
    if (mutation.type === 'add' || mutation.type === 'prices') {
      for (let offset = 0; offset < mutation.items.length; offset += batchSize) {
        const batch = mutation.items.slice(offset, offset + batchSize);
        try {
          await writeBatch({ ...mutation, items: batch });
        } catch {
          throw new Error(`No se pudo guardar la tanda ${completed.toLocaleString('es-AR')} de ${total.toLocaleString('es-AR')}. Los cambios anteriores se conservaron; podés reintentar.`);
        }
        completed += batch.length;
        onProgress?.({ completed, total });
      }
    } else {
      for (let offset = 0; offset < mutation.productIds.length; offset += batchSize) {
        const batch = mutation.productIds.slice(offset, offset + batchSize);
        try {
          await writeBatch({ ...mutation, productIds: batch });
        } catch {
          throw new Error(`No se pudo guardar la tanda ${completed.toLocaleString('es-AR')} de ${total.toLocaleString('es-AR')}. Los cambios anteriores se conservaron; podés reintentar.`);
        }
        completed += batch.length;
        onProgress?.({ completed, total });
      }
    }
  }
}
