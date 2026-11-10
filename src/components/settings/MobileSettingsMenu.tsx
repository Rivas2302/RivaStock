import { ChevronRight, ContactRound, Globe, Moon, Palette, Tags, Users, Wrench, DollarSign, AlertTriangle, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';

export type MobileSettingsScreen = 'business' | 'profile' | 'categories' | 'prices' | 'catalog' | 'owners' | 'team' | 'maintenance' | 'appearance' | 'danger';
type SettingsTab = 'general' | 'categories' | 'owners' | 'prices' | 'catalog' | 'maintenance' | 'equipo';

interface MobileSettingsMenuProps {
  businessName: string;
  planName?: string;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpen: (tab: SettingsTab, screen: MobileSettingsScreen) => void;
  isOwner: boolean;
}

export default function MobileSettingsMenu({ businessName, planName, darkMode, onToggleDarkMode, onOpen, isOwner }: MobileSettingsMenuProps) {
  const initials = businessName.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toLocaleUpperCase()).join('') || 'RS';
  return <main data-testid="mobile-settings-menu" className="business-page mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-8 pt-3 text-slate-900 dark:text-white">
    <header><h1 className="text-2xl font-bold tracking-tight">Configuración</h1><p className="text-sm text-slate-500 dark:text-slate-400">Tu negocio y la app</p></header>
    <button type="button" onClick={() => onOpen('general', 'business')} className="flex min-h-[84px] items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left dark:border-slate-800 dark:bg-slate-900">
      <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-100 text-lg font-bold text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">{initials}</span>
      <span className="min-w-0 flex-1"><strong className="block truncate text-base">{businessName || 'Mi negocio'}</strong><span className="mt-0.5 block text-sm text-slate-500 dark:text-slate-400">Logo, teléfono, email y redes</span>{planName && <span className="mt-1 block text-xs font-semibold text-indigo-700 dark:text-indigo-300">{planName}</span>}</span><ChevronRight size={18} className="shrink-0 text-slate-500" />
    </button>

    <MenuSection title="Ventas y catálogo">
      <MenuRow label="Catálogo público" icon={<Globe size={18} />} onClick={() => onOpen('catalog', 'catalog')} />
      <MenuRow label="Categorías" icon={<Tags size={18} />} onClick={() => onOpen('categories', 'categories')} />
      <MenuRow label="Rangos de precio" icon={<DollarSign size={18} />} onClick={() => onOpen('prices', 'prices')} />
    </MenuSection>

    <MenuSection title="Equipo y datos">
      <MenuRow label="Mi perfil" icon={<UserRound size={18} />} onClick={() => onOpen('general', 'profile')} />
      <MenuRow label="Titulares del inventario" icon={<ContactRound size={18} />} onClick={() => onOpen('owners', 'owners')} />
      {isOwner && <MenuRow label="Equipo" icon={<Users size={18} />} onClick={() => onOpen('equipo', 'team')} />}
      <MenuRow label="Mantenimiento" icon={<Wrench size={18} />} onClick={() => onOpen('maintenance', 'maintenance')} />
    </MenuSection>

    <MenuSection title="Apariencia">
      <button type="button" onClick={() => onOpen('general', 'appearance')} className="flex min-h-16 w-full items-center gap-3 px-3 text-left">
        <span className="flex size-9 items-center justify-center rounded-xl bg-slate-100 text-indigo-700 dark:bg-slate-800 dark:text-indigo-300"><Palette size={18} /></span><span className="min-w-0 flex-1"><strong className="block text-sm">Apariencia</strong><span className="text-xs text-slate-500 dark:text-slate-400">Preferencias de la aplicación</span></span><ChevronRight size={18} className="text-slate-500" />
      </button>
      <div className="flex min-h-16 items-center gap-3 border-t border-slate-100 px-3 dark:border-slate-800"><span className="flex size-9 items-center justify-center rounded-xl bg-slate-100 text-indigo-700 dark:bg-slate-800 dark:text-indigo-300"><Moon size={18} /></span><span className="flex-1 text-sm font-semibold">Modo oscuro</span><button type="button" role="switch" aria-label="Modo oscuro" aria-checked={darkMode} onClick={onToggleDarkMode} className={`flex h-8 w-[52px] shrink-0 items-center rounded-full p-[3px] transition-colors ${darkMode ? 'justify-end bg-indigo-600' : 'justify-start bg-slate-300 dark:bg-slate-700'}`}><span className="size-[26px] rounded-full bg-white shadow-sm" /></button></div>
    </MenuSection>

    <MenuSection title="Zona de peligro">
      <button type="button" onClick={() => onOpen('general', 'danger')} className="flex min-h-16 w-full items-center gap-3 rounded-b-2xl px-3 text-left"><span className="flex size-9 items-center justify-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"><AlertTriangle size={18} /></span><span className="flex-1 text-sm font-semibold text-rose-700 dark:text-rose-300">Eliminar todos los datos</span><ChevronRight size={18} className="text-rose-600 dark:text-rose-300" /></button>
    </MenuSection>
  </main>;
}

function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return <section><h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">{children}</div></section>;
}

function MenuRow({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex min-h-16 w-full items-center gap-3 border-b border-slate-100 px-3 text-left last:border-0 dark:border-slate-800"><span className="flex size-9 items-center justify-center rounded-xl bg-slate-100 text-indigo-700 dark:bg-slate-800 dark:text-indigo-300">{icon}</span><span className="flex-1 text-sm font-semibold">{label}</span><ChevronRight size={18} className="text-slate-500" /></button>;
}
