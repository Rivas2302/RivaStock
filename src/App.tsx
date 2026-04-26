import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Stock from './pages/Stock';
import Sales from './pages/Sales';
import Intake from './pages/Intake';
import CashFlow from './pages/CashFlow';
import Orders from './pages/Orders';
import Calculator from './pages/Calculator';
import Settings from './pages/Settings';
import PublicCatalog from './pages/PublicCatalog';
import Quotes from './pages/Quotes';
import QuotePublic from './pages/QuotePublic';
import Customers from './pages/Customers';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';

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
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/catalogo/:slug" element={<PublicCatalog />} />
      <Route path="/presupuesto/:id" element={<QuotePublic />} />

      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="stock" element={<Stock />} />
        <Route path="ventas" element={<Sales />} />
        <Route path="presupuestos" element={<Quotes />} />
        <Route path="clientes" element={<Customers />} />
        <Route path="ingresos" element={<Intake />} />
        <Route path="caja" element={<CashFlow />} />
        <Route path="pedidos" element={<Orders />} />
        <Route path="calculadora" element={<Calculator />} />
        <Route path="config" element={<Settings />} />
      </Route>
      
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default function App() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult: any) => {
        if (choiceResult.outcome === 'accepted') {
          setShowInstallBanner(false);
        }
        setDeferredPrompt(null);
      });
    }
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
    </BrowserRouter>
  );
}
