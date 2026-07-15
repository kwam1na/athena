import { describe, expect, it } from "vitest";

import { isExpiredSharedDemoSessionError } from "./athenaUser";

describe("authenticated Athena user session bootstrap", () => {
  it("recognizes only the expired shared-demo admission error", () => {
    expect(
      isExpiredSharedDemoSessionError(
        new Error("The demo session has expired. Open the demo again."),
      ),
    ).toBe(true);
    expect(isExpiredSharedDemoSessionError(new Error("Access denied"))).toBe(
      false,
    );
    expect(isExpiredSharedDemoSessionError("expired")).toBe(false);
  });
});
