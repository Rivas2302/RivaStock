export function queueAlarmPeriodMinutes(state) {
  const inProgress = hasInProgressWork(state);
  if (!state.connection) return null;
  // Keep an inexpensive heartbeat while idle/paused so the service worker can
  // receive a server-directed extension update without polling the job queue.
  if (state.paused !== false && !inProgress) return 15;
  return inProgress ? 0.5 : 1;
}

export function shouldSkipPausedQueuePoll(state, signal) {
  return state.paused !== false && !hasInProgressWork(state) && signal?.source !== 'local';
}

function hasInProgressWork(state) {
  const hasPendingTracking = state.ownContentTrackers
    && typeof state.ownContentTrackers === 'object'
    && Object.keys(state.ownContentTrackers).length > 0;
  return Boolean(
    state.activeJob || state.activeRehearsal || state.pendingClaim || state.pendingRehearsalClaim || hasPendingTracking,
  );
}
