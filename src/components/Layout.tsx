import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useAuth } from '../AuthContext';
import { useBusinessPlan } from '../hooks/useBusinessPlan';
import type { BusinessModuleKey } from '../lib/businessPlan';
const BusinessSetupModal = lazy(() => import('./BusinessSetupModal'));
const AppNavigation = lazy(() => import('./AppNavigation'));

import { cn } from '../lib/utils';
import type { PermissionMatrix } from '../types';
export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, authUser, isOwner, logout, refetchData, permissions } = useAuth();
  const [mobileChrome, setMobileChrome] = useState({ hideHeader: false, hideBottomNav: false });
  const { plan, loading: planLoading, error: planError } = useBusinessPlan();
  const businessCanWrite = !planLoading && !planError && Boolean(plan && plan.status !== 'suspended');
  const needsBusinessSetup = !user?.onboardingCompletedAt && isOwner;
  const [loggingOut, setLoggingOut] = useState(false);
  const lastRefetchAtRef = useRef(0);

  const includedModules = !planLoading && !planError ? plan?.limits.modules : null;
  const displayName = isOwner
    ? (user?.displayName || authUser?.email || '')
    : (authUser?.email || '');
  const displayInitial = displayName.charAt(0).toUpperCase() || '?';

  useEffect(() => {
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
  }, [refetchData]);

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

  return (
    <div className="app-shell flex h-[100dvh] min-h-[100dvh] overflow-hidden">
      <Suspense fallback={<div className="hidden w-64 shrink-0 lg:block" />}><AppNavigation
        permissions={permissions as PermissionMatrix}
        businessModules={includedModules ?? {}}
        isOwner={isOwner}
        canWrite={businessCanWrite}
        businessName={user?.businessName ?? 'RivaStock'}
        displayName={displayName}
        displayInitial={displayInitial}
        roleLabel={isOwner ? 'Propietario' : 'Colaborador'}
        pathname={location.pathname}
        hideBottomNav={mobileChrome.hideBottomNav}
        loggingOut={loggingOut}
        onLogout={handleLogout}
      /></Suspense>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {plan?.status === 'suspended' && (
          <div role="alert" className="sticky top-0 z-30 border-b border-rose-300 bg-rose-100 px-4 py-3 text-center text-sm font-semibold text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100">
            La cuenta está suspendida. Comunicate con RivaTech.
          </div>
        )}
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
