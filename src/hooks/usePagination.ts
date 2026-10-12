import { useState } from 'react';
import { pageBounds } from '../lib/pagination';

/** Only bounds rendering. Keep original rows for totals, search and exports. */
export function usePagination<T>(items: T[], pageSize = 50) {
  const [selection, setSelection] = useState({ items, page: 0 });
  // A changed dataset/filter resets synchronously, without an effect or an
  // intermediate stale page. Callers must memoize their filtered arrays.
  const bounds = pageBounds(items.length, selection.items === items ? selection.page : 0, pageSize);
  return {
    ...bounds,
    total: items.length,
    rows: items.slice(bounds.start, bounds.end),
    setPage: (page: number) => setSelection({ items, page }),
  };
}
