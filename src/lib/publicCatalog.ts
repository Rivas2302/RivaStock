import type {
  CatalogChannel,
  PublicCatalogProduct,
  PublicResellerCatalog,
} from '../types';
import { supabase } from './supabase';

type PublicProductPayload = Partial<PublicCatalogProduct> & Pick<PublicCatalogProduct, 'id' | 'name'>;

const normalizePublicProduct = (payload: PublicProductPayload): PublicCatalogProduct => ({
  id: payload.id,
  name: payload.name,
  categoryId: payload.categoryId ?? '',
  category: payload.category ?? '',
  purchasePrice: 0,
  salePrice: Number(payload.salePrice ?? 0),
  stock: Number(payload.stock ?? 0),
  minStock: 0,
  imageUrl: payload.imageUrl,
  images: payload.images ?? [],
  showInCatalog: true,
  description: payload.description,
  ownerUid: '',
  createdAt: '',
  updatedAt: '',
  availability: payload.availability ?? 'out_of_stock',
});

export async function getPublicCatalogProducts(slug: string): Promise<PublicCatalogProduct[]> {
  const { data, error } = await supabase.rpc('get_public_catalog_products', { p_slug: slug });
  if (error) throw new Error(`[get_public_catalog_products] ${error.message}`);
  return (Array.isArray(data) ? data : []).map((product) => normalizePublicProduct(product as PublicProductPayload));
}

export async function getResellerCatalogStatus(slug: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_reseller_catalog_status', { p_slug: slug });
  if (error) throw new Error(`[get_reseller_catalog_status] ${error.message}`);
  return Boolean((data as { enabled?: boolean } | null)?.enabled);
}

export async function unlockResellerCatalog(slug: string, accessCode: string): Promise<PublicResellerCatalog> {
  const { data, error } = await supabase.rpc('unlock_reseller_catalog', {
    p_slug: slug,
    p_access_code: accessCode,
  });
  if (error) throw new Error(error.message);
  const payload = data as Omit<PublicResellerCatalog, 'products'> & { products?: PublicProductPayload[] };
  return {
    ...payload,
    minimumOrderAmount: Number(payload.minimumOrderAmount ?? 0),
    minimumOrderQuantity: Number(payload.minimumOrderQuantity ?? 0),
    products: (payload.products ?? []).map(normalizePublicProduct),
  };
}

interface PublicOrderInput {
  slug: string;
  channel: CatalogChannel;
  accessCode?: string;
  customer: {
    name: string;
    phone: string;
    email: string;
    address: string;
    message: string;
  };
  items: { productId: string; quantity: number }[];
}

export async function createPublicCatalogOrder(input: PublicOrderInput): Promise<{
  id: string;
  total: number;
  channel: CatalogChannel;
}> {
  const { data, error } = await supabase.rpc('create_public_catalog_order', {
    p_slug: input.slug,
    p_channel: input.channel,
    p_access_code: input.accessCode ?? '',
    p_customer: input.customer,
    p_items: input.items,
  });
  if (error) throw new Error(error.message);
  const result = data as { id: string; total: number; channel: CatalogChannel };
  return { ...result, total: Number(result.total) };
}
