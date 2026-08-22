import { describe, expect, it, vi } from "vitest";

import {
  migratePosAmountTableWithCtx,
  needsPesewasConversion,
  pesewasPatchForRow,
  posAmountMigrationStatusWithCtx,
  verifyPosAmountsToPesewasWithCtx,
} from "./migratePosAmountsToPesewas";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

function createCtx(seed: Record<string, Row[]>) {
  const tables = new Map<string, Row[]>(
    Object.entries(seed).map(([name, rows]) => [
      name,
      rows.map((row) => ({ ...row })),
    ]),
  );
  let nextId = 1;
  const getRows = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };

  const paginate = vi.fn();

  const buildQuery = (name: string) => {
    // Return snapshot COPIES, faithful to Convex: `ctx.db.patch` writes to the DB
    // and does not mutate the objects a prior read returned.
    let rows = getRows(name).map((row) => ({ ...row }));
    const api = {
      withIndex(_index: string, fn?: (q: unknown) => unknown) {
        if (fn) {
          const eqs: Array<[string, unknown]> = [];
          fn({
            eq: (field: string, value: unknown) => (
              eqs.push([field, value]), api
            ),
          });
          rows = rows.filter((row) => eqs.every(([f, val]) => row[f] === val));
        }
        return api;
      },
      async collect() {
        return rows;
      },
      async first() {
        return rows[0] ?? null;
      },
      async paginate({
        cursor,
        numItems,
      }: {
        cursor: string | null;
        numItems: number;
      }) {
        paginate({ cursor, numItems, table: name });
        const start = cursor ? Number(cursor) : 0;
        const end = Math.min(start + numItems, rows.length);
        return {
          continueCursor: String(end),
          isDone: end >= rows.length,
          page: rows.slice(start, end),
        };
      },
    };
    return api;
  };

  const scheduled: Array<Record<string, unknown>> = [];
  const db = {
    query: (name: string) => buildQuery(name),
    async patch(name: string, id: string, patch: Record<string, unknown>) {
      const row = getRows(name).find((candidate) => candidate._id === id);
      if (!row) throw new Error(`Missing ${name}:${id}`);
      Object.assign(row, patch);
    },
    async insert(name: string, value: Record<string, unknown>) {
      const id = `${name}-${nextId++}`;
      getRows(name).push({
        _id: id,
        _creationTime: Date.now(),
        ...value,
      } as Row);
      return id;
    },
  };
  const scheduler = {
    runAfter: vi.fn(
      async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "job" as never;
      },
    ),
  };
  return { ctx: { db, scheduler } as never, paginate, scheduled, tables };
}

/** Drive an autoContinue chain to completion, as the scheduler would. */
async function runChain(
  harness: ReturnType<typeof createCtx>,
  args: Record<string, unknown>,
) {
  let next: Record<string, unknown> | undefined = args;
  let last: any;
  let batches = 0;
  while (next) {
    last = await migratePosAmountTableWithCtx(harness.ctx, next as any);
    batches += 1;
    next = harness.scheduled.shift();
    if (batches > 50) throw new Error("chain did not terminate");
  }
  return { batches, last };
}

describe("pesewasPatchForRow", () => {
  it("converts posTransaction money fields and payments to integer pesewas", () => {
    const patch = pesewasPatchForRow(
      "posTransaction",
      {
        subtotal: 10.5,
        tax: 0,
        total: 10.5,
        totalPaid: 20,
        changeGiven: 9.5,
        payments: [{ method: "cash", amount: 20, timestamp: 1 }],
      },
      1234,
    );
    expect(patch).toEqual(
      expect.objectContaining({
        subtotal: 1050,
        tax: 0,
        total: 1050,
        totalPaid: 2000,
        changeGiven: 950,
        payments: [{ method: "cash", amount: 2000, timestamp: 1 }],
        pesewasMigratedAt: 1234,
      }),
    );
  });

  it("converts registerSession drawer + closeout money, preserving variance = counted − expected under integer arithmetic", () => {
    const patch = pesewasPatchForRow(
      "registerSession",
      {
        openingFloat: 100,
        expectedCash: 250.25,
        countedCash: 249.25,
        variance: -1,
        closeoutRecords: [
          {
            expectedCash: 250.25,
            countedCash: 249.25,
            variance: -1,
            type: "closed",
            occurredAt: 1,
          },
        ],
      },
      1,
    );
    expect(patch.openingFloat).toBe(10000);
    expect(patch.expectedCash).toBe(25025);
    expect(patch.countedCash).toBe(24925);
    expect(patch.variance).toBe(-100);
    // Drawer variance stays exactly counted − expected after conversion.
    expect((patch.countedCash as number) - (patch.expectedCash as number)).toBe(
      patch.variance,
    );
    expect(
      (patch.closeoutRecords as Array<Record<string, unknown>>)[0],
    ).toEqual(
      expect.objectContaining({
        expectedCash: 25025,
        countedCash: 24925,
        variance: -100,
      }),
    );
  });
});

describe("needsPesewasConversion", () => {
  it("is false once the marker is present, whatever the creation time", () => {
    expect(
      needsPesewasConversion(
        { _creationTime: 1, pesewasMigratedAt: 99 },
        1_000_000,
      ),
    ).toBe(false);
  });

  it("is false for rows created at or after the cutoff", () => {
    expect(needsPesewasConversion({ _creationTime: 1_000_000 }, 1_000_000)).toBe(
      false,
    );
  });

  it("is true only for unmarked pre-cutoff rows", () => {
    expect(needsPesewasConversion({ _creationTime: 999_999 }, 1_000_000)).toBe(
      true,
    );
  });
});

describe("migratePosAmountTableWithCtx", () => {
  const CUTOFF = 1_000_000;

  it("converts a legacy cedis row and marks it, and re-running does not double-convert", async () => {
    const { ctx, tables } = createCtx({
      posTransaction: [
        {
          _id: "txn-1",
          _creationTime: CUTOFF - 1,
          subtotal: 10,
          tax: 0,
          total: 10,
          totalPaid: 10,
        },
      ],
      posAmountMigrationRun: [],
    });
    const args = {
      cutoffTimestamp: CUTOFF,
      dryRun: false,
      table: "posTransaction" as const,
    };

    const first = await migratePosAmountTableWithCtx(ctx, args);
    expect(first).toEqual(
      expect.objectContaining({ migrated: 1, remaining: 0, complete: true }),
    );
    const row = tables.get("posTransaction")![0];
    expect(row.total).toBe(1000);
    expect(row.pesewasMigratedAt).toBeTypeOf("number");

    // Idempotent re-run: the marked row is skipped, no double-conversion.
    const second = await migratePosAmountTableWithCtx(ctx, args);
    expect(second).toEqual(
      expect.objectContaining({
        migrated: 0,
        skipped: 1,
        remaining: 0,
        complete: true,
      }),
    );
    expect(tables.get("posTransaction")![0].total).toBe(1000);
  });

  it("skips rows created after the cutoff (already pesewas) and converts only legacy rows", async () => {
    const { ctx, tables } = createCtx({
      posTransaction: [
        { _id: "legacy", _creationTime: CUTOFF - 1, total: 5 },
        { _id: "new", _creationTime: CUTOFF + 1, total: 500 },
      ],
      posAmountMigrationRun: [],
    });

    const result = await migratePosAmountTableWithCtx(ctx, {
      cutoffTimestamp: CUTOFF,
      dryRun: false,
      table: "posTransaction",
    });
    expect(result).toEqual(
      expect.objectContaining({ migrated: 1, remaining: 0, complete: true }),
    );
    // Legacy converted; post-cutoff row left untouched.
    expect(
      tables.get("posTransaction")!.find((r) => r._id === "legacy")!.total,
    ).toBe(500);
    expect(
      tables.get("posTransaction")!.find((r) => r._id === "new")!.total,
    ).toBe(500);
    expect(
      tables.get("posTransaction")!.find((r) => r._id === "new")!
        .pesewasMigratedAt,
    ).toBeUndefined();
  });

  it("completes over multiple bounded pages and never reads the whole table", async () => {
    const harness = createCtx({
      posTransactionItem: Array.from({ length: 47 }, (_, index) => ({
        _id: `item-${index}`,
        _creationTime: CUTOFF - 1,
        unitPrice: 10,
        totalPrice: 10,
      })),
      posAmountMigrationRun: [],
    });

    const { batches, last } = await runChain(harness, {
      autoContinue: true,
      cutoffTimestamp: CUTOFF,
      dryRun: false,
      limit: 10,
      table: "posTransactionItem",
    });

    expect(batches).toBe(5); // ceil(47/10)
    for (const call of harness.paginate.mock.calls) {
      expect(call[0].numItems).toBe(10);
    }
    expect(last.isDone).toBe(true);
    expect(last.complete).toBe(true);
    expect(last.totals.migrated).toBe(47);
    expect(
      harness
        .tables!.get("posTransactionItem")!
        .every((row) => row.totalPrice === 1000),
    ).toBe(true);
  });

  it("caps the page size so a caller cannot reintroduce a full-table read", async () => {
    const harness = createCtx({
      posSession: [{ _id: "s1", _creationTime: CUTOFF - 1, total: 5 }],
      posAmountMigrationRun: [],
    });
    await migratePosAmountTableWithCtx(harness.ctx, {
      cutoffTimestamp: CUTOFF,
      limit: 100_000,
      table: "posSession",
    });
    expect(harness.paginate.mock.calls[0][0].numItems).toBe(100);
  });

  it("defaults to a dry run that writes nothing and never claims completion", async () => {
    const harness = createCtx({
      posSession: [{ _id: "s1", _creationTime: CUTOFF - 1, total: 5 }],
      posAmountMigrationRun: [],
    });

    const result = await migratePosAmountTableWithCtx(harness.ctx, {
      cutoffTimestamp: CUTOFF,
      table: "posSession",
    });

    expect(result.dryRun).toBe(true);
    expect(result.migrated).toBe(0);
    expect(result.pending).toBe(1);
    // A dry run must not be able to mark the constraint-flip gate as satisfied.
    expect(result.complete).toBe(false);
    expect(harness.tables!.get("posSession")![0].total).toBe(5);
    expect(
      harness.tables!.get("posSession")![0].pesewasMigratedAt,
    ).toBeUndefined();
  });

  it("records a verifiable completion marker honored by the status query", async () => {
    const { ctx } = createCtx({
      registerSession: [
        {
          _id: "reg-1",
          _creationTime: CUTOFF - 1,
          openingFloat: 100,
          expectedCash: 100,
        },
      ],
      posAmountMigrationRun: [],
    });
    await migratePosAmountTableWithCtx(ctx, {
      cutoffTimestamp: CUTOFF,
      dryRun: false,
      table: "registerSession",
    });
    const status = await posAmountMigrationStatusWithCtx(ctx);
    const registerStatus = status.find(
      (entry) => entry.table === "registerSession",
    );
    expect(registerStatus).toEqual(
      expect.objectContaining({ migrated: 1, remaining: 0, complete: true }),
    );
    // Tables that never ran report not-complete (guards the constraint-flip).
    expect(status.find((entry) => entry.table === "posTransaction")).toEqual(
      expect.objectContaining({ complete: false }),
    );
  });
});

describe("verifyPosAmountsToPesewasWithCtx", () => {
  const CUTOFF = 1_000_000;

  it("reports zero pending once the migration drains, and writes nothing", async () => {
    const harness = createCtx({
      posTransaction: Array.from({ length: 8 }, (_, index) => ({
        _id: `txn-${index}`,
        _creationTime: CUTOFF - 1,
        total: 10,
      })),
      posAmountMigrationRun: [],
    });
    const verifyArgs = {
      cutoffTimestamp: CUTOFF,
      limit: 100,
      table: "posTransaction" as const,
    };

    const before = await verifyPosAmountsToPesewasWithCtx(
      harness.ctx,
      verifyArgs,
    );
    expect(before.pendingCount).toBe(8);
    expect(before.migratedCount).toBe(0);

    await runChain(harness, {
      autoContinue: true,
      cutoffTimestamp: CUTOFF,
      dryRun: false,
      limit: 3,
      table: "posTransaction",
    });

    const after = await verifyPosAmountsToPesewasWithCtx(
      harness.ctx,
      verifyArgs,
    );
    expect(after.pendingCount).toBe(0);
    expect(after.migratedCount).toBe(8);
  });
});
