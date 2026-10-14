export const SUPPLIER_ORDER_STATUSES = {
  pending: 'Pendiente de envío', transit: 'En camino', ready: 'Para retirar',
  received: 'Retirado / recibido', cancelled: 'Cancelado',
} as const;
export type SupplierOrderStatus = keyof typeof SUPPLIER_ORDER_STATUSES;
export interface SupplierOrder {
  id: string; user_id: string; supplier_name: string; ordered_on: string;
  reference: string; tracking_number: string | null; status: SupplierOrderStatus;
  notes: string; document_path: string | null; document_name: string | null;
  received_at: string | null; created_at: string; updated_at: string;
}
export const isPendingOrder = (order: SupplierOrder) => !['received', 'cancelled'].includes(order.status);
export function trackingUrl(guide: string): string {
  if (!/^\d{12}$/.test(guide)) throw new Error('La guía debe tener 12 dígitos.');
  return `https://formularios.viacargo.com.ar/seguimiento-envio/${guide}`;
}
export function sortSupplierOrders(orders: SupplierOrder[]): SupplierOrder[] {
  const priority = { ready: 0, transit: 1, pending: 2, received: 3, cancelled: 4 };
  return [...orders].sort((a, b) => priority[a.status] - priority[b.status]
    || a.ordered_on.localeCompare(b.ordered_on) || a.created_at.localeCompare(b.created_at));
}
export async function validateOrderPdf(file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith('.pdf') || file.size > 10 * 1024 * 1024) {
    throw new Error('Adjunta un PDF de hasta 10 MB.');
  }
  if (await file.slice(0, 5).text() !== '%PDF-') throw new Error('El archivo no es un PDF válido.');
}
