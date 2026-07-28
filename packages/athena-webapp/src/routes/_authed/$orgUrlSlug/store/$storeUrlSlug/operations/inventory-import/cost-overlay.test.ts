import { describe, expect, it } from "vitest";

import { inventoryCostOverlaySearchSchema } from "./-cost-overlay-search";

describe("inventory cost overlay route search state", () => {
  it("restores bounded review filters and page depth", () => {
    expect(
      inventoryCostOverlaySearchSchema.parse({
        filter: "selected",
        page: "3",
        q: "  bob  ",
        run: " overlay-run ",
      }),
    ).toEqual({
      filter: "selected",
      page: 3,
      q: "bob",
      run: "overlay-run",
    });
  });

  it("falls back to the first unfiltered page", () => {
    expect(
      inventoryCostOverlaySearchSchema.parse({
        filter: "unknown",
        page: "0",
      }),
    ).toEqual({
      filter: "all",
      page: 1,
    });
  });

  it("clamps hostile deep-page restoration to the bounded review window", () => {
    expect(
      inventoryCostOverlaySearchSchema.parse({
        page: "999999999",
      }),
    ).toEqual({
      page: 10,
    });
  });

  it("keeps an opaque malformed run value for server-side resolution", () => {
    expect(
      inventoryCostOverlaySearchSchema.parse({
        run: " not-a-convex-id ",
      }),
    ).toEqual({ run: "not-a-convex-id" });
  });
});
