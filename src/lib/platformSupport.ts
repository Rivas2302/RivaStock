export function getRivaTechWhatsAppUrl(message: string): string {
  const number = (import.meta.env.VITE_RIVATECH_WHATSAPP_NUMBER as string | undefined)?.replace(/\D/g, '') ?? '';
  const base = number ? `https://wa.me/${number}` : 'https://wa.me/';
  return `${base}?text=${encodeURIComponent(message)}`;
}
