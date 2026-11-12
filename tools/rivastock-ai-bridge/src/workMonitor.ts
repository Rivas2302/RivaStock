export const PENDING_WORK_KEYS = [
  'ai_jobs',
  'knowledge',
  'supervisor',
  'central_requests',
  'central_store',
  'memory_embeddings',
  'idle_summary',
  'chat_tombstones',
  'workspace_files',
] as const;

export type PendingWorkKey = typeof PENDING_WORK_KEYS[number];
export type PendingWork = Record<PendingWorkKey, boolean>;

const IDLE_POLL_DELAYS_MS = [3_000, 6_000, 12_000, 24_000, 40_000, 60_000] as const;
const ACTIVE_POLL_DELAY_MS = 2_500;

export function parsePendingWork(value: unknown): PendingWork {
  const record = isRecord(value) ? value : {};
  return {
    ai_jobs: record.ai_jobs === true,
    knowledge: record.knowledge === true,
    supervisor: record.supervisor === true,
    central_requests: record.central_requests === true,
    central_store: record.central_store === true,
    memory_embeddings: record.memory_embeddings === true,
    idle_summary: record.idle_summary === true,
    chat_tombstones: record.chat_tombstones === true,
    workspace_files: record.workspace_files === true,
  };
}

export function nextPendingWorkDelay(hasWork: boolean, idleStep: number): number {
  if (hasWork) return ACTIVE_POLL_DELAY_MS;
  return IDLE_POLL_DELAYS_MS[Math.min(Math.max(0, idleStep), IDLE_POLL_DELAYS_MS.length - 1)];
}

export class PendingWorkMonitor {
  private work = parsePendingWork(null);
  private readonly eventWork = new Set<PendingWorkKey>();
  private readonly waiters = new Set<() => void>();
  private timer: NodeJS.Timeout | null = null;
  private idleStep = 0;
  private inFlight = false;
  private rerunRequested = false;
  private stopped = false;
  private longPollFallback = false;
  private retryLongPollAt = 0;
  private waitController: AbortController | null = null;

  constructor(
    private readonly probe: () => Promise<unknown>,
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly waitForWork?: (signal: AbortSignal) => Promise<unknown>,
  ) {}

  start(): void {
    if (this.stopped || this.timer || this.inFlight) return;
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.waitController?.abort();
    this.notify();
  }

  wake(source?: string): void {
    if (this.stopped) return;
    if (source === 'ai_workspace_files') this.eventWork.add('workspace_files');
    this.idleStep = 0;
    this.notify();
    this.requestProbe();
  }

  hasWork(key: PendingWorkKey): boolean {
    return this.work[key] || this.eventWork.has(key);
  }

  markDrained(key: PendingWorkKey): void {
    this.work[key] = false;
    this.eventWork.delete(key);
    this.notify();
    this.requestProbe();
  }

  async waitForAny(
    keys: readonly PendingWorkKey[],
    isStopping: () => boolean,
    timeoutMs = Number.POSITIVE_INFINITY,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const deadline = Number.isFinite(timeoutMs) ? Date.now() + Math.max(0, timeoutMs) : Number.POSITIVE_INFINITY;
    while (!this.stopped && !isStopping() && !signal?.aborted) {
      if (keys.some((key) => this.hasWork(key))) return true;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      const changed = await this.waitForChange(remaining, signal);
      if (!changed) return false;
    }
    return false;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, delayMs);
  }

  private requestProbe(): void {
    if (this.stopped) return;
    if (this.inFlight) {
      this.rerunRequested = true;
      return;
    }
    this.schedule(0);
  }

  private async refresh(): Promise<void> {
    if (this.stopped || this.inFlight) return;
    this.inFlight = true;
    this.rerunRequested = false;
    if (this.longPollFallback && Date.now() >= this.retryLongPollAt) this.longPollFallback = false;
    const useLongPoll = Boolean(this.waitForWork && !this.longPollFallback);
    const waitController = useLongPoll ? new AbortController() : null;
    this.waitController = waitController;
    try {
      const next = parsePendingWork(await (useLongPoll && waitController && this.waitForWork
        ? this.waitForWork(waitController.signal)
        : this.probe()));
      this.setWork(next);
      if (useLongPoll) this.longPollFallback = false;
    } catch (error) {
      if (this.stopped) return;
      if (useLongPoll) {
        this.longPollFallback = true;
        this.retryLongPollAt = Date.now() + 60_000;
        this.onError(error);
        try {
          this.setWork(parsePendingWork(await this.probe()));
        } catch (probeError) {
          this.setWork(parsePendingWork(null));
          this.onError(probeError);
        }
      } else {
        this.setWork(parsePendingWork(null));
        this.onError(error);
      }
    } finally {
      if (this.waitController === waitController) this.waitController = null;
      this.inFlight = false;
    }
    if (this.stopped) return;
    if (this.rerunRequested) {
      this.schedule(0);
      return;
    }
    const hasWork = PENDING_WORK_KEYS.some((key) => this.hasWork(key));
    if (hasWork) this.idleStep = 0;
    if (useLongPoll && !this.longPollFallback) {
      this.schedule(hasWork ? ACTIVE_POLL_DELAY_MS : 0);
      return;
    }
    this.schedule(nextPendingWorkDelay(hasWork, this.idleStep));
    if (!hasWork) this.idleStep = Math.min(this.idleStep + 1, IDLE_POLL_DELAYS_MS.length - 1);
  }

  private setWork(next: PendingWork): void {
    const changed = PENDING_WORK_KEYS.some((key) => this.work[key] !== next[key]);
    this.work = next;
    if (changed) this.notify();
  }

  private waitForChange(timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: NodeJS.Timeout | null = null;
      const finish = (changed: boolean) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.waiters.delete(onChange);
        signal?.removeEventListener('abort', onAbort);
        resolve(changed);
      };
      const onChange = () => finish(true);
      const onAbort = () => finish(true);
      this.waiters.add(onChange);
      if (Number.isFinite(timeoutMs)) timer = setTimeout(() => finish(false), timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) finish(true);
      if (this.stopped) finish(true);
    });
  }

  private notify(): void {
    const current = [...this.waiters];
    this.waiters.clear();
    for (const resolve of current) resolve();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
