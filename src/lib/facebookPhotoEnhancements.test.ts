import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoEnhancePixels, centeredCrop, enhanceFacebookPhoto } from './facebookPhotoEnhancements';

afterEach(() => vi.unstubAllGlobals());

describe('local Facebook photo improvements', () => {
  it('centers square and 4:3 crops without stretching', () => {
    expect(centeredCrop(4000, 2000, 'square')).toEqual({ sx: 1000, sy: 0, sw: 2000, sh: 2000 });
    expect(centeredCrop(4000, 2000, 'four_three')).toEqual({ sx: 666.6666666666667, sy: 0, sw: 2666.6666666666665, sh: 2000 });
    expect(centeredCrop(1200, 2400, 'four_three')).toEqual({ sx: 0, sy: 750, sw: 1200, sh: 900 });
  });

  it('adjusts contrast while leaving fully transparent pixels untouched', () => {
    const pixels = new Uint8ClampedArray([10, 10, 10, 255, 110, 110, 110, 255, 200, 20, 30, 0]);
    autoEnhancePixels(pixels);
    expect([...pixels.slice(0, 8)]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    expect([...pixels.slice(8)]).toEqual([200, 20, 30, 0]);
  });

  it('caps output at 2048 pixels and composites transparent PNG onto white', async () => {
    const pixelData = new Uint8ClampedArray([12, 30, 40, 0, 100, 100, 100, 255]);
    const drawImage = vi.fn();
    const putImageData = vi.fn();
    const close = vi.fn();
    const context = { drawImage, getImageData: () => ({ data: pixelData }), putImageData };
    let encodedType = '';
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (callback: (blob: Blob) => void, type: string) => {
        encodedType = type;
        callback(new Blob(['enhanced'], { type }));
      },
    };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 3000, close }));
    vi.stubGlobal('document', { createElement: () => canvas });

    const result = await enhanceFacebookPhoto(new Blob(['png'], { type: 'image/png' }), 'square');

    expect(result).toMatchObject({ width: 2048, height: 2048, mimeType: 'image/jpeg', whiteBackgroundApplied: true });
    expect(encodedType).toBe('image/jpeg');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 500, 0, 3000, 3000, 0, 0, 2048, 2048);
    expect([...pixelData.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect(close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
  });

  it('does not flatten animated PNG or WebP images', async () => {
    const animatedPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 97, 99, 84, 76, 0, 0, 0, 0]);
    const animatedWebp = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 65, 78, 73, 77, 0, 0, 0, 0]);
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    await expect(enhanceFacebookPhoto(new Blob([animatedPng], { type: 'image/png' }), 'square')).rejects.toThrow('imágenes animadas');
    await expect(enhanceFacebookPhoto(new Blob([animatedWebp], { type: 'image/webp' }), 'square')).rejects.toThrow('imágenes animadas');
    expect(decode).not.toHaveBeenCalled();
  });
});
