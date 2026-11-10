import { describe, expect, it } from 'vitest';
import {
  IOS_INSTALL_HINT_COOLDOWN_MS,
  isIOSDevice,
  isPWAStandalone,
  shouldShowIOSInstallHint,
} from './pwaInstall';

describe('PWA installation helpers', () => {
  it('detects iPhone, iPad, iPod and touch-enabled iPadOS', () => {
    expect(isIOSDevice('Mozilla/5.0 (iPhone)', 'iPhone', 5)).toBe(true);
    expect(isIOSDevice('Mozilla/5.0 (iPad)', 'iPad', 5)).toBe(true);
    expect(isIOSDevice('Mozilla/5.0', 'MacIntel', 5)).toBe(true);
    expect(isIOSDevice('Mozilla/5.0 (Windows NT)', 'Win32', 0)).toBe(false);
  });

  it('recognizes standalone installation on iOS and other browsers', () => {
    expect(isPWAStandalone('standalone', false)).toBe(true);
    expect(isPWAStandalone('browser', true)).toBe(true);
    expect(isPWAStandalone('browser', false)).toBe(false);
  });

  it('shows the iPhone hint once and respects the 30 day dismissal window', () => {
    const now = 1_800_000_000_000;
    expect(shouldShowIOSInstallHint(now, null, null)).toBe(true);
    expect(shouldShowIOSInstallHint(now, now - 1000, null)).toBe(false);
    expect(shouldShowIOSInstallHint(now, now - IOS_INSTALL_HINT_COOLDOWN_MS, null)).toBe(true);
    expect(shouldShowIOSInstallHint(now, null, now - 1000)).toBe(false);
    expect(shouldShowIOSInstallHint(now, null, now - IOS_INSTALL_HINT_COOLDOWN_MS)).toBe(true);
  });
});
