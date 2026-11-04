import { useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';

export interface MobileAppChromeState {
  hideHeader: boolean;
  hideBottomNav: boolean;
}

interface MobileAppChromeOutletContext {
  setMobileChrome: (state: MobileAppChromeState) => void;
}

const DEFAULT_CHROME: MobileAppChromeState = { hideHeader: false, hideBottomNav: false };

export function useMobileAppChrome(options: MobileAppChromeState): void {
  const { setMobileChrome } = useOutletContext<MobileAppChromeOutletContext>();
  const { hideHeader, hideBottomNav } = options;

  useEffect(() => {
    const media = typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 1023px)')
      : null;
    const update = () => {
      const isMobile = media?.matches ?? window.innerWidth < 1024;
      setMobileChrome(isMobile ? { hideHeader, hideBottomNav } : DEFAULT_CHROME);
    };

    update();
    media?.addEventListener('change', update);
    return () => {
      media?.removeEventListener('change', update);
      setMobileChrome(DEFAULT_CHROME);
    };
  }, [hideBottomNav, hideHeader, setMobileChrome]);
}
