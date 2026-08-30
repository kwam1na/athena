/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { seedStore, seedDailyClose } from "./reseedTestSupport";
import {
  publishCloseLifecycleWithCtx,
  materializeCloseEvidenceWithCtx,
} from "./closeEvidence";
import { foldAndReplaceDay } from "./sweeper";
import { materializeAcceptedWeek } from "./weekly";
import { verifyAcceptedBaselinePageWithCtx } from "./pipelineAcceptedParity";
import { recordReadCosts } from "./readCostTestSupport";
const modules = import.meta.glob("../**/*.ts");
const NOW = Date.parse("2026-08-29T20:00:00Z");

async function fixture() {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const store = await seedStore(ctx, "UTC");
    await ctx.db.patch("store", store.storeId, {
      weeklyObservedAtVerification: {
        status: "complete",
        missingCount: 0,
        startedAt: NOW - 100,
        completedAt: NOW - 1,
      },
    });
    const controlId = await ctx.db.insert("reportPipelineControl", {
      storeId: store.storeId,
      mode: "active",
      fence: 1,
      sourceWatermark: 0,
    });
    await ctx.db.insert("storeSchedule", {
      storeId: store.storeId,
      organizationId: store.organizationId,
      timezone: "UTC",
      weeklyWindows: [],
      weeklyClosedDays: [],
      dateExceptions: [],
      reportingCycleStartsOn: 0,
      effectiveFrom: Date.parse("2026-01-01"),
      status: "active",
      source: "admin",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const factId = await ctx.db.insert("reportFact", {
      storeId: store.storeId,
      operatingDate: "2026-08-29",
      sourceDomain: "pos",
      sourceId: "accepted-sale",
      lineId: "one",
      factKind: "sale",
      fingerprint: "one",
      fingerprintVersion: 2,
      occurredAt: NOW - 1,
      recordedAt: NOW - 1,
      observedAt: NOW - 1,
      currency: "GHS",
      productSkuId: store.skuId,
      grossAmountMinor: 100,
      netAmountMinor: 100,
      taxAmountMinor: 0,
      discountAmountMinor: 0,
      quantity: 1,
    });
    const closeId = await seedDailyClose(ctx, store, {
      operatingDate: "2026-08-29",
      completedAt: NOW,
      salesTotal: 100,
    });
    const close = (await ctx.db.get("dailyClose", closeId))!;
    await ctx.db.patch("dailyClose", closeId, {
      reportSnapshot: {
        closeMetadata: {
          storeId: store.storeId,
          organizationId: store.organizationId,
          operatingDate: "2026-08-29",
          startAt: NOW - 1000,
          endAt: NOW,
          completedAt: NOW,
          carryForwardWorkItemIds: [],
        },
        readiness: close.readiness,
        summary: { netCashVariance: 0, transactionCount: 1, paymentTotals: [] },
        reviewedItems: [],
        carryForwardItems: [],
        readyItems: [],
        sourceSubjects: [],
        expenseProductEvidence: {
          contractVersion: 1,
          status: "complete",
          expenseTotal: 0,
          sourceItemCount: 0,
          sourceTransactionCount: 0,
          products: [],
        },
        openWorkMembership: {
          completeness: "complete",
          observedLogicalCount: 0,
        },
        frozenSyncedSaleInventoryReviewGroups: [],
      },
    });
    const source = (await ctx.db.get("dailyClose", closeId))!;
    const header = await publishCloseLifecycleWithCtx(ctx, source, NOW);
    await materializeCloseEvidenceWithCtx(ctx, {
      storeId: store.storeId,
      closeId,
      expectedGeneration: header.expectedGeneration,
    });
    await foldAndReplaceDay(ctx, store.storeId, "2026-08-29", NOW + 1);
    expect(
      await materializeAcceptedWeek({
        ctx,
        storeId: store.storeId,
        closeId,
        cutoffObservedAt: NOW,
        now: NOW + 2,
      }),
    ).toBe("created");
    const accepted = (await ctx.db.query("reportWeekAccepted").first())!;
    return { ...store, closeId, factId, acceptedId: accepted._id, controlId };
  });
  const verify = () =>
    t.run(async (ctx) => {
      const r = recordReadCosts(ctx);
      const result = await verifyAcceptedBaselinePageWithCtx(r.ctx, {
        storeId: seeded.storeId,
        cursor: null,
      });
      expect(r.snapshot().total.returnedDocuments).toBeLessThan(4500);
      expect(r.snapshot().total.serializedBytes).toBeLessThan(4 * 1024 * 1024);
      expect(r.snapshot().byTable.dailyClose).toBeUndefined();
      return result;
    });
  return { t, seeded, verify };
}

describe("bounded immutable accepted-baseline parity", () => {
  it("replays cutoff truth without changing accepted rows or notifications", async () => {
    const { t, seeded, verify } = await fixture();
    const before = await t.run((ctx) =>
      ctx.db.get("reportWeekAccepted", seeded.acceptedId),
    );
    expect(await verify()).toMatchObject({
      done: true,
      checked: 1,
      issues: [],
    });
    expect(
      await t.run((ctx) => ctx.db.get("reportWeekAccepted", seeded.acceptedId)),
    ).toEqual(before);
  });

  it("uses historical frozen close identity after a later reopen, not the current day link", async () => {
    const { t, seeded, verify } = await fixture();
    await t.run(async (ctx) => {
      await ctx.db.patch("dailyClose", seeded.closeId, {
        lifecycleStatus: "reopened",
        reopenedAt: NOW + 100,
        updatedAt: NOW + 100,
      });
      const source = (await ctx.db.get("dailyClose", seeded.closeId))!;
      const header = await publishCloseLifecycleWithCtx(ctx, source, NOW + 100);
      await materializeCloseEvidenceWithCtx(ctx, {
        storeId: seeded.storeId,
        closeId: seeded.closeId,
        expectedGeneration: header.expectedGeneration,
      });
      const day = (await ctx.db.query("reportDay").first())!;
      await ctx.db.patch("reportDay", day._id, { closeId: undefined });
      const original = (await ctx.db.get("reportFact", seeded.factId))!;
      const { _id, _creationTime, ...fields } = original;
      await ctx.db.insert("reportFact", {
        ...fields,
        sourceId: "late-sale",
        observedAt: NOW + 100,
        recordedAt: NOW + 100,
      });
    });
    expect((await verify()).issues).toEqual([]);
  });

  it.each(["financial", "payment", "leader", "close"] as const)(
    "blocks a mismatched %s baseline without repairing it",
    async (kind) => {
      const { t, seeded, verify } = await fixture();
      await t.run(async (ctx) => {
        const accepted = (await ctx.db.get(
          "reportWeekAccepted",
          seeded.acceptedId,
        ))!;
        if (kind === "financial")
          await ctx.db.patch("reportWeekAccepted", accepted._id, {
            included: { ...accepted.included, netSalesMinor: 101 },
          });
        if (kind === "payment")
          await ctx.db.patch("reportWeekAccepted", accepted._id, {
            paymentMix: { status: "complete", rows: [], totalMinor: 1 },
          });
        if (kind === "leader")
          await ctx.db.patch("reportWeekAccepted", accepted._id, {
            topSkuLeaders: accepted.topSkuLeaders!.map((row) => ({
              ...row,
              unitsSold: 2,
            })),
          });
        if (kind === "close")
          await ctx.db.patch("reportWeekAccepted", accepted._id, {
            closeEvidence: {
              ...accepted.closeEvidence!,
              cash: { ...accepted.closeEvidence!.cash, cashVarianceMinor: 1 },
            },
          });
      });
      const before = await t.run((ctx) =>
        ctx.db.get("reportWeekAccepted", seeded.acceptedId),
      );
      expect((await verify()).issues).toHaveLength(1);
      expect(
        await t.run((ctx) =>
          ctx.db.get("reportWeekAccepted", seeded.acceptedId),
        ),
      ).toEqual(before);
    },
  );

  it("blocks lost cutoff history and unsupported legacy close lineage", async () => {
    const { t, seeded, verify } = await fixture();
    await t.run((ctx) =>
      ctx.db.patch("reportPipelineControl", seeded.controlId, {
        acceptedReplayUnavailableBefore: NOW + 1,
      }),
    );
    expect((await verify()).issues[0]?.reason).toBe(
      "cutoff_evidence_unavailable",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("reportPipelineControl", seeded.controlId, {
        acceptedReplayUnavailableBefore: undefined,
      });
      const accepted = (await ctx.db.get(
        "reportWeekAccepted",
        seeded.acceptedId,
      ))!;
      await ctx.db.patch("reportWeekAccepted", accepted._id, {
        scheduleLineage: accepted.scheduleLineage.map(
          ({ dayClosed, ...rest }) => rest,
        ),
      });
    });
    expect((await verify()).issues[0]?.reason).toBe(
      "unsupported_legacy_evidence",
    );
  });

  it("blocks a cutoff equal to the destructive replay boundary", async () => {
    const { t, seeded, verify } = await fixture();
    await t.run((ctx) =>
      ctx.db.patch("reportPipelineControl", seeded.controlId, {
        acceptedReplayUnavailableBefore: NOW,
      }),
    );
    expect((await verify()).issues[0]?.reason).toBe(
      "cutoff_evidence_unavailable",
    );
  });

  it("blocks when a referenced schedule no longer proves the frozen lineage", async () => {
    const { t, seeded, verify } = await fixture();
    await t.run(async (ctx) => {
      const accepted = (await ctx.db.get(
        "reportWeekAccepted",
        seeded.acceptedId,
      ))!;
      await ctx.db.patch(
        "storeSchedule",
        accepted.scheduleLineage[0].scheduleVersionId!,
        { weeklyClosedDays: [6] },
      );
    });
    expect((await verify()).issues[0]?.reason).toBe(
      "unsupported_legacy_evidence",
    );
  });

  it("blocks ambiguous historical close identity rather than choosing a newer row", async () => {
    const { t, seeded, verify } = await fixture();
    await t.run(async (ctx) => {
      const closeId = await seedDailyClose(ctx, seeded, {
        operatingDate: "2026-08-29",
        completedAt: NOW - 10,
        salesTotal: 0,
      });
      const source = (await ctx.db.get("dailyClose", closeId))!;
      await publishCloseLifecycleWithCtx(ctx, source, NOW + 100);
    });
    expect((await verify()).issues[0]?.reason).toBe(
      "unsupported_legacy_evidence",
    );
  });

  it("does not certify a frozen missing-day claim when historical source proves a close", async () => {
    const { t, seeded, verify } = await fixture();
    await t.run(async (ctx) => {
      const closeId = await seedDailyClose(ctx, seeded, {
        operatingDate: "2026-08-28",
        completedAt: NOW - 10,
        salesTotal: 0,
      });
      await publishCloseLifecycleWithCtx(
        ctx,
        (await ctx.db.get("dailyClose", closeId))!,
        NOW + 100,
      );
    });
    expect((await verify()).issues[0]?.reason).toBe(
      "unsupported_legacy_evidence",
    );
  });

  it("refuses unpublished compact evidence and externally sealed correction provenance", async () => {
    const { t, seeded, verify } = await fixture();
    await t.run(async (ctx) => {
      const header = (await ctx.db.query("reportCloseEvidence").first())!;
      await ctx.db.patch("reportCloseEvidence", header._id, {
        publishedGeneration: undefined,
      });
    });
    expect((await verify()).issues[0]?.reason).toBe("missing_close_evidence");
    await t.run(async (ctx) => {
      const accepted = (await ctx.db.get(
        "reportWeekAccepted",
        seeded.acceptedId,
      ))!;
      await ctx.db.patch("reportWeekAccepted", accepted._id, {
        correction: {
          contractVersion: 1,
          appliedAt: NOW + 100,
          candidateFingerprint: "sealed",
          sourceManifestFingerprint: "external-manifest",
          scheduleLineage: accepted.scheduleLineage,
          closeEvidence: accepted.closeEvidence!,
        },
      });
    });
    expect((await verify()).issues[0]?.reason).toBe(
      "unsupported_legacy_evidence",
    );
  });

  it("stops at the shared 4000-fact sentinel without publishing partial proof", async () => {
    const { t, seeded, verify } = await fixture();
    await t.run(async (ctx) => {
      const { _id, _creationTime, ...fact } = (await ctx.db.get(
        "reportFact",
        seeded.factId,
      ))!;
      for (let i = 0; i < 4000; i++)
        await ctx.db.insert("reportFact", {
          ...fact,
          sourceId: `overflow-${i}`,
        });
    });
    expect((await verify()).issues[0]?.reason).toBe("capacity_exceeded");
  });

  it("visits all retained accepted rows one at a time, including beyond sixteen cycles", async () => {
    const { t, seeded } = await fixture();
    await t.run(async (ctx) => {
      const { _id, _creationTime, ...accepted } = (await ctx.db.get(
        "reportWeekAccepted",
        seeded.acceptedId,
      ))!;
      for (let i = 0; i < 20; i++)
        await ctx.db.insert("reportWeekAccepted", {
          ...accepted,
          cycleStartDate: `legacy-${i}`,
        });
    });
    let cursor: string | null = null;
    let checked = 0;
    let blocked = 0;
    for (let page = 0; page < 22; page++) {
      const result = await t.run((ctx) =>
        verifyAcceptedBaselinePageWithCtx(ctx, {
          storeId: seeded.storeId,
          cursor,
        }),
      );
      expect(result.checked).toBeLessThanOrEqual(1);
      checked += result.checked;
      blocked += result.issues.length;
      cursor = result.nextCursor;
      if (result.done) break;
    }
    expect(cursor).toBeNull();
    expect(checked).toBe(21);
    expect(blocked).toBe(20);
  });
});
