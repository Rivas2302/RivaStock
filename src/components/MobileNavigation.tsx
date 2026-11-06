import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { LogOut, Plus, Search, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { useIsMobile } from '../hooks/useIsMobile';
import { matchesMobileNavigationSearch } from '../lib/mobileNavigation';
import './MobileNavigation.css';

interface NavigationItem {
  name: string;
  path: string;
  icon: LucideIcon;
}

interface NavigationGroup {
  label: string;
  items: NavigationItem[];
}

interface QuickAction {
  label: string;
  description: string;
  path: string;
}

interface MobileNavigationProps {
  primaryItems: [NavigationItem | undefined, NavigationItem | undefined, NavigationItem | undefined, NavigationItem | undefined];
  navItems: NavigationItem[];
  navGroups: NavigationGroup[];
  quickActions: QuickAction[];
  pathname: string;
  onLogout: () => void;
  loggingOut: boolean;
  displayName: string;
  displayInitial: string;
  roleLabel: string;
}

function isActive(path: string, pathname: string) {
  return path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
}

export default function MobileNavigation({ primaryItems, navItems, navGroups, quickActions, pathname, onLogout, loggingOut, displayName, displayInitial, roleLabel }: MobileNavigationProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [search, setSearch] = useState('');
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const sheetHistoryRef = useRef(false);

  useEffect(() => {
    if (!sheetOpen) return;
    if (!sheetHistoryRef.current) {
      window.history.pushState({ mobileNavigationSheet: true }, '');
      sheetHistoryRef.current = true;
    }
    const closeOnBack = () => {
      sheetHistoryRef.current = false;
      setSheetOpen(false);
      setSearch('');
    };
    window.addEventListener('popstate', closeOnBack);
    return () => window.removeEventListener('popstate', closeOnBack);
  }, [sheetOpen]);

  const closeSheet = () => {
    if (sheetHistoryRef.current) {
      sheetHistoryRef.current = false;
      window.history.back();
    }
    setSheetOpen(false);
    setSearch('');
  };

  const navigateFromSheet = (path: string) => {
    if (!sheetHistoryRef.current) {
      setSheetOpen(false);
      setSearch('');
      navigate(path);
      return;
    }
    sheetHistoryRef.current = false;
    setSheetOpen(false);
    setSearch('');
    window.addEventListener('popstate', () => navigate(path), { once: true });
    window.history.back();
  };

  return <>
    <nav aria-label="Navegación principal" className="mobile-navigation-bar lg:hidden">
      {primaryItems[0] && <NavLink item={primaryItems[0]} pathname={pathname} />}
      {primaryItems[1] && <NavLink item={primaryItems[1]} pathname={pathname} />}
      <button type="button" aria-label={sheetOpen ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={sheetOpen} onClick={() => sheetOpen ? closeSheet() : setSheetOpen(true)} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--action-bg)] text-[var(--action-ink)] shadow-md">
        {sheetOpen ? <X size={23} /> : <Plus size={24} />}
      </button>
      {primaryItems[2] && <NavLink item={primaryItems[2]} pathname={pathname} />}
      {primaryItems[3] && <NavLink item={primaryItems[3]} pathname={pathname} label={primaryItems[3].path === '/consulta-rapida' ? 'Consulta' : undefined} />}
    </nav>

    <AnimatePresence>
      {sheetOpen && <>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeSheet} className="mobile-navigation-overlay lg:hidden" />
        <motion.div initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.98 }} role="dialog" aria-modal="true" aria-label="¿Qué querés hacer?" className="mobile-navigation-sheet lg:hidden">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">¿Qué querés hacer?</h2>
            <button type="button" aria-label="Cerrar" onClick={closeSheet} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--surface-muted)]"><X size={21} /></button>
          </div>
          <label className="mb-5 flex min-h-12 items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 focus-within:border-[var(--brand)]"><Search size={18} className="text-[var(--ink-muted)]"/><input autoFocus={!isMobile} type="search" aria-label="Buscar acciones y secciones" placeholder="Buscar…" value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"/></label>
          <div className="space-y-5">
            {quickActions.filter(action => matchesMobileNavigationSearch(`${action.label} ${action.description}`, search)).length > 0 && <section aria-label="Crear">
              <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">Crear</h3>
              <div className="grid grid-cols-2 gap-2">
            {quickActions.filter(action => matchesMobileNavigationSearch(`${action.label} ${action.description}`, search)).map(action => {
              const item = navItems.find(entry => entry.path === action.path.split('?')[0]);
              const Icon = item?.icon ?? Plus;
              return <Link key={action.label} to={action.path} onClick={event => { event.preventDefault(); navigateFromSheet(action.path); }} className="flex min-h-[104px] flex-col items-start gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3.5 text-left hover:bg-[var(--surface-muted)]"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-strong)]"><Icon size={20} /></span><span className="flex flex-col gap-0.5"><span className="text-sm font-bold">{action.label}</span><span className="text-xs text-[var(--ink-muted)]">{action.description}</span></span></Link>;
            })}
              </div>
            </section>}
            <nav aria-label="Ir a">
            {navGroups.map(group => {
              const visibleItems = group.items.filter(item => matchesMobileNavigationSearch(item.name, search));
              return visibleItems.length > 0 && <section key={group.label} aria-label={group.label} className="mb-5">
              <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">{group.label}</h3>
              <div className="grid grid-cols-4 gap-2">
                {visibleItems.map(item => {
                  const Icon = item.icon;
                  const active = isActive(item.path, pathname);
                  return <Link key={item.path} to={item.path} onClick={event => { event.preventDefault(); navigateFromSheet(item.path); }} aria-current={active ? 'page' : undefined} className={cn('flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl p-2 text-center text-xs font-medium', active ? 'bg-[var(--brand-soft)] text-[var(--brand-strong)]' : 'text-[var(--ink-subtle)] hover:bg-[var(--surface-muted)]')}><Icon size={21} /><span>{item.name}</span></Link>;
                })}
              </div>
            </section>;
            })}
            </nav>
            <div className="flex min-w-0 items-center gap-2 border-t border-[var(--line)] pt-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-sm font-bold text-white">{displayInitial}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{displayName}</span><span className="block truncate text-xs text-[var(--ink-muted)]">{roleLabel}</span></span></div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { closeSheet(); onLogout(); }} disabled={loggingOut} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-950/30"><LogOut size={18} />Cerrar sesión</button>
            </div>
          </div>
        </motion.div>
      </>}
    </AnimatePresence>
  </>;
}

function NavLink({ item, pathname, label }: { item: NavigationItem; pathname: string; label?: string }) {
  const Icon = item.icon;
  const active = isActive(item.path, pathname);
  return <Link to={item.path} aria-current={active ? 'page' : undefined} className={cn('relative flex min-h-12 min-w-14 flex-col items-center justify-center gap-1 rounded-full px-2 transition-colors', active ? 'text-[var(--brand-strong)]' : 'text-[var(--ink-muted)]')}>
    {active && <span className="absolute inset-0 rounded-full bg-[var(--brand-soft)]" />}<Icon className="relative" size={20} /><span className="relative text-[10px] font-medium">{label ?? item.name}</span>
  </Link>;
}
