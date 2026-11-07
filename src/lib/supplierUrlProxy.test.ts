import { describe, expect, it } from 'vitest';
import {
  assertPublicDns,
  createInMemoryRateLimiter,
  extractVisibleSupplierText,
  isPublicIpAddress,
  readLimitedResponseText,
  validateSupplierPageUrl,
} from '../../supabase/functions/_shared/supplierUrlProxy';

describe('supplier URL proxy safeguards', () => {
  it.each(['http://supplier.example/list', 'https://127.0.0.1/list', 'https://10.1.2.3/list', 'https://[::1]/list', 'https://supplier.local/list', 'https://supplier.example:8443/list'])
  ('rejects unsafe source URL %s', url => {
    expect(() => validateSupplierPageUrl(url)).toThrow();
  });

  it('rejects a public hostname if DNS includes any private address', async () => {
    await expect(assertPublicDns('supplier.example', async (_hostname, type) => type === 'A'
      ? ['93.184.216.34']
      : ['fd00::1'])).rejects.toThrow('dirección pública');
    await expect(assertPublicDns('supplier.example', async (_hostname, type) => type === 'A'
      ? ['93.184.216.34']
      : [])).resolves.toBeUndefined();
  });

  it.each(['0.1.2.3', '10.0.0.1', '127.0.0.1', '169.254.1.1', '172.16.1.1', '192.168.1.1', '198.51.100.5', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1'])
  ('does not treat reserved address %s as public', address => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it('extracts table text and excludes script and navigation content', () => {
    const html = '<html><body><nav>Menú</nav><script>secreto</script><table><tr><th>Producto</th><th>Costo</th></tr><tr><td>Vaso &amp; taza</td><td>$ 2500</td></tr></table></body></html>';
    expect(extractVisibleSupplierText(html, 'text/html; charset=utf-8')).toBe('Producto\tCosto\nVaso & taza\t$ 2500');
  });

  it('rejects a response body above two megabytes even when Content-Length is absent', async () => {
    const response = new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/plain' } });
    await expect(readLimitedResponseText(response)).rejects.toThrow('2 MB');
  });

  it('limits requests per key and resets the window', () => {
    const limiter = createInMemoryRateLimiter(2, 60_000);
    expect(limiter('ip-a', 100)).toBe(true);
    expect(limiter('ip-a', 101)).toBe(true);
    expect(limiter('ip-a', 102)).toBe(false);
    expect(limiter('ip-a', 60_100)).toBe(true);
  });
});
