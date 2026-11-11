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

export interface CatalogOrderMessageInput {
  businessName: string;
  orderCode: string;
  channel: 'retail' | 'reseller';
  items: Array<{ quantity: number; name: string; price: number; onOrder?: boolean }>;
  total: number;
  customerName: string;
}

export function formatRetailOrderCode(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Order number must be a positive integer.');
  return `P-${String(value).padStart(4, '0')}`;
}

function formatOrderAmount(value: number): string {
  return formatCurrency(value).replace(/\u00a0/g, ' ');
}

export function buildCatalogOrderWhatsAppMessage(input: CatalogOrderMessageInput): string {
  const lines = input.items.map(item =>
    `${item.quantity} × ${item.name}${item.onOrder ? ' (por pedido)' : ''} · ${formatOrderAmount(item.price)}`,
  );
  const customer = input.channel === 'reseller'
    ? `Soy ${input.customerName.trim()}, revendedor.`
    : `Soy ${input.customerName.trim()}.`;
  return [
    `Hola ${input.businessName.trim()}! ${customer} Te hice un pedido por el catálogo.`,
    `Pedido ${input.orderCode}`,
    ...lines,
    `Total: ${formatOrderAmount(input.total)}`,
    `Ver pedido: https://rivastock.vercel.app/pedidos/${encodeURIComponent(input.orderCode)}`,
  ].join('\n');
}

export function buildSuperOfferOrderWhatsAppMessage(input: {
  template: string;
  businessName: string;
  orderCode: string;
  items: Array<{ quantity: number; name: string; price: number }>;
  subtotal: number;
  shippingAmount: number;
  total: number;
}): string {
  const productLines = input.items.map(item => `${item.quantity} × ${item.name} · ${formatOrderAmount(item.price)}`).join('\n');
  const values: Record<string, string> = {
    negocio: input.businessName.trim(),
    codigo: input.orderCode,
    productos: productLines,
    subtotal: formatOrderAmount(input.subtotal),
    envio: formatOrderAmount(input.shippingAmount),
    total: formatOrderAmount(input.total),
    link: `https://rivastock.vercel.app/pedidos/${encodeURIComponent(input.orderCode)}`,
  };
  return input.template.replace(/\{(negocio|codigo|productos|subtotal|envio|total|link)\}/g, (_, key: string) => values[key]);
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
