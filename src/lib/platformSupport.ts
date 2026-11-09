const DEFAULT_RIVATECH_WHATSAPP_NUMBER = '5492302381814';

export function getRivaTechWhatsAppUrl(message: string): string {
  const configuredNumber = (import.meta.env.VITE_RIVATECH_WHATSAPP_NUMBER as string | undefined)?.replace(/\D/g, '');
  const number = configuredNumber || DEFAULT_RIVATECH_WHATSAPP_NUMBER;
  const base = `https://wa.me/${number}`;
  return `${base}?text=${encodeURIComponent(message)}`;
}
