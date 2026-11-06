import { describe, expect, it } from 'vitest';
import { isNewerExtensionVersion, shouldReloadForServerTarget } from './extension-update.js';

describe('Facebook extension update gate', () => {
  it('compares semantic versions numerically', () => {
    expect(isNewerExtensionVersion('0.5.24', '0.5.23')).toBe(true);
    expect(isNewerExtensionVersion('0.6.0', '0.5.99')).toBe(true);
    expect(isNewerExtensionVersion('0.5.23', '0.5.23')).toBe(false);
    expect(isNewerExtensionVersion('0.5.22', '0.5.23')).toBe(false);
  });

  it('fails closed for malformed version strings', () => {
    expect(isNewerExtensionVersion('latest', '0.5.23')).toBe(false);
    expect(isNewerExtensionVersion('0.5.24-beta', '0.5.23')).toBe(false);
  });

  it('reloads only when both the server and local worker confirm idle state', () => {
    const ready = { requiredVersion: '0.5.24', installedVersion: '0.5.23', reloadSafe: true, localWorkInProgress: false };
    expect(shouldReloadForServerTarget(ready)).toBe(true);
    expect(shouldReloadForServerTarget({ ...ready, reloadSafe: false })).toBe(false);
    expect(shouldReloadForServerTarget({ ...ready, localWorkInProgress: true })).toBe(false);
    expect(shouldReloadForServerTarget({ ...ready, requiredVersion: '0.5.23' })).toBe(false);
  });
});
