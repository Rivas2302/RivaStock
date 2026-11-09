export const DEFAULT_RESELLER_BUYING_POLICY = [
  'Pedís cuando quieras y pagás por adelantado (se coordina por WhatsApp).',
  'Cada proveedor tiene un mínimo de compra. Si tu pedido no llega al mínimo, queda “En espera”.',
  'Los precios son por unidad.',
  'El envío se cobra una vez que el pedido llega a General Pico, antes de la entrega.',
  'Retiro en General Pico.',
  'Si falta un producto, elegís devolución o saldo a favor.',
  'Los productos con falla tienen la garantía del proveedor.',
].join('\n');

export function getResellerBuyingPolicyLines(policy: string): string[] {
  return policy
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^[-*]\s+/, ''))
    .filter(Boolean);
}
