import { describe, expect, it } from "vitest";

import { getRecoveryHomePath } from "./appEntryRoutes";

describe("recovery home routing", () => {
  it("keeps public recovery on the product overview", () => {
    expect(getRecoveryHomePath("/walkthrough")).toBe("/landing");
  });

  it("keeps unknown authenticated app paths in the operational entry", () => {
    expect(getRecoveryHomePath("/app/unknown")).toBe("/");
  });
});
