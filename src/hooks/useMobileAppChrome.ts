import { useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useIsMobile } from './useIsMobile';

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
  const isMobile = useIsMobile();

  useEffect(() => {
    setMobileChrome(isMobile ? { hideHeader, hideBottomNav } : DEFAULT_CHROME);
    return () => {
      setMobileChrome(DEFAULT_CHROME);
    };
  }, [hideBottomNav, hideHeader, isMobile, setMobileChrome]);
}
