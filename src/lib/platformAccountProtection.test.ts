import { describe, expect, it } from 'vitest';
import {
  platformAccountProtectionMessage,
  platformAccountProtectionReason,
} from '../../supabase/functions/_shared/platformAccountProtection';
import {
  platformBusinessDisplayName,
} from './platformAccountProtection';

const emptySet = new Set<string>();

describe('platform account protection', () => {
  it('allows an unnamed account without a subscription when it is not protected by identity', () => {
    expect(platformAccountProtectionReason({
      targetUid: 'customer-1',
      actorUid: 'admin-1',
      platformAdminUids: emptySet,
      ownBusinessCollaboratorUids: emptySet,
      planCode: null,
    })).toBeNull();
  });

  it('protects the current administrator, platform administrators, and actual own-business collaborators', () => {
    const cases = [
      { targetUid: 'admin-1', actorUid: 'admin-1', expected: 'own_account' },
      { targetUid: 'admin-2', actorUid: 'admin-1', platformAdminUids: new Set(['admin-2']), expected: 'platform_admin' },
      { targetUid: 'member-1', actorUid: 'admin-1', ownBusinessCollaboratorUids: new Set(['member-1']), expected: 'team_collaborator' },
    ] as const;

    for (const testCase of cases) {
      expect(platformAccountProtectionReason({
        targetUid: testCase.targetUid,
        actorUid: testCase.actorUid,
        platformAdminUids: 'platformAdminUids' in testCase ? testCase.platformAdminUids : emptySet,
        ownBusinessCollaboratorUids: 'ownBusinessCollaboratorUids' in testCase ? testCase.ownBusinessCollaboratorUids : emptySet,
        planCode: null,
      })).toBe(testCase.expected);
    }
  });

  it('keeps the internal-plan safeguard without treating an empty name as an identity', () => {
    expect(platformAccountProtectionReason({
      targetUid: 'customer-1',
      actorUid: 'admin-1',
      platformAdminUids: emptySet,
      ownBusinessCollaboratorUids: emptySet,
      planCode: 'interno',
    })).toBe('internal_plan');
    expect(platformAccountProtectionMessage('team_collaborator')).toContain('equipo de tu negocio');
  });
});

describe('platform business display name', () => {
  it('does not inherit another business name for a blank or null name', () => {
    expect(platformBusinessDisplayName('', 'demo@example.test')).toBe('Sin nombre · demo@example.test');
    expect(platformBusinessDisplayName(null, 'demo@example.test')).toBe('Sin nombre · demo@example.test');
  });
});
