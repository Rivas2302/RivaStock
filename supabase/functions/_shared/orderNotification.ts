export interface PublicOrderNotificationItem {
  productName?: unknown;
  quantity?: unknown;
  price?: unknown;
}

export interface PublicOrderNotificationData {
  businessName: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerAddress: string;
  customerMessage: string;
  items: PublicOrderNotificationItem[];
  total: number;
  currencySymbol?: string;
}

export interface PublicOrderEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const safeValue = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const money = (value: unknown, symbol: string): string => {
  const amount = Number(value);
  const formatted = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(
    Number.isFinite(amount) ? amount : 0,
  );
  return `${symbol}${formatted}`;
};

export function buildPublicOrderEmail(data: PublicOrderNotificationData): PublicOrderEmail {
  const businessName = safeValue(data.businessName) || 'RivaStock';
  const customerName = safeValue(data.customerName);
  const customerPhone = safeValue(data.customerPhone);
  const customerEmail = safeValue(data.customerEmail);
  const customerAddress = safeValue(data.customerAddress);
  const customerMessage = safeValue(data.customerMessage);
  const symbol = safeValue(data.currencySymbol) || '$';
  const items = data.items.map(item => {
    const name = safeValue(item.productName) || 'Producto';
    const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
    const unitPrice = Number(item.price) || 0;
    return { name, quantity, unitPrice, lineTotal: quantity * unitPrice };
  });
  const textItems = items.map(item => `• ${item.quantity} × ${item.name} — ${money(item.unitPrice, symbol)} c/u — ${money(item.lineTotal, symbol)}`);
  const htmlItems = items.map(item => `<tr><td style="padding:12px 8px;border-bottom:1px solid #e2e8f0">${escapeHtml(String(item.quantity))} × ${escapeHtml(item.name)}</td><td style="padding:12px 8px;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap">${escapeHtml(money(item.unitPrice, symbol))} c/u</td><td style="padding:12px 8px;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap">${escapeHtml(money(item.lineTotal, symbol))}</td></tr>`);
  const optionalText = [customerEmail && `Email: ${customerEmail}`, customerAddress && `Dirección: ${customerAddress}`, customerMessage && `Nota: ${customerMessage}`].filter(Boolean).join('\n');
  const optionalHtml = [
    customerEmail && `<p style="margin:8px 0"><strong>Email:</strong> ${escapeHtml(customerEmail)}</p>`,
    customerAddress && `<p style="margin:8px 0"><strong>Dirección:</strong> ${escapeHtml(customerAddress)}</p>`,
    customerMessage && `<p style="margin:8px 0"><strong>Nota:</strong> ${escapeHtml(customerMessage)}</p>`,
  ].filter(Boolean).join('');
  const total = money(data.total, symbol);

  return {
    subject: `Nuevo pedido en ${businessName}`,
    text: `Nuevo pedido en ${businessName}\n\nCliente: ${customerName}\nTeléfono: ${customerPhone}${optionalText ? `\n${optionalText}` : ''}\n\nProductos:\n${textItems.join('\n')}\n\nTotal: ${total}\n\nRivaStock · RivaTech`,
    html: `<!doctype html><html lang="es"><body style="margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border-radius:16px;overflow:hidden"><tr><td style="background:#2563eb;padding:24px;color:#fff"><div style="font-size:20px;font-weight:700">RivaStock</div><div style="margin-top:8px;font-size:14px">Nuevo pedido · ${escapeHtml(businessName)}</div></td></tr><tr><td style="padding:24px"><h1 style="margin:0 0 18px;font-size:22px">Recibiste un pedido</h1><p style="margin:8px 0"><strong>Cliente:</strong> ${escapeHtml(customerName)}</p><p style="margin:8px 0"><strong>Teléfono:</strong> ${escapeHtml(customerPhone)}</p>${optionalHtml}<h2 style="margin:28px 0 8px;font-size:17px">Detalle</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><thead><tr><th align="left" style="padding:8px;border-bottom:2px solid #cbd5e1">Producto</th><th align="right" style="padding:8px;border-bottom:2px solid #cbd5e1">Precio</th><th align="right" style="padding:8px;border-bottom:2px solid #cbd5e1">Subtotal</th></tr></thead><tbody>${htmlItems.join('')}</tbody></table><p style="margin:20px 0 0;text-align:right;font-size:18px;font-weight:700">Total: ${escapeHtml(total)}</p></td></tr><tr><td style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px">RivaStock · RivaTech</td></tr></table></td></tr></table></body></html>`,
  };
}

export function isVerifiedResendSender(from: string | null | undefined): boolean {
  const value = from?.trim() ?? '';
  const address = value.match(/<([^<>]+)>/)?.[1] ?? value;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) && !address.toLowerCase().endsWith('@resend.dev');
}
