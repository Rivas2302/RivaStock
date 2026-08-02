export interface CollaboratorAccount<TPermissions> {
  id: string;
  ownerUid: string;
  permissions: TPermissions;
}

export interface ResolveAccountActorInput<TPermissions> {
  actorUid: string;
  collaborator: CollaboratorAccount<TPermissions> | null;
  queryError: string | null;
  ownerPermissions: TPermissions;
}

export function resolveAccountActor<TPermissions>({
  actorUid,
  collaborator,
  queryError,
  ownerPermissions,
}: ResolveAccountActorInput<TPermissions>) {
  if (queryError) {
    throw new Error('No se pudo verificar la cuenta del usuario. Recargá la página.');
  }

  if (!collaborator) {
    return {
      isOwner: true,
      ownerUid: actorUid,
      collaboratorId: null,
      permissions: ownerPermissions,
    };
  }

  return {
    isOwner: false,
    ownerUid: collaborator.ownerUid,
    collaboratorId: collaborator.id,
    permissions: collaborator.permissions,
  };
}
