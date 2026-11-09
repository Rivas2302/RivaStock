import { describe, expect, it } from 'vitest';
import { getSupplierSiteDomain, isSameSupplierSiteDomain } from './supplierSiteDomain';

describe('supplier site domain', () => {
  it('allows the root domain and its HTTPS image subdomains', () => {
    expect(getSupplierSiteDomain('https://brajamayorista.com')).toBe('brajamayorista.com');
    expect(isSameSupplierSiteDomain('https://brajamayorista.com', 'https://api.brajamayorista.com/uploads/photo.webp')).toBe(true);
  });

  it('keeps public suffix tenants and unrelated domains isolated', () => {
    expect(isSameSupplierSiteDomain('https://shop.example.co.uk', 'https://images.example.co.uk/item.webp')).toBe(true);
    expect(isSameSupplierSiteDomain('https://alice.github.io', 'https://bob.github.io/photo.webp')).toBe(false);
    expect(isSameSupplierSiteDomain('https://supplier.example', 'https://supplier-other.example/photo.webp')).toBe(false);
    expect(isSameSupplierSiteDomain('https://127.0.0.1', 'https://api.127.0.0.1/photo.webp')).toBe(false);
  });
});
