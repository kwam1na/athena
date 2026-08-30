import { afterEach, describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { SCHEDULED_CRON_INTERVAL_MINUTES } from "../automation/scheduledRunLedger";
import {
  PIPELINE_CRON_FAMILY_BY_LANE,
  recordPipelineBacklogWithCtx,
  recordPipelineOutcomeWithCtx,
} from "./pipelineEvidence";

type LedgerRecord = Omit<Doc<"scheduledRunLedger">, "_id" | "_creationTime">;

function ledgerFixture() {
  const rows = new Map<string, Doc<"scheduledRunLedger">>();
  const db = {
    query: vi.fn((table: string) => {
      expect(table).toBe("scheduledRunLedger");
      return {
        withIndex: (
          index: string,
          apply: (builder: {
            eq: (field: string, value: string) => unknown;
          }) => unknown,
        ) => {
          expect(index).toBe("by_runKey");
          let runKey = "";
          const builder = {
            eq: (field: string, value: string) => {
              expect(field).toBe("runKey");
              runKey = value;
              return builder;
            },
          };
          apply(builder);
          return { first: async () => rows.get(runKey) ?? null };
        },
      };
    }),
    insert: vi.fn(async (table: string, value: LedgerRecord) => {
      expect(table).toBe("scheduledRunLedger");
      const id = `ledger-${rows.size}` as Id<"scheduledRunLedger">;
      rows.set(value.runKey, { ...value, _id: id, _creationTime: 0 });
      return id;
    }),
    patch: vi.fn(
      async (
        table: string,
        id: Id<"scheduledRunLedger">,
        value: LedgerRecord,
      ) => {
        expect(table).toBe("scheduledRunLedger");
        const row = [...rows.values()].find(
          (candidate) => candidate._id === id,
        );
        if (!row) throw new Error("Missing fixture ledger row");
        rows.set(row.runKey, { ...row, ...value });
      },
    ),
    get: vi.fn(() => {
      throw new Error("Evidence must not hydrate source/store documents");
    }),
  };
  return { ctx: { db } as unknown as MutationCtx, db, rows };
}

afterEach(() => vi.restoreAllMocks());

describe("reports pipeline evidence", () => {
  it("accumulates outcomes within a five-minute store/lane window", async () => {
    const { ctx, db, rows } = ledgerFixture();
    const base = {
      storeId: "store-a" as Id<"store">,
      lane: "fold" as const,
      now: 600_001,
    };
    const firstId = await recordPipelineOutcomeWithCtx(ctx, {
      ...base,
      outcome: "applied",
    });
    await recordPipelineOutcomeWithCtx(ctx, {
      ...base,
      outcome: "blocked",
      oldestAgeMs: 1_000,
      saturated: true,
    });
    await recordPipelineOutcomeWithCtx(ctx, { ...base, outcome: "deferred" });
    await recordPipelineOutcomeWithCtx(ctx, { ...base, outcome: "stale" });
    await recordPipelineOutcomeWithCtx(ctx, { ...base, outcome: "failed" });
    const lastId = await recordPipelineOutcomeWithCtx(ctx, {
      ...base,
      now: 600_002,
      outcome: "applied",
      oldestAgeMs: 50,
    });

    expect(lastId).toBe(firstId);
    expect(rows.size).toBe(1);
    expect([...rows.values()][0]).toMatchObject({
      cronFamily: "reports-pipeline-fold",
      scope: "store",
      visibility: "support",
      storeId: base.storeId,
      scheduledWindowStartAt: 600_000,
      scheduledWindowEndAt: 900_000,
      candidateCount: 6,
      processedCount: 4,
      succeededCount: 2,
      failedCount: 1,
      skippedCount: 2,
      outcome: "partial_failure",
      snapshotCounts: {
        applied: 2,
        blocked: 1,
        failed: 1,
        stale: 1,
        deferred: 1,
        saturationCount: 1,
        oldestAgeMs: 1_000,
      },
      sampleSubjectIds: [],
      updatedAt: 600_002,
    });
    expect(db.query).toHaveBeenCalledTimes(12);
    expect(db.get).not.toHaveBeenCalled();
  });

  it("isolates every lane, stores, system scope, and subsequent windows", async () => {
    const { ctx, rows } = ledgerFixture();
    const storeId = "store-a" as Id<"store">;
    for (const lane of Object.keys(PIPELINE_CRON_FAMILY_BY_LANE) as Array<
      keyof typeof PIPELINE_CRON_FAMILY_BY_LANE
    >) {
      expect(
        SCHEDULED_CRON_INTERVAL_MINUTES[PIPELINE_CRON_FAMILY_BY_LANE[lane]],
      ).toBe(5);
      await recordPipelineOutcomeWithCtx(ctx, {
        storeId,
        lane,
        now: 899_999,
        outcome: "applied",
      });
    }
    await recordPipelineOutcomeWithCtx(ctx, {
      storeId: "store-b" as Id<"store">,
      lane: "fold",
      now: 899_999,
      outcome: "failed",
    });
    await recordPipelineOutcomeWithCtx(ctx, {
      lane: "fold",
      now: 899_999,
      outcome: "deferred",
    });
    await recordPipelineOutcomeWithCtx(ctx, {
      storeId,
      lane: "fold",
      now: 900_000,
      outcome: "blocked",
    });

    expect(rows.size).toBe(14);
    expect([...rows.values()].every((row) => row.candidateCount === 1)).toBe(
      true,
    );
    expect(
      [...rows.values()].find((row) => row.scope === "system"),
    ).toMatchObject({
      visibility: "support",
      processedCount: 0,
      skippedCount: 1,
      outcome: "support_only",
    });
    expect(
      [...rows.values()].find((row) => row.scheduledWindowStartAt === 900_000),
    ).toMatchObject({
      failedCount: 0,
      succeededCount: 0,
      outcome: "support_only",
      snapshotCounts: { blocked: 1 },
    });
  });

  it("keeps failure details private even after a later successful outcome", async () => {
    const { ctx, rows } = ledgerFixture();
    await recordPipelineOutcomeWithCtx(ctx, {
      lane: "current",
      now: 1,
      outcome: "failed",
      error: new Error("customer@example.test secret-source-payload"),
    });
    await recordPipelineOutcomeWithCtx(ctx, {
      lane: "current",
      now: 2,
      outcome: "applied",
    });
    const row = [...rows.values()][0];
    expect(row.error).toEqual({
      code: "reports_pipeline_failed",
      message: "Reports pipeline work failed.",
    });
    expect(JSON.stringify(row)).not.toContain("customer@example.test");
    expect(JSON.stringify(row)).not.toContain("secret-source-payload");
  });

  it("records latest bounded backlog samples without inventing processed outcomes", async () => {
    const { ctx, db, rows } = ledgerFixture();
    const base = { storeId: "store-a" as Id<"store">, lane: "fold" as const };
    await recordPipelineBacklogWithCtx(ctx, {
      ...base,
      now: 100,
      eligibleSampleCount: 3,
      oldestAgeMs: 500,
      saturated: true,
    });
    expect([...rows.values()][0]).toMatchObject({
      visibility: "support",
      candidateCount: 0,
      processedCount: 0,
      succeededCount: 0,
      outcome: "support_only",
      snapshotCounts: {
        backlogEligibleSampleCount: 3,
        backlogOldestAgeMs: 500,
        backlogSaturated: 1,
        backlogObservedAt: 100,
        saturationCount: 0,
      },
    });
    await recordPipelineOutcomeWithCtx(ctx, {
      ...base,
      now: 110,
      outcome: "applied",
    });
    await recordPipelineBacklogWithCtx(ctx, {
      ...base,
      now: 120,
      eligibleSampleCount: 0,
    });
    await recordPipelineBacklogWithCtx(ctx, {
      ...base,
      now: 105,
      eligibleSampleCount: 9,
      oldestAgeMs: 800,
      saturated: true,
    });
    expect(rows.size).toBe(1);
    expect([...rows.values()][0]).toMatchObject({
      candidateCount: 1,
      processedCount: 1,
      succeededCount: 1,
      outcome: "applied",
      updatedAt: 120,
      snapshotCounts: {
        applied: 1,
        backlogEligibleSampleCount: 0,
        backlogOldestAgeMs: 0,
        backlogSaturated: 0,
        backlogObservedAt: 120,
        saturationCount: 0,
      },
    });
    expect(db.query).toHaveBeenCalledTimes(8);
    expect(db.get).not.toHaveBeenCalled();
  });

  it("contains ledger errors without logging raw exception payloads", async () => {
    const { ctx, db } = ledgerFixture();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.query.mockImplementation(() => {
      throw new Error("private-payload");
    });
    expect(
      await recordPipelineOutcomeWithCtx(ctx, {
        lane: "legacy",
        now: 1,
        outcome: "applied",
      }),
    ).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-payload");
  });

  it("does not store non-finite ages or regress timestamps within a window", async () => {
    const { ctx, rows } = ledgerFixture();
    await recordPipelineOutcomeWithCtx(ctx, {
      lane: "inventory",
      now: 100,
      outcome: "applied",
      oldestAgeMs: Infinity,
    });
    await recordPipelineOutcomeWithCtx(ctx, {
      lane: "inventory",
      now: 90,
      outcome: "deferred",
      oldestAgeMs: -10,
    });
    const row = [...rows.values()][0];
    expect(row.updatedAt).toBe(100);
    expect(row.snapshotCounts.oldestAgeMs).toBe(0);
    expect(Object.values(row.snapshotCounts).every(Number.isFinite)).toBe(true);
  });
});
