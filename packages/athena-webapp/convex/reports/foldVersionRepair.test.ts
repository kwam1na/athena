import { describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import { REPORTS_FOLD_VERSION } from "../../shared/reportsContract";
import {
  countStaleFoldVersionDaysWithCtx,
  countUncertifiedDaysWithCtx,
  markStaleFoldVersionDaysWithCtx,
  needsCertifiedRefold,
} from "./foldVersionRepair";

type DayRow = {
  _id: string;
  storeId: string;
  operatingDate: string;
  foldVersion: number;
  certifiedFoldRevision?: number;
  skuDayRowCount?: number;
};

type DirtyRow = {
  _id: string;
  storeId: string;
  operatingDate: string;
  reason: string;
  markedAt: number;
};

/**
 * A hand-rolled ctx, matching `migrations/backfillReportFactObservedAt.test.ts`:
 * the assertions that matter here are about the scheduler chain and about not
 * inserting a second queue row, both of which need a spy rather than a real
 * backend. The fake db honours the two indexes this module uses and nothing
 * else, so a query that drifts off them fails loudly.
 */
function createCtx(days: DayRow[], dirty: DirtyRow[] = []) {
  const dayRows = structuredClone(days);
  const dirtyRows = structuredClone(dirty);
  let nextId = 1;

  function indexEqs(builder: (q: any) => unknown) {
    const eqs: Record<string, unknown> = {};
    const q: any = {
      eq: (field: string, value: unknown) => {
        eqs[field] = value;
        return q;
      },
    };
    builder(q);
    return eqs;
  }

  function matches(row: Record<string, unknown>, eqs: Record<string, unknown>) {
    return Object.entries(eqs).every(([field, value]) => row[field] === value);
  }

  const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
    if (table !== "reportDirtyDay") throw new Error(`Unexpected insert ${table}`);
    const row = { _id: `dirty-${nextId++}`, ...value } as DirtyRow;
    dirtyRows.push(row);
    return row._id;
  });

  const patch = vi.fn(
    async (table: string, id: string, value: Record<string, unknown>) => {
      if (table !== "reportDirtyDay") throw new Error(`Unexpected patch ${table}`);
      const row = dirtyRows.find((candidate) => candidate._id === id);
      if (!row) throw new Error(`Missing dirty row ${id}`);
      Object.assign(row, value);
    },
  );

  const query = vi.fn((table: string) => {
    const rows: Record<string, unknown>[] =
      table === "reportDay"
        ? dayRows
        : table === "reportDirtyDay"
          ? dirtyRows
          : (() => {
              throw new Error(`Unexpected table ${table}`);
            })();

    return {
      withIndex: (indexName: string, builder: (q: any) => unknown) => {
        // Both tables expose exactly this index; anything else is a bug.
        if (indexName !== "by_storeId_operatingDate") {
          throw new Error(`Unexpected index ${indexName} on ${table}`);
        }
        const eqs = indexEqs(builder);
        const selected = rows
          .filter((row) => matches(row, eqs))
          .sort((a, b) =>
            String(a.operatingDate).localeCompare(String(b.operatingDate)),
          );

        return {
          paginate: async ({
            cursor,
            numItems,
          }: {
            cursor: string | null;
            numItems: number;
          }) => {
            const start = cursor ? Number(cursor) : 0;
            const end = Math.min(start + numItems, selected.length);
            return {
              continueCursor: String(end),
              isDone: end >= selected.length,
              page: selected.slice(start, end),
            };
          },
          unique: async () => {
            if (selected.length > 1) {
              throw new Error("unique() matched multiple rows");
            }
            return selected[0] ?? null;
          },
        };
      },
    };
  });

  const runAfter = vi.fn(async (..._args: unknown[]) => "job" as never);

  return {
    ctx: { db: { insert, patch, query }, scheduler: { runAfter } } as any,
    dayRows,
    dirtyRows,
    insert,
    patch,
    runAfter,
  };
}

const STORE = "store-1" as Id<"store">;
const OTHER_STORE = "store-2" as Id<"store">;

function day(
  operatingDate: string,
  foldVersion: number,
  storeId: string = String(STORE),
  certifiedFoldRevision?: number,
): DayRow {
  return {
    _id: `day-${storeId}-${operatingDate}`,
    storeId,
    operatingDate,
    foldVersion,
    ...(certifiedFoldRevision !== undefined ? { certifiedFoldRevision } : {}),
  };
}

/**
 * A fully repaired row: current fold version, a certified revision, AND the
 * U8 `skuDayRowCount`. A row missing any of the three is still refold-bait,
 * so this helper must carry all of them or every "leaves it alone" assertion
 * silently stops testing what it claims to.
 */
function certifiedDay(
  operatingDate: string,
  storeId: string = String(STORE),
): DayRow {
  return {
    ...day(operatingDate, REPORTS_FOLD_VERSION, storeId, 1),
    skuDayRowCount: 12,
  };
}

describe("fold version repair", () => {
  it("marks only the rows folded under a superseded version", async () => {
    const harness = createCtx([
      day("2026-07-01", 1),
      certifiedDay("2026-07-02"),
      day("2026-07-03", 1),
    ]);

    const result = await markStaleFoldVersionDaysWithCtx(harness.ctx, {
      storeId: STORE,
    });

    expect(result).toMatchObject({
      isDone: true,
      markedCount: 2,
      processedCount: 3,
      alreadyQueuedCount: 0,
      staleCount: 2,
      missingRevisionCount: 0,
    });
    // The current-version day must not enter the sweeper's queue at all.
    expect(
      harness.dirtyRows.map((row) => [row.operatingDate, row.reason]),
    ).toEqual([
      ["2026-07-01", "fold_version_bump"],
      ["2026-07-03", "fold_version_bump"],
    ]);
  });

  it("re-running leaves the existing mark untouched instead of duplicating or reordering it", async () => {
    const harness = createCtx([day("2026-07-01", 1)]);

    await markStaleFoldVersionDaysWithCtx(harness.ctx, { storeId: STORE });
    expect(harness.dirtyRows).toHaveLength(1);
    const firstMarkedAt = harness.dirtyRows[0]!.markedAt;

    vi.useFakeTimers();
    vi.setSystemTime(new Date(firstMarkedAt + 60_000));
    try {
      const second = await markStaleFoldVersionDaysWithCtx(harness.ctx, {
        storeId: STORE,
      });
      expect(second).toMatchObject({ markedCount: 0, alreadyQueuedCount: 1 });
    } finally {
      vi.useRealTimers();
    }

    expect(harness.dirtyRows).toHaveLength(1);
    // The sweeper drains oldest-markedAt first, so touching recency here would
    // send an already-waiting day to the back of the queue.
    expect(harness.dirtyRows[0]!.markedAt).toBe(firstMarkedAt);
    expect(harness.patch).not.toHaveBeenCalled();
    expect(harness.insert).toHaveBeenCalledTimes(1);
  });

  it("leaves a pre-existing mark's reason intact rather than duplicating the row", async () => {
    const harness = createCtx(
      [day("2026-07-01", 1)],
      [
        {
          _id: "dirty-existing",
          storeId: String(STORE),
          operatingDate: "2026-07-01",
          reason: "close_accepted",
          markedAt: 10,
        },
      ],
    );

    const result = await markStaleFoldVersionDaysWithCtx(harness.ctx, {
      storeId: STORE,
    });

    expect(result).toMatchObject({ markedCount: 0, alreadyQueuedCount: 1 });
    expect(harness.insert).not.toHaveBeenCalled();
    expect(harness.dirtyRows).toHaveLength(1);
    // A more specific cause survives; the day gets refolded either way.
    expect(harness.dirtyRows[0]!.reason).toBe("close_accepted");
    // And its queue position is preserved — a pending close fold must not be
    // pushed behind a bulk version repair.
    expect(harness.dirtyRows[0]!.markedAt).toBe(10);
    expect(harness.patch).not.toHaveBeenCalled();
  });

  it("marks a current-version day that was never revision-certified", async () => {
    // Cannot happen through the fold path (stamping ships with the bump), but
    // an ingest-created open day is exactly this shape until its first sweep;
    // the repair must be able to reach it rather than leaving it inadmissible.
    const harness = createCtx([
      day("2026-07-01", REPORTS_FOLD_VERSION),
      certifiedDay("2026-07-02"),
    ]);

    const result = await markStaleFoldVersionDaysWithCtx(harness.ctx, {
      storeId: STORE,
    });

    expect(result).toMatchObject({
      isDone: true,
      markedCount: 1,
      staleCount: 1,
      missingRevisionCount: 1,
    });
    expect(
      harness.dirtyRows.map((row) => [row.operatingDate, row.reason]),
    ).toEqual([["2026-07-01", "fold_version_bump"]]);
  });

  it("marks a certified day that predates the sku row count, and says why", async () => {
    // The U8 backfill: fully trustworthy rows whose only gap is the mix
    // probe's sizing hint. Counted separately from `missingRevisionCount` so
    // the operator does not read a performance backfill as a trust failure.
    const harness = createCtx([
      { ...certifiedDay("2026-07-01"), skuDayRowCount: undefined },
      certifiedDay("2026-07-02"),
    ]);

    const result = await markStaleFoldVersionDaysWithCtx(harness.ctx, {
      storeId: STORE,
    });

    expect(result).toMatchObject({
      isDone: true,
      markedCount: 1,
      staleCount: 1,
      missingRevisionCount: 0,
      missingSkuDayRowCountCount: 1,
    });
    expect(
      harness.dirtyRows.map((row) => [row.operatingDate, row.reason]),
    ).toEqual([["2026-07-01", "fold_version_bump"]]);
  });

  it("treats a zero sku row count as measured, not missing", async () => {
    // A day that folded no SKU rows stores 0. Confusing that with "unknown"
    // would put every quiet day into a permanent refold loop, and would make
    // the mix probe unable to prove exactly the ranges that are cheapest.
    const harness = createCtx([
      { ...certifiedDay("2026-07-01"), skuDayRowCount: 0 },
    ]);

    const result = await markStaleFoldVersionDaysWithCtx(harness.ctx, {
      storeId: STORE,
    });

    expect(result).toMatchObject({
      markedCount: 0,
      staleCount: 0,
      missingSkuDayRowCountCount: 0,
    });
    expect(harness.dirtyRows).toEqual([]);
  });

  it("drives itself to completion when autoContinue is set", async () => {
    const harness = createCtx([
      day("2026-07-01", 1),
      certifiedDay("2026-07-02"),
      day("2026-07-03", 1),
    ]);

    const first = await markStaleFoldVersionDaysWithCtx(harness.ctx, {
      autoContinue: true,
      limit: 2,
      storeId: STORE,
    });

    expect(first).toMatchObject({ isDone: false, markedCount: 1, staleCount: 1 });
    expect(harness.runAfter).toHaveBeenCalledTimes(1);
    const [, , scheduledArgs] = harness.runAfter.mock.calls[0]!;
    expect(scheduledArgs).toMatchObject({
      autoContinue: true,
      cursor: first.continueCursor,
      limit: 2,
      markedSoFar: 1,
      processedSoFar: 2,
      staleSoFar: 1,
      storeId: STORE,
    });

    const second = await markStaleFoldVersionDaysWithCtx(
      harness.ctx,
      scheduledArgs as never,
    );
    expect(second.isDone).toBe(true);
    expect(second.totals).toEqual({
      markedCount: 2,
      processedCount: 3,
      alreadyQueuedCount: 0,
      staleCount: 2,
      missingRevisionCount: 0,
    });
    // A finished chain must not schedule another link.
    expect(harness.runAfter).toHaveBeenCalledTimes(1);
    expect(harness.dirtyRows).toHaveLength(2);
  });

  it("never self-schedules unless autoContinue is requested", async () => {
    const harness = createCtx([day("2026-07-01", 1), day("2026-07-02", 1)]);

    const result = await markStaleFoldVersionDaysWithCtx(harness.ctx, {
      limit: 1,
      storeId: STORE,
    });

    expect(result.isDone).toBe(false);
    expect(harness.runAfter).not.toHaveBeenCalled();
  });

  it("leaves other stores' stale days untouched", async () => {
    const harness = createCtx([
      day("2026-07-01", 1),
      day("2026-07-01", 1, String(OTHER_STORE)),
      day("2026-07-02", 1, String(OTHER_STORE)),
    ]);

    const result = await markStaleFoldVersionDaysWithCtx(harness.ctx, {
      storeId: STORE,
    });

    expect(result).toMatchObject({ processedCount: 1, staleCount: 1 });
    expect(harness.dirtyRows.map((row) => row.storeId)).toEqual([String(STORE)]);
  });

  it("reports stale counts without writing anything", async () => {
    const harness = createCtx([
      day("2026-07-01", 1),
      day("2026-07-02", REPORTS_FOLD_VERSION),
      day("2026-07-03", 1),
    ]);

    const first = await countStaleFoldVersionDaysWithCtx(harness.ctx, {
      limit: 2,
      storeId: STORE,
    });
    expect(first).toMatchObject({
      isDone: false,
      processedCount: 2,
      staleCount: 1,
    });

    const second = await countStaleFoldVersionDaysWithCtx(harness.ctx, {
      cursor: first.continueCursor,
      limit: 2,
      storeId: STORE,
    });
    expect(second).toMatchObject({
      isDone: true,
      processedCount: 1,
      staleCount: 1,
    });

    expect(harness.insert).not.toHaveBeenCalled();
    expect(harness.patch).not.toHaveBeenCalled();
    expect(harness.runAfter).not.toHaveBeenCalled();
    expect(harness.dirtyRows).toEqual([]);
  });

  it("reports zero once every row carries the current version", async () => {
    const harness = createCtx([
      day("2026-07-01", REPORTS_FOLD_VERSION),
      day("2026-07-02", REPORTS_FOLD_VERSION),
    ]);

    await expect(
      countStaleFoldVersionDaysWithCtx(harness.ctx, { storeId: STORE }),
    ).resolves.toMatchObject({ isDone: true, staleCount: 0 });
  });

  it("exposes the repair predicate: stale version OR missing revision", () => {
    expect(needsCertifiedRefold(day("d", 1))).toBe(true);
    expect(needsCertifiedRefold(day("d", REPORTS_FOLD_VERSION))).toBe(true);
    expect(needsCertifiedRefold(certifiedDay("d"))).toBe(false);
  });
});

describe("certified revision coverage", () => {
  it("reports a mixed-generation store as not yet certified, without writing", async () => {
    const harness = createCtx([
      day("2026-07-01", 1), // legacy fold version
      day("2026-07-02", REPORTS_FOLD_VERSION), // current version, no revision
      certifiedDay("2026-07-03"),
    ]);

    const first = await countUncertifiedDaysWithCtx(harness.ctx, {
      limit: 2,
      storeId: STORE,
    });
    expect(first).toMatchObject({
      isDone: false,
      processedCount: 2,
      staleFoldVersionCount: 1,
      missingRevisionCount: 1,
      uncertifiedCount: 2,
      certifiedCount: 0,
    });

    const second = await countUncertifiedDaysWithCtx(harness.ctx, {
      cursor: first.continueCursor,
      limit: 2,
      storeId: STORE,
    });
    expect(second).toMatchObject({
      isDone: true,
      processedCount: 1,
      uncertifiedCount: 0,
      certifiedCount: 1,
    });

    // Any non-zero page means the store is not movement-ready.
    expect(first.uncertifiedCount + second.uncertifiedCount).toBeGreaterThan(0);
    expect(harness.insert).not.toHaveBeenCalled();
    expect(harness.patch).not.toHaveBeenCalled();
    expect(harness.runAfter).not.toHaveBeenCalled();
  });

  it("reports complete coverage once every row is certified under the current version", async () => {
    const harness = createCtx([
      certifiedDay("2026-07-01"),
      certifiedDay("2026-07-02"),
    ]);

    await expect(
      countUncertifiedDaysWithCtx(harness.ctx, { storeId: STORE }),
    ).resolves.toMatchObject({
      isDone: true,
      processedCount: 2,
      uncertifiedCount: 0,
      certifiedCount: 2,
    });
  });

  it("scopes coverage to the requested store", async () => {
    const harness = createCtx([
      certifiedDay("2026-07-01"),
      day("2026-07-01", 1, String(OTHER_STORE)),
    ]);

    await expect(
      countUncertifiedDaysWithCtx(harness.ctx, { storeId: STORE }),
    ).resolves.toMatchObject({ processedCount: 1, uncertifiedCount: 0 });
  });
});
