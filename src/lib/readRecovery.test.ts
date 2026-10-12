import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithDeadline, isTransientReadError, retryRead, withDeadline } from './readRecovery';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('bounded read recovery', () => {
  it('recognizes the reported stolen-lock error and the installed SDK timeout', () => {
    expect(isTransientReadError(new Error("AbortError: Lock broken by another request with the 'steal' option."))).toBe(true);
    expect(isTransientReadError({ isAcquireTimeout: true, message: 'lock unavailable' })).toBe(true);
    expect(isTransientReadError(new Error('Lock was released because another request stole it'))).toBe(true);
  });
  it('retries a lock interruption once and resolves without a page reload', async () => {
    vi.useFakeTimers();
    const operation = vi.fn().mockRejectedValueOnce(new Error('Lock broken by another request')).mockResolvedValueOnce(['owner']);
    const result = retryRead(operation);
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toEqual(['owner']);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not retry forever', async () => {
    vi.useFakeTimers();
    const operation = vi.fn().mockRejectedValue(new Error('Lock broken by another request'));
    const rejected = expect(retryRead(operation)).rejects.toThrow('Lock broken');
    await vi.advanceTimersByTimeAsync(200);
    await rejected;
    expect(operation).toHaveBeenCalledTimes(2);
  });
  it.each(['permission denied', 'JWT expired', 'duplicate key', 'invalid input'])('does not retry terminal errors: %s', async message => {
    const operation = vi.fn().mockRejectedValue(new Error(message));
    await expect(retryRead(operation)).rejects.toThrow(message);
    expect(operation).toHaveBeenCalledOnce();
  });
  it('does not retry an explicitly cancelled read, even when its error mentions a lock', async () => {
    const controller = new AbortController();
    const operation = vi.fn().mockImplementation(() => {
      controller.abort();
      throw new Error('Lock broken by another request');
    });
    await expect(retryRead(operation, controller.signal)).rejects.toThrow('Lock broken');
    expect(operation).toHaveBeenCalledOnce();
  });
  it('stops a never-settling auth operation at the deadline', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal;
    const rejected = expect(withDeadline(value => {
      signal = value;
      return new Promise(() => {});
    }, 1000)).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not start operations whose parent signal is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = vi.fn();
    await expect(withDeadline(operation, 1000, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(operation).not.toHaveBeenCalled();
  });
});

describe('fetch cancellation and write safety', () => {
  function hangingFetch() {
    const fetchMock = vi.fn((_input, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }
  it('preserves the SDK/caller signal instead of replacing it with a timeout signal', async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    const controller = new AbortController();
    const result = fetchWithDeadline('https://example.test', { signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('limits GET requests without aborting the original signal', async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    const controller = new AbortController();
    const rejected = expect(fetchWithDeadline('https://example.test', { signal: controller.signal })).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(controller.signal.aborted).toBe(false);
  });
  it('retains the previous 65-second POST deadline and never replays the request', async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    const result = fetchWithDeadline('https://example.test', { method: 'POST', body: '{}' });
    const rejected = expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(45_000);
    await rejected;
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('keeps SDK cancellation connected after headers arrive while the body is pending', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_input, init: RequestInit) => Promise.resolve({
      text: () => new Promise<string>((_, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      }),
    })));
    const controller = new AbortController();
    const response = await fetchWithDeadline('https://example.test', { signal: controller.signal });
    const rejected = expect(response.text()).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});
