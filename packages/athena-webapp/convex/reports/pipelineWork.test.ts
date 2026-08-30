/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import {
  claimReportWorkWithCtx,
  completeReportWorkWithCtx,
  enqueueReportWork,
  failReportWorkWithCtx,
  getClaimedReportWorkWithCtx,
  REPORT_WORK_CLAIM_LIMIT,
  REPORT_WORK_LEASE_MS,
  REPORT_WORK_RETRY_BASE_MS,
  REPORT_WORK_RETRY_MAX_MS,
  type ReportWorkClaim,
} from "./pipelineWork";
import { recordReadCosts } from "./readCostTestSupport";

const modules = import.meta.glob("../**/*.ts");
const NOW = 1_000_000;

async function fixture(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("athenaUser", { email: "work@test" });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: userId,
      name: "Work",
      slug: "work",
    });
    const storeIds: Id<"store">[] = [];
    for (const slug of ["first", "second"]) {
      storeIds.push(
        await ctx.db.insert("store", {
          createdByUserId: userId,
          organizationId,
          currency: "GHS",
          name: slug,
          slug,
        }),
      );
    }
    const closeIds: Id<"dailyClose">[] = [];
    for (const operatingDate of ["2026-08-22", "2026-08-29"]) {
      closeIds.push(
        await ctx.db.insert("dailyClose", {
          storeId: storeIds[0],
          organizationId,
          operatingDate,
          status: "completed",
          lifecycleStatus: "active",
          isCurrent: true,
          readiness: {
            status: "ready",
            blockerCount: 0,
            reviewCount: 0,
            carryForwardCount: 0,
            readyCount: 0,
          },
          summary: {},
          sourceSubjects: [],
          carryForwardWorkItemIds: [],
          createdAt: NOW,
          updatedAt: NOW,
          completedAt: NOW,
        }),
      );
    }
    return { storeId: storeIds[0], otherStoreId: storeIds[1], closeIds };
  });
}

async function claimOne(
  t: ReturnType<typeof convexTest>,
  work: Pick<ReportWorkClaim, "storeId" | "kind">,
  now = NOW,
) {
  const result = await t.run((ctx) =>
    claimReportWorkWithCtx(ctx, { ...work, limit: 1 }, now),
  );
  expect(result.claims).toHaveLength(1);
  return result.claims[0];
}

describe("reports exact durable work", () => {
  it("retains more than sixteen historical cycles and two acceptance identities", async () => {
    const t = convexTest(schema, modules);
    const { storeId, closeIds } = await fixture(t);
    await t.run(async (ctx) => {
      for (let index = 1; index <= 20; index += 1) {
        await enqueueReportWork(
          ctx,
          {
            storeId,
            kind: "refresh",
            cycleStartDate: `2026-08-${String(index).padStart(2, "0")}`,
          },
          NOW,
        );
      }
      for (const [index, closeId] of closeIds.entries()) {
        await enqueueReportWork(
          ctx,
          {
            storeId,
            kind: "accept",
            cycleStartDate: index === 0 ? "2026-08-17" : "2026-08-24",
            closeId,
            cutoffObservedAt: NOW + index,
          },
          NOW,
        );
      }
      const all = await ctx.db
        .query("reportPipelineWork")
        .withIndex("by_storeId_workKey", (q) => q.eq("storeId", storeId))
        .take(23);
      expect(all).toHaveLength(22);
      expect(
        all
          .filter((row) => row.kind === "accept")
          .map((row) => row.cutoffObservedAt),
      ).toEqual([NOW, NOW + 1]);
    });
  });

  it("coalesces only the exact structural identity across kinds, dates, closes, and stores", async () => {
    const t = convexTest(schema, modules);
    const { storeId, otherStoreId, closeIds } = await fixture(t);
    await t.run(async (ctx) => {
      const first = await enqueueReportWork(
        ctx,
        { storeId, kind: "current" },
        NOW,
      );
      const repeat = await enqueueReportWork(
        ctx,
        { storeId, kind: "current" },
        NOW + 1,
      );
      expect(repeat.workId).toBe(first.workId);
      expect(repeat.generation).toBe(first.generation + 1);
      const distinct = [
        first,
        await enqueueReportWork(
          ctx,
          { storeId: otherStoreId, kind: "current" },
          NOW,
        ),
        await enqueueReportWork(ctx, { storeId, kind: "overview" }, NOW),
        await enqueueReportWork(ctx, { storeId, kind: "inventory" }, NOW),
        await enqueueReportWork(
          ctx,
          { storeId, kind: "resolve-week-date", operatingDate: "2026-08-24" },
          NOW,
        ),
        await enqueueReportWork(
          ctx,
          { storeId, kind: "rollup", operatingDate: "2026-08-24" },
          NOW,
        ),
        await enqueueReportWork(
          ctx,
          { storeId, kind: "rollup", operatingDate: "2026-08-25" },
          NOW,
        ),
        await enqueueReportWork(
          ctx,
          { storeId, kind: "close-evidence", closeId: closeIds[0] },
          NOW,
        ),
        await enqueueReportWork(
          ctx,
          {
            storeId,
            kind: "accept",
            cycleStartDate: "2026-08-24",
            closeId: closeIds[0],
            cutoffObservedAt: NOW,
          },
          NOW,
        ),
        await enqueueReportWork(
          ctx,
          {
            storeId,
            kind: "accept",
            cycleStartDate: "2026-08-24",
            closeId: closeIds[1],
            cutoffObservedAt: NOW,
          },
          NOW,
        ),
      ];
      expect(new Set(distinct.map((row) => row.workId)).size).toBe(
        distinct.length,
      );
      const row = await ctx.db.get("reportPipelineWork", first.workId);
      expect(row?.workKey).toBe(JSON.stringify([String(storeId), "current"]));
      expect(row?.createdAt).toBe(NOW);
      expect(row?.updatedAt).toBe(NOW + 1);
    });
  });

  it("refuses a changed acceptance cutoff without mutating the original identity", async () => {
    const t = convexTest(schema, modules);
    const { storeId, closeIds } = await fixture(t);
    const input = {
      storeId,
      kind: "accept" as const,
      cycleStartDate: "2026-08-24",
      closeId: closeIds[1],
      cutoffObservedAt: NOW,
    };
    const original = await t.run((ctx) => enqueueReportWork(ctx, input, NOW));
    await expect(
      t.run((ctx) =>
        enqueueReportWork(
          ctx,
          { ...input, cutoffObservedAt: NOW + 1 },
          NOW + 1,
        ),
      ),
    ).rejects.toThrow("report_work_cutoff_conflict");
    const row = await t.run((ctx) =>
      ctx.db.get("reportPipelineWork", original.workId),
    );
    expect(row).toMatchObject({ cutoffObservedAt: NOW, generation: 1 });
    const claim = await claimOne(t, original);
    expect(
      await t.run((ctx) =>
        failReportWorkWithCtx(
          ctx,
          claim,
          { code: "missing_evidence", blocked: true },
          NOW,
        ),
      ),
    ).toBe("applied");
    const retry = await claimOne(t, original, NOW + REPORT_WORK_RETRY_BASE_MS);
    const retained = await t.run((ctx) =>
      getClaimedReportWorkWithCtx(ctx, retry, NOW + REPORT_WORK_RETRY_BASE_MS),
    );
    expect(retained).toMatchObject({ cutoffObservedAt: NOW, generation: 1 });
  });

  it("never lets an older generation acknowledge or fail a newer signal", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await fixture(t);
    const original = await t.run((ctx) =>
      enqueueReportWork(ctx, { storeId, kind: "current" }, NOW),
    );
    const old = await claimOne(t, original);
    const newer = await t.run((ctx) =>
      enqueueReportWork(ctx, { storeId, kind: "current" }, NOW + 1),
    );
    expect(
      await t.run((ctx) => completeReportWorkWithCtx(ctx, old, NOW + 1)),
    ).toBe("stale");
    expect(
      await t.run((ctx) =>
        failReportWorkWithCtx(
          ctx,
          old,
          { code: "capacity_exceeded", blocked: true },
          NOW + 1,
        ),
      ),
    ).toBe("stale");
    expect(
      await t.run((ctx) => ctx.db.get("reportPipelineWork", newer.workId)),
    ).toMatchObject({
      generation: 2,
      status: "pending",
      attempts: 0,
      eligibleAt: NOW + 1,
    });
    const live = await claimOne(t, newer, NOW + 1);
    expect(
      await t.run((ctx) => completeReportWorkWithCtx(ctx, live, NOW + 1)),
    ).toBe("applied");
    expect(
      await t.run((ctx) => completeReportWorkWithCtx(ctx, live, NOW + 1)),
    ).toBe("stale");
  });

  it("leases dispatch, fences expired duplicate schedules, and recovers a dropped schedule", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await fixture(t);
    const original = await t.run((ctx) =>
      enqueueReportWork(ctx, { storeId, kind: "overview" }, NOW),
    );
    const first = await t.run((ctx) =>
      claimReportWorkWithCtx(
        ctx,
        { storeId, kind: "overview", leaseMs: 100 },
        NOW,
      ),
    );
    expect(first.claims).toHaveLength(1);
    expect(
      (
        await t.run((ctx) =>
          claimReportWorkWithCtx(ctx, { storeId, kind: "overview" }, NOW + 99),
        )
      ).claims,
    ).toEqual([]);
    expect(
      await t.run((ctx) =>
        getClaimedReportWorkWithCtx(ctx, first.claims[0], NOW + 100),
      ),
    ).toBeNull();
    const recovered = await claimOne(t, original, NOW + 100);
    expect(recovered.dispatchFence).toBe(first.claims[0].dispatchFence + 1);
    expect(
      await t.run((ctx) =>
        completeReportWorkWithCtx(ctx, first.claims[0], NOW + 100),
      ),
    ).toBe("stale");
    expect(
      await t.run((ctx) =>
        completeReportWorkWithCtx(ctx, recovered, NOW + 100),
      ),
    ).toBe("applied");
    const recreated = await t.run((ctx) =>
      enqueueReportWork(ctx, { storeId, kind: "overview" }, NOW + 101),
    );
    expect(recreated.workId).not.toBe(original.workId);
    expect(
      await t.run((ctx) =>
        completeReportWorkWithCtx(ctx, recovered, NOW + 101),
      ),
    ).toBe("stale");
  });

  it("records a late failure once without allowing expired publication or overwriting a reclaimed fence", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await fixture(t);
    const work = await t.run((ctx) =>
      enqueueReportWork(ctx, { storeId, kind: "current" }, NOW),
    );
    const claim = await claimOne(t, work);
    const failedAt = NOW + REPORT_WORK_LEASE_MS + 1;
    expect(
      await t.run((ctx) => completeReportWorkWithCtx(ctx, claim, failedAt)),
    ).toBe("stale");
    expect(
      await t.run((ctx) =>
        failReportWorkWithCtx(
          ctx,
          claim,
          {
            code: "unexpected_failure",
          },
          failedAt,
        ),
      ),
    ).toBe("applied");
    expect(
      await t.run((ctx) =>
        failReportWorkWithCtx(
          ctx,
          claim,
          {
            code: "unexpected_failure",
          },
          failedAt + 1,
        ),
      ),
    ).toBe("stale");
    expect(
      await t.run((ctx) => ctx.db.get("reportPipelineWork", work.workId)),
    ).toMatchObject({
      attempts: 1,
      eligibleAt: failedAt + REPORT_WORK_RETRY_BASE_MS,
    });
    const retryAt = failedAt + REPORT_WORK_RETRY_BASE_MS;
    const reclaimed = await claimOne(t, work, retryAt);
    expect(
      await t.run((ctx) =>
        failReportWorkWithCtx(
          ctx,
          claim,
          {
            code: "capacity_exceeded",
            blocked: true,
          },
          retryAt,
        ),
      ),
    ).toBe("stale");
    expect(
      await t.run((ctx) =>
        getClaimedReportWorkWithCtx(ctx, reclaimed, retryAt),
      ),
    ).toMatchObject({
      attempts: 1,
      dispatchFence: reclaimed.dispatchFence,
      status: "pending",
    });
  });

  it("bounds and sanitizes failure backoff while keeping blocked work retryable", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await fixture(t);
    const original = await t.run((ctx) =>
      enqueueReportWork(ctx, { storeId, kind: "inventory" }, NOW),
    );
    let now = NOW;
    for (let attempt = 1; attempt <= 14; attempt += 1) {
      const claim = await claimOne(t, original, now);
      await t.run((ctx) =>
        failReportWorkWithCtx(
          ctx,
          claim,
          {
            code:
              attempt === 1
                ? "customer@example.test secret details"
                : "capacity_exceeded",
            blocked: true,
          },
          now,
        ),
      );
      const row = await t.run((ctx) =>
        ctx.db.get("reportPipelineWork", original.workId),
      );
      const delay = Math.min(
        REPORT_WORK_RETRY_BASE_MS * 2 ** (attempt - 1),
        REPORT_WORK_RETRY_MAX_MS,
      );
      expect(row).toMatchObject({
        status: "blocked",
        attempts: attempt,
        eligibleAt: now + delay,
        lastFailure: {
          code: attempt === 1 ? "unexpected_failure" : "capacity_exceeded",
          at: now,
        },
      });
      expect(JSON.stringify(row)).not.toContain("customer@example.test");
      expect(row?.leaseUntil).toBeUndefined();
      expect(
        (
          await t.run((ctx) =>
            claimReportWorkWithCtx(
              ctx,
              { storeId, kind: "inventory" },
              now + delay - 1,
            ),
          )
        ).claims,
      ).toEqual([]);
      now += delay;
    }
  });

  it("refuses cross-store and wrong-lane claims without exposing or clearing work", async () => {
    const t = convexTest(schema, modules);
    const { storeId, otherStoreId } = await fixture(t);
    const work = await t.run((ctx) =>
      enqueueReportWork(ctx, { storeId, kind: "current" }, NOW),
    );
    const claim = await claimOne(t, work);
    for (const forged of [
      { ...claim, storeId: otherStoreId },
      { ...claim, kind: "overview" as const },
    ]) {
      expect(
        await t.run((ctx) => getClaimedReportWorkWithCtx(ctx, forged, NOW)),
      ).toBeNull();
      expect(
        await t.run((ctx) => completeReportWorkWithCtx(ctx, forged, NOW)),
      ).toBe("stale");
      expect(
        await t.run((ctx) =>
          failReportWorkWithCtx(
            ctx,
            forged,
            { code: "capacity_exceeded" },
            NOW,
          ),
        ),
      ).toBe("stale");
    }
    expect(
      await t.run((ctx) => getClaimedReportWorkWithCtx(ctx, claim, NOW)),
    ).not.toBeNull();
  });

  it("claims only bounded store/lane eligibility and reports true oldest outstanding age", async () => {
    const t = convexTest(schema, modules);
    const { storeId, otherStoreId } = await fixture(t);
    await t.run(async (ctx) => {
      for (let index = 1; index <= 20; index += 1) {
        const operatingDate = `2026-08-${String(index).padStart(2, "0")}`;
        await enqueueReportWork(
          ctx,
          { storeId: otherStoreId, kind: "rollup", operatingDate },
          NOW - 100,
        );
        await enqueueReportWork(
          ctx,
          { storeId, kind: "rollup", operatingDate },
          NOW + index,
        );
      }
      await enqueueReportWork(ctx, { storeId, kind: "current" }, NOW - 200);
    });
    const first = await t.run(async (ctx) => {
      const recorder = recordReadCosts(ctx);
      const result = await claimReportWorkWithCtx(
        recorder.ctx,
        { storeId, kind: "rollup", limit: 999, leaseMs: 1_000_000 },
        NOW + 100,
      );
      return { result, cost: recorder.snapshot() };
    });
    expect(first.result.claims).toHaveLength(REPORT_WORK_CLAIM_LIMIT);
    expect(REPORT_WORK_CLAIM_LIMIT).toBe(4);
    expect(first.result.hasMore).toBe(true);
    expect(first.result.oldestAgeMs).toBe(99);
    expect(first.cost.byTable.reportPipelineWork).toMatchObject({
      calls: 2,
      returnedDocuments: REPORT_WORK_CLAIM_LIMIT + 2,
    });
    expect(Object.keys(first.cost.byTable)).toEqual(["reportPipelineWork"]);
    const leased = await t.run((ctx) =>
      ctx.db.get("reportPipelineWork", first.result.claims[0].workId),
    );
    expect(leased?.eligibleAt).toBe(NOW + 100 + 10 * 60_000);
    const next = await t.run((ctx) =>
      claimReportWorkWithCtx(ctx, { storeId, kind: "rollup" }, NOW + 101),
    );
    expect(next.claims).toHaveLength(1);
    expect(next.claims[0].workId).not.toBe(first.result.claims[0].workId);
    expect(next.oldestAgeMs).toBe(100); // includes the older outstanding lease
  });

  it("refuses malformed time/date inputs before writing or leasing", async () => {
    const t = convexTest(schema, modules);
    const { storeId, closeIds } = await fixture(t);
    for (const now of [-1, NaN, Infinity]) {
      await expect(
        t.run((ctx) =>
          enqueueReportWork(ctx, { storeId, kind: "current" }, now),
        ),
      ).rejects.toThrow("report_work_invalid_time");
      await expect(
        t.run((ctx) =>
          claimReportWorkWithCtx(ctx, { storeId, kind: "current" }, now),
        ),
      ).rejects.toThrow("report_work_invalid_time");
    }
    for (const leaseMs of [-1, 0, NaN, Infinity]) {
      await expect(
        t.run((ctx) =>
          claimReportWorkWithCtx(
            ctx,
            { storeId, kind: "current", leaseMs },
            NOW,
          ),
        ),
      ).rejects.toThrow("report_work_invalid_lease");
    }
    for (const operatingDate of [
      "2026-02-30",
      "2026-8-1",
      "2026-08-24|other",
    ]) {
      await expect(
        t.run((ctx) =>
          enqueueReportWork(
            ctx,
            { storeId, kind: "rollup", operatingDate },
            NOW,
          ),
        ),
      ).rejects.toThrow("report_work_invalid_date");
    }
    await expect(
      t.run((ctx) =>
        enqueueReportWork(
          ctx,
          {
            storeId,
            kind: "accept",
            cycleStartDate: "2026-08-24",
            closeId: closeIds[1],
            cutoffObservedAt: -1,
          },
          NOW,
        ),
      ),
    ).rejects.toThrow("report_work_invalid_time");
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineWork").take(1)),
    ).toEqual([]);
  });
});
