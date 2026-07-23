import { describe, expect, it } from "vitest";

import { getAthenaDocumentTitle } from "./__root";
import { rootPageSchema } from "./-root-page-search";

describe("Athena document title", () => {
  it("keeps public route titles specific after JavaScript starts", () => {
    expect(getAthenaDocumentTitle("/landing")).toBe(
      "Athena | Product overview",
    );
    expect(getAthenaDocumentTitle("/walkthrough")).toBe(
      "Register interest in Athena",
    );
    expect(getAthenaDocumentTitle("/privacy")).toBe(
      "Athena privacy details",
    );
    expect(getAthenaDocumentTitle("/demo")).toBe("Athena | Demo");
  });

  it("uses the app title for authenticated and app-entry routes", () => {
    expect(getAthenaDocumentTitle("/")).toBe("Athena");
    expect(getAthenaDocumentTitle("/app")).toBe("Athena");
    expect(getAthenaDocumentTitle("/acme/store/main/home")).toBe("Athena");
    expect(
      getAthenaDocumentTitle("/acme/store/main/operations/daily-close"),
    ).toBe("Athena");
  });
});

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
