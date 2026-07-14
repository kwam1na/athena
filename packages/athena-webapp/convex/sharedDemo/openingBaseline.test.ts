import { describe, expect, it } from "vitest";

import {
  buildSharedDemoOpeningBaseline,
  sharedDemoOperatingDateRange,
} from "./openingBaseline";

describe("shared demo opening baseline", () => {
  it("starts the current New York operating day with Opening Handoff complete", () => {
    const now = Date.parse("2026-07-14T12:30:00.000Z");
    const range = sharedDemoOperatingDateRange(now);

    expect(range).toEqual({
      endAt: Date.parse("2026-07-15T04:00:00.000Z"),
      operatingDate: "2026-07-14",
      startAt: Date.parse("2026-07-14T04:00:00.000Z"),
    });
    expect(
      buildSharedDemoOpeningBaseline({
        actorStaffProfileId: "staff" as never,
        actorUserId: "user" as never,
        now,
        organizationId: "organization" as never,
        storeId: "store" as never,
      }),
    ).toMatchObject({
      acknowledgedItemKeys: [],
      actorStaffProfileId: "staff",
      actorType: "human",
      actorUserId: "user",
      carryForwardWorkItemIds: [],
      endAt: range.endAt,
      operatingDate: range.operatingDate,
      readiness: {
        blockerCount: 0,
        carryForwardCount: 0,
        readyCount: 1,
        reviewCount: 0,
        status: "ready",
      },
      startAt: range.startAt,
      status: "started",
    });
  });

  it("keeps the canonical store date when a browser is on another local date", () => {
    const now = Date.parse("2026-07-14T02:00:00.000Z");

    expect(sharedDemoOperatingDateRange(now)).toEqual({
      endAt: Date.parse("2026-07-14T04:00:00.000Z"),
      operatingDate: "2026-07-13",
      startAt: Date.parse("2026-07-13T04:00:00.000Z"),
    });
  });
});
