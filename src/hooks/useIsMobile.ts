import { useSyncExternalStore } from 'react';

const MOBILE_MEDIA_QUERY = '(max-width: 1023px)';

function getSnapshot(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof window.matchMedia === 'function'
    ? window.matchMedia(MOBILE_MEDIA_QUERY).matches
    : window.innerWidth < 1024;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const media = window.matchMedia(MOBILE_MEDIA_QUERY);
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }
  media.addListener(onChange);
  return () => media.removeListener(onChange);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}