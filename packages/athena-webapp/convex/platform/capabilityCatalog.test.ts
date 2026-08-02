import { describe, expect, it } from "vitest";

import {
  isCloseWithinWeeklyAcceptanceFloor,
  hasCompletedWeeklyReportingCycleAnchorVerification,
  isWeeklyReportingEnabledForStore,
  isWeeklyReportingEnabledForStoreDoc,
} from "./capabilityCatalog";

const VERIFIED = {
  status: "complete",
  missingCount: 0,
  startedAt: 1,
  completedAt: 2,
} as const;

describe("weekly Reports rollout gate", () => {
  it("requires durable observedAt verification in addition to an explicit allowlist entry", () => {
    expect(
      isWeeklyReportingEnabledForStore("store-a", undefined, false, true),
    ).toBe(false);
    expect(isWeeklyReportingEnabledForStore("store-a", "", true, true)).toBe(
      false,
    );
    expect(
      isWeeklyReportingEnabledForStore("store-a", " store-b, store-a ", true, true),
    ).toBe(true);
    expect(
      isWeeklyReportingEnabledForStore("store-a", "store-a", false, true),
    ).toBe(false);
    expect(
      isWeeklyReportingEnabledForStore("store-c", "store-a,store-b", true, true),
    ).toBe(false);
  });

  it("requires reporting-cycle anchor verification, and fails closed without it", () => {
    // Absent evidence is not permission: the argument defaults to false, so a
    // caller that has not been taught about the anchor cannot accidentally
    // enable the surface.
    expect(isWeeklyReportingEnabledForStore("store-a", "store-a", true)).toBe(
      false,
    );
    expect(
      isWeeklyReportingEnabledForStore("store-a", "store-a", true, false),
    ).toBe(false);
    expect(
      isWeeklyReportingEnabledForStore("store-a", "store-a", true, true),
    ).toBe(true);
  });

  it("reads the anchor evidence off the store document", () => {
    expect(hasCompletedWeeklyReportingCycleAnchorVerification(null)).toBe(false);
    expect(hasCompletedWeeklyReportingCycleAnchorVerification({})).toBe(false);
    expect(
      hasCompletedWeeklyReportingCycleAnchorVerification({
        weeklyReportingCycleAnchorVerification: { status: "incomplete" },
      }),
    ).toBe(false);
    expect(
      hasCompletedWeeklyReportingCycleAnchorVerification({
        weeklyReportingCycleAnchorVerification: VERIFIED,
      }),
    ).toBe(true);
  });

  it("keeps an allowlisted, observedAt-verified store off until its anchors are verified", () => {
    const allowlist = "store-a";
    const observedAtOnly = { weeklyObservedAtVerification: VERIFIED };
    expect(
      isWeeklyReportingEnabledForStoreDoc("store-a", observedAtOnly, allowlist),
    ).toBe(false);

    const anchorInProgress = {
      ...observedAtOnly,
      weeklyReportingCycleAnchorVerification: {
        status: "incomplete",
        missingCount: 1,
        startedAt: 1,
      },
    };
    expect(
      isWeeklyReportingEnabledForStoreDoc("store-a", anchorInProgress, allowlist),
    ).toBe(false);

    const fullyVerified = {
      ...observedAtOnly,
      weeklyReportingCycleAnchorVerification: VERIFIED,
    };
    expect(
      isWeeklyReportingEnabledForStoreDoc("store-a", fullyVerified, allowlist),
    ).toBe(true);
    // Anchors alone are not enough either — both migrations must land.
    expect(
      isWeeklyReportingEnabledForStoreDoc(
        "store-a",
        { weeklyReportingCycleAnchorVerification: VERIFIED },
        allowlist,
      ),
    ).toBe(false);
  });
});

describe("isCloseWithinWeeklyAcceptanceFloor", () => {
  it("keeps legacy stores without a floor permissive", () => {
    expect(isCloseWithinWeeklyAcceptanceFloor({}, 100)).toBe(true);
    expect(isCloseWithinWeeklyAcceptanceFloor(null, undefined)).toBe(true);
  });

  it("refuses pre-activation and unproven closes once a floor exists", () => {
    const store = { weeklyReportingAcceptanceFloor: 1_000 };
    expect(isCloseWithinWeeklyAcceptanceFloor(store, 999)).toBe(false);
    expect(isCloseWithinWeeklyAcceptanceFloor(store, undefined)).toBe(false);
    expect(isCloseWithinWeeklyAcceptanceFloor(store, 1_000)).toBe(true);
    expect(isCloseWithinWeeklyAcceptanceFloor(store, 1_001)).toBe(true);
  });
});
