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
  phone?: string;
  email_contact?: string;
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
  images?: string[];
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
  createdAt?: string;
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
  createdAt?: string;
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
  createdAt?: string;
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
  instagramUrl?: string;
  facebookUrl?: string;
  contactEmail?: string;
  aboutText?: string;
  slug: string;
  showPrices: boolean;
  showOutOfStock: boolean;
  showStock: boolean;
  enabled: boolean;
  welcomeMessage: string;
  primaryColor: string;
  accentColor: string;
  allowOrders: boolean;
  layout: 'Grid' | 'List';
  fontStyle: 'Modern' | 'Classic' | 'Rounded';
  updatedAt?: string;
}

export interface Collaborator {
  id: string;
  ownerUid: string;
  email: string;
  role: 'admin' | 'viewer';
  status: 'pending' | 'active';
}

export interface QuoteItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export interface Quote {
  id: string;
  ownerUid: string;
  number: string;
  clientId: string;
  clientName: string;
  clientPhone?: string;
  clientEmail?: string;
  items: QuoteItem[];
  subtotal: number;
  discount: number;
  total: number;
  status: QuoteStatus;
  validDays: 7 | 15 | 30;
  expiresAt: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  convertedToSaleId?: string;
}

export interface Customer {
  id: string;
  ownerUid: string;
  name: string;
  nameLower: string;
  phone?: string;
  email?: string;
  notes?: string;
  currentBalance: number;
  createdAt: string;
  updatedAt: string;
}

export type TransactionType = 'sale' | 'payment' | 'adjustment';

export interface CustomerTransaction {
  id: string;
  ownerUid: string;
  customerId: string;
  type: TransactionType;
  amount: number;
  description: string;
  relatedSaleId?: string;
  relatedQuoteId?: string;
  date: string;
  createdAt: string;
}
