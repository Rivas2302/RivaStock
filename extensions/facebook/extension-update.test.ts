import { describe, expect, it } from 'vitest';
import {
  hasExtensionWorkInProgress,
  isNewerExtensionVersion,
  shouldReloadForDiskVersion,
  shouldReloadForServerTarget,
} from './extension-update.js';

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
    const ready = { requiredVersion: '0.5.24', diskVersion: '0.5.24', installedVersion: '0.5.23', reloadSafe: true, localWorkInProgress: false };
    expect(shouldReloadForServerTarget(ready)).toBe(true);
    expect(shouldReloadForServerTarget({ ...ready, reloadSafe: false })).toBe(false);
    expect(shouldReloadForServerTarget({ ...ready, localWorkInProgress: true })).toBe(false);
    expect(shouldReloadForServerTarget({ ...ready, requiredVersion: '0.5.23' })).toBe(false);
    expect(shouldReloadForServerTarget({ ...ready, diskVersion: '0.5.23' })).toBe(false);
    expect(shouldReloadForServerTarget({ ...ready, diskVersion: '0.5.25' })).toBe(true);
  });

  it('reloads after the updater writes a newer manifest to disk, but only when work is idle', () => {
    expect(shouldReloadForDiskVersion({ diskVersion: '0.6.4', installedVersion: '0.6.3', localWorkInProgress: false })).toBe(true);
    expect(shouldReloadForDiskVersion({ diskVersion: '0.6.4', installedVersion: '0.6.3', localWorkInProgress: true })).toBe(false);
    expect(shouldReloadForDiskVersion({ diskVersion: '0.6.3', installedVersion: '0.6.3', localWorkInProgress: false })).toBe(false);
  });

  it('treats imports and publications as busy', () => {
    expect(hasExtensionWorkInProgress({ activeJob: { stage: 'submitting' } })).toBe(true);
    expect(hasExtensionWorkInProgress({ activeRehearsal: { stage: 'preparing' } })).toBe(true);
    expect(hasExtensionWorkInProgress({ historicalReview: { stage: 'reviewing' } })).toBe(true);
    expect(hasExtensionWorkInProgress({}, { status: 'reading' })).toBe(true);
    expect(hasExtensionWorkInProgress({ ownContentTrackers: { pending: { status: 'pending_approval' } } })).toBe(true);
    expect(hasExtensionWorkInProgress({}, { status: 'complete' })).toBe(false);
    expect(hasExtensionWorkInProgress({}, null)).toBe(false);
  });
});
