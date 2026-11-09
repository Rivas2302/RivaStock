import type {
  MinimumOrderRule,
  PriceList,
  PriceListAvailability,
  PriceListItem,
  Product,
  ResellerSupplierOrderRound,
  ResellerSupplierRoundOrder,
  ResellerSupplierRoundOrderStatus,
  ResellerSupplierRoundStatus,
  ResellerSupplierList,
} from '../types';
import { db, fromDb, invalidateDbCache } from './db';
import { supabase } from './supabase';
import { clampPriceListDiscount } from './priceListPricing';
import { normalizeResellerMarginRules, type ResellerMarginRules } from './resellerMarginRules';
import { DEFAULT_RESELLER_BUYING_POLICY } from './resellerBuyingPolicy';

type RawPriceList = PriceList & { accessCodeHash?: string | null };
const SUPPLIER_ITEMS_PAGE_SIZE = 1_000;

const normalizePriceList = (value: RawPriceList): PriceList => {
  const { accessCodeHash, ...list } = value;
  return {
    ...list,
    publicEnabled: Boolean(list.publicEnabled),
    accessCodeConfigured: Boolean(accessCodeHash),
    minimumRule: list.minimumRule ?? 'none',
    minimumOrderAmount: Number(list.minimumOrderAmount ?? 0),
    minimumOrderQuantity: Number(list.minimumOrderQuantity ?? 0),
    buyingPolicy: list.buyingPolicy ?? DEFAULT_RESELLER_BUYING_POLICY,
    minimumProfitMarginPercent: Number(list.minimumProfitMarginPercent ?? 25),
    targetResellerDiscountPercent: Number(list.targetResellerDiscountPercent ?? 15),
    marginRules: normalizeResellerMarginRules(list.marginRules),
  };
};

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
  return { list: normalizePriceList(list as RawPriceList), items };
}

export async function ensureResellerPriceList(defaultDiscountPercent = 20): Promise<PriceList> {
  const { data, error } = await supabase.rpc('ensure_reseller_price_list', {
    p_default_discount: clampPriceListDiscount(defaultDiscountPercent),
  });
  if (error) throw new Error(`[ensure_reseller_price_list] ${error.message}`);
  invalidateDbCache('price_lists', 'price_list_items');
  return normalizePriceList(fromDb<RawPriceList>(data as Record<string, unknown>));
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
    supplierListId: item.supplierListId ?? null,
    sortOrder: index,
  }));
  const { data, error } = await supabase.rpc('save_reseller_price_list', {
    p_list_id: listId,
    p_default_discount: clampPriceListDiscount(defaultDiscountPercent),
    p_items: payload,
  });
  if (error) throw new Error(`[save_reseller_price_list] ${error.message}`);
  invalidateDbCache('price_lists', 'price_list_items');
  return normalizePriceList(fromDb<RawPriceList>(data as Record<string, unknown>));
}

export async function saveResellerMarginRules(
  listId: string,
  marginRules: ResellerMarginRules,
): Promise<PriceList> {
  const saved = await db.update<RawPriceList>('price_lists', listId, { marginRules });
  invalidateDbCache('price_lists');
  return normalizePriceList(saved);
}

export async function loadResellerSupplierLists(priceListId: string): Promise<ResellerSupplierList[]> {
  const rawLists: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += SUPPLIER_ITEMS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('reseller_supplier_lists')
      .select('*')
      .eq('price_list_id', priceListId)
      .order('created_at')
      .order('id', { ascending: true })
      .range(offset, offset + SUPPLIER_ITEMS_PAGE_SIZE - 1);
    if (error) throw new Error(`[load_reseller_supplier_lists] ${error.message}`);
    const page = data ?? [];
    rawLists.push(...page);
    if (page.length < SUPPLIER_ITEMS_PAGE_SIZE) break;
  }

  const listIds = rawLists.map((row) => String(row.id));
  const rawItems: Record<string, unknown>[] = [];
  for (let offset = 0; listIds.length > 0; offset += SUPPLIER_ITEMS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('reseller_supplier_list_items')
      .select('supplier_list_id,product_id,sort_order')
      .in('supplier_list_id', listIds)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + SUPPLIER_ITEMS_PAGE_SIZE - 1);
    if (error) throw new Error(`[load_reseller_supplier_list_items] ${error.message}`);
    const page = data ?? [];
    rawItems.push(...page);
    if (page.length < SUPPLIER_ITEMS_PAGE_SIZE) break;
  }

  const productIdsByList = new Map<string, string[]>();
  for (const item of rawItems) {
    const listId = String(item.supplier_list_id);
    const productIds = productIdsByList.get(listId) ?? [];
    productIds.push(String(item.product_id));
    productIdsByList.set(listId, productIds);
  }

  return rawLists.map((row) => ({
    ...fromDb<Omit<ResellerSupplierList, 'productIds'>>(row as Record<string, unknown>),
    productIds: productIdsByList.get(String(row.id)) ?? [],
  }));
}

export async function loadResellerSupplierListPricing(supplierListIds: string[]): Promise<{
  supplier_list_id: string;
  product_id: string;
  margin_percent: number;
  updated_at: string | null;
}[]> {
  const rows: { supplier_list_id: string; product_id: string; margin_percent: number; updated_at: string | null }[] = [];
  for (let offset = 0; supplierListIds.length > 0; offset += SUPPLIER_ITEMS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('reseller_supplier_list_pricing')
      .select('supplier_list_id,product_id,margin_percent,updated_at')
      .in('supplier_list_id', supplierListIds)
      .order('supplier_list_id', { ascending: true })
      .order('product_id', { ascending: true })
      .range(offset, offset + SUPPLIER_ITEMS_PAGE_SIZE - 1);
    if (error) throw new Error(`[load_reseller_supplier_list_pricing] ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < SUPPLIER_ITEMS_PAGE_SIZE) break;
  }
  return rows;
}

export async function saveResellerSupplierList(input: {
  priceListId: string;
  supplierId: string;
  productIds: string[];
}): Promise<ResellerSupplierList> {
  const productIds = Array.from(new Set(input.productIds));
  const { data, error } = await supabase.rpc('save_reseller_supplier_list', {
    p_list_id: input.priceListId,
    p_supplier_id: input.supplierId,
    p_product_ids: productIds,
  });
  if (error) throw new Error(`[save_reseller_supplier_list] ${error.message}`);
  invalidateDbCache('price_list_items', 'reseller_supplier_lists', 'reseller_supplier_list_items');
  return {
    ...fromDb<Omit<ResellerSupplierList, 'productIds'>>(data as Record<string, unknown>),
    productIds,
  };
}

export async function saveResellerSupplierImportCategories(
  supplierListId: string,
  categoryIds: string[],
): Promise<number> {
  if (categoryIds.length === 0) return 0;
  const { data, error } = await supabase.rpc('save_reseller_supplier_import_categories', {
    p_supplier_list_id: supplierListId,
    p_category_ids: Array.from(new Set(categoryIds)),
  });
  if (error) throw new Error(`[save_reseller_supplier_import_categories] ${error.message}`);
  return Number(data ?? 0);
}

export async function saveResellerSupplierListWithPricing(input: {
  priceListId: string;
  supplierId: string;
  productIds: string[];
  price: {
    productId: string;
    supplierCost: number;
    marginPercent: number;
    roundingStep: 0 | 100 | 500;
  };
}): Promise<ResellerSupplierList> {
  const productIds = Array.from(new Set(input.productIds));
  const { data, error } = await supabase.rpc('save_reseller_supplier_list_with_pricing', {
    p_list_id: input.priceListId,
    p_supplier_id: input.supplierId,
    p_product_ids: productIds,
    p_prices: [{
      productId: input.price.productId,
      supplierCost: input.price.supplierCost,
      marginPercent: input.price.marginPercent,
      roundingStep: input.price.roundingStep,
    }],
  });
  if (error) throw new Error(`[save_reseller_supplier_list_with_pricing] ${error.message}`);
  invalidateDbCache('price_list_items', 'reseller_supplier_lists', 'reseller_supplier_list_items');
  return {
    ...fromDb<Omit<ResellerSupplierList, 'productIds'>>(data as Record<string, unknown>),
    productIds,
  };
}

export async function saveResellerSupplierListPricingBatch(
  supplierListId: string,
  items: Array<{ productId: string; supplierCost: number; marginPercent: number; roundingStep: 0 | 100 | 500 }>,
): Promise<number> {
  const { data, error } = await supabase.rpc('save_reseller_supplier_list_pricing', {
    p_supplier_list_id: supplierListId,
    p_items: items.map(item => ({
      productId: item.productId,
      supplierCost: item.supplierCost,
      marginPercent: item.marginPercent,
      roundingStep: item.roundingStep,
    })),
  });
  if (error) throw new Error(`[save_reseller_supplier_list_pricing] ${error.message}`);
  invalidateDbCache('price_list_items', 'reseller_supplier_lists', 'reseller_supplier_list_items');
  return Number(data ?? 0);
}

export async function saveSupplierCatalogExchangeRate(supplierId: string, ownerUid: string, rate: number): Promise<void> {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('La cotización debe ser mayor a cero.');
  const { error } = await supabase.from('suppliers')
    .update({ catalog_exchange_rate: rate })
    .eq('id', supplierId)
    .eq('user_id', ownerUid);
  if (error) throw new Error(`[save_supplier_catalog_exchange_rate] ${error.message}`);
  invalidateDbCache('suppliers');
}

export async function toggleResellerSupplierList(
  supplierListId: string,
  enabled: boolean,
): Promise<ResellerSupplierList> {
  const { data, error } = await supabase.rpc('toggle_reseller_supplier_list', {
    p_supplier_list_id: supplierListId,
    p_enabled: enabled,
  });
  if (error) throw new Error(`[toggle_reseller_supplier_list] ${error.message}`);
  invalidateDbCache('price_list_items', 'reseller_supplier_lists');
  return {
    ...fromDb<Omit<ResellerSupplierList, 'productIds'>>(data as Record<string, unknown>),
    productIds: [],
  };
}

export async function loadResellerSupplierRounds(supplierListId: string): Promise<ResellerSupplierOrderRound[]> {
  const { data: roundRows, error: roundError } = await supabase
    .from('reseller_supplier_order_rounds')
    .select('*')
    .eq('supplier_list_id', supplierListId)
    .order('closes_at', { ascending: false })
    .limit(20);
  if (roundError) throw new Error(`[load_reseller_supplier_order_rounds] ${roundError.message}`);

  const roundIds = (roundRows ?? []).map(row => String(row.id));
  const { data: orderRows, error: orderError } = roundIds.length === 0
    ? { data: [], error: null }
    : await supabase
      .from('reseller_supplier_round_orders')
      .select('*')
      .in('round_id', roundIds)
      .order('created_at', { ascending: false })
      .limit(500);
  if (orderError) throw new Error(`[load_reseller_supplier_round_orders] ${orderError.message}`);

  const ordersByRound = new Map<string, ResellerSupplierRoundOrder[]>();
  for (const row of orderRows ?? []) {
    const order = fromDb<ResellerSupplierRoundOrder>(row as Record<string, unknown>);
    order.supplierTotal = Number(order.supplierTotal ?? 0);
    order.resellerTotal = Number(order.resellerTotal ?? 0);
    order.profit = Number(order.profit ?? 0);
    order.itemsSnapshot = (order.itemsSnapshot ?? []).map(item => ({
      ...item,
      quantity: Number(item.quantity),
      supplierUnitCost: Number(item.supplierUnitCost),
      resellerUnitPrice: Number(item.resellerUnitPrice),
    }));
    ordersByRound.set(order.roundId, [...(ordersByRound.get(order.roundId) ?? []), order]);
  }

  return (roundRows ?? []).map(row => {
    const round = fromDb<Omit<ResellerSupplierOrderRound, 'orders'>>(row as Record<string, unknown>);
    return {
      ...round,
      minimumOrderAmount: Number(round.minimumOrderAmount ?? 0),
      orders: ordersByRound.get(round.id) ?? [],
    };
  });
}

export async function createResellerSupplierOrderRound(input: {
  supplierListId: string;
  closesAt: string;
  minimumOrderAmount: number;
  audienceName: string;
  audienceCode: string;
}): Promise<ResellerSupplierOrderRound> {
  const { data, error } = await supabase.rpc('create_reseller_supplier_order_round', {
    p_supplier_list_id: input.supplierListId,
    p_closes_at: input.closesAt,
    p_minimum_order_amount: Math.max(0, input.minimumOrderAmount),
    p_audience_name: input.audienceName.trim(),
    p_audience_code: input.audienceCode.trim(),
  });
  if (error) throw new Error(`[create_reseller_supplier_order_round] ${error.message}`);
  return { ...fromDb<Omit<ResellerSupplierOrderRound, 'orders'>>(data as Record<string, unknown>), orders: [] };
}

export async function setResellerSupplierOrderRoundStatus(
  roundId: string,
  status: Extract<ResellerSupplierRoundStatus, 'open' | 'closed'>,
): Promise<ResellerSupplierOrderRound> {
  const { data, error } = await supabase.rpc('set_reseller_supplier_order_round_status', {
    p_round_id: roundId,
    p_status: status,
  });
  if (error) throw new Error(`[set_reseller_supplier_order_round_status] ${error.message}`);
  return { ...fromDb<Omit<ResellerSupplierOrderRound, 'orders'>>(data as Record<string, unknown>), orders: [] };
}

export async function setResellerSupplierRoundOrderStatus(
  roundOrderId: string,
  status: ResellerSupplierRoundOrderStatus,
): Promise<ResellerSupplierRoundOrder> {
  const { data, error } = await supabase.rpc('set_reseller_supplier_round_order_status', {
    p_round_order_id: roundOrderId,
    p_status: status,
  });
  if (error) throw new Error(`[set_reseller_supplier_round_order_status] ${error.message}`);
  const order = fromDb<ResellerSupplierRoundOrder>(data as Record<string, unknown>);
  order.supplierTotal = Number(order.supplierTotal ?? 0);
  order.resellerTotal = Number(order.resellerTotal ?? 0);
  order.profit = Number(order.profit ?? 0);
  return order;
}

export async function promoteResellerCatalogProduct(productId: string): Promise<Product> {
  const { data, error } = await supabase.rpc('promote_reseller_catalog_product', {
    p_product_id: productId,
  });
  if (error) throw new Error(`[promote_reseller_catalog_product] ${error.message}`);
  invalidateDbCache(
    'products',
    'price_list_items',
    'reseller_supplier_lists',
    'reseller_supplier_list_items',
  );
  return fromDb<Product>(data as Record<string, unknown>);
}

export async function configureResellerPriceList(input: {
  listId: string;
  publicEnabled: boolean;
  accessCode?: string;
  minimumRule: MinimumOrderRule;
  minimumOrderAmount: number;
  minimumOrderQuantity: number;
}): Promise<PriceList> {
  const { data, error } = await supabase.rpc('configure_reseller_price_list', {
    p_list_id: input.listId,
    p_public_enabled: input.publicEnabled,
    p_access_code: input.accessCode?.trim() ?? '',
    p_minimum_rule: input.minimumRule,
    p_minimum_order_amount: Math.max(0, input.minimumOrderAmount),
    p_minimum_order_quantity: Math.max(0, Math.floor(input.minimumOrderQuantity)),
  });
  if (error) throw new Error(`[configure_reseller_price_list] ${error.message}`);
  invalidateDbCache('price_lists');
  return normalizePriceList(fromDb<RawPriceList>(data as Record<string, unknown>));
}

export async function configureResellerPricingAdvisor(input: {
  listId: string;
  minimumProfitMarginPercent: number;
  targetResellerDiscountPercent: number;
}): Promise<PriceList> {
  const { data, error } = await supabase.rpc('configure_reseller_pricing_advisor', {
    p_list_id: input.listId,
    p_minimum_profit_margin_percent: Math.min(95, Math.max(0, input.minimumProfitMarginPercent)),
    p_target_reseller_discount_percent: Math.min(100, Math.max(0, input.targetResellerDiscountPercent)),
  });
  if (error) throw new Error(`[configure_reseller_pricing_advisor] ${error.message}`);
  invalidateDbCache('price_lists');
  return normalizePriceList(fromDb<RawPriceList>(data as Record<string, unknown>));
}

export async function saveResellerBuyingPolicy(listId: string, buyingPolicy: string): Promise<void> {
  const normalizedPolicy = buyingPolicy.replace(/\r\n/g, '\n');
  if (normalizedPolicy.length > 5_000) throw new Error('Las condiciones no pueden superar los 5.000 caracteres.');
  await db.update<RawPriceList>('price_lists', listId, { buyingPolicy: normalizedPolicy });
  invalidateDbCache('price_lists');
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
