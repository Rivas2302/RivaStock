export type StreamActivityKind = 'thinking' | 'searching_web' | 'tool' | 'writing';

export interface StreamActivity {
  kind: StreamActivityKind;
  label: string;
  tool?: string;
}

export interface StreamPayload {
  seq: number;
  text: string;
  activity: StreamActivity;
}

export interface StreamReporter {
  setText(text: string): void;
  setActivity(activity: StreamActivity): void;
  flush(): Promise<void>;
  dispose(): void;
  readonly cancelled: AbortSignal;
}

export interface StreamReporterOptions {
  send(payload: StreamPayload): Promise<{ cancel: boolean }>;
  onError?(error: unknown): void;
  minIntervalMs?: number;
  heartbeatIntervalMs?: number;
}

export function createStreamReporter(options: StreamReporterOptions): StreamReporter {
  const minIntervalMs = options.minIntervalMs ?? 400;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 2_000;
  const cancellation = new AbortController();
  let text = '';
  let activity: StreamActivity = { kind: 'thinking', label: 'Preparando la respuesta…' };
  let seq = 0;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let sentSnapshot = '';
  let lastAttemptSnapshot = '';
  let lastAttemptSucceeded = false;
  let changed = false;
  let heartbeatPending = false;
  let forcePending = false;
  let retryOnHeartbeat = false;
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let disposed = false;
  let attemptWaiters: Array<() => void> = [];

  const snapshot = (): string => JSON.stringify({ text, activity });
  const settleAttemptWaiters = (): void => {
    for (const resolve of attemptWaiters.splice(0)) resolve();
  };

  const sendLatest = async (): Promise<void> => {
    if (disposed || cancellation.signal.aborted || inFlight) return;
    const currentSnapshot = snapshot();
    if (currentSnapshot === sentSnapshot && !heartbeatPending && !forcePending) return;
    const remaining = lastAttemptAt + minIntervalMs - Date.now();
    if (remaining > 0) {
      schedule(remaining);
      return;
    }
    const payload: StreamPayload = {
      seq: ++seq,
      text: text.slice(0, 20_000),
      activity: { ...activity },
    };
    lastAttemptAt = Date.now();
    lastAttemptSnapshot = currentSnapshot;
    lastAttemptSucceeded = false;
    changed = false;
    heartbeatPending = false;
    forcePending = false;
    inFlight = options.send(payload).then((result) => {
      sentSnapshot = currentSnapshot;
      lastAttemptSucceeded = true;
      retryOnHeartbeat = false;
      if (result.cancel && !cancellation.signal.aborted) cancellation.abort();
    }).catch((error: unknown) => {
      changed = true;
      retryOnHeartbeat = true;
      options.onError?.(error);
    }).finally(() => {
      inFlight = null;
      settleAttemptWaiters();
      if (cancellation.signal.aborted) {
        if (scheduled) clearTimeout(scheduled);
        scheduled = null;
        return;
      }
      if (changed || heartbeatPending || forcePending) schedule(minIntervalMs);
    });
    await inFlight;
  };

  function schedule(delayMs = 0): void {
    if (disposed || cancellation.signal.aborted || scheduled) return;
    const rateLimitDelay = Math.max(0, lastAttemptAt + minIntervalMs - Date.now());
    scheduled = setTimeout(() => {
      scheduled = null;
      void sendLatest();
    }, Math.max(delayMs, rateLimitDelay));
  }

  const heartbeat = setInterval(() => {
    if (retryOnHeartbeat) changed = true;
    heartbeatPending = true;
    schedule();
  }, heartbeatIntervalMs);

  cancellation.signal.addEventListener('abort', () => {
    if (scheduled) clearTimeout(scheduled);
    scheduled = null;
    settleAttemptWaiters();
  }, { once: true });

  return {
    setText(nextText) {
      const next = nextText.slice(0, 20_000);
      if (next === text || disposed) return;
      text = next;
      changed = true;
      schedule();
    },
    setActivity(nextActivity) {
      const normalized: StreamActivity = {
        kind: nextActivity.kind,
        label: nextActivity.label.slice(0, 120),
        ...(nextActivity.tool ? { tool: nextActivity.tool.slice(0, 80) } : {}),
      };
      if (JSON.stringify(normalized) === JSON.stringify(activity) || disposed) return;
      activity = normalized;
      changed = true;
      schedule();
    },
    async flush() {
      if (disposed || cancellation.signal.aborted) return;
      forcePending = true;
      if (scheduled) {
        clearTimeout(scheduled);
        scheduled = null;
      }
      const startSeq = seq;
      while (!disposed && !cancellation.signal.aborted) {
        const targetSnapshot = snapshot();
        if (lastAttemptSnapshot === targetSnapshot && (lastAttemptSucceeded || seq > startSeq)) {
          if (inFlight) await inFlight;
          if (lastAttemptSnapshot === targetSnapshot && snapshot() === targetSnapshot) {
            forcePending = false;
            return;
          }
        }
        const attempt = new Promise<void>((resolve) => attemptWaiters.push(resolve));
        schedule();
        await attempt;
      }
    },
    dispose() {
      disposed = true;
      clearInterval(heartbeat);
      if (scheduled) clearTimeout(scheduled);
      scheduled = null;
      settleAttemptWaiters();
    },
    cancelled: cancellation.signal,
  };
}
