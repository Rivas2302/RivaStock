import { describe, expect, it, vi } from 'vitest';
import { processSupplierPhotoBatch } from './supplierImportPhotoBatch';
import { withSupplierPhotoTimeout } from './supplierPhotoTimeout';

describe('supplier catalog photo batches', () => {
  it('continues after one photo fails and reports each item in progress', async () => {
    const processed: number[] = [];
    const progress: Array<[number, number]> = [];
    const failed: number[] = [];
    const failures = await processSupplierPhotoBatch([1, 2, 3], async value => {
      processed.push(value);
      if (value === 2) throw new Error('download failed');
    }, (done, total) => progress.push([done, total]), value => failed.push(value));

    expect(processed).toEqual([1, 2, 3]);
    expect(failures).toBe(1);
    expect(failed).toEqual([2]);
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('does not attempt image work when the selected batch is empty', async () => {
    const processPhoto = vi.fn();
    await expect(processSupplierPhotoBatch([], processPhoto)).resolves.toBe(0);
    expect(processPhoto).not.toHaveBeenCalled();
  });

  it('marks a hung OCR photo as failed and continues through the rest of the batch', async () => {
    vi.useFakeTimers();
    const processed: number[] = [];
    const progress: Array<[number, number]> = [];
    const failed: number[] = [];
    const batch = processSupplierPhotoBatch([1, 2, 3], async value => {
      if (value === 2) {
        await withSupplierPhotoTimeout(() => new Promise<never>(() => undefined), 20_000, 'recognition');
      }
      processed.push(value);
    }, (done, total) => progress.push([done, total]), value => failed.push(value));

    await vi.advanceTimersByTimeAsync(20_000);
    await expect(batch).resolves.toBe(1);
    expect(processed).toEqual([1, 3]);
    expect(failed).toEqual([2]);
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('marks an unavailable image download as failed without blocking the next image', async () => {
    const processed: number[] = [];
    const progress: Array<[number, number]> = [];
    const failed: number[] = [];
    const batch = processSupplierPhotoBatch([1, 2], async value => {
      if (value === 1) throw new Error('download failed');
      processed.push(value);
    }, (done, total) => progress.push([done, total]), value => failed.push(value));

    await expect(batch).resolves.toBe(1);
    expect(processed).toEqual([2]);
    expect(failed).toEqual([1]);
    expect(progress).toEqual([[1, 2], [2, 2]]);
  });
});
