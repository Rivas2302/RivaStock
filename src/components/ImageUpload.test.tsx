// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageUpload } from './ImageUpload';

const { rpc, uploadToStorage, optimizeUploadImage } = vi.hoisted(() => ({
  rpc: vi.fn(),
  uploadToStorage: vi.fn(),
  optimizeUploadImage: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../lib/db', () => ({ uploadToStorage, deleteFromStorage: vi.fn() }));
vi.mock('../lib/imageOptimization', () => ({
  imageFileExtension: () => 'webp',
  optimizeUploadImage,
}));
vi.mock('../lib/productPhotos', () => ({
  PRODUCT_PHOTO_CACHE_CONTROL: '31536000',
  getProductThumbnailPath: (path: string) => `thumbs/${path}`,
  getProductThumbnailUrl: (url: string) => `thumb:${url}`,
}));

describe('ImageUpload storage guard', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    rpc.mockReset().mockResolvedValue({
      data: { allowed: false, reason: 'project_storage_full' },
      error: null,
    });
    uploadToStorage.mockReset();
    optimizeUploadImage.mockReset().mockImplementation(async () =>
      new File([new Uint8Array([1, 2])], 'optimized.webp', { type: 'image/webp' }));
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('checks the combined original and thumbnail size and shows the exact denial without uploading', async () => {
    await act(async () => {
      root.render(<ImageUpload ownerUid="owner" productId="product" onChange={vi.fn()} />);
    });

    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    const image = new File([new Uint8Array([1])], 'photo.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, value: [image] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rpc).toHaveBeenCalledWith('storage_upload_check', {
      p_bucket: 'assets',
      p_bytes: 4,
    });
    expect(uploadToStorage).not.toHaveBeenCalled();
    expect(host.querySelector('p.text-rose-500')?.textContent)
      .toBe('No hay espacio en la nube de RivaStock. Avisá a RivaTech.');
  });

  it('uploads a WebP original and its derived thumbnail while exposing only the original URL', async () => {
    const onChange = vi.fn();
    rpc.mockResolvedValue({ data: { allowed: true, reason: null }, error: null });
    uploadToStorage.mockImplementation(async (path: string) => `https://cdn.test/${path}`);
    optimizeUploadImage.mockImplementation(async (_file: File, maxDimension: number) => new File(
      [new Uint8Array([maxDimension === 1600 ? 1 : 2])],
      maxDimension === 1600 ? 'original.webp' : 'thumbnail.webp',
      { type: 'image/webp' },
    ));
    vi.stubGlobal('crypto', { randomUUID: () => 'thumbnail-test-id' });

    await act(async () => {
      root.render(<ImageUpload ownerUid="owner" productId="product" onChange={onChange} />);
    });

    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File([new Uint8Array([9])], 'photo.png', { type: 'image/png' })],
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(uploadToStorage).toHaveBeenCalledTimes(2));

    expect(optimizeUploadImage.mock.calls.map((call) => call[1])).toEqual([1600, 480]);
    expect(uploadToStorage).toHaveBeenCalledTimes(2);
    const originalPath = uploadToStorage.mock.calls[0][0] as string;
    expect(originalPath).toMatch(/^owner\/products\/product\/.+\.webp$/);
    expect(uploadToStorage.mock.calls[0][1]).toMatchObject({ type: 'image/webp' });
    expect(uploadToStorage.mock.calls[0][3]).toBe('31536000');
    expect(uploadToStorage.mock.calls[1][0]).toBe(`thumbs/${originalPath}`);
    expect(uploadToStorage.mock.calls[1][1]).toMatchObject({ type: 'image/webp' });
    expect(uploadToStorage.mock.calls[1][3]).toBe('31536000');
    expect(onChange).toHaveBeenCalledWith([`https://cdn.test/${originalPath}`]);
  });

  it('offers camera and gallery inputs on mobile and reorders images without uploading them again', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(<ImageUpload
        ownerUid="owner"
        productId="product"
        currentImages={['https://cdn.test/one.webp', 'https://cdn.test/two.webp']}
        onChange={onChange}
        mobileControls
        allowReorder
      />);
    });

    expect(host.querySelector<HTMLInputElement>('input[capture="environment"]')?.accept).toBe('image/*');
    expect(host.querySelector<HTMLInputElement>('input[multiple]')?.accept).toBe('image/jpeg,image/png,image/webp');
    const moveLeft = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.getAttribute('aria-label') === 'Mover imagen 2 a la izquierda');
    if (!moveLeft) throw new Error('No se encontró el control para reordenar la foto.');
    await act(async () => { moveLeft.click(); });

    expect(onChange).toHaveBeenCalledWith(['https://cdn.test/two.webp', 'https://cdn.test/one.webp']);
    expect(uploadToStorage).not.toHaveBeenCalled();
  });
});
