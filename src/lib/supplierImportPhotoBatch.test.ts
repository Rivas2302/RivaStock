import { describe, expect, it, vi } from 'vitest';
import { processSupplierPhotoBatch } from './supplierImportPhotoBatch';

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
});
