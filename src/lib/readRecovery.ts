const READ_ATTEMPTS = 2;

export function isTransientReadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { name?: string; message?: string; isAcquireTimeout?: boolean };
  const text = `${value.name ?? ''} ${value.message ?? ''}`;
  return value.isAcquireTimeout === true
    || /lock.*(?:broken|stolen|stole|acquire.*timeout)/i.test(text)
    || /NavigatorLockAcquireTimeoutError|AuthRetryableFetchError|TimeoutError|Failed to fetch|fetch failed|NetworkError/i.test(text);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Operation cancelled', 'AbortError');
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortReason(signal)); return; }
    const finish = () => { signal?.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(abortReason(signal!)); };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

/** Read-only policy. Never use this around a sale, payment or other mutation. */
export async function retryRead<T>(operation: () => PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw abortReason(signal);
    try {
      return await operation();
    } catch (error) {
      if (signal?.aborted || attempt + 1 >= READ_ATTEMPTS || !isTransientReadError(error)) throw error;
      await pause(200, signal);
    }
  }
}

/** Bound the whole operation (including time spent waiting for an auth lock).
 * The abort signal also cancels its underlying fetch when the SDK supports it.
 */
export async function withDeadline<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal | null,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener('abort', cancel, { once: true });
  if (parentSignal?.aborted) cancel();
  const timeout = setTimeout(() => controller.abort(new DOMException('Connection timed out', 'TimeoutError')), timeoutMs);
  let onAbort: (() => void) | undefined;
  try {
    if (controller.signal.aborted) throw abortReason(controller.signal);
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abortReason(controller.signal));
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([Promise.resolve(operation(controller.signal)), aborted]);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', cancel);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
  }
}

export async function fetchWithDeadline(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
  const signal = init?.signal === undefined ? request?.signal : init.signal;
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  // Preserve the previous write deadline; never retry or shorten a financial
  // command just because a read can safely recover sooner.
  const timeoutMs = method === 'GET' || method === 'HEAD' ? 20_000 : 65_000;
  if (signal?.aborted) throw abortReason(signal);
  const controller = new AbortController();
  const cleanup = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  };
  const cancel = () => { controller.abort(signal?.reason); cleanup(); };
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Connection timed out', 'TimeoutError'));
    cleanup();
  }, timeoutMs);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    // Fetch resolves when headers arrive, not when JSON/body consumption ends.
    // Keep cancellation connected through body reading; cleanup is bounded by
    // the deadline (like the previous AbortSignal.timeout transport).
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    cleanup();
    throw error;
  }
}
