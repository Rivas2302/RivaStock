// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUnreadCatalogOrders } from './useUnreadCatalogOrders';

const mocks = vi.hoisted(() => ({ from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: mocks }));

function Probe({ ownerUid }: { ownerUid: string }) {
  const { unreadCount, notice, clearNotice } = useUnreadCatalogOrders(ownerUid);
  return <div><span data-testid="count">{unreadCount}</span>{notice && <span data-testid="notice">{notice.orderCode ?? 'sin código'}</span>}<button onClick={clearNotice}>Cerrar</button></div>;
}

describe('useUnreadCatalogOrders', () => {
  let host: HTMLDivElement;
  let root: Root;
  let onChange: ((payload: { eventType: string; new: Record<string, unknown> }) => void) | undefined;
  const channel = {
    on: vi.fn((_kind: string, _filter: unknown, handler: typeof onChange) => { onChange = handler; return channel; }),
    subscribe: vi.fn(() => channel),
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const query = { eq: vi.fn(), then: (resolve: (value: { count: number; error: null }) => unknown) => Promise.resolve({ count: 2, error: null }).then(resolve) };
    query.eq.mockReturnValue(query);
    mocks.from.mockReset().mockReturnValue({ select: vi.fn().mockReturnValue(query) });
    mocks.channel.mockReset().mockReturnValue(channel);
    mocks.removeChannel.mockReset().mockResolvedValue(undefined);
    channel.on.mockClear(); channel.subscribe.mockClear(); onChange = undefined;
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  it('scopes the count and realtime channel to the current owner and announces unread retail orders', async () => {
    await act(async () => { root.render(<Probe ownerUid="owner-1"/>); await Promise.resolve(); });
    expect(host.querySelector('[data-testid="count"]')?.textContent).toBe('2');
    expect(mocks.channel).toHaveBeenCalledWith('catalog-order-notices:owner-1');
    expect(channel.on.mock.calls[0]?.[1]).toMatchObject({ filter: 'user_id=eq.owner-1', table: 'orders' });
    await act(async () => onChange?.({ eventType: 'INSERT', new: { user_id: 'owner-1', channel: 'retail', is_read: false, order_code: 'P-0042' } }));
    expect(host.querySelector('[data-testid="notice"]')?.textContent).toBe('P-0042');
    await act(async () => onChange?.({ eventType: 'INSERT', new: { user_id: 'owner-1', channel: 'reseller', is_read: false, order_code: 'R-1' } }));
    expect(host.querySelector('[data-testid="notice"]')?.textContent).toBe('P-0042');
  });
});
