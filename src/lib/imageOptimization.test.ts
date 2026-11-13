import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitImageDimensions, hasPngAnimation, imageFileExtension, ImageProcessingError, optimizeCatalogCover, optimizeSupplierCatalogPhoto, optimizeUploadImage, resetWebPEncoderDetectionForTests } from './imageOptimization';

const wasmEncoder = vi.hoisted(() => ({ encodeWebPWithWasm: vi.fn() }));
vi.mock('./webpWasmEncoder', () => wasmEncoder);

afterEach(() => {
  vi.unstubAllGlobals();
  resetWebPEncoderDetectionForTests();
  wasmEncoder.encodeWebPWithWasm.mockReset();
});

/** Canvas double that behaves like Safari: asked for WebP, it answers with PNG. */
function safariCanvas() {
  const pixels = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
  const toBlob = vi.fn((fn: (blob: Blob) => void) => fn(new Blob([new Uint8Array(900_000)], { type: 'image/png' })));
  const getImageData = vi.fn(() => pixels);
  return { canvas: { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn(), getImageData }), toBlob }, toBlob, getImageData, pixels };
}

describe('WebP encoding on browsers without a native encoder (Safari / iPhone)', () => {
  it('uploads a product photo as genuine WebP through the WASM encoder', async () => {
    const { canvas, toBlob, getImageData, pixels } = safariCanvas();
    wasmEncoder.encodeWebPWithWasm.mockResolvedValue(new Blob([new Uint8Array(180_000)], { type: 'image/webp' }));
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4032, height: 3024, close: vi.fn() }));
    vi.stubGlobal('document', { createElement: () => canvas });
    const photo = new File([new Uint8Array(3_000_000)], 'IMG_0001.jpeg', { type: 'image/jpeg' });

    const original = await optimizeUploadImage(photo, 1600, { forceWebP: true, maxBytes: 2 * 1024 * 1024 });
    const thumbnail = await optimizeUploadImage(original, 480, { forceWebP: true, maxBytes: 300_000 });

    expect(original.type).toBe('image/webp');
    expect(original.name).toBe('IMG_0001.webp');
    expect(original.size).toBe(180_000);
    expect(thumbnail.type).toBe('image/webp');
    expect(wasmEncoder.encodeWebPWithWasm).toHaveBeenNthCalledWith(1, pixels, 0.85);
    expect(getImageData).toHaveBeenCalledWith(0, 0, 1600, 1200);
    // The PNG answer is remembered: the second image goes straight to WASM.
    expect(toBlob).toHaveBeenCalledOnce();
    expect(wasmEncoder.encodeWebPWithWasm).toHaveBeenCalledTimes(2);
  });
  it('lowers WASM quality until the photo fits the storage limit', async () => {
    const { canvas } = safariCanvas();
    wasmEncoder.encodeWebPWithWasm.mockImplementation(async (_image: unknown, quality: number) => (
      new Blob([new Uint8Array(quality <= 0.75 ? 1_500_000 : 2_500_000)], { type: 'image/webp' })
    ));
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4032, height: 3024, close: vi.fn() }));
    vi.stubGlobal('document', { createElement: () => canvas });

    const optimized = await optimizeUploadImage(
      new File([new Uint8Array(5_000_000)], 'big.jpg', { type: 'image/jpeg' }), 1600, { forceWebP: true, maxBytes: 2 * 1024 * 1024 },
    );

    expect(optimized.size).toBe(1_500_000);
    expect(wasmEncoder.encodeWebPWithWasm.mock.calls.map(call => call[1])).toEqual([0.85, 0.75]);
  });
  it('reports compression_failed only when the WASM encoder also fails', async () => {
    const { canvas } = safariCanvas();
    wasmEncoder.encodeWebPWithWasm.mockRejectedValue(new Error('wasm blocked'));
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 800, height: 600, close: vi.fn() }));
    vi.stubGlobal('document', { createElement: () => canvas });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(optimizeUploadImage(
      new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' }), 1600, { forceWebP: true },
    )).rejects.toMatchObject({ code: 'compression_failed' });
    consoleError.mockRestore();
  });
  it('compresses catalog covers and supplier photos on Safari too', async () => {
    const { canvas } = safariCanvas();
    wasmEncoder.encodeWebPWithWasm.mockResolvedValue(new Blob([new Uint8Array(40_000)], { type: 'image/webp' }));
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2000, height: 1000, close: vi.fn() }));
    vi.stubGlobal('document', { createElement: () => canvas });

    const cover = await optimizeCatalogCover(new File([new Uint8Array(900_000)], 'cover.jpg', { type: 'image/jpeg' }));
    const supplier = await optimizeSupplierCatalogPhoto(new File([new Uint8Array(200_000)], 'supplier.jpg', { type: 'image/jpeg' }));

    expect(cover.type).toBe('image/webp');
    expect(supplier.type).toBe('image/webp');
    expect(supplier.size).toBe(40_000);
  });
});

describe('image upload optimization', () => {
  it('preserves aspect ratio and never upscales', () => {
    expect(fitImageDimensions(4000, 2000)).toEqual({ width: 1600, height: 800 });
    expect(fitImageDimensions(600, 1200)).toEqual({ width: 600, height: 1200 });
  });
  it('does not mislabel JPEG or PNG originals as WebP', () => {
    expect(imageFileExtension({ type: 'image/jpeg', name: 'photo.webp' })).toBe('jpg');
    expect(imageFileExtension({ type: 'image/png', name: 'photo.jpg' })).toBe('png');
  });
  it('keeps the original when decoding fails or bitmap is unavailable', async () => {
    const file = new File(['original'], 'photo.jpg', { type: 'image/jpeg' });
    vi.stubGlobal('createImageBitmap', undefined);
    expect(await optimizeUploadImage(file)).toBe(file);
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode')));
    expect(await optimizeUploadImage(file)).toBe(file);
  });
  it('optimizes a JPEG larger than 2 MB when the browser can decode it', async () => {
    const file = new File([new Uint8Array(3 * 1024 * 1024)], 'large-photo.jpg', { type: 'image/jpeg' });
    const close = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (fn: (blob: Blob) => void) => fn(new Blob([new Uint8Array(1024)], { type: 'image/webp' })) };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 2000, close }));
    vi.stubGlobal('document', { createElement: () => canvas });
    const result = await optimizeUploadImage(file);
    expect(file.size).toBeGreaterThan(2 * 1024 * 1024);
    expect(result.type).toBe('image/webp');
    expect(result.size).toBe(1024);
    expect(close).toHaveBeenCalledOnce();
  });
  it('creates a forced WebP thumbnail even when encoding is larger than its source', async () => {
    const file = new File(['source'], 'photo.png', { type: 'image/png' });
    const close = vi.fn();
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (fn: (blob: Blob) => void) => fn(new Blob([new Uint8Array(1024)], { type: 'image/webp' })) };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 2400, height: 1200, close }));
    vi.stubGlobal('document', { createElement: () => canvas });

    const thumbnail = await optimizeUploadImage(file, 480, { forceWebP: true });

    expect(thumbnail).not.toBe(file);
    expect(thumbnail.type).toBe('image/webp');
    expect(thumbnail.name).toBe('photo.webp');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 480, 240);
    expect(close).toHaveBeenCalledOnce();
  });
  it('uses native image decoding for HEIC when the browser supports it and resizes to 1600 px', async () => {
    const file = new File(['heic'], 'camera.heic', { type: 'image/heic' });
    const close = vi.fn();
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (fn: (blob: Blob) => void) => fn(new Blob(['webp'], { type: 'image/webp' })) };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 3000, close }));
    vi.stubGlobal('document', { createElement: () => canvas });

    const optimized = await optimizeUploadImage(file, 1600, { forceWebP: true, maxBytes: 2 * 1024 * 1024 });

    expect(optimized.type).toBe('image/webp');
    expect(optimized.name).toBe('camera.webp');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    expect(close).toHaveBeenCalledOnce();
  });
  it('reports unsupported HEIC when the browser cannot decode it', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new DOMException('Unsupported image', 'NotSupportedError')));
    await expect(optimizeUploadImage(
      new File(['heic'], 'camera.heic', { type: 'image/heic' }), 1600, { forceWebP: true },
    )).rejects.toMatchObject({ code: 'unsupported_format' });
  });
  it('retries WebP encoding at lower quality to fit the bucket file limit', async () => {
    const file = new File([new Uint8Array(6 * 1024 * 1024)], 'large.jpg', { type: 'image/jpeg' });
    const close = vi.fn();
    const qualities: number[] = [];
    const canvas = {
      width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }),
      toBlob: (fn: (blob: Blob) => void, _type: string, quality: number) => {
        qualities.push(quality);
        fn(new Blob([new Uint8Array(quality <= 0.65 ? 1_900_000 : 2_200_000)], { type: 'image/webp' }));
      },
    };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4200, height: 2800, close }));
    vi.stubGlobal('document', { createElement: () => canvas });

    const optimized = await optimizeUploadImage(file, 1600, { forceWebP: true, maxBytes: 2 * 1024 * 1024 });

    expect(file.size).toBeGreaterThan(5 * 1024 * 1024);
    expect(optimized.size).toBe(1_900_000);
    expect(qualities).toEqual([0.85, 0.75, 0.65]);
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(['image/png', 'image/webp'])('accepts only smaller genuine WebP blobs (%s)', async type => {
    const file = new File(['original image bytes'], 'photo.jpg', { type: 'image/jpeg' });
    const close = vi.fn();
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toBlob: (fn: (blob: Blob) => void) => fn(new Blob(['small'], { type })) };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 2000, close }));
    vi.stubGlobal('document', { createElement: () => canvas });
    const result = await optimizeUploadImage(file);
    expect(result.type).toBe(type === 'image/webp' ? type : file.type);
    expect(result.name).toBe(type === 'image/webp' ? 'photo.webp' : 'photo.jpg');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800);
    expect(close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
  });
  it('leaves SVG intact', async () => {
    const file = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    expect(await optimizeUploadImage(file)).toBe(file);
    expect(decode).not.toHaveBeenCalled();
  });
  it('compresses a catalog cover under the configured 300 KB ceiling', async () => {
    const file = new File([new Uint8Array(900_000)], 'cover.png', { type: 'image/png' });
    const close = vi.fn();
    let calls = 0;
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (fn: (blob: Blob) => void) => {
      calls += 1;
      fn(new Blob([new Uint8Array(calls === 1 ? 350_000 : 250_000)], { type: 'image/webp' }));
    } };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 2000, close }));
    vi.stubGlobal('document', { createElement: () => canvas });
    const optimized = await optimizeCatalogCover(file);
    expect(optimized.type).toBe('image/webp');
    expect(optimized.size).toBeLessThanOrEqual(300_000);
    expect(close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
  });
  it('compresses a supplier photo to genuine WebP within the 60 KB limit', async () => {
    const file = new File([new Uint8Array(200_000)], 'supplier.jpg', { type: 'image/jpeg' });
    const close = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toBlob: (fn: (blob: Blob) => void) => fn(new Blob([new Uint8Array(58_000)], { type: 'image/webp' })) };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1200, height: 900, close }));
    vi.stubGlobal('document', { createElement: () => canvas });

    const optimized = await optimizeSupplierCatalogPhoto(file);

    expect(optimized.type).toBe('image/webp');
    expect(optimized.size).toBeLessThanOrEqual(60_000);
    expect(optimized.name).toBe('supplier.webp');
    expect(close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
  });
  it('rejects supplier formats that are not JPEG, PNG or WebP', async () => {
    const file = new File(['gif'], 'supplier.gif', { type: 'image/gif' });
    await expect(optimizeSupplierCatalogPhoto(file)).rejects.toThrow();
  });
  it('preserves animated WebP and APNG rather than flattening frames', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    const webp = new File(['animated'], 'animation.webp', { type: 'image/webp' });
    expect(await optimizeUploadImage(webp)).toBe(webp);
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 97, 99, 84, 76, 0, 0, 0, 0]);
    expect(hasPngAnimation(bytes.buffer)).toBe(true);
    const apng = new File([bytes], 'animation.png', { type: 'image/png' });
    expect(await optimizeUploadImage(apng)).toBe(apng);
    expect(decode).not.toHaveBeenCalled();
  });
});
