import type {
  PriceList,
  PriceListAvailability,
  PriceListItem,
} from '../types';
import { db, fromDb, invalidateDbCache } from './db';
import { supabase } from './supabase';
import { clampPriceListDiscount } from './priceListPricing';

export async function loadResellerPriceList(ownerUid: string): Promise<{
  list: PriceList | null;
  items: PriceListItem[];
}> {
  const [list] = await db.findBy<PriceList>('price_lists', [
    { field: 'ownerUid', value: ownerUid },
    { field: 'kind', value: 'reseller' },
  ], 1);
  if (!list) return { list: null, items: [] };

  const items = await db.findBy<PriceListItem>('price_list_items', [
    { field: 'priceListId', value: list.id },
  ]);
  return { list, items };
}

export async function ensureResellerPriceList(defaultDiscountPercent = 20): Promise<PriceList> {
  const { data, error } = await supabase.rpc('ensure_reseller_price_list', {
    p_default_discount: clampPriceListDiscount(defaultDiscountPercent),
  });
  if (error) throw new Error(`[ensure_reseller_price_list] ${error.message}`);
  invalidateDbCache('price_lists', 'price_list_items');
  return fromDb<PriceList>(data as Record<string, unknown>);
}

export async function saveResellerPriceList(
  listId: string,
  defaultDiscountPercent: number,
  items: PriceListItem[],
): Promise<PriceList> {
  const payload = items.map((item, index) => ({
    productId: item.productId,
    pricingMode: item.pricingMode,
    discountPercent: item.pricingMode === 'discount' ? clampPriceListDiscount(item.discountPercent ?? 0) : null,
    fixedPrice: item.pricingMode === 'fixed' ? Math.max(0, item.fixedPrice ?? 0) : null,
    availability: item.availability,
    sortOrder: index,
  }));
  const { data, error } = await supabase.rpc('save_reseller_price_list', {
    p_list_id: listId,
    p_default_discount: clampPriceListDiscount(defaultDiscountPercent),
    p_items: payload,
  });
  if (error) throw new Error(`[save_reseller_price_list] ${error.message}`);
  invalidateDbCache('price_lists', 'price_list_items');
  return fromDb<PriceList>(data as Record<string, unknown>);
}

export async function addProductToResellerPriceList(
  productId: string,
  availability: PriceListAvailability = 'on_order',
): Promise<void> {
  const { error } = await supabase.rpc('add_reseller_price_list_product', {
    p_product_id: productId,
    p_availability: availability,
  });
  if (error) throw new Error(`[add_reseller_price_list_product] ${error.message}`);
  invalidateDbCache('price_lists', 'price_list_items');
}
