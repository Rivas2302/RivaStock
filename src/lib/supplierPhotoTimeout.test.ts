import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUPPLIER_PHOTO_TIMEOUT_MS, SupplierPhotoOperationTimeout, withSupplierPhotoTimeout } from './supplierPhotoTimeout';

describe('supplier photo operation timeouts', () => {
  afterEach(() => vi.useRealTimers());

  it('sets bounded deadlines for OCR, catalog images, and extension replies', () => {
    expect(SUPPLIER_PHOTO_TIMEOUT_MS).toEqual({
      worker: 30_000,
      catalogDownload: 15_000,
      extensionResponse: 10_000,
      recognition: 20_000,
      terminate: 3_000,
    });
  });

  it('rejects a hung recognition operation at its deadline', async () => {
    vi.useFakeTimers();
    const operation = withSupplierPhotoTimeout(() => new Promise<never>(() => undefined), 20_000, 'recognition');
    const rejection = expect(operation).rejects.toMatchObject({
      name: 'SupplierPhotoOperationTimeout', operation: 'recognition',
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
  });

  it('returns a completed operation without waiting for the deadline', async () => {
    vi.useFakeTimers();
    await expect(withSupplierPhotoTimeout(async () => 'ok', 15_000, 'catalogDownload')).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });
});
