export function isInactiveRehearsalTraceStart(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'message' in error && error.message === 'Rehearsal is not active';
}
