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
});
