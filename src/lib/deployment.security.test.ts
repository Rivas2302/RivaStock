import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
describe('deployment security and cache configuration', () => {
  it('uses valid header rules and caches only content-hashed static assets immutably', () => {
    for (const rule of config.headers) {
      expect(typeof rule.source).toBe('string');
      for (const header of rule.headers) {
        expect(Object.keys(header).sort()).toEqual(['key','value']);
        expect(typeof header.value).toBe('string');
        if (header.key === 'Cache-Control' && header.value.includes('immutable')) expect(rule.source).toBe('/assets/(.*)');
      }
    }
  });
  it('retains restricted frames and enables HSTS', () => {
    const headers = config.headers.find((rule: {source:string}) => rule.source === '/(.*)').headers;
    expect(headers.find((h: {key:string}) => h.key === 'Strict-Transport-Security').value).toBe('max-age=31536000');
    const csp = headers.find((h: {key:string}) => h.key === 'Content-Security-Policy').value;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp.split(';').find((directive:string) => directive.trim().startsWith('frame-src'))).toBe(" frame-src 'self' blob: https://formularios.viacargo.com.ar https://nkfqhuqrgrpfufdymkcr.supabase.co");
  });
});
