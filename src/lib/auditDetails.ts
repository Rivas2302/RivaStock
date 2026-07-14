import type { AuditEvent } from '../types';

export type AuditRecord = Record<string, unknown>;

export interface AuditDetailRow {
  field: string;
  label: string;
  before?: unknown;
  after?: unknown;
}

const INTERNAL_FIELDS = new Set([
  'id', 'user_id', 'owner_uid', 'ownerUid', 'created_at', 'createdAt', 'updated_at', 'updatedAt',
]);

const FIELD_LABELS: Record<string, string> = {
  name: 'Nombre', product_name: 'Producto', productName: 'Producto', description: 'Descripción',
  notes: 'Notas', stock: 'Stock', min_stock: 'Stock mínimo', minStock: 'Stock mínimo',
  purchase_price: 'Precio de compra', purchasePrice: 'Precio de compra',
  sale_price: 'Precio de venta', salePrice: 'Precio de venta', category: 'Categoría',
  barcode: 'Código de barras',
  show_in_catalog: 'Visible en catálogo', showInCatalog: 'Visible en catálogo',
  images: 'Imágenes', image_url: 'Imagen principal', imageUrl: 'Imagen principal',
  quantity: 'Cantidad', unit_price: 'Precio unitario', unitPrice: 'Precio unitario',
  total: 'Total', amount: 'Importe', status: 'Estado', payment_method: 'Medio de pago',
  paymentMethod: 'Medio de pago', client: 'Cliente', supplier: 'Proveedor', items: 'Ítems',
  custom_fields: 'Campos personalizados', customFields: 'Campos personalizados',
  date: 'Fecha operativa', type: 'Tipo de movimiento', source: 'Origen',
  sale_id: 'ID de venta relacionada', saleId: 'ID de venta relacionada',
  product_id: 'ID del producto', productId: 'ID del producto',
  category_id: 'ID de categoría', categoryId: 'ID de categoría',
  adjustment: 'Ajuste', difference: 'Diferencia', counted_cash: 'Efectivo contado',
  countedCash: 'Efectivo contado', expected_cash: 'Efectivo esperado', expectedCash: 'Efectivo esperado',
};

const FIELD_ORDER = [
  'name', 'product_name', 'productName', 'description', 'type', 'status', 'quantity',
  'stock', 'min_stock', 'minStock', 'purchase_price', 'purchasePrice', 'sale_price',
  'salePrice', 'unit_price', 'unitPrice', 'amount', 'total', 'adjustment', 'difference',
  'category', 'payment_method', 'paymentMethod', 'client', 'supplier', 'date', 'source',
  'items', 'notes', 'barcode', 'show_in_catalog', 'showInCatalog', 'images', 'image_url',
  'imageUrl', 'custom_fields', 'customFields',
];

const MONEY_FIELDS = new Set([
  'purchase_price', 'purchasePrice', 'sale_price', 'salePrice', 'unit_price', 'unitPrice',
  'amount', 'total', 'adjustment', 'difference', 'counted_cash', 'countedCash',
  'expected_cash', 'expectedCash',
]);

function asAuditRecord(value: unknown): AuditRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as AuditRecord
    : null;
}

export function getAuditSnapshots(event: AuditEvent): { before: AuditRecord | null; after: AuditRecord | null } {
  const metadata = asAuditRecord(event.metadata);
  return {
    before: asAuditRecord(metadata?.before),
    after: asAuditRecord(metadata?.after),
  };
}

function areEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isInternalField(field: string): boolean {
  return INTERNAL_FIELDS.has(field) || field.endsWith('_at') || field.endsWith('At');
}

export function formatAuditFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function formatDateOnly(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatAuditItems(value: unknown[], currencySymbol?: string): string {
  return value.map((item) => {
    const record = asAuditRecord(item);
    if (!record) return formatAuditValue(item);
    const name = record.product_name ?? record.productName ?? record.name ?? 'Ítem';
    const quantity = record.quantity;
    const price = record.unit_price ?? record.unitPrice ?? record.price;
    const parts = [String(name)];
    if (typeof quantity === 'number') parts.push(`× ${new Intl.NumberFormat('es-AR').format(quantity)}`);
    if (typeof price === 'number') parts.push(formatAuditValue(price, 'unit_price', currencySymbol));
    return parts.join(' · ');
  }).join('\n');
}

export function formatAuditValue(value: unknown, field?: string, currencySymbol?: string): string {
  if (value === null || value === undefined || value === '') return 'Sin valor';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') {
    const formatted = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(value);
    return field && MONEY_FIELDS.has(field) && currencySymbol ? `${currencySymbol} ${formatted}` : formatted;
  }
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return 'Imagen adjunta';
    if (field === 'date') return formatDateOnly(value) ?? value;
    return value;
  }
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string' && item.startsWith('data:image/'))) {
      return `${value.length} ${value.length === 1 ? 'imagen adjunta' : 'imágenes adjuntas'}`;
    }
    if (field === 'items' && value.length > 0) return formatAuditItems(value, currencySymbol);
    return value.length === 0 ? 'Sin elementos' : `${value.length} ${value.length === 1 ? 'elemento' : 'elementos'}`;
  }
  return JSON.stringify(value);
}

function fieldRank(field: string): number {
  const rank = FIELD_ORDER.indexOf(field);
  return rank === -1 ? FIELD_ORDER.length : rank;
}

/** Converts raw audit snapshots into a compact, human-readable list without exposing binary image data. */
export function getAuditDetailRows(event: AuditEvent): AuditDetailRow[] {
  const { before, after } = getAuditSnapshots(event);
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  return [...fields]
    .filter((field) => !isInternalField(field))
    .filter((field) => event.action !== 'update' || !areEqual(before?.[field], after?.[field]))
    .sort((left, right) => fieldRank(left) - fieldRank(right)
      || formatAuditFieldLabel(left).localeCompare(formatAuditFieldLabel(right), 'es'))
    .map((field) => ({
      field,
      label: formatAuditFieldLabel(field),
      before: before?.[field],
      after: after?.[field],
    }));
}
