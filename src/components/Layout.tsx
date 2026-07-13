import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ArrowDownCircle,
  Wallet,
  ClipboardList,
  Calculator,
  Settings,
  LogOut,
  Menu,
  X,
  ExternalLink,
  FileText,
  Users,
  Building2,
  BarChart3
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../AuthContext';
import type { ModuleKey } from '../types';

import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface NavItem {
  name: string;
  path: string;
  icon: typeof LayoutDashboard;
  module: ModuleKey | null;
}

const NAV_ITEMS: NavItem[] = [
  { name: 'Inicio', path: '/', icon: LayoutDashboard, module: null },
  { name: 'Stock', path: '/stock', icon: Package, module: 'stock' },
  { name: 'Ventas', path: '/ventas', icon: ShoppingCart, module: 'ventas' },
  { name: 'Reportes', path: '/reportes', icon: BarChart3, module: 'ventas' },
  { name: 'Presupuestos', path: '/presupuestos', icon: FileText, module: 'presupuestos' },
  { name: 'Clientes', path: '/clientes', icon: Users, module: 'clientes' },
  { name: 'Proveedores', path: '/proveedores', icon: Building2, module: 'proveedores' },
  { name: 'Ingresos', path: '/ingresos', icon: ArrowDownCircle, module: 'ingresos' },
  { name: 'Flujo de Caja', path: '/caja', icon: Wallet, module: 'caja' },
  { name: 'Pedidos', path: '/pedidos', icon: ClipboardList, module: 'pedidos' },
  { name: 'Calculadora', path: '/calculadora', icon: Calculator, module: null },
  { name: 'Configuración', path: '/config', icon: Settings, module: 'config' },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, authUser, isOwner, logout, refetchData, permissions } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const lastRefetchAtRef = useRef(0);

  const navItems = NAV_ITEMS.filter(it =>
    it.module === null || permissions[it.module]?.read === true
  );
  const navGroups = [
    { label: 'Operación', paths: ['/', '/stock', '/ventas', '/reportes', '/presupuestos'] },
    { label: 'Relaciones', paths: ['/clientes', '/proveedores'] },
    { label: 'Gestión', paths: ['/ingresos', '/caja', '/pedidos', '/calculadora'] },
    { label: 'Sistema', paths: ['/config'] },
  ].map((group) => ({
    ...group,
    items: navItems.filter((item) => group.paths.includes(item.path)),
  })).filter((group) => group.items.length > 0);

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
    <div className="app-shell flex h-screen overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="app-sidebar hidden md:flex flex-col w-64 text-white shrink-0">
        <div className="p-6">
          <h1 className="brand-mark text-2xl font-extrabold text-white">RivaStock</h1>
          <p className="mt-1 text-xs text-slate-400">{user?.businessName}</p>
        </div>
        
        <nav className="flex-1 px-4 space-y-5 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.label} className="space-y-1">
              <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {group.label}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "nav-item flex items-center gap-3 px-3 py-2 transition-colors group",
                      isActive
                        ? "nav-item-active text-white"
                        : "text-slate-400 hover:bg-white/5 hover:text-white"
                    )}
                  >
                    <Icon size={19} strokeWidth={1.8} />
                    <span className="font-medium">{item.name}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-4 mt-auto border-t border-slate-800 space-y-2">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-[#365FAD] flex items-center justify-center text-white text-sm font-bold shrink-0">
              {displayInitial}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{displayName}</p>
              <p className="text-xs text-slate-500 truncate">{isOwner ? 'Propietario' : 'Colaborador'}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="nav-item flex items-center gap-3 w-full px-3 py-2 text-slate-400 hover:text-rose-300 transition-colors disabled:opacity-50"
          >
            <LogOut size={20} />
            <span className="font-medium">Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 bg-[#FCFAF5] dark:bg-[#202329] border-b border-[#DDD8CE] dark:border-slate-700 shrink-0">
          <h1 className="brand-mark text-xl font-extrabold text-[#1D2026] dark:text-white">RivaStock</h1>
          <button 
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-2 text-[#4E535D] dark:text-slate-300"
          >
            <Menu size={24} />
          </button>
        </header>

        <div className="app-content flex-1 overflow-y-auto p-4 md:p-8">
          <Outlet />
        </div>

        {/* Mobile Bottom Bar */}
        <nav className="md:hidden flex items-center justify-around p-2 bg-[#FCFAF5] dark:bg-[#202329] border-t border-[#DDD8CE] dark:border-slate-700 shrink-0">
          {navItems.slice(0, 5).map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex flex-col items-center gap-1 p-2 transition-colors",
                  isActive ? "text-[#365FAD] dark:text-[#90A9DF]" : "text-slate-400"
                )}
              >
                <Icon size={20} />
                <span className="text-[10px] font-medium">{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </main>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="fixed inset-y-0 right-0 w-64 app-sidebar text-white z-50 md:hidden flex flex-col"
            >
              <div className="p-6 flex items-center justify-between">
                <h1 className="text-xl font-bold text-indigo-400">Menú</h1>
                <button onClick={() => setIsMobileMenuOpen(false)}>
                  <X size={24} />
                </button>
              </div>
              <nav className="flex-1 px-4 space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={cn(
                        "nav-item flex items-center gap-3 px-3 py-2 transition-colors",
                        isActive ? "nav-item-active text-white" : "text-slate-400 hover:bg-white/5"
                      )}
                    >
                      <Icon size={20} />
                      <span className="font-medium">{item.name}</span>
                    </Link>
                  );
                })}
              </nav>
              <div className="p-4 border-t border-slate-800 space-y-2">
                <div className="flex items-center gap-3 px-3 py-2">
                  <div className="w-8 h-8 rounded-full bg-[#365FAD] flex items-center justify-center text-white text-sm font-bold shrink-0">
                    {displayInitial}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{displayName}</p>
                    <p className="text-xs text-slate-500 truncate">{isOwner ? 'Propietario' : 'Colaborador'}</p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="nav-item flex items-center gap-3 w-full px-3 py-2 text-slate-400 hover:text-rose-300 transition-colors disabled:opacity-50"
                >
                  <LogOut size={20} />
                  <span className="font-medium">Cerrar Sesión</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
