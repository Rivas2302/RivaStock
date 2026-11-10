import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Share, X } from 'lucide-react';
import {
  IOS_INSTALL_HINT_DISMISSED_AT_KEY,
  IOS_INSTALL_HINT_SHOWN_AT_KEY,
  isIOSDevice,
  isPWAStandalone,
  shouldShowIOSInstallHint,
} from '../lib/pwaInstall';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface PWAInstallContextValue {
  openInstall: () => Promise<void>;
}

const PWAInstallContext = createContext<PWAInstallContextValue>({ openInstall: async () => undefined });

export function usePWAInstall(): PWAInstallContextValue {
  return useContext(PWAInstallContext);
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const navigatorStandalone = Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  return isPWAStandalone(window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser', navigatorStandalone);
}

function readTimestamp(key: string): number | null {
  try {
    const value = window.localStorage.getItem(key);
    const timestamp = value ? Number(value) : Number.NaN;
    return Number.isFinite(timestamp) ? timestamp : null;
  } catch {
    return null;
  }
}

export default function PWAInstallProvider({ children, allowInstallPrompt = true }: { children: ReactNode; allowInstallPrompt?: boolean }) {
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    const ios = isIOSDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
    setIsIOS(ios);
    let hintTimer: number | undefined;
    if (ios && allowInstallPrompt && !isStandalone()) {
      const now = Date.now();
      if (shouldShowIOSInstallHint(now, readTimestamp(IOS_INSTALL_HINT_SHOWN_AT_KEY), readTimestamp(IOS_INSTALL_HINT_DISMISSED_AT_KEY))) {
        hintTimer = window.setTimeout(() => {
          setShowIOSHint(true);
          try { window.localStorage.setItem(IOS_INSTALL_HINT_SHOWN_AT_KEY, String(Date.now())); } catch { /* Storage may be disabled. */ }
        }, 1200);
      }
    }

    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setDeferredPrompt(null);
      setShowIOSHint(false);
      setShowInstructions(false);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      if (hintTimer !== undefined) window.clearTimeout(hintTimer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, [allowInstallPrompt]);

  const openInstall = useCallback(async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') setShowIOSHint(false);
      setDeferredPrompt(null);
      return;
    }
    setShowInstructions(true);
  }, [deferredPrompt]);

  const dismissIOSHint = () => {
    setShowIOSHint(false);
    try { window.localStorage.setItem(IOS_INSTALL_HINT_DISMISSED_AT_KEY, String(Date.now())); } catch { /* Storage may be disabled. */ }
  };

  const contextValue = useMemo(() => ({ openInstall }), [openInstall]);
  return <PWAInstallContext.Provider value={contextValue}>
    {children}
    {showIOSHint && !isStandalone() && <aside role="note" aria-label="Instalar RivaStock en iPhone" className="fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[120] mx-auto max-w-md rounded-2xl border border-slate-700 bg-slate-950/95 p-4 text-white shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-bold">Instalá RivaStock en tu iPhone</h2><ol className="mt-2 space-y-1.5 text-xs text-slate-200"><li className="flex items-center gap-2"><span className="grid size-6 shrink-0 place-items-center rounded-lg bg-white/10"><Share size={15} aria-label="Compartir"/></span><span>1. Tocá <strong>Compartir</strong>.</span></li><li>2. Elegí <strong>“Agregar a pantalla de inicio”</strong>.</li><li>3. Tocá <strong>Agregar</strong>.</li></ol></div><button type="button" aria-label="Cerrar aviso de instalación" onClick={dismissIOSHint} className="grid size-9 shrink-0 place-items-center rounded-full text-slate-300 hover:bg-white/10"><X size={18}/></button></div>
      <button type="button" onClick={dismissIOSHint} className="mt-3 min-h-10 w-full rounded-xl bg-white/10 px-3 text-sm font-semibold hover:bg-white/15">Ahora no</button>
    </aside>}
    {!isIOS && allowInstallPrompt && deferredPrompt && !isStandalone() && <aside role="note" aria-label="Instalar RivaStock" className="fixed inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[120] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/95 p-3 text-white shadow-2xl backdrop-blur">
      <img src="/icons/icon-192.png" alt="" className="size-10 rounded-xl"/><p className="min-w-0 flex-1 text-sm font-bold">Instalá RivaStock</p><button type="button" onClick={() => void openInstall()} className="min-h-11 rounded-xl bg-indigo-500 px-4 text-sm font-bold">Instalar app</button>
    </aside>}
    {showInstructions && <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center" onClick={() => setShowInstructions(false)}>
      <section role="dialog" aria-modal="true" aria-labelledby="pwa-install-title" onClick={event => event.stopPropagation()} className="w-full max-w-md rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-5 text-[var(--ink)] shadow-2xl">
        <div className="flex items-center gap-3"><img src="/icons/icon-192.png" alt="" className="size-12 rounded-2xl"/><h2 id="pwa-install-title" className="flex-1 text-lg font-bold">Instalar app</h2><button type="button" aria-label="Cerrar instrucciones de instalación" onClick={() => setShowInstructions(false)} className="grid size-10 place-items-center rounded-full hover:bg-[var(--surface-muted)]"><X size={20}/></button></div>
        {isIOS ? <ol className="mt-5 space-y-4 text-sm"><li className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-muted)]"><Share size={20}/></span><span>1. Tocá <strong>Compartir</strong>.</span></li><li>2. Elegí <strong>“Agregar a pantalla de inicio”</strong>.</li><li className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-muted)]"><Plus size={20}/></span><span>3. Tocá <strong>Agregar</strong>.</span></li></ol> : <p className="mt-5 text-sm text-[var(--ink-muted)]">Abrí el menú de tu navegador y elegí <strong>Instalar app</strong> o <strong>Agregar a pantalla de inicio</strong>.</p>}
        <button type="button" onClick={() => setShowInstructions(false)} className="mt-5 min-h-12 w-full rounded-xl bg-[var(--action-bg)] px-4 font-bold text-[var(--action-ink)]">Listo</button>
      </section>
    </div>}
  </PWAInstallContext.Provider>;
}
