import { supabase } from './supabase';
import type { SuperOfferNoticeColor, SuperOfferShippingMode } from './superOffers';

export interface PublicSuperOfferBatch {
  id: string;
  endsAt: string;
  shippingMode: SuperOfferShippingMode;
  shippingValue: number;
  noticeColor: SuperOfferNoticeColor;
  showComparePrice: boolean;
}

export interface PublicSuperOfferProduct {
  id: string;
  name: string;
  categoryId: string;
  category: string;
  salePrice: number;
  strikePrice: number | null;
  discountPercent: number;
  imageUrl: string | null;
  images: string[];
  description: string | null;
  availability: 'in_stock' | 'on_order';
}

export interface PublicSuperOfferResponse {
  active: boolean;
  batch: PublicSuperOfferBatch | null;
  products: PublicSuperOfferProduct[];
}

export interface OwnerSuperOfferBatch {
  id: string;
  status: 'draft' | 'open' | 'closed';
  selectionMode: 'all' | 'selected';
  extraPercent: number;
  showComparePrice: boolean;
  shippingMode: SuperOfferShippingMode;
  shippingValue: number;
  endsAt: string;
  noticeColor: SuperOfferNoticeColor;
  productIds: string[];
  brandedProductIds: string[];
  ordersCount: number;
}

export interface OwnerSuperOfferState {
  batch: OwnerSuperOfferBatch | null;
  slug: string;
  catalogEnabled: boolean;
  resellerEnabled: boolean;
}

export async function getPublicSuperOffer(slug: string): Promise<PublicSuperOfferResponse> {
  const { data, error } = await supabase.rpc('get_public_super_offer', { p_slug: slug });
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as Partial<PublicSuperOfferResponse>;
  const batch = payload.batch;
  return {
    active: Boolean(payload.active && batch?.id),
    batch: batch ? {
      ...batch,
      shippingValue: Number(batch.shippingValue ?? 0),
      showComparePrice: batch.showComparePrice === true,
    } : null,
    products: Array.isArray(payload.products) ? payload.products.map(product => ({
      ...product,
      salePrice: Number(product.salePrice ?? 0),
      strikePrice: product.strikePrice == null ? null : Number(product.strikePrice),
      discountPercent: Number(product.discountPercent ?? 0),
      images: Array.isArray(product.images) ? product.images : [],
    })) : [],
  };
}

export async function getOwnerSuperOfferState(): Promise<OwnerSuperOfferState> {
  const { data, error } = await supabase.rpc('get_owner_super_offer_state');
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as Partial<OwnerSuperOfferState>;
  const batch = payload.batch as OwnerSuperOfferBatch | null | undefined;
  return {
    batch: batch ? {
      ...batch,
      extraPercent: Number(batch.extraPercent ?? 20),
      showComparePrice: batch.showComparePrice === true,
      shippingValue: Number(batch.shippingValue ?? 5000),
      ordersCount: Number(batch.ordersCount ?? 0),
      productIds: Array.isArray(batch.productIds) ? batch.productIds : [],
      brandedProductIds: Array.isArray(batch.brandedProductIds) ? batch.brandedProductIds : [],
    } : null,
    slug: payload.slug ?? '',
    catalogEnabled: Boolean(payload.catalogEnabled),
    resellerEnabled: Boolean(payload.resellerEnabled),
  };
}

export async function saveSuperOfferBatch(input: {
  batchId: string | null;
  selectionMode: 'all' | 'selected';
  extraPercent: number;
  showComparePrice: boolean;
  shippingMode: SuperOfferShippingMode;
  shippingValue: number;
  endsAt: string;
  noticeColor: SuperOfferNoticeColor;
  productIds: string[];
  allowBrandedProductIds: string[];
  open: boolean;
}): Promise<void> {
  const { error } = await supabase.rpc('save_super_offer_batch_with_compare_price', {
    p_batch_id: input.batchId,
    p_selection_mode: input.selectionMode,
    p_extra_percent: input.extraPercent,
    p_shipping_mode: input.shippingMode,
    p_shipping_value: input.shippingValue,
    p_ends_at: input.endsAt,
    p_notice_color: input.noticeColor,
    p_product_ids: input.productIds,
    p_allow_branded_product_ids: input.allowBrandedProductIds,
    p_open: input.open,
    p_show_compare_price: input.showComparePrice,
  });
  if (error) throw new Error(error.message);
}

export async function closeSuperOfferBatch(batchId: string): Promise<void> {
  const { error } = await supabase.rpc('close_super_offer_batch', { p_batch_id: batchId });
  if (error) throw new Error(error.message);
}

export async function createPublicSuperOfferOrder(input: {
  slug: string;
  batchId: string;
  customer: {
    name: string;
    phone: string;
    email: string;
    address: string;
    message: string;
    deliveryMethod: 'pickup' | 'shipping';
  };
  items: Array<{ productId: string; quantity: number }>;
}): Promise<{
  id: string;
  orderCode: string;
  subtotal: number;
  shippingAmount: number;
  total: number;
  items: Array<{ productId: string; productName: string; quantity: number; price: number }>;
}> {
  const { data, error } = await supabase.rpc('create_public_super_offer_order', {
    p_slug: input.slug,
    p_batch_id: input.batchId,
    p_customer: input.customer,
    p_items: input.items,
  });
  if (error) throw new Error(error.message);
  const result = data as {
    id: string; orderCode: string; subtotal: number; shippingAmount: number; total: number;
    items: Array<{ productId: string; productName: string; quantity: number; price: number }>;
  };
  return {
    ...result,
    subtotal: Number(result.subtotal),
    shippingAmount: Number(result.shippingAmount),
    total: Number(result.total),
    items: (result.items ?? []).map(item => ({
      ...item, quantity: Number(item.quantity), price: Number(item.price),
    })),
  };
}
