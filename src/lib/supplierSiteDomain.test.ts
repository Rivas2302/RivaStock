import { describe, expect, it } from 'vitest';
import { getSupplierSiteDomain, isAllowedSupplierImageUrl, isKnownSupplierImageCdn, isSameSupplierSiteDomain } from './supplierSiteDomain';

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

  it('allows only HTTPS URLs on the supplier domain or a known image CDN', () => {
    expect(isAllowedSupplierImageUrl('https://catalogue.example.test', 'https://res.cloudinary.com/account/photo.webp?auto=format')).toBe(true);
    expect(isKnownSupplierImageCdn('https://images.example.imgix.net/photo.webp')).toBe(true);
    expect(isAllowedSupplierImageUrl('https://catalogue.example.test', 'https://other-store.invalid/photo.webp')).toBe(false);
    expect(isAllowedSupplierImageUrl('https://catalogue.example.test', 'http://res.cloudinary.com/account/photo.webp')).toBe(false);
    expect(isAllowedSupplierImageUrl('https://catalogue.example.test', 'https://res.cloudinary.com.evil.test/photo.webp')).toBe(false);
  });
});
