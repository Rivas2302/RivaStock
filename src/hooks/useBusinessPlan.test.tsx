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

import { useBusinessPlan } from './useBusinessPlan';

const plan = {
  planCode: 'base',
  planName: 'Base',
  status: 'active' as const,
  limits: { modules: { ai: false, knowledge: false, automation: false } },
};

function PlanStatus() {
  const { plan: current, loading, error } = useBusinessPlan();
  return <output>{loading ? 'loading' : error ? 'error' : current?.planCode ?? 'empty'}</output>;
}

describe('useBusinessPlan', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (ui: ReactElement) => {
    await act(async () => { root.render(ui); });
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    mocks.auth.ownerUid = null;
    mocks.auth.authUser = null;
    mocks.auth.loading = true;
    mocks.getBusinessPlanForOwner.mockReset().mockResolvedValue(plan);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('waits for auth, then loads the plan for the business owner', async () => {
    await render(<PlanStatus/>);
    expect(host.textContent).toBe('loading');
    expect(mocks.getBusinessPlanForOwner).not.toHaveBeenCalled();

    mocks.auth.ownerUid = 'owner-1';
    mocks.auth.authUser = { uid: 'actor-1' };
    mocks.auth.loading = false;
    await render(<PlanStatus/>);
    expect(host.textContent).toBe('base');
    expect(mocks.getBusinessPlanForOwner).toHaveBeenCalledWith('owner-1', true);
  });

  it('refreshes the plan when the customer returns to the app after switching tabs', async () => {
    mocks.auth.ownerUid = 'owner-1';
    mocks.auth.authUser = { uid: 'actor-1' };
    mocks.auth.loading = false;
    await render(<PlanStatus/>);
    expect(mocks.getBusinessPlanForOwner).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });

    expect(mocks.getBusinessPlanForOwner).toHaveBeenCalledTimes(2);
    expect(mocks.getBusinessPlanForOwner).toHaveBeenLastCalledWith('owner-1', true);
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
