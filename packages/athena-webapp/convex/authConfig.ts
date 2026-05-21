export const ATHENA_AUTH_SESSION_TOTAL_DURATION_MS =
  1000 * 60 * 60 * 24 * 90;
export const ATHENA_AUTH_SESSION_INACTIVE_DURATION_MS =
  1000 * 60 * 60 * 24 * 30;
export const ATHENA_AUTH_JWT_DURATION_MS = 1000 * 60 * 60 * 12;

export const athenaAuthSessionConfig = {
  totalDurationMs: ATHENA_AUTH_SESSION_TOTAL_DURATION_MS,
  inactiveDurationMs: ATHENA_AUTH_SESSION_INACTIVE_DURATION_MS,
};

export const athenaAuthJwtConfig = {
  durationMs: ATHENA_AUTH_JWT_DURATION_MS,
};
