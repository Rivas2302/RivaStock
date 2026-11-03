import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('./supabase', () => ({ supabase: { rpc: mocks.rpc } }));

import {
  getBusinessPlanDisplayName,
  getBusinessPlanForOwner,
  getMyBusinessPlan,
  invalidateBusinessPlan,
} from './businessPlan';

const response = {
  plan_code: 'base',
  plan_name: 'Base',
  status: 'active',
  limits: {
    collaborators: 5,
    modules: { ai: false, knowledge: false, automation: false },
  },
};

describe('business plan client', () => {
  beforeEach(() => {
    invalidateBusinessPlan();
    mocks.rpc.mockReset().mockResolvedValue({ data: response, error: null });
  });

  afterEach(() => { vi.useRealTimers(); });

  it('parses the current owner plan and fails on malformed module flags', async () => {
    await expect(getMyBusinessPlan()).resolves.toMatchObject({
      planCode: 'base',
      planName: 'RivaStock',
      status: 'active',
      limits: { modules: { ai: false, knowledge: false, automation: false } },
    });

    mocks.rpc.mockResolvedValueOnce({
      data: { ...response, limits: { modules: { ai: 1, knowledge: false, automation: false } } },
      error: null,
    });
    await expect(getMyBusinessPlan()).rejects.toThrow('La configuración de módulos del plan no es válida.');
  });

  it('uses customer-facing plan names without changing the internal plan codes', () => {
    expect(getBusinessPlanDisplayName('base')).toBe('RivaStock');
    expect(getBusinessPlanDisplayName('pro')).toBe('RivaStock IA');
    expect(getBusinessPlanDisplayName('interno')).toBe('RivaStock Interno');
    expect(getBusinessPlanDisplayName('custom', 'Enterprise')).toBe('Enterprise');
  });

  it('shares in-flight requests and caches a business plan for five minutes', async () => {
    vi.useFakeTimers();
    const [first, concurrent] = await Promise.all([
      getBusinessPlanForOwner('owner-1'),
      getBusinessPlanForOwner('owner-1'),
    ]);
    expect(first).toEqual(concurrent);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    await getBusinessPlanForOwner('owner-1');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await getBusinessPlanForOwner('owner-1');
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a cached plan across businesses', async () => {
    await getBusinessPlanForOwner('owner-1');
    await getBusinessPlanForOwner('owner-2');
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('does not let an invalidated request overwrite a newer cached plan', async () => {
    let resolveOldRequest!: (result: { data: typeof response; error: null }) => void;
    const oldRequest = new Promise<{ data: typeof response; error: null }>((resolve) => {
      resolveOldRequest = resolve;
    });
    const updatedPlan = {
      ...response,
      plan_code: 'pro',
      plan_name: 'Pro',
      limits: { ...response.limits, modules: { ai: true, knowledge: true, automation: true } },
    };
    mocks.rpc.mockReturnValueOnce(oldRequest).mockResolvedValueOnce({ data: updatedPlan, error: null });

    const outdated = getBusinessPlanForOwner('owner-1');
    invalidateBusinessPlan('owner-1');
    await expect(getBusinessPlanForOwner('owner-1')).resolves.toMatchObject({ planCode: 'pro' });
    resolveOldRequest({ data: response, error: null });
    await expect(outdated).resolves.toMatchObject({ planCode: 'base' });

    await expect(getBusinessPlanForOwner('owner-1')).resolves.toMatchObject({ planCode: 'pro' });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it('propagates server errors so the UI can fail closed', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('plan unavailable') });
    await expect(getMyBusinessPlan()).rejects.toThrow('plan unavailable');
  });
});
