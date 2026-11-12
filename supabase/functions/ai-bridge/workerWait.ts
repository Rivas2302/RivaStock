export type PendingWorkSnapshot = Record<string, unknown>;

export interface WorkerWaitListener {
  waitForOwnerWake(timeoutMs: number, signal?: AbortSignal): Promise<boolean>;
  close(): Promise<void>;
}

export interface WaitForPendingWorkOptions {
  timeoutMs: number;
  probe: () => Promise<PendingWorkSnapshot>;
  openListener?: () => Promise<WorkerWaitListener>;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onFallback?: () => void;
}

export interface WaitForPendingWorkResult {
  work: PendingWorkSnapshot;
  wakeup: 'pending' | 'notification' | 'poll' | 'timeout';
}

export async function waitForPendingWork(options: WaitForPendingWorkOptions): Promise<WaitForPendingWorkResult> {
  const timeoutMs = Math.max(0, Math.min(55_000, options.timeoutMs));
  const deadline = (options.now ?? Date.now)() + timeoutMs;
  const probe = options.probe;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableSleep;
  const signal = options.signal;
  let fallbackNoted = false;
  const noteFallback = () => {
    if (fallbackNoted) return;
    fallbackNoted = true;
    options.onFallback?.();
  };
  const initial = await probe();
  if (hasPendingWork(initial)) return { work: initial, wakeup: 'pending' };
  if (signal?.aborted || timeoutMs === 0) return { work: initial, wakeup: 'timeout' };

  let listener: WorkerWaitListener | null = null;
  if (options.openListener) {
    try {
      listener = await options.openListener();
      const afterListen = await probe();
      if (hasPendingWork(afterListen)) return { work: afterListen, wakeup: 'pending' };
      while (now() < deadline) {
        const woke = await listener.waitForOwnerWake(deadline - now(), signal);
        if (!woke) break;
        const next = await probe();
        if (hasPendingWork(next)) return { work: next, wakeup: 'notification' };
      }
      const finalWork = await probe();
      return { work: finalWork, wakeup: hasPendingWork(finalWork) ? 'poll' : 'timeout' };
    } catch {
      if (signal?.aborted) throw new DOMException('Worker wait aborted.', 'AbortError');
      noteFallback();
    } finally {
      await listener?.close().catch(() => undefined);
    }
  }

  noteFallback();
  while (now() < deadline && !signal?.aborted) {
    await sleep(Math.min(options.pollIntervalMs ?? 750, deadline - now()), signal);
    if (signal?.aborted) break;
    const next = await probe();
    if (hasPendingWork(next)) return { work: next, wakeup: 'poll' };
  }
  return { work: await probe(), wakeup: 'timeout' };
}

function hasPendingWork(work: PendingWorkSnapshot): boolean {
  return Object.values(work).some((value) => value === true);
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Worker wait aborted.', 'AbortError'));
      return;
    }
    const timer = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Worker wait aborted.', 'AbortError'));
    };
    function finish() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
