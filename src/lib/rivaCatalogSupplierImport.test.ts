import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicCatalogProduct } from '../types';

const mocks = vi.hoisted(() => ({
  getPublicCatalogProduct: vi.fn(),
  getPublicCatalogProducts: vi.fn(),
  configResponse: { data: null as Record<string, unknown> | null, error: null as Error | null },
  download: vi.fn(),
  storageFrom: vi.fn(),
  from: vi.fn(),
}));

vi.mock('./publicCatalog', () => ({
  getPublicCatalogProduct: mocks.getPublicCatalogProduct,
  getPublicCatalogProducts: mocks.getPublicCatalogProducts,
}));
vi.mock('./supabase', () => ({
  supabaseProjectUrl: 'https://project.supabase.co',
  supabase: {
    from: mocks.from,
    storage: { from: mocks.storageFrom },
  },
}));

import {
  fetchRivaCatalogImage,
  getRivaCatalogStoragePath,
  loadRivaCatalogSupplierSource,
  parseRivaCatalogReference,
} from './rivaCatalogSupplierImport';

const product = (changes: Partial<PublicCatalogProduct> = {}): PublicCatalogProduct => ({
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Cable USB-C', categoryId: 'category', category: 'Accesorios',
  purchasePrice: 0, salePrice: 12500, stock: 0, minStock: 0,
  imageUrl: 'https://project.supabase.co/storage/v1/object/public/assets/owner/products/10000000/photo.webp',
  images: ['https://project.supabase.co/storage/v1/object/public/assets/owner/products/10000000/photo.webp'],
  showInCatalog: true, catalogOnly: false, ownerUid: '', createdAt: '', updatedAt: '', availability: 'in_stock',
  ...changes,
});

beforeEach(() => {
  mocks.getPublicCatalogProduct.mockReset();
  mocks.getPublicCatalogProducts.mockReset();
  mocks.download.mockReset();
  mocks.storageFrom.mockReset().mockReturnValue({ download: mocks.download });
  mocks.configResponse = { data: { business_name: 'Cuenta B', show_prices: true }, error: null };
  const query = {
    select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => mocks.configResponse),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  mocks.from.mockReset().mockReturnValue(query);
});

describe('RivaStock public catalog supplier source', () => {
  it('recognizes only public retail catalog and product routes', () => {
    expect(parseRivaCatalogReference('https://rivastock.vercel.app/catalogo/tienda-b')).toEqual({ slug: 'tienda-b' });
    expect(parseRivaCatalogReference('https://rivastock.vercel.app/catalogo/tienda-b/10000000-0000-4000-8000-000000000001'))
      .toEqual({ slug: 'tienda-b', productId: '10000000-0000-4000-8000-000000000001' });
    expect(() => parseRivaCatalogReference('https://rivastock.vercel.app/catalogo/tienda-b/revendedores')).toThrow('producto');
    expect(parseRivaCatalogReference('https://evil.example/catalogo/tienda-b')).toBeNull();
    expect(parseRivaCatalogReference('http://rivastock.vercel.app/catalogo/tienda-b')).toBeNull();
  });

  it('reads the public products of the requested business and maps no private fields', async () => {
    mocks.getPublicCatalogProducts.mockResolvedValue([
      product({ id: '10000000-0000-4000-8000-000000000002', purchasePrice: 900, stock: 42 }),
    ]);
    const source = await loadRivaCatalogSupplierSource('https://rivastock.vercel.app/catalogo/tienda-b');

    expect(mocks.from).toHaveBeenCalledWith('catalog_config');
    expect(mocks.getPublicCatalogProducts).toHaveBeenCalledWith('tienda-b');
    expect(source).toMatchObject({
      slug: 'tienda-b', businessName: 'Cuenta B', showPrices: true,
      items: [{ id: '10000000-0000-4000-8000-000000000002', name: 'Cable USB-C', price: 12500, category: 'Accesorios' }],
    });
    expect(source?.items[0]).not.toHaveProperty('stock');
    expect(source?.items[0]).not.toHaveProperty('purchasePrice');
    expect(source?.items[0].imageUrls).toHaveLength(1);
  });

  it('imports only the selected public product and hides prices when the catalog does', async () => {
    const publicProduct = product();
    mocks.configResponse = { data: { business_name: 'Cuenta B', show_prices: false }, error: null };
    mocks.getPublicCatalogProduct.mockResolvedValue(publicProduct);

    const source = await loadRivaCatalogSupplierSource('https://rivastock.vercel.app/catalogo/tienda-b/10000000-0000-4000-8000-000000000001');

    expect(mocks.getPublicCatalogProduct).toHaveBeenCalledWith('tienda-b', publicProduct.id);
    expect(mocks.getPublicCatalogProducts).not.toHaveBeenCalled();
    expect(source?.items).toMatchObject([{ id: publicProduct.id, price: null }]);
    expect(source?.items[0]).not.toHaveProperty('stock');
  });

  it('never reads the protected reseller catalog or calls the external page proxy', async () => {
    mocks.getPublicCatalogProducts.mockResolvedValue([product()]);
    await loadRivaCatalogSupplierSource('https://rivastock.vercel.app/catalogo/tienda-b');
    expect(mocks.getPublicCatalogProducts).toHaveBeenCalledOnce();
    expect(mocks.getPublicCatalogProduct).not.toHaveBeenCalled();
  });

  it('downloads only public assets from this Supabase project', async () => {
    const path = 'owner/products/item/photo.webp';
    const url = `https://project.supabase.co/storage/v1/object/public/assets/${path}`;
    expect(getRivaCatalogStoragePath(url)).toBe(path);
    expect(getRivaCatalogStoragePath(url.replace('/public/assets/', '/sign/assets/'))).toBeNull();
    expect(getRivaCatalogStoragePath(url.replace('project.supabase.co', 'other.supabase.co'))).toBeNull();
    expect(getRivaCatalogStoragePath(url.replace('/products/item/photo.webp', '/products/../photo.webp'))).toBeNull();

    mocks.download.mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }), error: null });
    const file = await fetchRivaCatalogImage(url);
    expect(file.type).toBe('image/webp');
    expect(file.size).toBe(3);
    expect(mocks.storageFrom).toHaveBeenCalledWith('assets');
    expect(mocks.download).toHaveBeenCalledWith(path);
  });
});
