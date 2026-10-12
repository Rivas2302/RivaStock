import { describe, expect, it, vi } from 'vitest';
const { recentPaidSales } = vi.hoisted(() => ({ recentPaidSales: vi.fn().mockResolvedValue([]) }));
vi.mock('./db', () => ({ db: { recentPaidSales } }));
import { getRecentRestockSales } from './recentSales';

describe('restock query date bounds', () => {
  it('uses local calendar dates and the same 30-day boundary as the calculator', async () => {
    await getRecentRestockSales('owner', new Date(2026, 9, 12, 12));
    expect(recentPaidSales).toHaveBeenLastCalledWith('owner', '2026-09-12', '2026-10-12');
    await getRecentRestockSales('other', new Date(2026, 2, 2, 12));
    expect(recentPaidSales).toHaveBeenLastCalledWith('other', '2026-01-31', '2026-03-02');
  });
});
