import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
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
import Login from './pages/Login';
import { useEffect } from 'react';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-950">Cargando...</div>;
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();

  useEffect(() => {
    if (user?.darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [user?.darkMode]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/catalogo/:slug" element={<PublicCatalog />} />
      
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="stock" element={<Stock />} />
        <Route path="ventas" element={<Sales />} />
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
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
