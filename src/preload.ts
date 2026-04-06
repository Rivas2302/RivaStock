import { Category, PriceRange, Product, CatalogConfig, UserProfile } from './types';
import { db } from './lib/db';
import { slugify } from './lib/utils';

export const PRELOADED_CATEGORIES = [
  'Accesorio de belleza', 'Auriculares', 'Parlantes', 'Termos', 'Bazar', 
  'Computación', 'Cargadores', 'Juguetes', 'Joystick', 'Perfumes', 
  'Accesorios de cocina', 'Otros'
];

export const PRELOADED_PRICE_RANGES = [
  { minPrice: 1000, maxPrice: 8000, markupPercent: 135 },
  { minPrice: 8001, maxPrice: 13000, markupPercent: 90 },
  { minPrice: 13001, maxPrice: 18000, markupPercent: 70 },
  { minPrice: 19001, maxPrice: 28000, markupPercent: 50 },
  { minPrice: 29000, maxPrice: null, markupPercent: 30 }
];

export const PRELOADED_PRODUCTS = [
  { name: 'Secador de pelo', category: 'Accesorio de belleza', purchasePrice: 13596, salePrice: 25000, stock: 0 },
  { name: 'Planchita', category: 'Accesorio de belleza', purchasePrice: 7519, salePrice: 14000, stock: 1 },
  { name: 'Botella 3 en 1', category: 'Termos', purchasePrice: 7725, salePrice: 12000, stock: 1 },
  { name: 'Tender', category: 'Bazar', purchasePrice: 12360, salePrice: 30000, stock: 0 },
  { name: 'Ventiladores', category: 'Bazar', purchasePrice: 30800, salePrice: 55000, stock: 0 },
  { name: 'Soporte para TV', category: 'Otros', purchasePrice: 7398, salePrice: 16000, stock: 0 },
  { name: 'Mouse Gaming', category: 'Computación', purchasePrice: 2864, salePrice: 9000, stock: 1 },
  { name: 'Parlante GTS Mediano', category: 'Parlantes', purchasePrice: 15000, salePrice: 20000, stock: 2 },
  { name: 'Parlante X', category: 'Parlantes', purchasePrice: 5500, salePrice: 8000, stock: 0 },
  { name: 'Parlante Retro iluminado', category: 'Parlantes', purchasePrice: 5800, salePrice: 15000, stock: 0 },
  { name: 'Parlante Radio V1', category: 'Parlantes', purchasePrice: 13800, salePrice: 15000, stock: 1 },
  { name: 'Parlante Mini 4 en 1', category: 'Parlantes', purchasePrice: 12900, salePrice: 20000, stock: 1 },
  { name: 'Auriculares M90 Flux', category: 'Auriculares', purchasePrice: 5082, salePrice: 12000, stock: 2 },
  { name: 'Auricular JBL', category: 'Auriculares', purchasePrice: 14400, salePrice: 27000, stock: 0 },
  { name: 'Minipimer', category: 'Accesorios de cocina', purchasePrice: 16940, salePrice: 30000, stock: 2 },
  { name: 'Power Bank Solar', category: 'Cargadores', purchasePrice: 10400, salePrice: 25000, stock: 0 },
  { name: 'Power Bank PL81', category: 'Cargadores', purchasePrice: 11550, salePrice: 20000, stock: 0 },
  { name: 'Power Bank PL82', category: 'Cargadores', purchasePrice: 10010, salePrice: 0, stock: 0 },
  { name: 'Consola de Juegos SUP', category: 'Juguetes', purchasePrice: 10934, salePrice: 18000, stock: 0 },
  { name: 'Cargador de notebook', category: 'Cargadores', purchasePrice: 8624, salePrice: 16000, stock: 0 },
  { name: 'Pava Eléctrica', category: 'Bazar', purchasePrice: 16000, salePrice: 28000, stock: 0 },
  { name: 'Batidora', category: 'Accesorios de cocina', purchasePrice: 13090, salePrice: 23000, stock: 2 },
  { name: 'Caja de herramientas 46 piezas', category: 'Otros', purchasePrice: 7392, salePrice: 17000, stock: 0 },
  { name: 'Joystick PS4', category: 'Joystick', purchasePrice: 20020, salePrice: 27000, stock: 0 },
  { name: 'Pop It', category: 'Juguetes', purchasePrice: 3400, salePrice: 7000, stock: 1 },
  { name: 'Pistola Hidrogel', category: 'Juguetes', purchasePrice: 17300, salePrice: 24000, stock: 1 },
  { name: 'Parlante GTS Grande', category: 'Parlantes', purchasePrice: 13630, salePrice: 23000, stock: 3 },
  { name: 'Perfume 9AM Azul', category: 'Perfumes', purchasePrice: 21560, salePrice: 40000, stock: 0 },
  { name: 'Perfume ASAD Bourbon', category: 'Perfumes', purchasePrice: 9240, salePrice: 18000, stock: 2 },
  { name: 'Perfume Rave Now Rouge', category: 'Perfumes', purchasePrice: 16170, salePrice: 38000, stock: 0 }
];

export async function preloadUserData(uid: string) {
  // Ensure user exists in users collection
  let user = await db.get<UserProfile>('users', uid);
  if (!user) {
    const authUser = localStorage.getItem('rivatech_user');
    if (authUser) {
      user = JSON.parse(authUser);
      if (user) {
        if (!user.catalogSlug) {
          user.catalogSlug = await db.getUniqueSlug(slugify(user.businessName), 'users');
        }
        await db.create('users', user);
      }
    }
  } else if (!user.catalogSlug) {
    user.catalogSlug = await db.getUniqueSlug(slugify(user.businessName), 'users');
    await db.update('users', uid, { catalogSlug: user.catalogSlug });
  }

  // Check if already preloaded
  const existingProducts = await db.list<Product>('products', uid);
  if (existingProducts.length > 0) return;

  // Categories
  const createdCategories: Category[] = [];
  for (const name of PRELOADED_CATEGORIES) {
    const cat = await db.create<Category>('categories', { id: crypto.randomUUID(), name, ownerUid: uid });
    createdCategories.push(cat);
  }

  // Price Ranges
  for (const range of PRELOADED_PRICE_RANGES) {
    await db.create<PriceRange>('price_ranges', { id: crypto.randomUUID(), ...range, ownerUid: uid });
  }

  // Products
  for (const p of PRELOADED_PRODUCTS) {
    const category = createdCategories.find(c => c.name === p.category);
    await db.create<Product>('products', {
      id: crypto.randomUUID(),
      ...p,
      categoryId: category?.id || '',
      minStock: 2,
      showInCatalog: true,
      ownerUid: uid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  // Default Catalog Config
  await db.create<CatalogConfig>('catalog_configs', {
    id: crypto.randomUUID(),
    ownerUid: uid,
    businessName: user?.businessName || 'RivaTech',
    slug: user?.catalogSlug || ('rivatech-' + uid.slice(0, 5)),
    showPrices: true,
    showOutOfStock: true,
    showStock: true,
    enabled: true,
    welcomeMessage: '¡Bienvenido a nuestro catálogo!',
    primaryColor: '#6366f1',
    accentColor: '#6366f1',
    allowOrders: true,
    layout: 'Grid',
    fontStyle: 'Modern'
  });
}
