const IDLE_POLLING_MINIMUM_MS = 30_000;
const ACTIVE_POLLING_MINIMUM_MS = 1_000;

export interface VisiblePollingOptions {
  active?: boolean;
}

/** Poll only in the foreground and never overlap asynchronous requests. */
export function startVisiblePolling(
  callback: () => void | boolean | Promise<void | boolean>,
  intervalMs: number,
  { active = false }: VisiblePollingOptions = {},
): () => void {
  const delay = Math.max(active ? ACTIVE_POLLING_MINIMUM_MS : IDLE_POLLING_MINIMUM_MS, intervalMs);
  let timer: number | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
  const schedule = () => {
    if (!stopped && document.visibilityState === 'visible') timer = window.setTimeout(run, delay);
  };
  const run = () => {
    timer = undefined;
    if (stopped || document.visibilityState !== 'visible') return;
    void Promise.resolve().then(callback).then((continuePolling) => {
      if (continuePolling === false) stop(); else schedule();
    }, schedule);
  };
  const onVisibilityChange = () => {
    window.clearTimeout(timer);
    timer = undefined;
    schedule();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  schedule();
  return stop;
}