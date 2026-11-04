import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface BottomSheetProps {
  title: string;
  titleId?: string;
  description?: ReactNode;
  closeLabel?: string;
  role?: 'dialog' | 'alertdialog';
  className?: string;
  overlayClassName?: string;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function BottomSheet({
  title,
  titleId = 'mobile-bottom-sheet-title',
  description,
  closeLabel = 'Cerrar',
  role = 'dialog',
  className = '',
  overlayClassName = '',
  onClose,
  children,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const startYRef = useRef<number | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !sheetRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sheetRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, []);

  const closeIfSwipedDown = (endY: number) => {
    const startY = startYRef.current;
    startYRef.current = null;
    if (startY !== null && endY - startY > 72) onCloseRef.current();
  };

  return (
    <div
      className={['fixed inset-0 z-[90] flex items-end bg-black/50 lg:hidden', overlayClassName].filter(Boolean).join(' ')}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current();
      }}
    >
      <section
        ref={sheetRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        onTouchStart={(event) => { startYRef.current = event.touches[0]?.clientY ?? null; }}
        onTouchEnd={(event) => closeIfSwipedDown(event.changedTouches[0]?.clientY ?? startYRef.current ?? 0)}
        className={['max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl border border-[var(--line)] bg-[var(--surface)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-[var(--ink)] shadow-2xl', className].filter(Boolean).join(' ')}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--line-strong)]" aria-hidden="true" />
        <header className="mb-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold">{title}</h2>
            {description && <div className="mt-1 text-sm text-[var(--ink-muted)]">{description}</div>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label={closeLabel}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}