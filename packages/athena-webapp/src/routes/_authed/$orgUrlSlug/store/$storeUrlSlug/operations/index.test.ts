import { describe, expect, it } from "vitest";

import { dailyOperationsSearchSchema } from "./index";

describe("daily operations search schema", () => {
  it("preserves an origin for back navigation", () => {
    expect(
      dailyOperationsSearchSchema.parse({
        o: "%2Fwigclub%2Fstore%2Fwigclub%2Freports",
        operatingDate: "2026-07-29",
      }),
    ).toEqual({
      o: "%2Fwigclub%2Fstore%2Fwigclub%2Freports",
      operatingDate: "2026-07-29",
    });
  });
});
