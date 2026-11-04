import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { buildBusinessExportArchive, type BusinessExportManifest } from './businessExport';

const manifest: BusinessExportManifest = {
  business_name: 'Tienda de prueba',
  tables: [{ name: 'products' }],
  objects: [{ bucket_id: 'assets', name: 'owner/photos/front.webp', size: 3, signed_url: 'https://storage.example/signed' }],
};

describe('business account export', () => {
  it('paginates all table rows and includes Storage bytes in the archive', async () => {
    const loadTablePage = vi.fn(async (_name: string, offset: number) =>
      offset === 0
        ? Array.from({ length: 500 }, (_, index) => ({ id: index }))
        : [{ id: 500 }],
    );
    const archive = await buildBusinessExportArchive(manifest, loadTablePage, async () => new Uint8Array([1, 2, 3]));
    const files = unzipSync(archive.bytes);

    expect(archive).toMatchObject({ rowCount: 501, objectCount: 1 });
    expect(loadTablePage).toHaveBeenNthCalledWith(1, 'products', 0, 500);
    expect(loadTablePage).toHaveBeenNthCalledWith(2, 'products', 500, 500);
    expect(JSON.parse(strFromU8(files['data/products.json']))).toHaveLength(501);
    expect([...files['storage/assets/owner/photos/front.webp']]).toEqual([1, 2, 3]);
    expect(JSON.parse(strFromU8(files['manifest.json'])).tables.products).toBe(501);
  });

  it('rejects unsafe tables and reports a missing Storage object instead of offering an incomplete archive', async () => {
    await expect(buildBusinessExportArchive({ ...manifest, tables: [{ name: '../profiles' }] }, vi.fn(), vi.fn()))
      .rejects.toThrow('tabla inválida');

    await expect(buildBusinessExportArchive(manifest, async () => [], async () => {
      throw new Error('No se pudo incluir un archivo en la copia.');
    })).rejects.toThrow('No se pudo incluir un archivo');
  });
});
