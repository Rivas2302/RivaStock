export const IOS_INSTALL_HINT_SHOWN_AT_KEY = 'pwa-ios-install-hint-shown-at';
export const IOS_INSTALL_HINT_DISMISSED_AT_KEY = 'pwa-ios-install-hint-dismissed-at';
export const IOS_INSTALL_HINT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
export const ANDROID_INSTALL_HINT_DISMISSED_AT_KEY = 'pwa-android-install-hint-dismissed-at';
export const ANDROID_INSTALL_HINT_COOLDOWN_MS = IOS_INSTALL_HINT_COOLDOWN_MS;

export function isIOSDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

export function isPWAStandalone(displayMode: string, navigatorStandalone: boolean): boolean {
  return displayMode === 'standalone' || navigatorStandalone;
}

export function shouldShowIOSInstallHint(now: number, lastShownAt: number | null, dismissedAt: number | null): boolean {
  if (dismissedAt !== null && now - dismissedAt < IOS_INSTALL_HINT_COOLDOWN_MS) return false;
  return lastShownAt === null || now - lastShownAt >= IOS_INSTALL_HINT_COOLDOWN_MS;
}

export function isInstallHintDismissed(now: number, dismissedAt: number | null): boolean {
  return dismissedAt !== null && now - dismissedAt < ANDROID_INSTALL_HINT_COOLDOWN_MS;
}
