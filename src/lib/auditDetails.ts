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
  category_id: 'Categoría', categoryId: 'Categoría', barcode: 'Código de barras',
  show_in_catalog: 'Visible en catálogo', showInCatalog: 'Visible en catálogo',
  images: 'Imágenes', image_url: 'Imagen principal', imageUrl: 'Imagen principal',
  quantity: 'Cantidad', unit_price: 'Precio unitario', unitPrice: 'Precio unitario',
  total: 'Total', amount: 'Importe', status: 'Estado', payment_method: 'Medio de pago',
  paymentMethod: 'Medio de pago', client: 'Cliente', supplier: 'Proveedor', items: 'Ítems',
  custom_fields: 'Campos personalizados', customFields: 'Campos personalizados',
};

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

export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Sin valor';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return new Intl.NumberFormat('es-AR').format(value);
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return 'Imagen adjunta';
    return value;
  }
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string' && item.startsWith('data:image/'))) {
      return `${value.length} ${value.length === 1 ? 'imagen adjunta' : 'imágenes adjuntas'}`;
    }
    return value.length === 0 ? 'Sin elementos' : `${value.length} ${value.length === 1 ? 'elemento' : 'elementos'}`;
  }
  return JSON.stringify(value);
}

/** Converts raw audit snapshots into a compact, human-readable list without exposing binary image data. */
export function getAuditDetailRows(event: AuditEvent): AuditDetailRow[] {
  const { before, after } = getAuditSnapshots(event);
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  return [...fields]
    .filter((field) => !isInternalField(field))
    .filter((field) => event.action !== 'update' || !areEqual(before?.[field], after?.[field]))
    .sort((left, right) => formatAuditFieldLabel(left).localeCompare(formatAuditFieldLabel(right), 'es'))
    .map((field) => ({
      field,
      label: formatAuditFieldLabel(field),
      before: before?.[field],
      after: after?.[field],
    }));
}
