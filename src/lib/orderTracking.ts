export function getPublicOrderTrackingPath(orderId: string): string {
  const id = orderId.trim();
  if (!id) throw new Error('Falta el identificador privado del pedido.');
  return `/seguimiento-pedido/${encodeURIComponent(id)}`;
}

export function getPublicOrderTrackingUrl(orderId: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://rivastock.vercel.app';
  return `${origin}${getPublicOrderTrackingPath(orderId)}`;
}
