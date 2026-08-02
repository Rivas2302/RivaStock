import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InventoryOwner } from '../types';
import { db } from '../lib/db';
import {
  getActiveInventoryOwners,
  getPrimaryInventoryOwner,
  sortInventoryOwners,
} from '../lib/inventoryOwners';

export function useInventoryOwners(ownerUid?: string | null, refetchToken = 0) {
  const [owners, setOwners] = useState<InventoryOwner[]>([]);
  const [loading, setLoading] = useState(Boolean(ownerUid));
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!ownerUid) {
      setOwners([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    db.list<InventoryOwner>('inventory_owners', ownerUid)
      .then((rows) => {
        if (!cancelled) setOwners(sortInventoryOwners(rows));
      })
      .catch((error) => {
        if (!cancelled) console.error('[InventoryOwners] load failed:', error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [ownerUid, refetchToken, reloadToken]);

  const activeOwners = useMemo(() => getActiveInventoryOwners(owners), [owners]);
  const primaryOwner = useMemo(() => getPrimaryInventoryOwner(owners), [owners]);

  return { owners, activeOwners, primaryOwner, loading, reload };
}
