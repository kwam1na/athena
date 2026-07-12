import { describe, expect, it } from "vitest";

import { rootPageSchema } from "./-root-page-search";

describe("root search compatibility", () => {
  it("preserves representative operational search parameters", () => {
    expect(
      rootPageSchema.parse({
        categorySlug: "hair-care",
        classification: "low_cover",
        comparison: "prior_period",
        cursor: "cursor-1",
        end: "2026-07-11",
        itemSort: "attention",
        mode: "cycle_count",
        page: "3",
        preset: "custom",
        procurementMode: "planned",
        query: "CW-18",
        registerSessionId: "session-1",
        runId: "run-1",
        scope: "store",
        sku: "CW-18",
        start: "2026-07-01",
        timeRange: "today",
      }),
    ).toEqual({
      categorySlug: "hair-care",
      classification: "low_cover",
      comparison: "prior_period",
      cursor: "cursor-1",
      end: "2026-07-11",
      itemSort: "attention",
      mode: "cycle_count",
      page: 3,
      preset: "custom",
      procurementMode: "planned",
      query: "CW-18",
      registerSessionId: "session-1",
      runId: "run-1",
      scope: "store",
      sku: "CW-18",
      start: "2026-07-01",
      timeRange: "today",
    });
  });

  it("preserves the resolved procurement compatibility seam", () => {
    expect(
      rootPageSchema.parse({ procurementMode: "resolved" }),
    ).toEqual({ procurementMode: undefined });
  });
});
