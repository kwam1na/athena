import { describe, expect, it } from "vitest";

import {
  ATHENA_AUTH_JWT_DURATION_MS,
  ATHENA_AUTH_SESSION_INACTIVE_DURATION_MS,
  ATHENA_AUTH_SESSION_TOTAL_DURATION_MS,
  athenaAuthJwtConfig,
  athenaAuthSessionConfig,
} from "./authConfig";

describe("Athena auth session config", () => {
  it("keeps signed-in operator sessions longer than the Convex Auth defaults", () => {
    expect(athenaAuthSessionConfig).toEqual({
      inactiveDurationMs: ATHENA_AUTH_SESSION_INACTIVE_DURATION_MS,
      totalDurationMs: ATHENA_AUTH_SESSION_TOTAL_DURATION_MS,
    });
    expect(ATHENA_AUTH_SESSION_TOTAL_DURATION_MS).toBe(
      1000 * 60 * 60 * 24 * 90
    );
    expect(ATHENA_AUTH_SESSION_INACTIVE_DURATION_MS).toBe(
      1000 * 60 * 60 * 24 * 30
    );
  });

  it("uses a workday-length JWT to avoid routine mid-shift refresh churn", () => {
    expect(athenaAuthJwtConfig).toEqual({
      durationMs: ATHENA_AUTH_JWT_DURATION_MS,
    });
    expect(ATHENA_AUTH_JWT_DURATION_MS).toBe(1000 * 60 * 60 * 12);
  });
});
