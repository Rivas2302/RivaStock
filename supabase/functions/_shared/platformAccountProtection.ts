export type PlatformAccountProtectionReason =
  | 'own_account'
  | 'platform_admin'
  | 'team_collaborator'
  | 'internal_plan';

export function platformAccountProtectionReason(input: {
  targetUid: string;
  actorUid: string;
  platformAdminUids: ReadonlySet<string>;
  ownBusinessCollaboratorUids: ReadonlySet<string>;
  planCode: string | null;
}): PlatformAccountProtectionReason | null {
  if (input.targetUid === input.actorUid) return 'own_account';
  if (input.platformAdminUids.has(input.targetUid)) return 'platform_admin';
  if (input.ownBusinessCollaboratorUids.has(input.targetUid)) return 'team_collaborator';
  if (input.planCode === 'interno') return 'internal_plan';
  return null;
}

export function platformAccountProtectionMessage(reason: PlatformAccountProtectionReason | null): string | null {
  switch (reason) {
    case 'own_account': return 'No podés administrar tu propia cuenta.';
    case 'platform_admin': return 'Esta cuenta pertenece a un administrador de RivaStock.';
    case 'team_collaborator': return 'Esta persona pertenece al equipo de tu negocio.';
    case 'internal_plan': return 'Las cuentas del plan interno están protegidas.';
    default: return null;
  }
}
