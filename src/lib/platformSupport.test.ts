import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRivaTechWhatsAppUrl } from './platformSupport';

describe('getRivaTechWhatsAppUrl', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses the configured RivaTech number by default', () => {
    vi.stubEnv('VITE_RIVATECH_WHATSAPP_NUMBER', '');

    expect(getRivaTechWhatsAppUrl('Necesito ayuda')).toBe(
      'https://wa.me/5492302381814?text=Necesito%20ayuda',
    );
  });

  it('normalizes a configured override and encodes the message', () => {
    vi.stubEnv('VITE_RIVATECH_WHATSAPP_NUMBER', '+1 (202) 555-0100');

    expect(getRivaTechWhatsAppUrl('Hola RivaTech, ¿me ayudás?')).toBe(
      'https://wa.me/12025550100?text=Hola%20RivaTech%2C%20%C2%BFme%20ayud%C3%A1s%3F',
    );
  });
});
