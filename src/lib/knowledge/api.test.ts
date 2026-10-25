import { describe, expect, it, vi } from 'vitest';
import { getStats } from './api';
import { supabase } from '../supabase';

describe('knowledge RPC wrapper', () => {
  it('preserves the Supabase client context when invoking RPCs', async () => {
    const stats = { documents: 0 };
    const rpc = vi.spyOn(supabase, 'rpc').mockImplementation(function (this: unknown) {
      expect(this).toBe(supabase);
      return Promise.resolve({ data: stats, error: null }) as never;
    } as never);

    await expect(getStats()).resolves.toEqual(stats);
    expect(rpc).toHaveBeenCalledWith('knowledge_stats', {});
  });
});
