// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ProductThumbnail from './ProductThumbnail';
import StockBadge from './StockBadge';

describe('mobile stock primitives', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (ui: ReactElement) => act(async () => { root.render(ui); });

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('shows labels for out and low stock and nothing for healthy stock', async () => {
    await render(<StockBadge stock={0} minStock={2}/>);
    expect(host.textContent).toBe('Sin stock');

    await render(<StockBadge stock={2} minStock={2}/>);
    expect(host.textContent).toBe('Quedan 2');

    await render(<StockBadge stock={3} minStock={2}/>);
    expect(host.textContent).toBe('');
  });

  it('replaces a failed remote image with the local icon', async () => {
    await render(<ProductThumbnail product={{ name: 'Producto', images: ['https://example.test/photo.webp'] }}/>);
    const image = host.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://example.test/photo.webp');

    await act(async () => { image?.dispatchEvent(new Event('error')); });
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('svg[role="img"]')?.getAttribute('aria-label')).toBe('Sin imagen para Producto');
  });

  it('loads the lazy thumbnail for Storage WebP photos', async () => {
    await render(<ProductThumbnail product={{ name: 'Producto', images: ['https://project.supabase.co/storage/v1/object/public/assets/owner/products/p/photo.webp'] }} />);
    const image = host.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://project.supabase.co/storage/v1/object/public/assets/owner/products/p/photo.thumb.webp');
    expect(image?.getAttribute('loading')).toBe('lazy');
  });
});
