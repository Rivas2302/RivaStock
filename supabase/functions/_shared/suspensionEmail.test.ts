import { describe, expect, it } from 'vitest';
import { buildSuspensionEmail } from './suspensionEmail';

describe('approved suspension email', () => {
  it('uses the approved layout, replaces all variables, and escapes business-provided content', () => {
    const message = buildSuspensionEmail({
      businessName: '<Tienda & Hijos>',
      suspensionDate: '15/11/2026',
      whatsappUrl: 'https://wa.me/5492302111111?text=Hola%20RivaTech',
    });
    expect(message.subject).toBe('Aviso: tu cuenta de RivaStock se suspende el 15/11/2026');
    expect(message.html).toContain('Tu cuenta se suspende el 15/11/2026');
    expect(message.html).toContain('Hola, &lt;Tienda &amp; Hijos&gt;.');
    expect(message.html).not.toContain('{{business_name}}');
    expect(message.html).not.toContain('{{suspension_date}}');
    expect(message.html).toContain('RivaStock · RivaTech');
    expect(message.text).toContain('<Tienda & Hijos>');
  });
});
