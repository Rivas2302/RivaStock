import { lazyWithRetry } from './lib/lazyWithRetry';
import React, { Suspense, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Layout from './components/Layout';
import RequirePermission from './components/RequirePermission';
import RequireBusinessModule from './components/RequireBusinessModule';
import ToastContainer from './components/ToastContainer';
import PWAInstallProvider from './components/PWAInstallProvider';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';
import { getOfflineQueueSize, subscribeToOfflineQueue, syncOfflineMutations } from './lib/db';
import { fetchBuildVersion, hasUnsavedAppChanges, reloadCurrentPage } from './lib/buildRuntime';
import ChunkRecoveryNotice from './components/ChunkRecoveryNotice';
import { reportReloadedChunkRecovery } from './lib/lazyWithRetry';

const Dashboard = lazyWithRetry('src/pages/Dashboard.tsx', () => import('./pages/Dashboard'));
const Stock = lazyWithRetry('src/pages/Stock.tsx', () => import('./pages/Stock'));
const Sales = lazyWithRetry('src/pages/Sales.tsx', () => import('./pages/Sales'));
const Intake = lazyWithRetry('src/pages/Intake.tsx', () => import('./pages/Intake'));
const CashFlow = lazyWithRetry('src/pages/CashFlow.tsx', () => import('./pages/CashFlow'));
const Orders = lazyWithRetry('src/pages/Orders.tsx', () => import('./pages/Orders'));
const Calculator = lazyWithRetry('src/pages/Calculator.tsx', () => import('./pages/Calculator'));
const Settings = lazyWithRetry('src/pages/Settings.tsx', () => import('./pages/Settings'));
const Automations = lazyWithRetry('src/pages/Automations.tsx', () => import('./pages/Automations'));
const PublicCatalog = lazyWithRetry('src/pages/PublicCatalog.tsx', () => import('./pages/PublicCatalog'));
const Quotes = lazyWithRetry('src/pages/Quotes.tsx', () => import('./pages/Quotes'));
const QuotePublic = lazyWithRetry('src/pages/QuotePublic.tsx', () => import('./pages/QuotePublic'));
const Customers = lazyWithRetry('src/pages/Customers.tsx', () => import('./pages/Customers'));
const Suppliers = lazyWithRetry('src/pages/Suppliers.tsx', () => import('./pages/Suppliers'));
const SupplierOrders = lazyWithRetry('src/pages/SupplierOrders.tsx', () => import('./pages/SupplierOrders'));
const Login = lazyWithRetry('src/pages/Login.tsx', () => import('./pages/Login'));
const ForgotPassword = lazyWithRetry('src/pages/ForgotPassword.tsx', () => import('./pages/ForgotPassword'));
const ResetPassword = lazyWithRetry('src/pages/ResetPassword.tsx', () => import('./pages/ResetPassword'));
const AuthConfirm = lazyWithRetry('src/pages/AuthConfirm.tsx', () => import('./pages/AuthConfirm'));
const POS = lazyWithRetry('src/pages/POS.tsx', () => import('./pages/POS'));
const Reports = lazyWithRetry('src/pages/Reports.tsx', () => import('./pages/Reports'));
const AuditTrail = lazyWithRetry('src/pages/AuditTrail.tsx', () => import('./pages/AuditTrail'));
const QuickPrice = lazyWithRetry('src/pages/QuickPrice.tsx', () => import('./pages/QuickPrice'));
const ProductPhotos = lazyWithRetry('src/pages/ProductPhotosRoute.tsx', () => import('./pages/ProductPhotosRoute'));
const AIHub = lazyWithRetry('src/pages/AIHub.tsx', () => import('./pages/AIHub'));
const Knowledge = lazyWithRetry('src/pages/Knowledge.tsx', () => import('./pages/Knowledge'));
const PlatformAdmin = lazyWithRetry('src/pages/PlatformAdmin.tsx', () => import('./pages/PlatformAdmin'));
const Welcome = lazyWithRetry('src/pages/Welcome.tsx', () => import('./pages/Welcome'));

function OwnerRoute({ children }: { children: React.ReactNode }) {
  const { isOwner } = useAuth();
  return isOwner ? <>{children}</> : <Navigate to="/" replace />;
}

function PageLoader() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Loader2 className="animate-spin text-indigo-600" size={36} />
    </div>
  );
}

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<PageLoader />}>{element}</Suspense>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, authUser, loading, authError, refetchData, logout } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh] bg-slate-50 dark:bg-slate-950">
        <Loader2 className="animate-spin text-indigo-600" size={48} />
      </div>
    );
  }
  if (authError) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <section role="alert" className="max-w-md rounded-2xl border border-amber-200 bg-white p-6 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white">
          <h2 className="text-lg font-bold">No pudimos conectar con tu cuenta</h2>
          <p className="mt-2 text-sm">{authError}</p>
          <div className="mt-4 flex gap-3">
            <button type="button" onClick={refetchData} className="rounded-lg bg-indigo-600 px-4 py-2 text-white">Reintentar conexión</button>
            <button type="button" onClick={() => void logout()} className="rounded-lg border border-slate-300 px-4 py-2 dark:border-slate-600">Cerrar sesión</button>
          </div>
        </section>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: `${location.pathname}${location.search}${location.hash}` }} replace />;
  if (authUser?.forcePass) {
    const type = authUser.signupKind === 'business_owner' || authUser.signupKind === 'collaborator'
      ? 'invite'
      : authUser.needsProfileSetup ? 'first-login' : 'temporary';
    return <Navigate to={`/reset-password?type=${type}`} replace />;
  }
  return <>{children}</>;
}

function PlatformAdminRoute({ children }: { children: React.ReactNode }) {
  const { isPlatformAdmin, isPlatformAdminLoading, loading } = useAuth();
  if (loading || isPlatformAdminLoading) return <PageLoader />;
  return isPlatformAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={withSuspense(<Login />)} />
      <Route path="/forgot-password" element={withSuspense(<ForgotPassword />)} />
      <Route path="/reset-password" element={withSuspense(<ResetPassword />)} />
      <Route path="/auth/confirm" element={withSuspense(<AuthConfirm />)} />
      <Route path="/catalogo/:slug/:productId?" element={withSuspense(<PublicCatalog />)} />
      <Route path="/ofertas/:slug/:productId?" element={withSuspense(<PublicCatalog />)} />
      <Route path="/presupuesto/:id" element={withSuspense(<QuotePublic />)} />

        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={withSuspense(<Dashboard />)} />
          <Route path="bienvenida" element={withSuspense(<Welcome />)} />
          <Route path="plataforma" element={<PlatformAdminRoute>{withSuspense(<PlatformAdmin />)}</PlatformAdminRoute>} />
          <Route path="consulta-rapida" element={withSuspense(<RequireBusinessModule module="quickPrice"><RequirePermission module="stock" action="read"><QuickPrice /></RequirePermission></RequireBusinessModule>)} />
          <Route path="fotos" element={withSuspense(<RequireBusinessModule module="sendPhotos"><ProductPhotos /></RequireBusinessModule>)} />
          <Route path="stock" element={withSuspense(<RequireBusinessModule module="stock"><RequirePermission module="stock"><Stock /></RequirePermission></RequireBusinessModule>)} />
          <Route path="revendedores" element={withSuspense(<RequireBusinessModule module="resellers"><RequirePermission module="stock"><Stock /></RequirePermission></RequireBusinessModule>)} />
          <Route path="ventas" element={withSuspense(<RequireBusinessModule module="sales"><RequirePermission module="ventas"><Sales /></RequirePermission></RequireBusinessModule>)} />
          <Route path="reportes" element={withSuspense(<RequireBusinessModule module="reports"><RequirePermission module="ventas" action="read"><Reports /></RequirePermission></RequireBusinessModule>)} />
          <Route path="pos" element={withSuspense(<RequireBusinessModule module="sales"><RequirePermission module="ventas" action="write"><POS /></RequirePermission></RequireBusinessModule>)} />
          <Route path="presupuestos" element={withSuspense(<RequireBusinessModule module="quotes"><RequirePermission module="presupuestos"><Quotes /></RequirePermission></RequireBusinessModule>)} />
          <Route path="clientes" element={withSuspense(<RequireBusinessModule module="customers"><RequirePermission module="clientes"><Customers /></RequirePermission></RequireBusinessModule>)} />
          <Route path="proveedores" element={withSuspense(<RequireBusinessModule module="suppliers"><RequirePermission module="proveedores"><Suppliers /></RequirePermission></RequireBusinessModule>)} />
          <Route path="compras" element={withSuspense(<RequireBusinessModule module="supplierOrders"><RequirePermission module="proveedores"><SupplierOrders /></RequirePermission></RequireBusinessModule>)} />
          <Route path="ingresos" element={withSuspense(<RequireBusinessModule module="intake"><RequirePermission module="ingresos"><Intake /></RequirePermission></RequireBusinessModule>)} />
          <Route path="caja" element={withSuspense(<RequireBusinessModule module="cash"><RequirePermission module="caja"><CashFlow /></RequirePermission></RequireBusinessModule>)} />
          <Route path="pedidos" element={withSuspense(<RequireBusinessModule module="orders"><RequirePermission module="pedidos"><Orders /></RequirePermission></RequireBusinessModule>)} />
          <Route path="pedidos/:codigo" element={withSuspense(<RequireBusinessModule module="orders"><RequirePermission module="pedidos"><Orders /></RequirePermission></RequireBusinessModule>)} />
          <Route path="calculadora" element={withSuspense(<RequireBusinessModule module="calculator"><Calculator /></RequireBusinessModule>)} />
          <Route path="config" element={withSuspense(<RequirePermission module="config"><Settings /></RequirePermission>)} />
          <Route path="automatizaciones" element={withSuspense(<RequireBusinessModule module="automation"><RequirePermission module="stock"><Automations /></RequirePermission></RequireBusinessModule>)} />
          <Route path="ia/conocimientos/*" element={withSuspense(<RequireBusinessModule module="knowledge"><OwnerRoute><Knowledge /></OwnerRoute></RequireBusinessModule>)} />
          <Route path="ia" element={withSuspense(<RequireBusinessModule module="ai"><OwnerRoute><AIHub /></OwnerRoute></RequireBusinessModule>)} />
          <Route path="trazabilidad" element={withSuspense(<RequireBusinessModule module="traceability"><RequirePermission module="config"><AuditTrail /></RequirePermission></RequireBusinessModule>)} />
        </Route>

      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

const PUBLIC_PATH_PREFIXES = ['/catalogo/', '/ofertas/', '/presupuesto/', '/login', '/forgot-password', '/reset-password', '/auth/'];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATH_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return false;
}

function AppShell() {
  const location = useLocation();
  const publicRoute = isPublicPath(location.pathname);

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState(getOfflineQueueSize);
  const [availableBuild, setAvailableBuild] = useState<string | null>(null);
  const [updateBlockedByDraft, setUpdateBlockedByDraft] = useState(false);
  const lastLocationKey = useRef(location.key);

  useEffect(() => {
    reportReloadedChunkRecovery();
    let disposed = false;
    const checkBuild = async () => {
      const version = await fetchBuildVersion();
      if (!disposed && version && version.buildId !== __RIVASTOCK_BUILD_ID__) setAvailableBuild(version.buildId);
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') void checkBuild(); };
    void checkBuild();
    const timer = window.setInterval(() => { void checkBuild(); }, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onVisibility);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (lastLocationKey.current === location.key) return;
    lastLocationKey.current = location.key;
    if (availableBuild && !hasUnsavedAppChanges()) reloadCurrentPage();
  }, [availableBuild, location.key]);

  useEffect(() => {
    const handleOnline  = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const refresh = () => setPendingSyncCount(getOfflineQueueSize());
    const unsubscribe = subscribeToOfflineQueue(refresh);
    window.addEventListener('online', refresh);
    void syncOfflineMutations().finally(refresh);
    return () => { unsubscribe(); window.removeEventListener('online', refresh); };
  }, []);

  return (
    <>
      {!isOnline && !publicRoute && (
        <div className="bg-rose-600 text-white text-center py-2 text-sm font-bold z-[100] relative">
          Estás trabajando sin conexión. {pendingSyncCount > 0 ? `${pendingSyncCount} cambio${pendingSyncCount === 1 ? '' : 's'} pendiente${pendingSyncCount === 1 ? '' : 's'} de sincronización.` : 'Los cambios nuevos se sincronizarán al recuperar la conexión.'}
        </div>
      )}
      <div className={`fixed ${isOnline ? 'top-[max(1rem,env(safe-area-inset-top))]' : 'top-[max(5rem,calc(env(safe-area-inset-top)_+_5rem))]'} left-[max(1rem,env(safe-area-inset-left))] right-[max(1rem,env(safe-area-inset-right))] sm:left-auto sm:w-[min(30rem,calc(100vw_-_2rem))] z-[100] flex flex-col gap-2 pointer-events-none`}>
        <ToastContainer />
      </div>
      <ChunkRecoveryNotice />
      {availableBuild && <div className="fixed left-1/2 top-[max(.75rem,env(safe-area-inset-top))] z-[190] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-xs font-semibold text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100">
        <span>Hay una versión nueva</span>
        <button type="button" className="font-bold text-indigo-700 underline dark:text-indigo-300" onClick={() => {
          if (hasUnsavedAppChanges()) { setUpdateBlockedByDraft(true); return; }
          reloadCurrentPage();
        }}>Actualizar</button>
        {updateBlockedByDraft && <span className="max-w-40 text-[10px]">Guardá o cerrá el formulario antes de actualizar.</span>}
      </div>}
      <PWAInstallProvider allowInstallPrompt={location.pathname !== '/catalogo' && !location.pathname.startsWith('/catalogo/') && !location.pathname.startsWith('/p/')}><AppRoutes /></PWAInstallProvider>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
