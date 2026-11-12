export interface BackgroundWorkLoopOptions {
  isStopping: () => boolean;
  processNext: (signal: AbortSignal) => Promise<boolean>;
  waitForWork: (signal: AbortSignal) => Promise<void>;
  onError?: (error: unknown) => void;
  retryDelayMs?: number;
}

export interface BackgroundWorkLoop {
  run(): Promise<void>;
  wake(): void;
  stop(): void;
}

export function createBackgroundWorkLoop(options: BackgroundWorkLoopOptions): BackgroundWorkLoop {
  const controller = new AbortController();
  let running = false;
  let waitController: AbortController | null = null;

  return {
    async run() {
      if (running) throw new Error('Background work loop is already running.');
      running = true;
      try {
        while (!options.isStopping() && !controller.signal.aborted) {
          try {
            if (await options.processNext(controller.signal)) continue;
            if (options.isStopping() || controller.signal.aborted) break;
            const currentWait = new AbortController();
            waitController = currentWait;
            const abortWait = () => currentWait.abort();
            controller.signal.addEventListener('abort', abortWait, { once: true });
            try {
              await options.waitForWork(currentWait.signal);
            } catch (error) {
              if (!currentWait.signal.aborted) throw error;
            } finally {
              controller.signal.removeEventListener('abort', abortWait);
              if (waitController === currentWait) waitController = null;
            }
          } catch (error) {
            if (options.isStopping() || controller.signal.aborted) break;
            options.onError?.(error);
            await abortableDelay(options.retryDelayMs ?? 3_000, controller.signal);
          }
        }
      } finally {
        running = false;
      }
    },
    wake() {
      waitController?.abort();
    },
    stop() {
      controller.abort();
      waitController?.abort();
    },
  };
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, ms);
    const onAbort = () => finish();
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
