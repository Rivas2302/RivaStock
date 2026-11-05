// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startVisiblePolling } from './visiblePolling';

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('startVisiblePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('enforces a 30 second minimum for idle polling', async () => {
    const poll = vi.fn();
    const stop = startVisiblePolling(poll, 10_000);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(poll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledOnce();
    stop();
  });

  it('removes the timer while hidden and resumes when visible', async () => {
    const poll = vi.fn();
    const stop = startVisiblePolling(poll, 30_000);

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(poll).not.toHaveBeenCalled();

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(29_999);
    expect(poll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledOnce();
    stop();
  });

  it('allows faster polling only for a visible in-progress action', async () => {
    const poll = vi.fn();
    const stop = startVisiblePolling(poll, 2_000, { active: true });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(poll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledOnce();
    stop();
  });

  it('does not overlap a slow request', async () => {
    let finish!: () => void;
    const poll = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const stop = startVisiblePolling(poll, 30_000);

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(poll).toHaveBeenCalledOnce();
    finish();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
  });

  it('stops after the active operation reports a terminal state', async () => {
    const poll = vi.fn(() => false);
    const stop = startVisiblePolling(poll, 2_000, { active: true });

    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledOnce();
    stop();
  });
});
