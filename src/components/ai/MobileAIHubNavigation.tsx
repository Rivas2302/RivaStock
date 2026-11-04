import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Brain,
  Cable,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Loader2,
  Library,
  ListChecks,
  MessageSquare,
  Wand2,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import type { AIBridgeState } from '../../lib/aiBridge';
import { useMobileAppChrome } from '../../hooks/useMobileAppChrome';
import BottomSheet from '../mobile/BottomSheet';

export type MobileAIHubView = 'chats' | 'tasks' | 'library' | 'connection' | 'memory' | 'actions';

interface MobileAIHubNavigationProps {
  view: MobileAIHubView;
  bridgeState: AIBridgeState | null;
  isOwner: boolean;
  fullScreen?: boolean;
  onNavigate: (view: MobileAIHubView) => void;
}

interface MoreItem {
  view: Exclude<MobileAIHubView, 'chats' | 'tasks'>;
  label: string;
  description: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
}

const MORE_ITEMS: MoreItem[] = [
  { view: 'library', label: 'Skills', description: 'Instrucciones reutilizables', icon: Wand2 },
  { view: 'memory', label: 'Memoria', description: 'Datos recordados entre chats', icon: Brain },
  { view: 'connection', label: 'Conexión', description: 'Estado y configuración de la PC', icon: Cable },
  { view: 'actions', label: 'Acciones', description: 'Revisá lo que la IA propone hacer', icon: ClipboardCheck, ownerOnly: true },
];

function connectionState(state: AIBridgeState | null) {
  if (state === 'idle') return { label: 'PC conectada', Icon: Wifi, classes: 'border-[var(--success-line)] bg-[var(--success-surface)] text-[var(--success-ink)]' };
  if (state === 'busy') return { label: 'PC ocupada', Icon: Loader2, classes: 'border-[var(--brand-ring)] bg-[var(--brand-soft)] text-[var(--brand-strong)]' };
  if (state === 'offline') return { label: 'PC desconectada', Icon: WifiOff, classes: 'border-[var(--line)] bg-[var(--surface-muted)] text-[var(--ink-muted)]' };
  return { label: 'Consultando PC', Icon: Loader2, classes: 'border-[var(--line)] bg-[var(--surface-muted)] text-[var(--ink-muted)]' };
}

export default function MobileAIHubNavigation({ view, bridgeState, isOwner, fullScreen = false, onNavigate }: MobileAIHubNavigationProps) {
  useMobileAppChrome({ hideHeader: true, hideBottomNav: fullScreen });
  const [isMoreOpen, setMoreOpen] = useState(false);
  const connection = connectionState(bridgeState);
  const ConnectionIcon = connection.Icon;
  const moreIsCurrent = view !== 'chats' && view !== 'tasks';

  const navigateFromSheet = (next: MobileAIHubView) => {
    setMoreOpen(false);
    onNavigate(next);
  };

  return (
    <>
      {!fullScreen && <header className="-mx-4 -mt-4 space-y-3 border-b border-[var(--line)] bg-[var(--surface)] px-5 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] text-[var(--ink)] lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[26px] font-bold tracking-tight">IA</h1>
          <button
            type="button"
            onClick={() => onNavigate('connection')}
            aria-label={`Estado de la PC: ${connection.label}. Abrir conexión`}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${connection.classes}`}
          >
            <ConnectionIcon size={16} aria-hidden="true" className={bridgeState === 'busy' || bridgeState === null ? 'animate-spin' : undefined}/>
            <span>{connection.label}</span>
            <ChevronRight size={15} aria-hidden="true" className="text-[var(--ink-muted)]"/>
          </button>
        </div>

        <nav className="grid grid-cols-3 gap-1 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] p-1" aria-label="Secciones de IA">
          <button
            type="button"
            onClick={() => onNavigate('chats')}
            aria-current={view === 'chats' ? 'page' : undefined}
            className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors ${view === 'chats' ? 'bg-[var(--action-bg)] text-[var(--action-ink)] shadow-sm' : 'text-[var(--ink-muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]'}`}
          >Chats</button>
          <button
            type="button"
            onClick={() => onNavigate('tasks')}
            aria-current={view === 'tasks' ? 'page' : undefined}
            className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition-colors ${view === 'tasks' ? 'bg-[var(--action-bg)] text-[var(--action-ink)] shadow-sm' : 'text-[var(--ink-muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]'}`}
          >Tareas</button>
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isMoreOpen}
            aria-current={moreIsCurrent ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center justify-center gap-1 rounded-xl px-3 text-sm font-semibold transition-colors ${moreIsCurrent ? 'bg-[var(--action-bg)] text-[var(--action-ink)] shadow-sm' : 'text-[var(--ink-muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]'}`}
          >Más <ChevronDown size={15} aria-hidden="true"/>
          </button>
        </nav>
      </header>}

      {isMoreOpen && <BottomSheet
        title="Más secciones de IA"
        titleId="mobile-ai-more-title"
        closeLabel="Cerrar más secciones"
        className="max-h-[82dvh] pt-3"
        overlayClassName="z-[70]"
        onClose={() => setMoreOpen(false)}
      >
        <nav aria-label="Más secciones de IA" className="space-y-1">
          <Link
            to="/ia/conocimientos"
            onClick={() => setMoreOpen(false)}
            className="flex min-h-16 items-center gap-3 rounded-2xl px-3 py-2 hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><Library size={20}/></span>
            <span className="min-w-0 flex-1"><span className="block font-semibold">Conocimientos</span><span className="mt-0.5 block text-sm text-[var(--ink-muted)]">Documentos y guías de tu negocio</span></span>
            <ChevronRight size={18} aria-hidden="true" className="text-[var(--ink-muted)]"/>
          </Link>
          {MORE_ITEMS.filter((item) => !item.ownerOnly || isOwner).map(({ view: next, label, description, icon: Icon }) => (
            <button
              key={next}
              type="button"
              onClick={() => navigateFromSheet(next)}
              aria-current={view === next ? 'page' : undefined}
              className="flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><Icon size={20}/></span>
              <span className="min-w-0 flex-1"><span className="block font-semibold">{label}</span><span className="mt-0.5 block text-sm text-[var(--ink-muted)]">{description}</span></span>
              {view === next ? <Check size={18} aria-label="Sección actual" className="text-[var(--brand)]"/> : <ChevronRight size={18} aria-hidden="true" className="text-[var(--ink-muted)]"/>}
            </button>
          ))}
        </nav>
      </BottomSheet>}
    </>
  );
}
