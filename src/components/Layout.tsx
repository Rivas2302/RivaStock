import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useAuth } from '../AuthContext';
import { useBusinessPlan } from '../hooks/useBusinessPlan';
import type { BusinessModuleKey } from '../lib/businessPlan';
const BusinessSetupModal = lazy(() => import('./BusinessSetupModal'));
const AppNavigation = lazy(() => import('./AppNavigation'));

import { cn } from '../lib/utils';
import type { PermissionMatrix } from '../types';
import { getRivaTechWhatsAppUrl } from '../lib/platformSupport';
import { useUnreadCatalogOrders } from '../hooks/useUnreadCatalogOrders';
import { Link } from 'react-router-dom';
import { DISABLED_BUSINESS_MODULES } from '../lib/businessModules';
import { normalizeDisplayName } from '../lib/accountProfile';
export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, authUser, isOwner, logout, refetchData, permissions } = useAuth();
  const [mobileChrome, setMobileChrome] = useState({ hideHeader: false, hideBottomNav: false });
  const { plan } = useBusinessPlan();
  const businessCanWrite = Boolean(plan && plan.status !== 'suspended');
  const needsBusinessSetup = !user?.onboardingCompletedAt && isOwner;
  const [loggingOut, setLoggingOut] = useState(false);
  const lastRefetchAtRef = useRef(0);
  const { unreadCount, notice, clearNotice } = useUnreadCatalogOrders(user?.uid);

  const includedModules = plan ? plan.limits.modules : DISABLED_BUSINESS_MODULES;
  const displayName = normalizeDisplayName(authUser?.displayName)
    || normalizeDisplayName(user?.displayName)
    || 'Mi perfil';
  const displayInitial = displayName.charAt(0).toUpperCase() || '?';

  useEffect(() => {
    if (plan?.status === 'suspended') return;
    const MIN_REFETCH_INTERVAL_MS = 10_000;
    const maybeRefetch = () => {
      const now = Date.now();
      if (now - lastRefetchAtRef.current < MIN_REFETCH_INTERVAL_MS) return;
      lastRefetchAtRef.current = now;
      refetchData();
    };

    const onFocus = () => maybeRefetch();
    const onVisible = () => {
      if (document.visibilityState === 'visible') maybeRefetch();
    };
    const onOnline = () => maybeRefetch();

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [plan?.status, refetchData]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login');
    } finally {
      setLoggingOut(false);
    }
  };

  if (plan?.status === 'suspended') {
    return <main className="flex min-h-[100dvh] items-center justify-center bg-[var(--page)] p-6 text-[var(--ink)]">
      <section className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center shadow-xl">
        <h1 className="text-2xl font-black">Tu cuenta está suspendida</h1>
        <a href={getRivaTechWhatsAppUrl('Hola RivaTech, necesito regularizar mi cuenta de RivaStock.')} target="_blank" rel="noreferrer" className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-600 px-5 font-bold text-white">Escribir por WhatsApp</a>
      </section>
    </main>;
  }

  return (
    <div className="app-shell flex h-[100dvh] min-h-[100dvh] overflow-hidden">
      <Suspense fallback={<div className="hidden w-64 shrink-0 lg:block" />}><AppNavigation
        permissions={permissions as PermissionMatrix}
        businessModules={includedModules}
        isOwner={isOwner}
        canWrite={businessCanWrite}
        businessName={user?.businessName ?? 'RivaStock'}
        displayName={displayName}
        displayInitial={displayInitial}
        roleLabel={isOwner ? 'Propietario' : 'Colaborador'}
        unreadOrderCount={unreadCount}
        pathname={location.pathname}
        hideBottomNav={mobileChrome.hideBottomNav}
        loggingOut={loggingOut}
        onLogout={handleLogout}
      /></Suspense>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {notice && <div role="status" aria-live="polite" className="z-20 flex items-center gap-3 border-b border-[var(--line)] bg-[var(--brand-soft)] px-4 py-3 text-sm font-semibold text-[var(--brand-strong)]"><span className="min-w-0 flex-1">{notice.channel === 'reseller' ? 'Nuevo pedido de revendedor' : 'Nuevo pedido'}{notice.orderCode ? ` ${notice.orderCode}` : ''}</span><Link to={notice.orderCode ? `/pedidos/${encodeURIComponent(notice.orderCode)}` : '/pedidos'} onClick={clearNotice} className="rounded-lg bg-[var(--brand)] px-3 py-2 text-white">Ver</Link><button type="button" aria-label="Cerrar aviso de nuevo pedido" onClick={clearNotice} className="grid size-9 place-items-center rounded-full">×</button></div>}
        {plan?.suspensionScheduledFor && <div role="alert" className="sticky top-0 z-30 flex flex-wrap items-center justify-center gap-3 border-b border-amber-300 bg-amber-100 px-4 py-3 text-center text-sm font-semibold text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <span>Tu cuenta se suspende el {new Date(plan.suspensionScheduledFor).toLocaleDateString('es-AR')}, comunicate con RivaTech</span>
          <a href={getRivaTechWhatsAppUrl('Hola RivaTech, quiero consultar el aviso de suspensión de mi cuenta de RivaStock.')} target="_blank" rel="noreferrer" className="rounded-lg bg-emerald-700 px-3 py-2 text-white">WhatsApp</a>
        </div>}
        {needsBusinessSetup && (
          <Suspense fallback={<div className="fixed inset-0 z-[100] bg-black/50" />}>
            <BusinessSetupModal />
          </Suspense>
        )}
        {/* Mobile Header */}
        {!mobileChrome.hideHeader && <header className="lg:hidden flex items-center justify-between p-4 bg-[var(--surface)] border-b border-[var(--line)] shrink-0">
          <h1 className="brand-mark text-xl font-extrabold text-[var(--ink)]">RivaStock</h1>
        </header>}

        <div className={cn('app-content flex-1 overflow-y-auto p-4 lg:p-8', !mobileChrome.hideBottomNav && 'pb-32 lg:pb-8')}>
          <Outlet context={{ setMobileChrome, menu: () => undefined }} />
        </div>

      </main>
    </div>
  );
}
