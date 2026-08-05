import { callRpc } from './db';

export type MovementType = 'intake' | 'transfer_in' | 'transfer_out' | 'product_edit' | 'adjustment';

export interface InventoryMovement {
  id: string;
  createdAt: string;
  productId: string;
  productName: string;
  inventoryOwnerId: string;
  inventoryOwnerName: string;
  movementType: MovementType;
  delta: number;
  reason: string;
  transferReason: string | null;
  transferKey: string | null;
  resultingStock: number | null;
  actorUid: string;
  totalCount: number;
}

export interface MovementFilters {
  dateFrom?: string | null;
  dateTo?: string | null;
  productId?: string | null;
  inventoryOwnerId?: string | null;
  movementType?: MovementType | null;
  limit?: number;
  offset?: number;
}

interface MovementRow {
  id: string;
  created_at: string;
  product_id: string;
  product_name: string;
  inventory_owner_id: string;
  inventory_owner_name: string;
  movement_type: string;
  delta: number;
  reason: string;
  transfer_reason: string | null;
  transfer_key: string | null;
  resulting_stock: number | null;
  actor_uid: string;
  total_count: string | number;
}

const isMovementType = (value: string): value is MovementType =>
  value === 'intake'
  || value === 'transfer_in'
  || value === 'transfer_out'
  || value === 'product_edit'
  || value === 'adjustment';

export function mapMovementRow(row: MovementRow): InventoryMovement {
  const totalCount = typeof row.total_count === 'string' ? Number(row.total_count) : row.total_count;
  const movementType: MovementType = isMovementType(row.movement_type) ? row.movement_type : 'adjustment';
  return {
    id: row.id,
    createdAt: row.created_at,
    productId: row.product_id,
    productName: row.product_name,
    inventoryOwnerId: row.inventory_owner_id,
    inventoryOwnerName: row.inventory_owner_name,
    movementType,
    delta: Number(row.delta),
    reason: row.reason,
    transferReason: row.transfer_reason,
    transferKey: row.transfer_key,
    resultingStock: row.resulting_stock === null ? null : Number(row.resulting_stock),
    actorUid: row.actor_uid,
    totalCount,
  };
}

export async function listInventoryMovements(
  filters: MovementFilters = {},
): Promise<InventoryMovement[]> {
  const params: Record<string, unknown> = {
    p_date_from: filters.dateFrom ?? null,
    p_date_to: filters.dateTo ?? null,
    p_product_id: filters.productId ?? null,
    p_inventory_owner_id: filters.inventoryOwnerId ?? null,
    p_movement_type: filters.movementType ?? null,
    p_limit: filters.limit ?? 50,
    p_offset: filters.offset ?? 0,
  };
  const rows = await callRpc<MovementRow[]>('list_inventory_movements', params);
  if (!Array.isArray(rows)) return [];
  return rows.map(mapMovementRow);
}

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  intake: 'Ingreso',
  transfer_in: 'Transferencia entrante',
  transfer_out: 'Transferencia saliente',
  product_edit: 'Edición de producto',
  adjustment: 'Ajuste',
};

export const MOVEMENT_TYPE_BADGE_CLASS: Record<MovementType, string> = {
  intake: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  transfer_in: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  transfer_out: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  product_edit: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  adjustment: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};
