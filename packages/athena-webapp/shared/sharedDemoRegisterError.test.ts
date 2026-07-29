import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  isSharedDemoRegisterUnavailableError,
  SHARED_DEMO_REGISTER_UNAVAILABLE_CODE,
  SHARED_DEMO_REGISTER_UNAVAILABLE_MESSAGE,
} from "./sharedDemoRegisterError";

describe("isSharedDemoRegisterUnavailableError", () => {
  it("matches the typed error the bind mutation throws", () => {
    const error = new ConvexError({
      code: SHARED_DEMO_REGISTER_UNAVAILABLE_CODE,
      message: SHARED_DEMO_REGISTER_UNAVAILABLE_MESSAGE,
    });
    expect(isSharedDemoRegisterUnavailableError(error)).toBe(true);
  });

  it("rejects plain errors carrying the same message", () => {
    expect(
      isSharedDemoRegisterUnavailableError(
        new Error(SHARED_DEMO_REGISTER_UNAVAILABLE_MESSAGE),
      ),
    ).toBe(false);
  });

  it("rejects other typed demo errors and non-errors", () => {
    expect(
      isSharedDemoRegisterUnavailableError(
        new ConvexError({ code: "shared_demo_action_denied" }),
      ),
    ).toBe(false);
    expect(isSharedDemoRegisterUnavailableError(null)).toBe(false);
    expect(isSharedDemoRegisterUnavailableError({ data: "nope" })).toBe(false);
  });
});
