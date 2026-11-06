import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownCircle, BarChart3, Building2, Calculator, ClipboardList, FileText, History,
  Images, LayoutDashboard, LogOut, Package, ScanLine, Settings, ShoppingCart, Sparkles,
  Truck, Users, Wallet, Zap, Search,
} from 'lucide-react';
import type { ModuleKey, PermissionMatrix } from '../types';
import type { BusinessModuleKey } from '../lib/businessPlan';
import { cn } from '../lib/utils';
import { getMobilePrimaryItems, getQuickActions, getVisibleNavigation, NAVIGATION_GROUPS } from '../lib/mobileNavigation';
import MobileNavigation from './MobileNavigation';

interface NavItem {
  name: string;
  path: string;
  icon: typeof LayoutDashboard;
  module: ModuleKey | null;
  businessModule?: BusinessModuleKey;
  ownerOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { name: 'Inicio', path: '/', icon: LayoutDashboard, module: null },
  { name: 'Consulta rápida', path: '/consulta-rapida', icon: ScanLine, module: 'stock' },
  { name: 'Stock', path: '/stock', icon: Package, module: 'stock' },
  { name: 'Buscar y enviar', path: '/fotos', icon: Images, module: 'stock' },
  { name: 'Ventas', path: '/ventas', icon: ShoppingCart, module: 'ventas' },
  { name: 'Reportes', path: '/reportes', icon: BarChart3, module: 'ventas' },
  { name: 'Presupuestos', path: '/presupuestos', icon: FileText, module: 'presupuestos' },
  { name: 'Clientes', path: '/clientes', icon: Users, module: 'clientes' },
  { name: 'Proveedores', path: '/proveedores', icon: Building2, module: 'proveedores' },
  { name: 'Compras a proveedores', path: '/compras', icon: Truck, module: 'proveedores' },
  { name: 'Ingresos de mercadería', path: '/ingresos', icon: ArrowDownCircle, module: 'ingresos' },
  { name: 'Flujo de Caja', path: '/caja', icon: Wallet, module: 'caja' },
  { name: 'Pedidos', path: '/pedidos', icon: ClipboardList, module: 'pedidos' },
  { name: 'Calculadora', path: '/calculadora', icon: Calculator, module: null },
  { name: 'Trazabilidad', path: '/trazabilidad', icon: History, module: 'config' },
  { name: 'Configuración', path: '/config', icon: Settings, module: 'config' },
  { name: 'Automatizaciones', path: '/automatizaciones', icon: Zap, module: 'stock', businessModule: 'automation' },
  { name: 'Asistente IA', path: '/ia', icon: Sparkles, module: null, businessModule: 'ai', ownerOnly: true },
];

interface AppNavigationProps {
  permissions: PermissionMatrix;
  businessModules: Partial<Record<BusinessModuleKey, boolean>>;
  isOwner: boolean;
  canWrite: boolean;
  businessName: string;
  displayName: string;
  displayInitial: string;
  roleLabel: string;
  pathname: string;
  hideBottomNav: boolean;
  loggingOut: boolean;
  onLogout: () => void;
}

export default function AppNavigation(props: AppNavigationProps) {
  const [search, setSearch] = useState('');
  const permissionState = {
    read: Object.fromEntries(Object.entries(props.permissions).map(([module, value]) => [module, value.read])),
    write: Object.fromEntries(Object.entries(props.permissions).map(([module, value]) => [module, props.canWrite && value.write])),
    businessModules: props.businessModules,
    isOwner: props.isOwner,
  };
  const items = getVisibleNavigation(NAV_ITEMS, permissionState);
  const actions = getQuickActions(permissionState);
  const groups = NAVIGATION_GROUPS.map(group => ({
    ...group,
    items: items.filter(item => group.paths.some(path => path === item.path)),
  })).filter(group => group.items.length > 0);
  const filteredGroups = groups.map(group => ({
    ...group,
    items: group.items.filter(item => item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())),
  })).filter(group => group.items.length > 0);
  const primaryItems = getMobilePrimaryItems(items);

  return <>
    <aside className="app-sidebar hidden lg:flex flex-col w-64 text-white shrink-0">
      <div className="p-6"><h1 className="brand-mark text-2xl font-extrabold text-white">RivaStock</h1><p className="mt-1 text-xs text-slate-400">{props.businessName}</p></div>
      <div className="px-4 pb-3">
        <Link to="/" className={cn('nav-item flex min-h-11 items-center gap-3 px-3 py-2 transition-colors', props.pathname === '/' ? 'nav-item-active text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white')}><LayoutDashboard size={19} strokeWidth={1.8} /><span className="font-medium">Inicio</span></Link>
        <label className="mt-2 flex min-h-11 items-center gap-2 rounded-lg border border-white/10 px-3 text-slate-400"><Search size={16} /><input aria-label="Ir a" placeholder="Ir a…" value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500" /></label>
      </div>
      <nav className="flex-1 min-h-0 px-4 pb-6 space-y-5 overflow-y-auto overscroll-contain">
        {filteredGroups.map(group => <section key={group.label} className="space-y-1">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{group.label}</p>
          {group.items.map(item => {
            const Icon = item.icon;
            const active = item.path === '/' ? props.pathname === '/' : props.pathname === item.path || props.pathname.startsWith(`${item.path}/`);
            return <Link key={item.path} to={item.path} aria-current={active ? 'page' : undefined} className={cn('nav-item flex min-h-11 items-center gap-3 px-3 py-2 transition-colors group', active ? 'nav-item-active text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white')}><Icon size={19} strokeWidth={1.8} /><span className="font-medium">{item.name}</span></Link>;
          })}
        </section>)}
      </nav>
      <div className="p-4 mt-auto border-t border-slate-800 space-y-2 shrink-0">
        <div className="flex items-center gap-3 px-3 py-2"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-sm font-bold text-white">{props.displayInitial}</div><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{props.displayName}</p><p className="truncate text-xs text-slate-500">{props.roleLabel}</p></div></div>
        <button type="button" onClick={props.onLogout} disabled={props.loggingOut} className="nav-item flex min-h-11 w-full items-center gap-3 px-3 py-2 text-slate-400 transition-colors hover:text-rose-300 disabled:opacity-50"><LogOut size={20} /><span className="font-medium">Cerrar sesión</span></button>
      </div>
    </aside>
    {!props.hideBottomNav && <MobileNavigation primaryItems={primaryItems} navItems={items} navGroups={groups} quickActions={actions} pathname={props.pathname} onLogout={props.onLogout} loggingOut={props.loggingOut} displayName={props.displayName} displayInitial={props.displayInitial} roleLabel={props.roleLabel} />}
  </>;
}
