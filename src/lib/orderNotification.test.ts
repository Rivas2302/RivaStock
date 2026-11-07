import { describe, expect, it } from 'vitest';
import { buildPublicOrderEmail, isVerifiedResendSender } from '../../supabase/functions/_shared/orderNotification';

describe('public order notification email', () => {
  it('includes order details in accessible HTML and plain text, escaping customer content', () => {
    const email = buildPublicOrderEmail({
      businessName: '<Tienda>',
      customerName: 'Ana & Luis',
      customerPhone: '+54 11 5555-1111',
      customerEmail: 'ana@example.com',
      customerAddress: 'Calle <Uno>',
      customerMessage: 'Dejar en recepción',
      items: [{ productName: 'Cable USB', quantity: 2, price: 1250 }],
      total: 2500,
    });

    expect(email.subject).toBe('Nuevo pedido en <Tienda>');
    expect(email.html).toContain('Ana &amp; Luis');
    expect(email.html).toContain('Calle &lt;Uno&gt;');
    expect(email.html).toContain('2 × Cable USB');
    expect(email.html).toContain('$2.500');
    expect(email.text).toContain('Dejar en recepción');
    expect(email.text).toContain('ana@example.com');
  });

  it('rejects the Resend sandbox sender', () => {
    expect(isVerifiedResendSender('RivaStock <pedidos@rivastock.com>')).toBe(true);
    expect(isVerifiedResendSender('RivaStock <onboarding@resend.dev>')).toBe(false);
    expect(isVerifiedResendSender(null)).toBe(false);
  });
});
