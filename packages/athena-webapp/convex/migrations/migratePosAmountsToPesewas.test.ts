import { describe, expect, it } from "vitest";

import {
  migratePosAmountTableWithCtx,
  pesewasPatchForRow,
  posAmountMigrationStatusWithCtx,
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

  const buildQuery = (name: string) => {
    // Return snapshot COPIES, faithful to Convex: `ctx.db.patch` writes to the DB
    // and does not mutate the objects a prior `collect()` returned. This is what
    // catches a completion counter that reads the stale post-collect snapshot.
    let rows = getRows(name).map((row) => ({ ...row }));
    const api = {
      withIndex(_index: string, fn?: (q: unknown) => unknown) {
        if (fn) {
          const eqs: Array<[string, unknown]> = [];
          fn({ eq: (field: string, value: unknown) => (eqs.push([field, value]), api) });
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
    };
    return api;
  };

  const db = {
    query: (name: string) => buildQuery(name),
    async patch(name: string, id: string, patch: Record<string, unknown>) {
      const row = getRows(name).find((candidate) => candidate._id === id);
      if (!row) throw new Error(`Missing ${name}:${id}`);
      Object.assign(row, patch);
    },
    async insert(name: string, value: Record<string, unknown>) {
      const id = `${name}-${nextId++}`;
      getRows(name).push({ _id: id, _creationTime: Date.now(), ...value } as Row);
      return id;
    },
  };
  return { ctx: { db } as never, tables };
}

describe("pesewasPatchForRow (U10)", () => {
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
          { expectedCash: 250.25, countedCash: 249.25, variance: -1, type: "closed", occurredAt: 1 },
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
    expect((patch.closeoutRecords as Array<Record<string, unknown>>)[0]).toEqual(
      expect.objectContaining({ expectedCash: 25025, countedCash: 24925, variance: -100 }),
    );
  });
});

describe("migratePosAmountTableWithCtx (U10)", () => {
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

    const first = await migratePosAmountTableWithCtx(ctx, {
      table: "posTransaction",
      cutoffTimestamp: CUTOFF,
    });
    expect(first).toEqual(
      expect.objectContaining({ migrated: 1, remaining: 0, complete: true }),
    );
    const row = tables.get("posTransaction")![0];
    expect(row.total).toBe(1000);
    expect(row.pesewasMigratedAt).toBeTypeOf("number");

    // Idempotent re-run: the marked row is skipped, no double-conversion.
    const second = await migratePosAmountTableWithCtx(ctx, {
      table: "posTransaction",
      cutoffTimestamp: CUTOFF,
    });
    expect(second).toEqual(
      expect.objectContaining({ migrated: 0, skipped: 1, remaining: 0, complete: true }),
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
      table: "posTransaction",
      cutoffTimestamp: CUTOFF,
    });
    expect(result).toEqual(
      expect.objectContaining({ migrated: 1, remaining: 0, complete: true }),
    );
    // Legacy converted; post-cutoff row left untouched.
    expect(tables.get("posTransaction")!.find((r) => r._id === "legacy")!.total).toBe(500);
    expect(tables.get("posTransaction")!.find((r) => r._id === "new")!.total).toBe(500);
    expect(
      tables.get("posTransaction")!.find((r) => r._id === "new")!.pesewasMigratedAt,
    ).toBeUndefined();
  });

  it("records a verifiable completion marker honored by the status query", async () => {
    const { ctx } = createCtx({
      registerSession: [
        { _id: "reg-1", _creationTime: CUTOFF - 1, openingFloat: 100, expectedCash: 100 },
      ],
      posAmountMigrationRun: [],
    });
    await migratePosAmountTableWithCtx(ctx, {
      table: "registerSession",
      cutoffTimestamp: CUTOFF,
    });
    const status = await posAmountMigrationStatusWithCtx(ctx);
    const registerStatus = status.find((entry) => entry.table === "registerSession");
    expect(registerStatus).toEqual(
      expect.objectContaining({ migrated: 1, remaining: 0, complete: true }),
    );
    // Tables that never ran report not-complete (guards the constraint-flip).
    expect(status.find((entry) => entry.table === "posTransaction")).toEqual(
      expect.objectContaining({ complete: false }),
    );
  });
});
