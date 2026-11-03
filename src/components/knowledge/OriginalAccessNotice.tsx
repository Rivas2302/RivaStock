import { Loader2 } from 'lucide-react';
import type { KnowledgeOriginalAccess } from '../../lib/knowledge/originals';

export type OriginalAccessViewState = KnowledgeOriginalAccess | { state: 'loading' } | { state: 'idle' } | null;

export default function OriginalAccessNotice({
  access,
  onViewText,
  onRetry,
}: {
  access: OriginalAccessViewState;
  onViewText(): void;
  onRetry(): void;
}) {
  if (!access || access.state === 'idle' || access.state === 'ready') return null;

  if (access.state === 'loading') {
    return <p role="status" className="inline-flex items-center gap-2 rounded-xl bg-[var(--brand-soft)] px-4 py-3 text-sm font-semibold text-[var(--brand)]">
      <Loader2 size={16} className="animate-spin"/>Pidiendo el archivo a la central…
    </p>;
  }

  if (access.state === 'offline') {
    return <section className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <p>La central de este negocio está apagada. Podés leer el texto del documento ahora; el original se abre cuando la PC esté prendida.</p>
      <button type="button" onClick={onViewText} className="rounded-lg border border-current px-3 py-2 text-sm font-bold">Ver texto</button>
    </section>;
  }

  if (access.state === 'missing') {
    return <section className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-950 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
      <p>No encontramos el original en la central ni en su copia de respaldo. El texto y la búsqueda siguen funcionando.</p>
      <button type="button" onClick={onViewText} className="rounded-lg border border-current px-3 py-2 text-sm font-bold">Ver texto</button>
    </section>;
  }

  if (access.state === 'timeout') {
    return <section className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <p>La central tardó demasiado en preparar el original.</p>
      <button type="button" onClick={onRetry} className="rounded-lg border border-current px-3 py-2 text-sm font-bold">Intentar de nuevo</button>
      <button type="button" onClick={onViewText} className="ml-2 rounded-lg border border-current px-3 py-2 text-sm font-bold">Ver texto</button>
    </section>;
  }

  return <section className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-950 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
    <p>{access.message}</p>
    <button type="button" onClick={onViewText} className="rounded-lg border border-current px-3 py-2 text-sm font-bold">Ver texto</button>
    <button type="button" onClick={onRetry} className="ml-2 rounded-lg border border-current px-3 py-2 text-sm font-bold">Intentar de nuevo</button>
  </section>;
}
