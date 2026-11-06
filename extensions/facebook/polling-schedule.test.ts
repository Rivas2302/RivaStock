import { describe, expect, it } from 'vitest';
import { queueAlarmPeriodMinutes, shouldSkipPausedQueuePoll } from './polling-schedule.js';

describe('Facebook queue alarm cadence', () => {
  const connected = { connection: { token: 'local-only' }, paused: false };

  it('uses a one minute alarm while the queue is idle', () => {
    expect(queueAlarmPeriodMinutes(connected)).toBe(1);
  });

  it.each(['activeJob', 'activeRehearsal', 'pendingClaim', 'pendingRehearsalClaim'])(
    'uses a 30 second alarm during %s',
    (key) => expect(queueAlarmPeriodMinutes({ ...connected, [key]: { id: 'work' } })).toBe(0.5),
  );

  it('keeps a low-frequency update heartbeat while the queue is paused and idle', () => {
    expect(queueAlarmPeriodMinutes({ ...connected, paused: true })).toBe(15);
  });

  it('keeps recovery polling for in-progress work when the queue is paused', () => {
    expect(queueAlarmPeriodMinutes({ ...connected, paused: true, activeJob: { id: 'work' } })).toBe(0.5);
  });

  it('keeps a 30 second alarm while a publication has a pending result tracker', () => {
    expect(queueAlarmPeriodMinutes({ ...connected, paused: true, ownContentTrackers: { attempt: { pendingPostId: 'post' } } })).toBe(0.5);
  });

  it('clears polling after local disconnect', () => {
    expect(queueAlarmPeriodMinutes({ paused: false })).toBeNull();
  });

  it('skips claiming work while paused and idle', () => {
    expect(shouldSkipPausedQueuePoll({ ...connected, paused: true }, { source: 'alarm' })).toBe(true);
  });

  it('allows an explicit local wake to learn whether the owner resumed the remote queue', () => {
    expect(shouldSkipPausedQueuePoll({ ...connected, paused: true }, { source: 'local' })).toBe(false);
  });

  it('keeps recovery processing available for active work even after a pause', () => {
    expect(shouldSkipPausedQueuePoll({ ...connected, paused: true, activeJob: { id: 'work' } }, { source: 'alarm' })).toBe(false);
  });

  it('keeps pending result tracking available while the new publication queue is paused', () => {
    expect(shouldSkipPausedQueuePoll({ ...connected, paused: true, ownContentTrackers: { attempt: { pendingPostId: 'post' } } }, { source: 'alarm' })).toBe(false);
  });
});
