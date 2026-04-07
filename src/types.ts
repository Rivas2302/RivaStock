export type UserRole = 'admin' | 'viewer';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  businessName: string;
  businessNameLower: string;
  currencySymbol: string;
  darkMode: boolean;
  createdAt: string;
  catalogSlug?: string;
}

export interface Category {
  id: string;
  name: string;
  ownerUid: string;
}

export interface PriceRange {
  id: string;
  minPrice: number;
  maxPrice: number | null;
  markupPercent: number;
  ownerUid: string;
}

export interface Product {
  id: string;
  name: string;
  categoryId: string;
  category: string;
  purchasePrice: number;
  salePrice: number;
  stock: number;
  minStock: number;
  imageUrl?: string;
  showInCatalog: boolean;
  notes?: string;
  description?: string;
  customFields?: Record<string, any>;
  ownerUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface Sale {
  id: string;
  date: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  adjustment: number;
  total: number;
  status: 'Pagado' | 'No Pagado' | 'Pendiente';
  paymentMethod?: 'Efectivo' | 'Transferencia' | 'Otro';
  client?: string;
  ownerUid: string;
  items?: {
    productId: string;
    productName: string;
    quantity: number;
    price: number;
  }[];
}

export interface StockIntake {
  id: string;
  date: string;
  productId: string;
  productName: string;
  quantity: number;
  purchasePrice: number;
  supplier?: string;
  notes?: string;
  ownerUid: string;
}

export interface CashFlowEntry {
  id: string;
  date: string;
  type: 'Ingreso' | 'Gasto';
  source: 'Venta' | 'Manual' | 'Gasto';
  description: string;
  category: string;
  amount: number;
  paymentMethod: 'Efectivo' | 'Transferencia' | 'Otro';
  status: 'Pagado' | 'Pendiente';
  saleId?: string;
  ownerUid: string;
  notes?: string;
}

export interface Order {
  id: string;
  date: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  customerMessage?: string;
  items: {
    productId: string;
    productName: string;
    quantity: number;
    price: number;
  }[];
  total: number;
  status: 'Nuevo' | 'En Proceso' | 'Entregado' | 'Cancelado';
  isRead: boolean;
  ownerUid: string;
}

export interface CatalogConfig {
  id: string;
  ownerUid: string;
  businessName: string;
  tagline?: string;
  logoUrl?: string;
  bannerUrl?: string;
  bannerColor?: string;
  whatsappNumber?: string;
  instagramHandle?: string;
  contactEmail?: string;
  aboutText?: string;
  slug: string;
  showPrices: boolean;
  showOutOfStock: boolean;
  showStock: boolean;
  enabled: boolean;
  welcomeMessage: string;
  primaryColor: string;
  allowOrders: boolean;
  accentColor: string;
  layout: 'Grid' | 'List';
  fontStyle: 'Modern' | 'Classic' | 'Rounded';
}

export interface Collaborator {
  id: string;
  ownerUid: string;
  email: string;
  role: 'admin' | 'viewer';
  status: 'pending' | 'active';
}
