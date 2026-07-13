import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  historicalPolicyApprovalHash,
  historicalPolicyContentHash,
  manifestCleanupEligibleAt,
  normalizeHistoricalPolicyContent,
  resolveHistoricalPolicyOperatingPeriod,
} from "./legacyCompatibility";

const content = {
  dateExceptionsJson: "[]",
  evidenceSummary: "Reviewed Wigclub ledger and canonical GHS payment facts.",
  intervalEnd: 200,
  intervalStart: 100,
  organizationId: "org-1",
  revenueCurrencyCode: "ghs",
  revenueCurrencyMinorUnitScale: 2,
  storeId: "store-1",
  timezone: "Africa/Accra",
  version: 1,
  weeklyWindowsJson: "[]",
};

describe("reporting historical interpretation policy", () => {
  it("normalizes and hashes reviewed policy evidence deterministically", () => {
    expect(normalizeHistoricalPolicyContent(content)).toMatchObject({
      revenueCurrencyCode: "GHS",
      timezone: "Africa/Accra",
    });
    expect(historicalPolicyContentHash(content)).toBe(
      historicalPolicyContentHash({ ...content }),
    );
    expect(historicalPolicyContentHash(content)).not.toBe(
      historicalPolicyContentHash({ ...content, intervalStart: 99 }),
    );
  });

  it("rejects invalid intervals, unsupported currency, and incomplete evidence", () => {
    expect(() =>
      normalizeHistoricalPolicyContent({ ...content, intervalEnd: 100 }),
    ).toThrow("interval is invalid");
    expect(() =>
      normalizeHistoricalPolicyContent({
        ...content,
        revenueCurrencyCode: "USD",
      }),
    ).toThrow("currency is unsupported");
    expect(() =>
      normalizeHistoricalPolicyContent({ ...content, evidenceSummary: "thin" }),
    ).toThrow("evidence is incomplete");
  });

  it("rejects malformed or operationally invalid historical schedules", () => {
    for (const weeklyWindowsJson of ["{}", "null", "1"]) {
      expect(() =>
        normalizeHistoricalPolicyContent({ ...content, weeklyWindowsJson }),
      ).toThrow("schedule JSON is invalid");
    }
    expect(() =>
      normalizeHistoricalPolicyContent({
        ...content,
        weeklyWindowsJson: JSON.stringify([
          { dayOfWeek: 7, endMinute: 1_500, startMinute: -1 },
        ]),
      }),
    ).toThrow("schedule is invalid");
    expect(() =>
      normalizeHistoricalPolicyContent({
        ...content,
        weeklyWindowsJson: JSON.stringify([
          { dayOfWeek: 1, endMinute: 600, startMinute: 500 },
          { dayOfWeek: 1, endMinute: 650, startMinute: 550 },
        ]),
      }),
    ).toThrow("schedule is invalid");
    expect(() =>
      normalizeHistoricalPolicyContent({
        ...content,
        dateExceptionsJson: JSON.stringify([
          { closed: false, localDate: "2026-99-99", windows: [] },
        ]),
      }),
    ).toThrow("schedule is invalid");
  });

  it("allows one admin to authorize and binds that identity into its hash", () => {
    expect(
      historicalPolicyApprovalHash({
        approverUserId: "user-1",
        contentHash: "hash-1",
        creatorUserId: "user-1",
      }),
    ).toContain("historical-policy-approval-v1:");
    expect(
      historicalPolicyApprovalHash({
        approverUserId: "user-2",
        contentHash: "hash-1",
        creatorUserId: "user-1",
      }),
    ).not.toBe(
      historicalPolicyApprovalHash({
        approverUserId: "user-3",
        contentHash: "hash-1",
        creatorUserId: "user-1",
      }),
    );
  });

  it("uses short failed retention and longer applied retention", () => {
    expect(
      manifestCleanupEligibleAt({ completedAt: 1_000, status: "failed" }),
    ).toBe(1_000 + 7 * 24 * 60 * 60 * 1_000);
    expect(
      manifestCleanupEligibleAt({ completedAt: 1_000, status: "completed" }),
    ).toBe(1_000 + 90 * 24 * 60 * 60 * 1_000);
    expect(() =>
      manifestCleanupEligibleAt({ completedAt: 1_000, status: "sealed" }),
    ).toThrow("Non-terminal manifest");
  });

  it("derives public policy authority from reporting access and keeps cleanup internal", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "convex",
        "reporting",
        "maintenance",
        "legacyCompatibility.ts",
      ),
      "utf8",
    );
    expect(source).toContain("requireReportingStoreAccess(ctx, args.storeId)");
    expect(source).not.toMatch(/createdByUserId:\s*args\./);
    expect(source).not.toMatch(/approvedByUserId:\s*args\./);
    expect(source).toContain("export const cleanupManifestBatch = internalMutation");
    expect(source).toContain(".take(CLEANUP_BATCH_LIMIT)");
    expect(source).toContain("recomputedContentHash !== policy.contentHash");
    expect(source).toContain('.lt("intervalStart", input.intervalEnd)');
    expect(source).toContain('.order("desc")');
    expect(source).toContain("requireFirstStoreScheduleBoundaryWithCtx");
  });

  it("resolves an approved historical interval to policy lineage without a Store Schedule row", () => {
    const occurrenceAt = Date.UTC(2026, 5, 29, 12);
    const result = resolveHistoricalPolicyOperatingPeriod({
      occurrenceAt,
      policy: {
        _id: "policy-1",
        approvalHash: "approval-hash-1",
        contentHash: "hash-1",
        dateExceptionsJson: "[]",
        intervalEnd: occurrenceAt + 86_400_000,
        intervalStart: occurrenceAt - 86_400_000,
        organizationId: "org-1",
        status: "approved",
        storeId: "store-1",
        timezone: "Africa/Accra",
        weeklyWindowsJson: JSON.stringify(
          Array.from({ length: 7 }, (_, dayOfWeek) => ({
            dayOfWeek,
            startMinute: 0,
            endMinute: 1_439,
          })),
        ),
      } as never,
    });
    expect(result).toMatchObject({
      kind: "resolved",
      historicalInterpretationPolicyHash: "approval-hash-1",
      historicalInterpretationPolicyId: "policy-1",
      operatingDate: "2026-06-29",
      scheduleVersionId: undefined,
    });
  });

  it("refuses approved policy state without an approval hash", () => {
    const occurrenceAt = Date.UTC(2026, 5, 29, 12);
    expect(
      resolveHistoricalPolicyOperatingPeriod({
        occurrenceAt,
        policy: {
          _id: "policy-1",
          approvalHash: undefined,
          contentHash: "content-hash-1",
          dateExceptionsJson: "[]",
          intervalEnd: occurrenceAt + 86_400_000,
          intervalStart: occurrenceAt - 86_400_000,
          organizationId: "org-1",
          status: "approved",
          storeId: "store-1",
          timezone: "Africa/Accra",
          weeklyWindowsJson: "[]",
        } as never,
      }),
    ).toEqual({ kind: "outside_policy", occurrenceAt });
  });

  it("does not resolve outside the approved historical interval", () => {
    expect(
      resolveHistoricalPolicyOperatingPeriod({
        occurrenceAt: 99,
        policy: {
          intervalStart: 100,
          intervalEnd: 200,
          status: "approved",
        } as never,
      }),
    ).toEqual({ kind: "outside_policy", occurrenceAt: 99 });
  });
});
