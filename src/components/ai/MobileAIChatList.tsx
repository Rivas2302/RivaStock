import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Loader2, MessageSquare, MoreHorizontal, Plus, Search, Trash2, X } from 'lucide-react';
import { deleteAIChat, type AIChat, type AIChatPage } from '../../lib/aiBridge';
import { getAIChatsPage } from '../../lib/aiBridgeChatList';
import { filterMobileChats, formatMobileChatTime, groupMobileChats, isChatInRecentWindow } from './mobileAIChatListUtils';

export interface MobileAIChatListProps {
  canWrite: boolean;
  onOpenChat: (chatId: string) => void;
  onNewChat: () => void;
}

export default function MobileAIChatList({
  canWrite,
  onOpenChat,
  onNewChat,
}: MobileAIChatListProps) {
  const [chats, setChats] = useState<AIChat[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [olderThan30DaysCount, setOlderThan30DaysCount] = useState(0);
  const [recentCutoff, setRecentCutoff] = useState(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [error, setError] = useState('');
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showOlder, setShowOlder] = useState(false);
  const [swipedChatId, setSwipedChatId] = useState<string | null>(null);
  const [menuChat, setMenuChat] = useState<AIChat | null>(null);
  const [confirmChat, setConfirmChat] = useState<AIChat | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const pointerStart = useRef<{ x: number; y: number; timer: number | null } | null>(null);
  const longPressTriggered = useRef(false);
  const sheetRef = useRef<HTMLElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(false);
  const loadAllRef = useRef<Promise<void> | null>(null);

  const applyPage = useCallback((page: AIChatPage, append: boolean) => {
    setChats((current) => {
      const merged = append ? [...current, ...page.chats] : page.chats;
      return [...new Map(merged.map((chat) => [chat.id, chat])).values()]
        .sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at));
    });
    setTotalCount(page.totalCount);
    setOlderThan30DaysCount(page.olderThan30DaysCount);
    setRecentCutoff(page.recentCutoff);
    setHasMore(page.hasMore);
    offsetRef.current = page.nextOffset;
    hasMoreRef.current = page.hasMore;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      applyPage(await getAIChatsPage(), false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los chats.');
    } finally {
      setLoading(false);
    }
  }, [applyPage]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadOlder = useCallback(async () => {
    if (!hasMoreRef.current || loadingOlder) return;
    setLoadingOlder(true);
    setError('');
    try {
      applyPage(await getAIChatsPage({ offset: offsetRef.current }), true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los chats anteriores.');
    } finally {
      setLoadingOlder(false);
    }
  }, [applyPage, loadingOlder]);

  const loadAll = useCallback(async () => {
    if (loadAllRef.current) return loadAllRef.current;
    const request = (async () => {
      setLoadingAll(true);
      setError('');
      try {
        while (hasMoreRef.current) {
          applyPage(await getAIChatsPage({ offset: offsetRef.current }), true);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'No se pudieron cargar todos los chats.');
      } finally {
        setLoadingAll(false);
        loadAllRef.current = null;
      }
    })();
    loadAllRef.current = request;
    return request;
  }, [applyPage]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 150);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (debouncedQuery.trim() && hasMore) void loadAll();
  }, [debouncedQuery, hasMore, loadAll]);

  const activeSheet = menuChat ?? confirmChat;
  const sheetMode = confirmChat ? 'confirm' : menuChat ? 'menu' : null;
  useEffect(() => {
    if (!activeSheet) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstActionRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuChat(null);
        setConfirmChat(null);
        return;
      }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
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
  }, [activeSheet, sheetMode]);

  const filteredChats = filterMobileChats(chats, debouncedQuery);
  const visibleChats = debouncedQuery.trim()
    ? filteredChats
    : filteredChats.filter((chat) => showOlder || isChatInRecentWindow(chat, recentCutoff));
  const groups = groupMobileChats(visibleChats);
  const isInitialLoading = loading && chats.length === 0;

  const openMenu = (chat: AIChat) => {
    setDeleteError('');
    setSwipedChatId(null);
    setMenuChat(chat);
  };

  const beginPointer = (event: ReactPointerEvent<HTMLButtonElement>, chat: AIChat) => {
    longPressTriggered.current = false;
    if (event.pointerType !== 'touch' && event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY, timer: null as number | null };
    if (event.pointerType === 'touch') {
      start.timer = window.setTimeout(() => {
        longPressTriggered.current = true;
        openMenu(chat);
      }, 520);
    }
    pointerStart.current = start;
  };

  const movePointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = pointerStart.current;
    if (!start) return;
    if (Math.abs(event.clientX - start.x) > 10 || Math.abs(event.clientY - start.y) > 10) {
      if (start.timer !== null) window.clearTimeout(start.timer);
      start.timer = null;
    }
  };

  const endPointer = (event: ReactPointerEvent<HTMLButtonElement>, chat: AIChat) => {
    const start = pointerStart.current;
    if (!start) return;
    if (start.timer !== null) window.clearTimeout(start.timer);
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (deltaX < -42 && Math.abs(deltaY) < 32) {
      longPressTriggered.current = true;
      setSwipedChatId(chat.id);
    } else if (deltaX > 32) {
      setSwipedChatId(null);
    }
    pointerStart.current = null;
  };

  const deleteChat = async () => {
    if (!confirmChat || !canWrite || confirmChat.has_pending_job) return;
    setDeleteError('');
    setDeletingChatId(confirmChat.id);
    try {
      await deleteAIChat(confirmChat.id);
      setConfirmChat(null);
      setMenuChat(null);
      setSwipedChatId(null);
      await refresh();
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'No se pudo eliminar el chat.');
    } finally {
      setDeletingChatId(null);
    }
  };

  const chatRows = groups.map((group) => (
    <section key={group.label} aria-labelledby={`mobile-chat-group-${group.label.replace(/\s/g, '-').toLocaleLowerCase('es-AR')}`}>
      <h2 id={`mobile-chat-group-${group.label.replace(/\s/g, '-').toLocaleLowerCase('es-AR')}`} className="px-5 pb-1 pt-4 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">{group.label}</h2>
      <ul>
        {group.chats.map((chat) => {
          const busy = Boolean(chat.has_pending_job);
          const swiped = swipedChatId === chat.id;
          return <li key={chat.id} className="relative overflow-hidden border-b border-[var(--line)]">
            <button
              type="button"
              onPointerDown={(event) => beginPointer(event, chat)}
              onPointerMove={movePointer}
              onPointerUp={(event) => endPointer(event, chat)}
              onPointerCancel={() => { if (pointerStart.current?.timer !== null) window.clearTimeout(pointerStart.current?.timer ?? undefined); pointerStart.current = null; }}
              onContextMenu={(event) => { event.preventDefault(); longPressTriggered.current = true; openMenu(chat); }}
              onClick={() => {
                if (longPressTriggered.current) { longPressTriggered.current = false; return; }
                setSwipedChatId(null);
                onOpenChat(chat.id);
              }}
              aria-label={`${chat.title}. ${chat.last_message_preview ?? ''}. ${formatMobileChatTime(chat.last_message_at)}`}
              className={`relative z-10 flex min-h-16 w-full items-start gap-3 bg-[var(--surface)] px-5 py-3 pr-14 text-left transition-transform duration-200 ${swiped ? '-translate-x-24' : ''}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-[var(--ink)]">{chat.title}</span>
                <span className="mt-0.5 block truncate text-[13px] text-[var(--ink-muted)]">{chat.last_message_preview || 'Todavía no hay mensajes'}</span>
              </span>
              <span className="pt-0.5 text-xs text-[var(--ink-muted)]">{formatMobileChatTime(chat.last_message_at)}</span>
            </button>
            <div className="absolute inset-y-0 right-0 flex w-24 items-center justify-center bg-[var(--danger-surface)]">
              <button
                type="button"
                onClick={() => openMenu(chat)}
                disabled={!canWrite || busy || deletingChatId !== null}
                aria-label={`Eliminar ${chat.title}`}
                className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs font-bold text-[var(--danger-ink)] disabled:opacity-50"
              ><Trash2 size={18}/><span>Eliminar</span></button>
            </div>
            <button
              type="button"
              aria-label={`Opciones de ${chat.title}`}
              onClick={() => openMenu(chat)}
              className="absolute right-1 top-1 z-20 inline-flex size-10 items-center justify-center rounded-xl bg-[var(--surface)] text-[var(--ink-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
            ><MoreHorizontal size={18}/></button>
          </li>;
        })}
      </ul>
    </section>
  ));

  return <section className="relative flex min-h-[calc(100dvh-12rem)] flex-col text-[var(--ink)] lg:hidden">
    <label className="mx-4 mt-3 flex min-h-12 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-4 text-[var(--ink-muted)] focus-within:border-[var(--brand)]">
      <Search size={18} aria-hidden="true"/>
      <span className="sr-only">Buscar en tus chats</span>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar en tus chats"
        className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
      />
      {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpiar búsqueda" className="rounded-md p-1 hover:bg-[var(--surface)]"><X size={16}/></button>}
    </label>

    {error && <div className="mx-4 mt-3 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger-ink)]" role="alert"><p>{error}</p><button type="button" onClick={() => { if (debouncedQuery.trim()) void loadAll(); else void refresh(); }} className="mt-2 font-bold underline underline-offset-2">Reintentar</button></div>}

    <div className="min-h-0 flex-1 overflow-y-auto pb-32">
      {isInitialLoading ? <div aria-label="Cargando chats" role="status" className="space-y-3 px-5 pt-5">
        {[0, 1, 2, 3].map((row) => <div key={row} className="flex min-h-16 items-start gap-3 border-b border-[var(--line)] py-3"><span className="min-w-0 flex-1 space-y-2"><span className="block h-4 w-3/4 animate-pulse rounded bg-[var(--surface-muted)]"/><span className="block h-3 w-2/3 animate-pulse rounded bg-[var(--surface-muted)]"/></span><span className="h-3 w-10 animate-pulse rounded bg-[var(--surface-muted)]"/></div>)}
      </div> : chats.length === 0 && !error ? <div className="flex flex-1 flex-col items-center justify-center px-8 py-16 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]"><MessageSquare size={25}/></span>
        <p className="mt-4 text-sm font-semibold">Todavía no tenés chats. Preguntale algo a tu IA.</p>
        {canWrite && <button type="button" onClick={onNewChat} className="mt-4 rounded-xl bg-[var(--action-bg)] px-4 py-2.5 text-sm font-bold text-[var(--action-ink)]">Nuevo chat</button>}
      </div> : debouncedQuery && !visibleChats.length && !loadingAll ? <p className="px-5 py-10 text-center text-sm text-[var(--ink-muted)]">No encontramos chats con ese texto.</p> : <>
        {chatRows}
        {debouncedQuery && loadingAll && <p role="status" className="flex items-center justify-center gap-2 px-5 py-4 text-sm text-[var(--ink-muted)]"><Loader2 size={16} className="animate-spin"/>Buscando en tus chats anteriores…</p>}
        {!debouncedQuery && (olderThan30DaysCount > 0 || hasMore) && <button
          type="button"
          onClick={() => { setShowOlder(true); void loadAll(); }}
          disabled={loadingAll}
          className="mx-5 mb-6 mt-3 inline-flex min-h-11 w-[calc(100%-2.5rem)] items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-60"
        >{loadingAll ? <><Loader2 size={15} className="animate-spin"/>Cargando chats anteriores…</> : olderThan30DaysCount > 0 ? `Ver chats anteriores (${olderThan30DaysCount})` : `Cargar más chats (${Math.max(totalCount - chats.length, 0)})`}</button>}
        {!debouncedQuery && hasMore && showOlder && !loadingAll && <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder} className="mx-5 mb-6 mt-2 inline-flex min-h-11 w-[calc(100%-2.5rem)] items-center justify-center gap-2 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold text-[var(--ink-muted)] disabled:opacity-60">{loadingOlder ? <Loader2 size={15} className="animate-spin"/> : null}Cargar más chats</button>}
      </>}
    </div>

    {canWrite && chats.length > 0 && <button
      type="button"
      onClick={onNewChat}
      className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-30 inline-flex min-h-13 items-center gap-2 rounded-full bg-[var(--action-bg)] px-5 text-sm font-bold text-[var(--action-ink)] shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
    ><Plus size={20}/>Nuevo chat</button>}

    {menuChat && <div className="fixed inset-0 z-[80] flex items-end bg-black/50" onMouseDown={(event) => { if (event.target === event.currentTarget) setMenuChat(null); }}>
      <section ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="mobile-chat-menu-title" className="w-full rounded-t-3xl border border-[var(--line)] bg-[var(--surface)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl">
        <h2 id="mobile-chat-menu-title" className="truncate text-base font-bold">{menuChat.title}</h2>
        <button ref={firstActionRef} type="button" onClick={() => { setConfirmChat(menuChat); setMenuChat(null); }} disabled={!canWrite || menuChat.has_pending_job || deletingChatId !== null} className="mt-3 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-semibold text-[var(--danger-ink)] hover:bg-[var(--danger-surface)] disabled:opacity-50"><Trash2 size={18}/>{deletingChatId === menuChat.id ? 'Eliminando…' : 'Eliminar chat'}</button>
        <button type="button" onClick={() => setMenuChat(null)} className="mt-1 min-h-12 w-full rounded-xl border border-[var(--line)] font-semibold">Cancelar</button>
      </section>
    </div>}

    {confirmChat && <div className="fixed inset-0 z-[81] flex items-end bg-black/50" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmChat(null); }}>
      <section ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="mobile-chat-delete-title" className="w-full rounded-t-3xl border border-[var(--line)] bg-[var(--surface)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-[var(--ink)] shadow-2xl">
        <h2 id="mobile-chat-delete-title" className="text-lg font-bold">¿Eliminar este chat?</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Se borran los mensajes y sus fuentes. No se puede deshacer.</p>
        <p className="mt-2 truncate text-sm font-semibold">{confirmChat.title}</p>
        {deleteError && <p role="alert" className="mt-3 rounded-lg border border-[var(--danger-line)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger-ink)]">{deleteError}</p>}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setConfirmChat(null)} className="min-h-12 rounded-xl border border-[var(--line)] font-semibold">Cancelar</button>
          <button ref={firstActionRef} type="button" onClick={() => void deleteChat()} disabled={!canWrite || confirmChat.has_pending_job || deletingChatId !== null} className="min-h-12 rounded-xl bg-[var(--danger-ink)] px-3 font-bold text-white disabled:opacity-50">{deletingChatId === confirmChat.id ? 'Eliminando…' : 'Eliminar'}</button>
        </div>
      </section>
    </div>}
  </section>;
}
