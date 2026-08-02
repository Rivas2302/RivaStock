import { describe, expect, it } from 'vitest';

import { resolveAccountActor } from './accountActor';

const ownerPermissions = { stock: { read: true, write: true, delete: true } };

describe('account actor resolution', () => {
  it('treats a successful collaborator not-found result as the account owner', () => {
    expect(resolveAccountActor({
      actorUid: 'owner-uid',
      collaborator: null,
      queryError: null,
      ownerPermissions,
    })).toEqual({
      isOwner: true,
      ownerUid: 'owner-uid',
      collaboratorId: null,
      permissions: ownerPermissions,
    });
  });

  it('fails closed instead of treating a collaborator lookup error as owner access', () => {
    expect(() => resolveAccountActor({
      actorUid: 'actor-uid',
      collaborator: null,
      queryError: 'collaborators unavailable',
      ownerPermissions,
    })).toThrow('No se pudo verificar la cuenta del usuario');
  });

  it('returns the collaborator account and permissions after a successful lookup', () => {
    const collaboratorPermissions = { stock: { read: true, write: false, delete: false } };
    expect(resolveAccountActor({
      actorUid: 'actor-uid',
      collaborator: {
        id: 'collab-1',
        ownerUid: 'owner-uid',
        permissions: collaboratorPermissions,
      },
      queryError: null,
      ownerPermissions,
    })).toEqual({
      isOwner: false,
      ownerUid: 'owner-uid',
      collaboratorId: 'collab-1',
      permissions: collaboratorPermissions,
    });
  });
});
