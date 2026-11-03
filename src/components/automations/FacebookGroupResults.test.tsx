// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FacebookDelivery } from '../../lib/facebookPublications';
import FacebookGroupResults from './FacebookGroupResults';

const baseDelivery = {
  id: 'delivery-1',
  status: 'running',
  message: null,
  evidence_url: null,
  destination: { name: 'Marketplace', url: 'https://www.facebook.com/marketplace/create/item', mechanism: 'marketplace_groups' },
  target_groups: [
    { group_id: 'group-published', name: 'Herramientas', url: 'https://www.facebook.com/groups/tools' },
    { group_id: 'group-pending', name: 'Repuestos', url: 'https://www.facebook.com/groups/parts' },
  ],
  fb_delivery_group_results: [
    { group_id: 'group-published', status: 'published', post_id: '123', url: 'https://www.facebook.com/groups/tools/posts/123', message: null, checked_at: '2026-11-03T10:00:00Z' },
    { group_id: 'group-pending', status: 'pending_approval', post_id: null, url: null, message: null, checked_at: null },
  ],
} satisfies FacebookDelivery;

describe('FacebookGroupResults', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('shows per-group status and safe publication and group links', () => {
    act(() => root.render(<FacebookGroupResults delivery={baseDelivery}/>));

    expect(host.textContent).toContain('Anuncio de Marketplace compartido');
    expect(host.textContent).toContain('Herramientas');
    expect(host.textContent).toContain('Publicado');
    expect(host.textContent).toContain('Repuestos');
    expect(host.textContent).toContain('Pendiente de aprobación');
    expect(host.querySelector('a[href="https://www.facebook.com/groups/tools/posts/123"]')?.textContent).toBe('Ver publicación del grupo');
    expect(host.querySelector('a[href="https://www.facebook.com/groups/parts"]')?.textContent).toBe('Abrir grupo');
  });

  it('rejects unsafe group result and destination URLs', () => {
    const delivery = {
      ...baseDelivery,
      target_groups: [{ group_id: 'group-published', name: 'Herramientas', url: 'https://evil.example/groups/tools' }],
      fb_delivery_group_results: [{ group_id: 'group-published', status: 'published', post_id: '123', url: 'https://evil.example/groups/tools/posts/123', message: null, checked_at: null }],
    } satisfies FacebookDelivery;
    act(() => root.render(<FacebookGroupResults delivery={delivery}/>));

    expect(host.querySelectorAll('a')).toHaveLength(0);
  });
});
