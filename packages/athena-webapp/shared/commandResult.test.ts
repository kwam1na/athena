import { describe, expect, it } from "vitest";

import {
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  GENERIC_UNEXPECTED_ERROR_TITLE,
  isUserErrorResult,
  ok,
  userError,
} from "./commandResult";

describe("command result helpers", () => {
  it("wraps success payloads with the ok discriminant", () => {
    expect(ok({ serviceCaseId: "service-case-1" })).toEqual({
      kind: "ok",
      data: { serviceCaseId: "service-case-1" },
    });
  });

  it("wraps user-facing failures with the user_error discriminant", () => {
    expect(
      userError({
        code: "validation_failed",
        message: "A service title is required.",
      }),
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "A service title is required.",
      },
    });
  });

  it("detects user error results without inspecting exception text", () => {
    const result = userError({
      code: "authentication_failed",
      message: "Invalid staff credentials.",
    });

    expect(isUserErrorResult(result)).toBe(true);
  });

  it("exports the generic fallback copy for unexpected faults", () => {
    expect(GENERIC_UNEXPECTED_ERROR_TITLE).toBe("Something went wrong");
    expect(GENERIC_UNEXPECTED_ERROR_MESSAGE).toBe("Please try again.");
  });
});
