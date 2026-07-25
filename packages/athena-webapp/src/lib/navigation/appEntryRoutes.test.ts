import { describe, expect, it } from "vitest";

import { getRecoveryHomePath } from "./appEntryRoutes";

describe("recovery home routing", () => {
  it("keeps public recovery on the product overview", () => {
    expect(getRecoveryHomePath("/register-interest")).toBe("/landing");
    // The pre-rename path still redirects, so it stays a public recovery too.
    expect(getRecoveryHomePath("/walkthrough")).toBe("/landing");
  });

  it("keeps unknown authenticated app paths in the operational entry", () => {
    expect(getRecoveryHomePath("/app/unknown")).toBe("/");
  });
});
