import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";

import {
  buildScheduledRunKey,
  deriveScheduledRunOutcome,
  recordScheduledRunEvidenceWithCtx,
  resolveScheduledWindow,
  SCHEDULED_CRON_INTERVAL_MINUTES,
} from "./scheduledRunLedger";

function createLedgerCtx(existing?: Record<string, unknown>) {
  const rows = new Map<string, Record<string, unknown>>();
  if (existing) {
    rows.set(existing.runKey as string, existing);
  }

  const db = {
    query: vi.fn((table: string) => {
      expect(table).toBe("scheduledRunLedger");
      return {
        withIndex: vi.fn((_indexName: string, apply: Function) => {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(field: string, value: unknown) {
              filters[field] = value;
              return builder;
            },
          };
          apply(builder);
          return {
            first: vi.fn(async () => rows.get(filters.runKey as string) ?? null),
          };
        }),
      };
    }),
    insert: vi.fn(async (table: string, input: Record<string, unknown>) => {
      expect(table).toBe("scheduledRunLedger");
      const id = "scheduled-run-1";
      rows.set(input.runKey as string, { _id: id, ...input });
      return id;
    }),
    patch: vi.fn(
      async (table: string, id: string, input: Record<string, unknown>) => {
        expect(table).toBe("scheduledRunLedger");
      const row = Array.from(rows.values()).find((value) => value._id === id);
      if (!row) throw new Error(`Missing row ${id}`);
      rows.set(row.runKey as string, { ...row, ...input });
      },
    ),
  };

  return { ctx: { db } as never, db, rows };
}

describe("scheduled run ledger", () => {
  it("builds a stable run key for a cron family scheduled window and partition", () => {
    const window = resolveScheduledWindow({
      cronFamily: "release-checkout-items",
      now: 1_234_567,
    });

    expect(window).toEqual({
      scheduledWindowStartAt: 1_200_000,
      scheduledWindowEndAt: 1_800_000,
    });
    expect(
      buildScheduledRunKey({
        cronFamily: "release-checkout-items",
        scheduledWindowStartAt: window.scheduledWindowStartAt,
        scope: "store",
        storeId: "store-1",
      }),
    ).toBe("scheduled-run:release-checkout-items:1200000:store:store-1");
  });

  it("derives hourly windows and partitions for the report verification sweep", () => {
    expect(SCHEDULED_CRON_INTERVAL_MINUTES["report-verification-sweep"]).toBe(
      60,
    );

    // 1970-01-01T02:34:56Z folds down to the 02:00 hour boundary.
    const now = 2 * 3_600_000 + 34 * 60_000 + 56_000;
    const window = resolveScheduledWindow({
      cronFamily: "report-verification-sweep",
      now,
    });

    expect(window).toEqual({
      scheduledWindowStartAt: 7_200_000,
      scheduledWindowEndAt: 10_800_000,
    });

    // The sweep writes one system-scope summary plus per-store rows; both must
    // stay stable within the hour so a re-run patches instead of duplicating.
    expect(
      buildScheduledRunKey({
        cronFamily: "report-verification-sweep",
        scheduledWindowStartAt: window.scheduledWindowStartAt,
        scope: "system",
      }),
    ).toBe("scheduled-run:report-verification-sweep:7200000:system");
    expect(
      buildScheduledRunKey({
        cronFamily: "report-verification-sweep",
        scheduledWindowStartAt: resolveScheduledWindow({
          cronFamily: "report-verification-sweep",
          now: now + 60_000,
        }).scheduledWindowStartAt,
        scope: "store",
        storeId: "store-1",
      }),
    ).toBe("scheduled-run:report-verification-sweep:7200000:store:store-1");
  });

  it("derives meaningful no-candidate and partial-failure outcomes", () => {
    expect(
      deriveScheduledRunOutcome({
        candidateCount: 0,
        succeededCount: 0,
        failedCount: 0,
      }),
    ).toBe("no_candidates");
    expect(
      deriveScheduledRunOutcome({
        candidateCount: 3,
        succeededCount: 2,
        failedCount: 1,
      }),
    ).toBe("partial_failure");
    expect(
      deriveScheduledRunOutcome({
        candidateCount: 2,
        succeededCount: 0,
        failedCount: 2,
      }),
    ).toBe("failed");
  });

  it("inserts then updates evidence for the same run key", async () => {
    const { ctx, db, rows } = createLedgerCtx();

    await recordScheduledRunEvidenceWithCtx(ctx, {
      cronFamily: "complete-checkout-sessions",
      now: 1_800_001,
      scope: "store",
      storeId: "store-1" as Id<"store">,
      outcome: "applied",
      candidateCount: 1,
      processedCount: 1,
      succeededCount: 1,
      failedCount: 0,
      sourceSubjectType: "checkoutSession",
      sampleSubjectIds: ["checkout-1"],
    });
    await recordScheduledRunEvidenceWithCtx(ctx, {
      cronFamily: "complete-checkout-sessions",
      now: 1_800_002,
      scope: "store",
      storeId: "store-1" as Id<"store">,
      outcome: "partial_failure",
      candidateCount: 2,
      processedCount: 2,
      succeededCount: 1,
      failedCount: 1,
      sourceSubjectType: "checkoutSession",
      sampleSubjectIds: ["checkout-1", "checkout-2"],
    });

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.patch).toHaveBeenCalledTimes(1);
    expect(Array.from(rows.values())[0]).toMatchObject({
      outcome: "partial_failure",
      candidateCount: 2,
      processedCount: 2,
      succeededCount: 1,
      failedCount: 1,
      runKey: "scheduled-run:complete-checkout-sessions:1800000:store:store-1",
    });
  });
});
