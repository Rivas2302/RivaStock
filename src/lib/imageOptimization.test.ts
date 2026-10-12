import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitImageDimensions, hasPngAnimation, imageFileExtension, optimizeUploadImage } from './imageOptimization';

afterEach(() => vi.unstubAllGlobals());
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
