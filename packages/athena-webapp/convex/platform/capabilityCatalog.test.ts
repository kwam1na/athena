import { describe, expect, it } from "vitest";

import { isWeeklyReportingEnabledForStore } from "./capabilityCatalog";

describe("weekly Reports rollout gate", () => {
  it("requires durable observedAt verification in addition to an explicit allowlist entry", () => {
    expect(
      isWeeklyReportingEnabledForStore("store-a", undefined, false),
    ).toBe(false);
    expect(isWeeklyReportingEnabledForStore("store-a", "", true)).toBe(false);
    expect(
      isWeeklyReportingEnabledForStore(
        "store-a",
        " store-b, store-a ",
        true,
      ),
    ).toBe(true);
    expect(
      isWeeklyReportingEnabledForStore("store-a", "store-a", false),
    ).toBe(false);
    expect(
      isWeeklyReportingEnabledForStore("store-c", "store-a,store-b", true),
    ).toBe(false);
  });
});
