import { describe, expect, it, vi } from 'vitest';
import { fetchSupplierCaptureImage, receiveSupplierExtensionCapture, supplierExtensionItemsToRows } from './supplierExtensionCapture';

const captureId = 'a1b2c3d4-e5f6-4789-a012-123456789abc';
const item = (index: number, currency = 'ARS') => ({
  name: `Producto ${index}`,
  code: `SKU-${index}`,
  altCode: null,
  price: index + 1,
  currency,
  category: 'Cables',
  imageUrl: 'https://images.example.test/item.webp',
  images: ['https://images.example.test/item.webp'],
  url: `https://supplier.example.test/product/${index}`,
});

function chunk(offset: number, items: ReturnType<typeof item>[], total: number) {
  const nextOffset = offset + items.length;
  return {
    captureId,
    offset,
    nextOffset,
    total,
    done: nextOffset === total,
    items,
    origin: 'https://supplier.example.test',
    source: ['dom-cards'],
    warnings: [],
    capturedAt: new Date('2026-11-08T12:00:00Z').toISOString(),
  };
}

describe('supplier extension capture transfer', () => {
  it('receives products in chunks of 500 and keeps the local capture available for photo fallback', async () => {
    const products = Array.from({ length: 501 }, (_, index) => item(index));
    const offsets: number[] = [];
    const result = await receiveSupplierExtensionCapture(captureId, async (_id, offset) => {
      offsets.push(offset);
      return offset === 0 ? chunk(0, products.slice(0, 500), products.length) : chunk(offset, products.slice(offset), products.length);
    });

    expect(offsets).toEqual([0, 500]);
    expect(result.items).toHaveLength(501);
    expect(result.rows[500].sourceCode).toBe('SKU-500');
    expect(result.rows[0].supplierCost).toBe(1);
  });

  it('rejects a wrong capture ID, offset, or incomplete chunk', async () => {
    await expect(receiveSupplierExtensionCapture('invalid', vi.fn())).rejects.toThrow('no es válido');
    await expect(receiveSupplierExtensionCapture(captureId, async () => ({ ...chunk(0, [item(0)], 1), offset: 1 })))
      .rejects.toThrow('validación');
  });

  it('rejects captures from insecure, private, or credential-bearing URLs', async () => {
    const badOrigin = { ...chunk(0, [item(0)], 1), origin: 'https://supplier.example.test/?session=private' };
    await expect(receiveSupplierExtensionCapture(captureId, async () => badOrigin)).rejects.toThrow('validación');
    const badItem = { ...chunk(0, [item(0)], 1), items: [{ ...item(0), imageUrl: 'https://127.0.0.1/private.webp' }] };
    await expect(receiveSupplierExtensionCapture(captureId, async () => badItem)).rejects.toThrow('validación');
  });

  it('marks missing prices and mixed currencies for review without inventing a conversion', () => {
    const rows = supplierExtensionItemsToRows([
      { ...item(1), price: null },
      item(2, 'USD'),
      item(3, 'ARS'),
    ]);
    expect(rows[0].supplierCost).toBeNull();
    expect(rows[0].error).toContain('Sin precio');
    expect(rows.slice(1).every(row => row.error?.includes('mezcla monedas'))).toBe(true);
    expect(rows[1].imageUrl).toBe('https://images.example.test/item.webp');
  });

  it('does not pass through credentials, hashes, or non-HTTPS URLs into draft rows', () => {
    const rows = supplierExtensionItemsToRows([{
      ...item(1),
      imageUrl: 'https://images.example.test/photo.webp?access_token=secret',
      images: ['http://images.example.test/photo.webp'],
      url: 'https://supplier.example.test/product/1#session-secret',
    }]);
    expect(rows[0].imageUrl).toBeNull();
    expect(rows[0]).not.toHaveProperty('url');
    expect(JSON.stringify(rows)).not.toContain('secret');
  });

  it('requests an image fallback through the extension and enforces the 400 KB limit', async () => {
    const runtime = { sendMessage: vi.fn((_id: string, _message: unknown, callback: (value: unknown) => void) => {
      callback({ mimeType: 'image/webp', base64: 'AQID', size: 3 });
    }) };
    vi.stubGlobal('window', { chrome: { runtime } });
    const file = await fetchSupplierCaptureImage(captureId, 'https://supplier.example.test/item.webp');
    expect(file.type).toBe('image/webp');
    expect(file.size).toBe(3);
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.any(String), {
      type: 'supplier-capture-read-image', captureId, imageUrl: 'https://supplier.example.test/item.webp',
    }, expect.any(Function));
  });
});
