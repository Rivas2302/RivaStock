import { afterEach, describe, expect, it, vi } from 'vitest';
import { cropSupplierListImage } from './SupplierListPhotoPicker';

describe('supplier list manual photo crop', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('creates a WebP file from the selected screenshot rectangle', async () => {
    const drawImage = vi.fn();
    const close = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (callback: BlobCallback) => callback(new Blob(['cropped'], { type: 'image/webp' })),
    };
    vi.stubGlobal('document', { createElement: () => canvas });
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1000, height: 500, close }));
    const screenshot = new File(['source'], 'capture.png', { type: 'image/png' });

    const photo = await cropSupplierListImage(screenshot, { x: 100, y: 50, width: 300, height: 200 }, 1000, 500);

    expect(photo.type).toBe('image/webp');
    expect(photo.name).toBe('foto-proveedor.webp');
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(200);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 100, 50, 300, 200, 0, 0, 300, 200);
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects undersized selections and unsupported files', async () => {
    const screenshot = new File(['source'], 'capture.png', { type: 'image/png' });
    await expect(cropSupplierListImage(screenshot, { x: 0, y: 0, width: 4, height: 4 }, 100, 100))
      .rejects.toThrow('Seleccioná un recorte más grande.');
    await expect(cropSupplierListImage(new File(['text'], 'notes.txt', { type: 'text/plain' }), { x: 0, y: 0, width: 20, height: 20 }, 100, 100))
      .rejects.toThrow('Elegí una imagen de hasta 10 MB.');
  });
});
