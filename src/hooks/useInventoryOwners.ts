import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InventoryOwner } from '../types';
import { db } from '../lib/db';
import {
  getActiveInventoryOwners,
  filterInventoryOwnersByMembership,
  getPrimaryInventoryOwner,
  sortInventoryOwners,
} from '../lib/inventoryOwners';

export function useInventoryOwners(
  ownerUid?: string | null,
  refetchToken = 0,
  allowedOwnerIds?: string[],
) {
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

  const visibleOwners = useMemo(() => {
    return filterInventoryOwnersByMembership(owners, allowedOwnerIds);
  }, [allowedOwnerIds, owners]);
  const activeOwners = useMemo(() => getActiveInventoryOwners(visibleOwners), [visibleOwners]);
  const primaryOwner = useMemo(() => getPrimaryInventoryOwner(visibleOwners), [visibleOwners]);

  return { owners: visibleOwners, activeOwners, primaryOwner, loading, reload };
}
