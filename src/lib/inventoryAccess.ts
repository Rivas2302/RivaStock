export interface InventoryAccessMembership {
  inventoryOwnerId: string;
  isDefault: boolean;
  canOperate: boolean;
}

export interface InventoryAccessState {
  allowedInventoryOwnerIds: string[];
  operableInventoryOwnerIds: string[];
  defaultInventoryOwnerId: string | null;
  holdingsEnabled: boolean;
  inventoryAccessError: string | null;
}

interface ResolveInventoryAccessInput {
  memberships: InventoryAccessMembership[];
  holdingsEnabled: boolean | null;
  inventoryOwnerIds: string[];
  queryErrors: string[];
}

export const INVENTORY_ACCESS_ERROR_MESSAGE = 'No se pudo verificar el acceso al stock. Recargá la página.';

export function resolveInventoryAccessState(
  input: ResolveInventoryAccessInput,
): InventoryAccessState {
  const verifiedOwnerIds = new Set(input.inventoryOwnerIds);
  const hasInvalidMembership = input.memberships.some(
    (membership) => !verifiedOwnerIds.has(membership.inventoryOwnerId),
  );
  if (input.queryErrors.length > 0 || input.holdingsEnabled === null || hasInvalidMembership) {
    return {
      allowedInventoryOwnerIds: [],
      operableInventoryOwnerIds: [],
      defaultInventoryOwnerId: null,
      holdingsEnabled: false,
      inventoryAccessError: INVENTORY_ACCESS_ERROR_MESSAGE,
    };
  }

  return {
    allowedInventoryOwnerIds: input.memberships.map((membership) => membership.inventoryOwnerId),
    operableInventoryOwnerIds: input.memberships
      .filter((membership) => membership.canOperate)
      .map((membership) => membership.inventoryOwnerId),
    defaultInventoryOwnerId: input.memberships.find((membership) => membership.isDefault)?.inventoryOwnerId ?? null,
    holdingsEnabled: input.holdingsEnabled,
    inventoryAccessError: null,
  };
}
