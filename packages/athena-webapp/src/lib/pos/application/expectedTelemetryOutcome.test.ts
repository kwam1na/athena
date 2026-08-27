import { describe, expect, it } from "vitest";

import { isExpectedPosTelemetryOutcome } from "./expectedTelemetryOutcome";

describe("isExpectedPosTelemetryOutcome", () => {
  it.each([
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
    "sessionExpired",
    "terminalUnavailable",
    "validationFailed",
  ])("classifies the coded %s outcome as expected", (code) => {
    expect(isExpectedPosTelemetryOutcome({ data: { code } })).toBe(true);
    expect(isExpectedPosTelemetryOutcome({ error: { code } })).toBe(true);
  });

  it("does not classify unknown, message-only, or malformed failures as expected", () => {
    expect(isExpectedPosTelemetryOutcome(new Error("conflict"))).toBe(false);
    expect(isExpectedPosTelemetryOutcome({ code: "database_exploded" })).toBe(
      false,
    );
    expect(isExpectedPosTelemetryOutcome("offline")).toBe(false);
    expect(isExpectedPosTelemetryOutcome(null)).toBe(false);
  });
});
