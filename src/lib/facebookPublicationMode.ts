export type FacebookGroupPublicationMode = 'marketplace_groups' | 'separate';

export const FACEBOOK_MARKETPLACE_GROUP_SHARING_ENABLED =
  import.meta.env.VITE_FB_MARKETPLACE_GROUP_SHARING_ENABLED === 'true';

const STORAGE_KEY_PREFIX = 'facebook-group-publication-mode:';

function getBrowserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function shouldShowFacebookGroupPublicationMode(
  enabled: boolean,
  marketplace: boolean,
  groupCount: number,
): boolean {
  return enabled && marketplace && groupCount > 0;
}

export function resolveFacebookGroupPublicationMode(
  enabled: boolean,
  requested: FacebookGroupPublicationMode,
  marketplace: boolean,
  groupCount: number,
): FacebookGroupPublicationMode {
  return shouldShowFacebookGroupPublicationMode(enabled, marketplace, groupCount)
    ? requested
    : 'separate';
}

export function readFacebookGroupPublicationMode(
  ownerUid: string | null | undefined,
  storage: Pick<Storage, 'getItem'> | null = getBrowserStorage(),
): FacebookGroupPublicationMode {
  if (!ownerUid || !storage) return 'separate';
  try {
    return storage.getItem(`${STORAGE_KEY_PREFIX}${ownerUid}`) === 'marketplace_groups'
      ? 'marketplace_groups'
      : 'separate';
  } catch {
    return 'separate';
  }
}

export function saveFacebookGroupPublicationMode(
  ownerUid: string | null | undefined,
  mode: FacebookGroupPublicationMode,
  storage: Pick<Storage, 'setItem'> | null = getBrowserStorage(),
): void {
  if (!ownerUid || !storage) return;
  try {
    storage.setItem(`${STORAGE_KEY_PREFIX}${ownerUid}`, mode);
  } catch {
    // The current selection remains usable if browser storage is unavailable.
  }
}
