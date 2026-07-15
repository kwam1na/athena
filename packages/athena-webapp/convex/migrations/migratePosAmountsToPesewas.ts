// convex/migrations/migratePosAmountsToPesewas.ts
//
// U10 (SAFE portion): deterministic, idempotent migration of the POS + cash-drawer
// money tables from cedis (major units) to integer pesewas (minor units).
//
// The POS tables (posTransaction, posTransactionItem, posSession, registerSession)
// were NEVER covered by migrateAmountsToPesewas.ts and still store cedis. This
// module converts them with a DETERMINISTIC rule — a per-row `pesewasMigratedAt`
// marker plus a deployment cutoff timestamp — instead of the fragile `< 10_000`
// heuristic, and records a verifiable completion marker per table.
//
// IMPORTANT: this does NOT flip the schema money validators to integer-only. That
// constraint-flip is the production-orchestrated cutover (deploy pesewas writers +
// run this migration to a verified-complete state → THEN tighten the validators).
// Flipping the validators before every POS row is migrated would reject the legacy
// cedis rows on read. Do not run this against production data outside that cutover.
import { v } from "convex/values";

import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../_generated/server";
import { toPesewas } from "../lib/currency";

export const POS_MONEY_TABLES = [
  "posTransaction",
  "posTransactionItem",
  "posSession",
  "registerSession",
] as const;

export type PosMoneyTable = (typeof POS_MONEY_TABLES)[number];

type Row = Record<string, unknown>;

function toPesewasOptional(value: unknown): number | undefined {
  return typeof value === "number" ? toPesewas(value) : undefined;
}

function convertPayments(payments: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(payments)) return undefined;
  return payments.map((payment) => {
    const record = payment as Record<string, unknown>;
    return typeof record.amount === "number"
      ? { ...record, amount: toPesewas(record.amount) }
      : record;
  });
}

function convertCloseoutRecords(records: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(records)) return undefined;
  return records.map((record) => {
    const closeout = record as Record<string, unknown>;
    return {
      ...closeout,
      expectedCash:
        typeof closeout.expectedCash === "number"
          ? toPesewas(closeout.expectedCash)
          : closeout.expectedCash,
      ...(typeof closeout.countedCash === "number"
        ? { countedCash: toPesewas(closeout.countedCash) }
        : {}),
      ...(typeof closeout.variance === "number"
        ? { variance: toPesewas(closeout.variance) }
        : {}),
    };
  });
}

/**
 * Compute the cedis→pesewas patch for a single row of a POS money table. Pure and
 * deterministic (no wall-clock, no heuristic) so it can be unit-tested directly.
 * Returns only the money fields that change plus the marker.
 */
export function pesewasPatchForRow(
  table: PosMoneyTable,
  row: Row,
  markerAt: number,
): Row {
  const patch: Row = { pesewasMigratedAt: markerAt };
  const assign = (key: string) => {
    const converted = toPesewasOptional(row[key]);
    if (converted !== undefined) patch[key] = converted;
  };

  switch (table) {
    case "posTransaction": {
      ["subtotal", "tax", "total", "totalPaid", "changeGiven"].forEach(assign);
      const payments = convertPayments(row.payments);
      if (payments) patch.payments = payments;
      break;
    }
    case "posTransactionItem": {
      ["unitPrice", "totalPrice", "discount"].forEach(assign);
      break;
    }
    case "posSession": {
      ["subtotal", "tax", "total"].forEach(assign);
      const payments = convertPayments(row.payments);
      if (payments) patch.payments = payments;
      break;
    }
    case "registerSession": {
      ["openingFloat", "expectedCash", "countedCash", "variance"].forEach(assign);
      const closeoutRecords = convertCloseoutRecords(row.closeoutRecords);
      if (closeoutRecords) patch.closeoutRecords = closeoutRecords;
      break;
    }
  }

  return patch;
}

async function upsertMigrationRun(
  ctx: MutationCtx,
  input: {
    table: PosMoneyTable;
    cutoffTimestamp: number;
    migrated: number;
    skipped: number;
    remaining: number;
    now: number;
  },
) {
  const existing = await ctx.db
    .query("posAmountMigrationRun")
    .withIndex("by_table", (q) => q.eq("table", input.table))
    .first();
  const value = {
    table: input.table,
    cutoffTimestamp: input.cutoffTimestamp,
    migrated: (existing?.migrated ?? 0) + input.migrated,
    skipped: input.skipped,
    remaining: input.remaining,
    complete: input.remaining === 0,
    updatedAt: input.now,
  };
  if (existing) {
    await ctx.db.patch("posAmountMigrationRun", existing._id, value);
  } else {
    await ctx.db.insert("posAmountMigrationRun", value);
  }
  return value;
}

/**
 * Migrate one POS money table. A row is converted only when it was created before
 * the deployment cutoff (legacy cedis) AND is not already marked — so the run is
 * deterministic and idempotent (re-running converts nothing already marked). The
 * completion marker records `complete: true` only once no legacy rows remain.
 */
export async function migratePosAmountTableWithCtx(
  ctx: MutationCtx,
  args: { table: PosMoneyTable; cutoffTimestamp: number },
) {
  const now = Date.now();
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- one-shot maintenance migration, mirrors migrateAmountsToPesewas.ts
  const rows = (await ctx.db.query(args.table).collect()) as Array<
    Row & { _id: string; _creationTime: number; pesewasMigratedAt?: number }
  >;

  let migrated = 0;
  let skipped = 0;
  let remaining = 0;

  for (const row of rows) {
    if (row.pesewasMigratedAt !== undefined) {
      skipped++;
      continue;
    }
    if (row._creationTime >= args.cutoffTimestamp) {
      // Created after the pesewas-writer deploy: already minor units, not legacy.
      skipped++;
      continue;
    }
    const patch = pesewasPatchForRow(args.table, row, now);
    await ctx.db.patch(args.table, row._id as never, patch as never);
    migrated++;
  }

  remaining = rows.filter(
    (row) =>
      row.pesewasMigratedAt === undefined &&
      row._creationTime < args.cutoffTimestamp,
  ).length;

  const run = await upsertMigrationRun(ctx, {
    table: args.table,
    cutoffTimestamp: args.cutoffTimestamp,
    migrated,
    skipped,
    remaining,
    now,
  });

  return { migrated, skipped, remaining, complete: run.complete };
}

export async function posAmountMigrationStatusWithCtx(ctx: QueryCtx) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- one marker row per POS money table (bounded, tiny table)
  const runs = await ctx.db.query("posAmountMigrationRun").collect();
  const byTable = new Map(runs.map((run) => [run.table, run]));
  return POS_MONEY_TABLES.map((table) => {
    const run = byTable.get(table);
    return {
      table,
      migrated: run?.migrated ?? 0,
      remaining: run?.remaining ?? null,
      complete: run?.complete ?? false,
    };
  });
}

export const migratePosAmountsToPesewas = internalMutation({
  args: { cutoffTimestamp: v.number(), table: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const tables = args.table
      ? (POS_MONEY_TABLES.filter((table) => table === args.table) as PosMoneyTable[])
      : [...POS_MONEY_TABLES];
    const results: Record<string, unknown> = {};
    for (const table of tables) {
      results[table] = await migratePosAmountTableWithCtx(ctx, {
        table,
        cutoffTimestamp: args.cutoffTimestamp,
      });
    }
    return results;
  },
});

export const posAmountMigrationStatus = internalQuery({
  args: {},
  handler: async (ctx) => posAmountMigrationStatusWithCtx(ctx),
});
