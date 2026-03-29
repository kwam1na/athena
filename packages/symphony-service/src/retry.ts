export function calculateFailureRetryDelay(attempt: number, maxRetryBackoffMs: number): number {
  const normalizedAttempt = Math.max(1, Math.trunc(attempt));
  const rawDelay = 10_000 * 2 ** (normalizedAttempt - 1);
  return Math.min(rawDelay, maxRetryBackoffMs);
}

export function calculateContinuationDelay(): number {
  return 1_000;
}
