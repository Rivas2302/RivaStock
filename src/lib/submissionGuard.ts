interface SubmissionGuard {
  current: boolean;
}

export function beginSubmission(guard: SubmissionGuard): boolean {
  if (guard.current) return false;
  guard.current = true;
  return true;
}

export function endSubmission(guard: SubmissionGuard): void {
  guard.current = false;
}
