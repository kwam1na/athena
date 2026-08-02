import { describe, expect, it } from "vitest";

import { reportsWeeklySearchSchema } from "./weekly";

describe("reports weekly route search", () => {
  it("owns historical selection separately from Overview return context", () => {
    expect(
      reportsWeeklySearchSchema.parse({
        reportId: "week:2026-07-06",
        history: true,
        overviewWindow: "trailing30",
      }),
    ).toEqual({
      reportId: "week:2026-07-06",
      history: true,
      overviewWindow: "trailing30",
    });
  });
});
