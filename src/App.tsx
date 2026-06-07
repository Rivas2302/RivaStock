import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Layout from './components/Layout';
import RequirePermission from './components/RequirePermission';
import ToastContainer from './components/ToastContainer';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Stock = lazy(() => import('./pages/Stock'));
const Sales = lazy(() => import('./pages/Sales'));
const Intake = lazy(() => import('./pages/Intake'));
const CashFlow = lazy(() => import('./pages/CashFlow'));
const Orders = lazy(() => import('./pages/Orders'));
const Calculator = lazy(() => import('./pages/Calculator'));
const Settings = lazy(() => import('./pages/Settings'));
const PublicCatalog = lazy(() => import('./pages/PublicCatalog'));
const Quotes = lazy(() => import('./pages/Quotes'));
const QuotePublic = lazy(() => import('./pages/QuotePublic'));
const Customers = lazy(() => import('./pages/Customers'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Login = lazy(() => import('./pages/Login'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const AuthConfirm = lazy(() => import('./pages/AuthConfirm'));
const PublicProductPage = lazy(() => import('./pages/PublicProductPage'));
const POS = lazy(() => import('./pages/POS'));

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
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-950">
        <Loader2 className="animate-spin text-indigo-600" size={48} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={withSuspense(<Login />)} />
      <Route path="/forgot-password" element={withSuspense(<ForgotPassword />)} />
      <Route path="/reset-password" element={withSuspense(<ResetPassword />)} />
      <Route path="/auth/confirm" element={withSuspense(<AuthConfirm />)} />
      <Route path="/catalogo/:slug" element={withSuspense(<PublicCatalog />)} />
      <Route path="/catalogo/:slug/:productId" element={withSuspense(<PublicProductPage />)} />
      <Route path="/presupuesto/:id" element={withSuspense(<QuotePublic />)} />

        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={withSuspense(<Dashboard />)} />
          <Route path="stock" element={withSuspense(<RequirePermission module="stock"><Stock /></RequirePermission>)} />
          <Route path="ventas" element={withSuspense(<RequirePermission module="ventas"><Sales /></RequirePermission>)} />
          <Route path="pos" element={withSuspense(<RequirePermission module="ventas" action="write"><POS /></RequirePermission>)} />
          <Route path="presupuestos" element={withSuspense(<RequirePermission module="presupuestos"><Quotes /></RequirePermission>)} />
          <Route path="clientes" element={withSuspense(<RequirePermission module="clientes"><Customers /></RequirePermission>)} />
          <Route path="proveedores" element={withSuspense(<RequirePermission module="proveedores"><Suppliers /></RequirePermission>)} />
          <Route path="ingresos" element={withSuspense(<RequirePermission module="ingresos"><Intake /></RequirePermission>)} />
          <Route path="caja" element={withSuspense(<RequirePermission module="caja"><CashFlow /></RequirePermission>)} />
          <Route path="pedidos" element={withSuspense(<RequirePermission module="pedidos"><Orders /></RequirePermission>)} />
          <Route path="calculadora" element={withSuspense(<Calculator />)} />
          <Route path="config" element={withSuspense(<RequirePermission module="config"><Settings /></RequirePermission>)} />
        </Route>

      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export default function App() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  useEffect(() => {
    const handleOnline  = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') setShowInstallBanner(false);
    setDeferredPrompt(null);
  };

  return (
    <BrowserRouter>
      {!isOnline && (
        <div className="bg-rose-600 text-white text-center py-2 text-sm font-bold z-[100] relative">
          Estás trabajando sin conexión. Los cambios se sincronizarán al recuperar la conexión.
        </div>
      )}
      {showInstallBanner && (
        <div className="fixed bottom-4 left-4 right-4 bg-[#1a1a1a] text-white p-4 rounded-2xl shadow-2xl z-[100] flex items-center justify-between border border-[#2a2a2a]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center font-bold">RS</div>
            <p className="text-sm font-bold">Instalá RivaStock en tu dispositivo</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowInstallBanner(false)} className="text-xs font-bold text-slate-400">Ahora no</button>
            <button onClick={handleInstall} className="bg-indigo-600 text-white text-xs font-bold px-4 py-2 rounded-lg">Instalar</button>
          </div>
        </div>
      )}
      <AppRoutes />
      <ToastContainer />
    </BrowserRouter>
  );
}
