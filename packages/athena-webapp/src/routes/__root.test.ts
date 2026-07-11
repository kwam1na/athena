import { describe, expect, it } from "vitest";

import { rootPageSchema } from "./-root-page-search";

describe("root search compatibility", () => {
  it("preserves representative operational search parameters", () => {
    expect(
      rootPageSchema.parse({
        categorySlug: "hair-care",
        mode: "cycle_count",
        page: "3",
        procurementMode: "planned",
        query: "CW-18",
        registerSessionId: "session-1",
        scope: "store",
        sku: "CW-18",
        timeRange: "today",
      }),
    ).toEqual({
      categorySlug: "hair-care",
      mode: "cycle_count",
      page: 3,
      procurementMode: "planned",
      query: "CW-18",
      registerSessionId: "session-1",
      scope: "store",
      sku: "CW-18",
      timeRange: "today",
    });
  });

  it("preserves the resolved procurement compatibility seam", () => {
    expect(
      rootPageSchema.parse({ procurementMode: "resolved" }),
    ).toEqual({ procurementMode: undefined });
  });
});
