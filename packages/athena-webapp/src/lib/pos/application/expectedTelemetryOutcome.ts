const EXPECTED_POS_TELEMETRY_CODES = new Set([
  "validation_failed",
  "authentication_failed",
  "authorization_failed",
  "not_found",
  "conflict",
  "precondition_failed",
  "rate_limited",
  "unavailable",
  "shared_demo_action_denied",
  "shared_demo_session_expired",
  "offline",
  "cashierMismatch",
  "inventoryUnavailable",
  "sessionExpired",
  "terminalUnavailable",
  "validationFailed",
]);

function readOutcomeCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.code === "string") return candidate.code;

  for (const key of ["data", "error"] as const) {
    const nested = candidate[key];
    if (!nested || typeof nested !== "object") continue;
    const code = (nested as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }

  return undefined;
}

/**
 * Returns true only for finite, coded outcomes that already have a normal POS
 * recovery or presentation path. Message text is deliberately ignored.
 */
export function isExpectedPosTelemetryOutcome(value: unknown): boolean {
  const code = readOutcomeCode(value);
  return code !== undefined && EXPECTED_POS_TELEMETRY_CODES.has(code);
}
