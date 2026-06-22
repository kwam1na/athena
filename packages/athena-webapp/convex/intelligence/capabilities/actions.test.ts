import { describe, expect, it } from "vitest";

import {
  isInsightGenerationInProgressError,
  toPersistedIntelligenceError,
} from "./actions";

describe("intelligence capability actions", () => {
  it("identifies duplicate in-flight insight generation errors", () => {
    expect(
      isInsightGenerationInProgressError(
        new Error("An Athena insight is already being generated for this context."),
      ),
    ).toBe(true);
    expect(isInsightGenerationInProgressError(new Error("Different failure"))).toBe(
      false,
    );
  });

  it("strips provider diagnostics before persisting run errors", () => {
    expect(
      toPersistedIntelligenceError({
        capability: "structured_text.v1",
        code: "provider_failure",
        message: "The intelligence provider could not complete the request.",
        providerId: "tanstack-openai",
        retryable: true,
        status: "provider_failure",
      } as Parameters<typeof toPersistedIntelligenceError>[0]),
    ).toEqual({
      code: "provider_failure",
      message: "The intelligence provider could not complete the request.",
      retryable: true,
    });
  });

  it("keeps sanitized failure diagnostics for debug visibility", () => {
    expect(
      toPersistedIntelligenceError({
        code: "provider_failure",
        diagnostic: "Cannot find module @tanstack/ai",
        message: "The intelligence provider could not complete the request.",
        retryable: true,
      }),
    ).toEqual({
      code: "provider_failure",
      diagnostic: "Cannot find module @tanstack/ai",
      message: "The intelligence provider could not complete the request.",
      retryable: true,
    });
  });
});
