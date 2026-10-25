import { Loader2, Wifi, WifiOff } from 'lucide-react';
import type { AIBridgeState } from '../../lib/aiBridge';

export default function ConnectionBadge({ state }: { state: AIBridgeState | null }) {
  if (state === null) return <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Loader2 size={14} className="animate-spin"/>Consultando</span>;
  if (state === 'busy') return <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200"><Loader2 size={14} className="animate-spin"/>Ocupada</span>;
  if (state === 'idle') return <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><Wifi size={14}/>Conectada</span>;
  return <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300"><WifiOff size={14}/>Desconectada</span>;
}
