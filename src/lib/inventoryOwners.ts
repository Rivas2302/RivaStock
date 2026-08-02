import type { InventoryOwner, Product, PublicInventoryOwnerLabel } from '../types';
import { callRpc, fromDb } from './db';

type InventoryOwnerRow = Record<string, unknown>;

function normalizeOwner(row: InventoryOwnerRow): InventoryOwner {
  return fromDb<InventoryOwner>(row);
}

export function sortInventoryOwners(owners: InventoryOwner[]): InventoryOwner[] {
  return [...owners].sort((a, b) => {
    if (Boolean(a.archivedAt) !== Boolean(b.archivedAt)) return a.archivedAt ? 1 : -1;
    return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  });
}

export function getActiveInventoryOwners(owners: InventoryOwner[]): InventoryOwner[] {
  return sortInventoryOwners(owners.filter((owner) => !owner.archivedAt));
}

export function getPrimaryInventoryOwner(owners: InventoryOwner[]): InventoryOwner | null {
  return owners.find((owner) => owner.isPrimary)
    ?? getActiveInventoryOwners(owners)[0]
    ?? null;
}

export function getAssignableInventoryOwners(
  owners: InventoryOwner[],
  currentOwnerId?: string,
): InventoryOwner[] {
  return sortInventoryOwners(
    owners.filter((owner) => !owner.archivedAt || owner.id === currentOwnerId),
  );
}

export function filterInventoryOwnersByMembership(
  owners: InventoryOwner[],
  allowedOwnerIds?: string[],
): InventoryOwner[] {
  if (allowedOwnerIds === undefined) return owners;
  const allowed = new Set(allowedOwnerIds);
  return owners.filter((owner) => allowed.has(owner.id));
}

export function resolveInventoryOwner(
  product: Pick<Product, 'inventoryOwnerId'>,
  owners: InventoryOwner[],
): InventoryOwner | null {
  if (product.inventoryOwnerId) {
    return owners.find((owner) => owner.id === product.inventoryOwnerId) ?? null;
  }
  return getPrimaryInventoryOwner(owners);
}

export function getInventoryOwnerName(
  product: Pick<Product, 'inventoryOwnerId'>,
  owners: InventoryOwner[],
): string {
  return resolveInventoryOwner(product, owners)?.name ?? '';
}

export function getInventoryOwnerProductLabel(
  product: Pick<Product, 'name' | 'inventoryOwnerId'>,
  owners: InventoryOwner[],
): string {
  const ownerName = getInventoryOwnerName(product, owners);
  return ownerName ? `${product.name} — ${ownerName}` : product.name;
}

export async function getPublicInventoryOwnerLabels(
  slug: string,
  productId?: string,
): Promise<PublicInventoryOwnerLabel[]> {
  const rows = await callRpc<Record<string, unknown>[]>('get_public_inventory_owner_labels', {
    p_slug: slug,
    p_product_id: productId ?? null,
  });
  return rows.map((row) => fromDb<PublicInventoryOwnerLabel>(row));
}

export async function createInventoryOwner(name: string): Promise<InventoryOwner> {
  const row = await callRpc<InventoryOwnerRow>('create_inventory_owner', { p_name: name });
  return normalizeOwner(row);
}

export async function renameInventoryOwner(id: string, name: string): Promise<InventoryOwner> {
  const row = await callRpc<InventoryOwnerRow>('rename_inventory_owner', {
    p_owner_id: id,
    p_name: name,
  });
  return normalizeOwner(row);
}

export async function archiveInventoryOwner(id: string): Promise<InventoryOwner> {
  const row = await callRpc<InventoryOwnerRow>('archive_inventory_owner', { p_owner_id: id });
  return normalizeOwner(row);
}

export async function reorderInventoryOwners(ids: string[]): Promise<InventoryOwner[]> {
  const rows = await callRpc<InventoryOwnerRow[]>('reorder_inventory_owners', { p_owner_ids: ids });
  return sortInventoryOwners(rows.map(normalizeOwner));
}
