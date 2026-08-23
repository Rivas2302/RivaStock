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

export interface InventoryOwner {
  id: string;
  ownerUid: string;
  name: string;
  sortOrder: number;
  isPrimary: boolean;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryHolding {
  id: string;
  ownerUid: string;
  productId: string;
  inventoryOwnerId: string;
  stock: number;
  purchaseCost: number;
  minStock: number;
  active: boolean;
  ownerSortOrder?: number;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryOwnerMembership {
  id: string;
  ownerUid: string;
  actorUid: string;
  inventoryOwnerId: string;
  isDefault: boolean;
  canOperate: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryHoldingAllocation {
  holdingId: string;
  inventoryOwnerId: string;
  quantity: number;
}

export interface InventoryHoldingDraft {
  inventoryOwnerId: string;
  stock: number;
  purchaseCost: number;
  minStock: number;
  active: boolean;
}

export interface InventoryOperationSettings {
  ownerUid: string;
  holdingsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryStockCommand {
  id: string;
  ownerUid: string;
  idempotencyKey: string;
  productId: string;
  productName: string;
  inventoryOwnerId: string;
  inventoryOwnerName: string;
  actorUid: string;
  delta: number;
  reason: string;
  resultingStock: number;
  createdAt: string;
}

export interface PublicInventoryOwnerLabel {
  productId: string;
  inventoryOwnerName: string;
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
  catalogOnly?: boolean;
  catalogCost?: number | null;
  notes?: string;
  description?: string;
  barcode?: string;
  customFields?: Record<string, string | number | boolean | null>;
  inventoryOwnerId?: string;
  ownerUid: string;
  createdAt: string;
  updatedAt: string;
}

export type PriceListKind = 'reseller';
export type PriceListPricingMode = 'default' | 'discount' | 'fixed';
export type PriceListAvailability = 'in_stock' | 'on_order';
export type MinimumOrderRule = 'none' | 'amount' | 'quantity' | 'both';
export type CatalogChannel = 'retail' | 'reseller';

export interface PriceList {
  id: string;
  ownerUid: string;
  name: string;
  kind: PriceListKind;
  defaultDiscountPercent: number;
  publicEnabled: boolean;
  accessCodeConfigured: boolean;
  minimumRule: MinimumOrderRule;
  minimumOrderAmount: number;
  minimumOrderQuantity: number;
  minimumProfitMarginPercent: number;
  targetResellerDiscountPercent: number;
  createdAt: string;
  updatedAt: string;
}

export interface PriceListItem {
  id: string;
  ownerUid: string;
  priceListId: string;
  productId: string;
  pricingMode: PriceListPricingMode;
  discountPercent: number | null;
  fixedPrice: number | null;
  availability: PriceListAvailability;
  supplierListId?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResellerSupplierList {
  id: string;
  ownerUid: string;
  priceListId: string;
  supplierId: string;
  enabled: boolean;
  productIds: string[];
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
  paymentMethod?: 'Efectivo' | 'Transferencia' | 'Débito' | 'Crédito' | 'Otro';
  client?: string;
  ownerUid: string;
  items?: {
    productId: string;
    productName: string;
    quantity: number;
    price: number;
    discount?: number;
  }[];
  source?: 'pos' | 'quote' | 'manual';
}

export interface SaleItemSnapshot {
  id: string;
  ownerUid: string;
  saleId?: string;
  saleIdSnapshot: string;
  revision: number;
  lineNumber: number;
  productId?: string;
  productIdSnapshot?: string;
  productNameSnapshot: string;
  quantity: number;
  unitPrice: number;
  unitDiscount: number;
  discountAmount: number;
  adjustmentShare: number;
  lineTotal: number;
  actorUid?: string;
  snapshotSource: 'captured' | 'legacy_runtime' | 'legacy_estimated';
  snapshotReason?: string;
  reversedAt?: string;
  reversalReason?: string;
  createdAt: string;
}

export interface SaleItemAllocation {
  id: string;
  ownerUid: string;
  saleId?: string;
  saleIdSnapshot: string;
  saleItemId: string;
  inventoryHoldingId?: string;
  inventoryOwnerId?: string;
  inventoryOwnerIdSnapshot: string;
  inventoryOwnerNameSnapshot: string;
  productIdSnapshot?: string;
  productNameSnapshot: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  discountShare: number;
  adjustmentShare: number;
  revenueShare: number;
  costShare: number;
  allocationSource: 'manual_override' | 'default' | 'priority' | 'legacy_estimated';
  actorUid?: string;
  snapshotReason?: string;
  reversedAt?: string;
  reversalReason?: string;
  createdAt: string;
}

export interface AttributedSaleCommandItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
  preferredOwnerId?: string;
}

export interface StockMovement {
  id: string;
  ownerUid: string;
  idempotencyKey: string;
  productIdSnapshot?: string;
  productNameSnapshot: string;
  inventoryOwnerIdSnapshot: string;
  inventoryOwnerNameSnapshot: string;
  saleIdSnapshot?: string;
  saleItemId?: string;
  saleItemAllocationId?: string;
  actorUid?: string;
  movementType: 'sale' | 'edit_restore' | 'refund';
  delta: number;
  resultingStock: number;
  unitCostSnapshot: number;
  createdAt: string;
}

export interface CashFlowAllocation {
  id: string;
  ownerUid: string;
  cashFlowId?: string;
  cashFlowIdSnapshot: string;
  saleIdSnapshot: string;
  inventoryOwnerId?: string;
  inventoryOwnerIdSnapshot: string;
  inventoryOwnerNameSnapshot: string;
  amount: number;
  costAmount: number;
  actorUid?: string;
  snapshotSource: string;
  snapshotReason?: string;
  reversedAt?: string;
  reversalReason?: string;
  createdAt: string;
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
  inventoryOwnerId?: string;
  inventoryOwnerName?: string;
  actorUid?: string;
  idempotencyKey?: string;
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
  paymentMethod: 'Efectivo' | 'Transferencia' | 'Débito' | 'Crédito' | 'Otro';
  status: 'Pagado' | 'Pendiente';
  saleId?: string;
  ownerUid: string;
  notes?: string;
}

export interface CashClosing {
  id: string;
  ownerUid: string;
  date: string;
  expectedCash: number;
  countedCash: number;
  difference: number;
  notes?: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  ownerUid: string;
  actorUid?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
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
  channel?: CatalogChannel;
  priceListId?: string | null;
}

export interface PublicCatalogProduct extends Product {
  availability: PriceListAvailability | 'out_of_stock';
}

export interface PublicResellerCatalog {
  enabled: boolean;
  priceListId: string;
  minimumRule: MinimumOrderRule;
  minimumOrderAmount: number;
  minimumOrderQuantity: number;
  products: PublicCatalogProduct[];
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
  showStockQuantity: boolean;
  enabled: boolean;
  welcomeMessage: string;
  primaryColor: string;
  accentColor: string;
  allowOrders: boolean;
  layout: 'Grid' | 'List';
  fontStyle: 'Modern' | 'Classic' | 'Rounded';
  updatedAt?: string;
}

export type ModuleKey =
  | 'stock'
  | 'ventas'
  | 'caja'
  | 'ingresos'
  | 'pedidos'
  | 'presupuestos'
  | 'clientes'
  | 'proveedores'
  | 'config';

export type ActionKey = 'read' | 'write' | 'delete';

export type ModulePermissions = Record<ActionKey, boolean>;

export type PermissionMatrix = Record<ModuleKey, ModulePermissions>;

export type StaffRole = 'admin' | 'employee' | 'viewer' | 'custom';

export const ALL_TRUE_PERMISSIONS: PermissionMatrix = {
  stock:        { read: true, write: true, delete: true },
  ventas:       { read: true, write: true, delete: true },
  caja:         { read: true, write: true, delete: true },
  ingresos:     { read: true, write: true, delete: true },
  pedidos:      { read: true, write: true, delete: true },
  presupuestos: { read: true, write: true, delete: true },
  clientes:     { read: true, write: true, delete: true },
  proveedores:  { read: true, write: true, delete: true },
  config:       { read: true, write: true, delete: true },
};

export interface Collaborator {
  id: string;
  ownerUid: string;
  userUid: string;
  email: string;
  permissions: PermissionMatrix;
  rolePreset: StaffRole | null;
  invitationId: string | null;
  createdAt: string;
  revokedAt: string | null;
  isPending: boolean;
}

export interface Invitation {
  id: string;
  ownerUid: string;
  email: string;
  permissions: PermissionMatrix;
  rolePreset: StaffRole | null;
  invitedAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
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
  effectiveStatus?: QuoteStatus;
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

export interface Supplier {
  id: string;
  ownerUid: string;
  name: string;
  nameLower: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  cuit?: string;
  category?: string;
  notes?: string;
  paymentTerms?: string;
  catalogUrl?: string;
  facebookUrl?: string;
  instagramUrl?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerTransaction {
  id: string;
  ownerUid: string;
  customerId: string;
  type: TransactionType;
  amount: number;
  description: string;
  paymentMethod?: 'Efectivo' | 'Transferencia' | 'Débito' | 'Crédito' | 'Otro';
  relatedSaleId?: string;
  relatedQuoteId?: string;
  date: string;
  createdAt: string;
}

export const PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'Otro'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// ─── Reports & Analytics ────────────────────────────────────────────────────

export type ReportRangePreset = 'today' | '7d' | '30d' | 'thisMonth' | 'lastMonth' | 'custom';

export interface ReportFilters {
  preset: ReportRangePreset;
  from: string; // YYYY-MM-DD (local)
  to:   string; // YYYY-MM-DD (local), inclusive
}

export interface ReportKpis {
  totalSales:      number; // suma de `total` de ventas Pagado en el rango
  transactionCount:number; // cantidad de ventas (cualquier estado) en el rango
  paidCount:       number; // cantidad Pagado
  pendingCount:    number; // cantidad Pendiente/No Pagado
  averageTicket:   number; // totalSales / paidCount (0 si paidCount===0)
  pendingAmount:   number; // suma de ventas no pagadas
}

export interface ReportTopProduct {
  productId:   string;
  productName: string;
  quantity:    number;
  revenue:     number; // suma de (quantity * unitPrice) sin adjustment
}

export interface ReportPaymentSlice {
  paymentMethod: PaymentMethod | 'Sin especificar';
  total:         number;
  count:         number;
}

export interface ReportDailyPoint {
  date:  string; // YYYY-MM-DD
  total: number; // suma de ventas Pagado
  count: number;
}

/** Una fila para la tabla y para exportar. Es una versión "aplanada" de Sale. */
export interface ReportSaleRow {
  id:            string;
  date:          string;
  productName:   string;
  quantity:      number;
  unitPrice:     number;
  total:         number;
  paymentMethod: PaymentMethod | 'Sin especificar';
  status:        Sale['status'];
  client:        string | null;
  source:        Sale['source'] | null;
}

/** Payload completo que devuelve el RPC get_sales_report. */
export interface SalesReportData {
  kpis:           ReportKpis;
  daily:          ReportDailyPoint[];
  byPayment:      ReportPaymentSlice[];
  topProducts:    ReportTopProduct[];
  sales:          ReportSaleRow[];
  range:          { from: string; to: string };
}
