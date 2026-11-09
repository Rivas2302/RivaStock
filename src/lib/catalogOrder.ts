import { formatCurrency } from './utils';

export type DeliveryMethod = 'pickup' | 'shipping';

export interface RetailOrderMessageInput {
  businessName: string;
  orderCode: string;
  items: Array<{ quantity: number; name: string; price: number }>;
  total: number;
  customerName: string;
  deliveryMethod: DeliveryMethod;
  address?: string;
}

export function formatRetailOrderCode(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Order number must be a positive integer.');
  return `P-${String(value).padStart(4, '0')}`;
}

function formatOrderAmount(value: number): string {
  return formatCurrency(value).replace(/\u00a0/g, ' ');
}

export function buildRetailOrderWhatsAppMessage(input: RetailOrderMessageInput): string {
  const delivery = input.deliveryMethod === 'shipping'
    ? `Envío${input.address?.trim() ? ` · ${input.address.trim()}` : ''}`
    : 'Retiro';
  const lines = input.items.map(item => `${item.quantity} × ${item.name} · ${formatOrderAmount(item.price)}`);
  return [
    `Hola ${input.businessName.trim()}! Te hice un pedido por el catálogo.`,
    `Pedido ${input.orderCode}`,
    ...lines,
    `Total: ${formatOrderAmount(input.total)}`,
    `Nombre: ${input.customerName.trim()}`,
    `Entrega: ${delivery}`,
    `Ver pedido: https://rivastock.vercel.app/pedidos/${encodeURIComponent(input.orderCode)}`,
  ].join('\n');
}
