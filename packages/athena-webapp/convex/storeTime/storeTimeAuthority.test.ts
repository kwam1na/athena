import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertStoreTimezoneVersionCanBeInserted,
  resolveStoreTimeAuthority,
} from "./storeTimeAuthority";

const accra = {
  _id: "timezone-accra",
  organizationId: "org-1",
  storeId: "store-1",
  timezone: "Africa/Accra",
  effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
  effectiveTo: Date.parse("2026-07-01T00:00:00.000Z"),
  contentHash: "hash-accra",
  source: "admin_authorized" as const,
  authorizedAt: 1,
  authorizedByUserId: "user-1",
  createdAt: 1,
};

describe("reporting store-time authority", () => {
  it("persists immutable authorization provenance separately from schedules", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "schemas", "inventory", "storeTimezone.ts"),
      "utf8",
    );
    expect(source).toContain("storeTimezoneVersionSchema");
    expect(source).toContain("authorizedByUserId");
    expect(source).toContain("authorizedAt");
    expect(source).toContain("contentHash");
    expect(source).not.toContain("weeklyWindows");
  });

  it("resolves a store-local calendar date without opening hours", () => {
    expect(
      resolveStoreTimeAuthority({
        occurrenceAt: Date.parse("2026-06-30T23:30:00.000Z"),
        organizationId: "org-1",
        storeId: "store-1",
        versions: [accra],
      }),
    ).toEqual({
      kind: "resolved",
      occurrenceAt: Date.parse("2026-06-30T23:30:00.000Z"),
      reportingDate: "2026-06-30",
      timezone: "Africa/Accra",
      timezoneVersionId: "timezone-accra",
      timezoneVersionHash: "hash-accra",
    });
  });

  it("switches adjacent timezone versions at the exact effective boundary", () => {
    const newYork = {
      ...accra,
      _id: "timezone-new-york",
      timezone: "America/New_York",
      effectiveFrom: accra.effectiveTo,
      effectiveTo: undefined,
      contentHash: "hash-new-york",
    };

    expect(
      resolveStoreTimeAuthority({
        occurrenceAt: accra.effectiveTo - 1,
        organizationId: "org-1",
        storeId: "store-1",
        versions: [newYork, accra],
      }),
    ).toMatchObject({ timezoneVersionId: "timezone-accra" });
    expect(
      resolveStoreTimeAuthority({
        occurrenceAt: accra.effectiveTo,
        organizationId: "org-1",
        storeId: "store-1",
        versions: [accra, newYork],
      }),
    ).toMatchObject({
      reportingDate: "2026-06-30",
      timezoneVersionId: "timezone-new-york",
    });
  });

  it("is deterministic across repeated and skipped DST wall-clock times", () => {
    const newYork = {
      ...accra,
      _id: "timezone-new-york",
      timezone: "America/New_York",
      effectiveTo: undefined,
      contentHash: "hash-new-york",
    };
    const firstRepeatedHour = resolveStoreTimeAuthority({
      occurrenceAt: Date.parse("2026-11-01T05:30:00.000Z"),
      organizationId: "org-1",
      storeId: "store-1",
      versions: [newYork],
    });
    const secondRepeatedHour = resolveStoreTimeAuthority({
      occurrenceAt: Date.parse("2026-11-01T06:30:00.000Z"),
      organizationId: "org-1",
      storeId: "store-1",
      versions: [newYork],
    });

    expect(firstRepeatedHour).toMatchObject({ reportingDate: "2026-11-01" });
    expect(secondRepeatedHour).toMatchObject({ reportingDate: "2026-11-01" });
  });

  it("returns explicit integrity dispositions instead of guessing", () => {
    expect(
      resolveStoreTimeAuthority({
        occurrenceAt: accra.effectiveTo + 1,
        organizationId: "org-1",
        storeId: "store-1",
        versions: [accra],
      }),
    ).toEqual({
      kind: "missing_timezone_authority",
      occurrenceAt: accra.effectiveTo + 1,
    });

    expect(
      resolveStoreTimeAuthority({
        occurrenceAt: accra.effectiveFrom,
        organizationId: "org-2",
        storeId: "store-1",
        versions: [accra],
      }),
    ).toEqual({
      kind: "cross_store_timezone_authority",
      occurrenceAt: accra.effectiveFrom,
    });
  });

  it("rejects invalid IANA identifiers, invalid intervals, and overlaps", () => {
    expect(() =>
      assertStoreTimezoneVersionCanBeInserted({
        candidate: { ...accra, timezone: "Not/A_Real_Zone" },
        existing: [],
      }),
    ).toThrow("valid IANA");
    expect(() =>
      assertStoreTimezoneVersionCanBeInserted({
        candidate: { ...accra, effectiveTo: accra.effectiveFrom },
        existing: [],
      }),
    ).toThrow("after effectiveFrom");
    expect(() =>
      assertStoreTimezoneVersionCanBeInserted({
        candidate: { ...accra, _id: "timezone-overlap" },
        existing: [accra],
      }),
    ).toThrow("overlaps");
  });
});
