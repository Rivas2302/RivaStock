// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { ownerUid: null as string | null, authUser: null as { uid: string } | null, loading: true },
  getBusinessPlanForOwner: vi.fn(),
}));

vi.mock('../AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../lib/businessPlan', () => ({
  getBusinessPlanForOwner: mocks.getBusinessPlanForOwner,
}));

import { BusinessPlanProvider, useBusinessPlan } from './useBusinessPlan';

const plan = {
  planCode: 'base',
  planName: 'Base',
  status: 'active' as const,
  limits: { modules: { ai: false, knowledge: false, automation: false } },
};

function PlanStatus() {
  const { plan: current, loading, error } = useBusinessPlan();
  return <output>{loading ? 'loading' : error ? 'error' : current?.limits.modules.stock ? 'stock' : current?.planCode ?? 'empty'}</output>;
}

describe('useBusinessPlan', () => {
  let host: HTMLDivElement;
  let root: Root;
  let visibilityDescriptor: PropertyDescriptor | undefined;

  const render = async (ui: ReactElement) => {
    await act(async () => { root.render(<BusinessPlanProvider>{ui}</BusinessPlanProvider>); });
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    mocks.auth.ownerUid = null;
    mocks.auth.authUser = null;
    mocks.auth.loading = true;
    visibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    mocks.getBusinessPlanForOwner.mockReset().mockResolvedValue({ ...plan, limits: { modules: { ...plan.limits.modules, stock: true } } });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    if (visibilityDescriptor) Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
    else Reflect.deleteProperty(document, 'visibilityState');
  });

  it('waits for auth, then loads the plan for the business owner', async () => {
    await render(<PlanStatus/>);
    expect(host.textContent).toBe('loading');
    expect(mocks.getBusinessPlanForOwner).not.toHaveBeenCalled();

    mocks.auth.ownerUid = 'owner-1';
    mocks.auth.authUser = { uid: 'actor-1' };
    mocks.auth.loading = false;
    await render(<PlanStatus/>);
    expect(host.textContent).toBe('stock');
    expect(mocks.getBusinessPlanForOwner).toHaveBeenCalledWith('owner-1', true);
  });

  it('shares one plan request across hook consumers', async () => {
    mocks.auth.ownerUid = 'owner-1';
    mocks.auth.authUser = { uid: 'actor-1' };
    mocks.auth.loading = false;
    await render(<><PlanStatus/><PlanStatus/></>);
    expect(mocks.getBusinessPlanForOwner).toHaveBeenCalledTimes(1);
    expect(host.textContent).toBe('stockstock');
  });

  it('keeps the same plan and loading state through blur, focus, and a failed background refresh', async () => {
    mocks.auth.ownerUid = 'owner-1';
    mocks.auth.authUser = { uid: 'actor-1' };
    mocks.auth.loading = false;
    await render(<PlanStatus/>);
    expect(host.textContent).toBe('stock');

    let rejectRefresh!: (reason: Error) => void;
    mocks.getBusinessPlanForOwner.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRefresh = reject; }));
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });

    expect(mocks.getBusinessPlanForOwner).toHaveBeenCalledTimes(2);
    expect(host.textContent).toBe('stock');
    await act(async () => { rejectRefresh(new Error('offline')); });
    expect(host.textContent).toBe('stock');
  });

  it('applies a module removal returned by the plan refresh when the customer returns', async () => {
    mocks.auth.ownerUid = 'owner-1';
    mocks.auth.authUser = { uid: 'actor-1' };
    mocks.auth.loading = false;
    await render(<PlanStatus/>);
    expect(host.textContent).toBe('stock');
    mocks.getBusinessPlanForOwner.mockResolvedValueOnce({
      ...plan,
      limits: { modules: { ...plan.limits.modules, stock: false } },
    });

    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });

    expect(mocks.getBusinessPlanForOwner).toHaveBeenCalledTimes(2);
    expect(mocks.getBusinessPlanForOwner).toHaveBeenLastCalledWith('owner-1', true);
    expect(host.textContent).toBe('base');
  });

  it('keeps a failed plan lookup empty so callers can hide restricted modules', async () => {
    mocks.auth.ownerUid = 'owner-1';
    mocks.auth.authUser = { uid: 'actor-1' };
    mocks.auth.loading = false;
    mocks.getBusinessPlanForOwner.mockRejectedValueOnce(new Error('unavailable'));

    await render(<PlanStatus/>);
    expect(host.textContent).toBe('error');
  });
});
