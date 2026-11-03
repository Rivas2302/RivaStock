import { describe, expect, it } from 'vitest';
import { getPreviewVersionAccess } from './previewVersionAccess';

describe('getPreviewVersionAccess', () => {
  it('returns null before a version or access result is available', () => {
    expect(getPreviewVersionAccess(null, null)).toBeNull();
    expect(getPreviewVersionAccess(null, undefined)).toBeNull();
    expect(getPreviewVersionAccess({ versionId: 'v1', value: 'ready' }, null)).toBeNull();
  });

  it('returns access only for the matching preview version', () => {
    const access = { versionId: 'v1', value: 'signed-url' };
    expect(getPreviewVersionAccess(access, 'v1')).toBe('signed-url');
    expect(getPreviewVersionAccess(access, 'v2')).toBeNull();
  });
});
