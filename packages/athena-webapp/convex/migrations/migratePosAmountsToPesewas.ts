// convex/migrations/migratePosAmountsToPesewas.ts
//
// Deterministic, idempotent, cursor-batched migration of the POS + cash-drawer
// money tables from cedis (major units) to integer pesewas (minor units).
//
// The POS tables (posTransaction, posTransactionItem, posSession, registerSession)
// were never covered by the online-order/checkout amount migration and still store
// cedis. They are converted by a DETERMINISTIC rule — a per-row `pesewasMigratedAt`
// marker plus a deployment cutoff timestamp — rather than a magnitude heuristic,
// and a completion marker per table records whether the table has drained.
//
// Batching contract matches migrations/backfillAmountsToPesewas.ts: one bounded
// page per invocation, dry run by default, and `autoContinue` to chain the rest.
// posTransaction and posTransactionItem are the largest money tables in the
// system, so a full-table read here is a Convex transaction-limit failure waiting
// for enough sales volume.
//
// IMPORTANT: this does NOT flip the schema money validators to integer-only. That
// constraint-flip is the production-orchestrated cutover (deploy pesewas writers +
// run this migration to a verified-complete state → THEN tighten the validators).
// Flipping the validators before every POS row is migrated would reject the legacy
// cedis rows on read. Do not run this against production data outside that cutover.
import { v } from "convex/values";

import { internal } from "../_generated/api";
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

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

type Row = Record<string, unknown>;

function toPesewasOptional(value: unknown): number | undefined {
  return typeof value === "number" ? toPesewas(value) : undefined;
}

function convertPayments(
  payments: unknown,
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(payments)) return undefined;
  return payments.map((payment) => {
    const record = payment as Record<string, unknown>;
    return typeof record.amount === "number"
      ? { ...record, amount: toPesewas(record.amount) }
      : record;
  });
}

function convertCloseoutRecords(
  records: unknown,
): Array<Record<string, unknown>> | undefined {
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
      ["openingFloat", "expectedCash", "countedCash", "variance"].forEach(
        assign,
      );
      const closeoutRecords = convertCloseoutRecords(row.closeoutRecords);
      if (closeoutRecords) patch.closeoutRecords = closeoutRecords;
      break;
    }
  }

  return patch;
}

/**
 * The single predicate the migration and the verifier both answer with, so the
 * two can never disagree about what still needs converting. The marker is
 * checked first: a stamped row is never re-examined, which is what makes a
 * re-run a no-op rather than a second multiplication by 100.
 */
export function needsPesewasConversion(
  row: { _creationTime: number; pesewasMigratedAt?: number },
  cutoffTimestamp: number,
): boolean {
  if (row.pesewasMigratedAt !== undefined) return false;
  return row._creationTime < cutoffTimestamp;
}

function boundedLimit(limit?: number) {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(limit, MAX_LIMIT);
}

type BatchArgs = {
  autoContinue?: boolean;
  cursor?: string | null;
  cutoffTimestamp: number;
  dryRun?: boolean;
  limit?: number;
  migratedSoFar?: number;
  pendingSoFar?: number;
  processedSoFar?: number;
  skippedSoFar?: number;
  startedAtBeginning?: boolean;
  table: PosMoneyTable;
};

async function posPage(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  args: Pick<BatchArgs, "cursor" | "limit" | "table">,
) {
  return await (ctx.db.query(args.table as never) as any).paginate({
    cursor: args.cursor ?? null,
    numItems: boundedLimit(args.limit),
  });
}

/**
 * `remaining` is advisory, but `posAmountMigrationStatus` reports it as the
 * cutover signal, so it must never state a number the run did not earn. The
 * field is optional precisely so a run can say "I did not measure this"
 * instead of defaulting to `0`, which reads as a positive claim of no work
 * left. Every branch below either writes a measurement it can stand behind or
 * writes nothing at all.
 */
type RemainingState = {
  cutoffChangedAt: number | undefined;
  remaining: number | undefined;
  remainingMeasuredAt: number | undefined;
};

function nextRemaining(input: {
  complete: boolean;
  cutoffChanged: boolean;
  drainedWithoutProof: boolean;
  existing: {
    cutoffChangedAt?: number;
    remaining?: number;
    remainingMeasuredAt?: number;
  } | null;
  measurementOnly: boolean;
  measuredWholeTable: boolean;
  now: number;
  remaining: number;
}): RemainingState {
  // Every key is always present in the result: on `ctx.db.patch` an explicit
  // `undefined` removes the field, which is how an invalidated measurement
  // stops being reported instead of lingering on the record.
  //
  // A run whose cutoff differs from the one on the record is answering a
  // different question about the same table, and the disagreement outlives the
  // batch that noticed it: the rest of that chain inherits the new cutoff and
  // would otherwise look consistent. `cutoffChangedAt` carries the conflict
  // forward until a whole-table dry run re-measures at the current cutoff,
  // which is the only evidence that settles which cutoff the board describes.
  const cutoffChangedAt = input.cutoffChanged
    ? input.now
    : input.existing?.cutoffChangedAt;
  const unmeasured = {
    cutoffChangedAt,
    remaining: undefined,
    remainingMeasuredAt: undefined,
  };
  // A record written before `remaining` became optional carries a number with
  // no `remainingMeasuredAt` — a figure from a run that never proved it, which
  // is exactly the unearned zero this pairing exists to eliminate. Carrying it
  // forward would launder it into a measurement and break the schema's stated
  // pairing, so an unpaired legacy number is dropped on first touch instead.
  const carriedMeasured = input.existing?.remainingMeasuredAt !== undefined;
  const carried = input.cutoffChanged
    ? unmeasured
    : {
        cutoffChangedAt,
        remaining: carriedMeasured ? input.existing?.remaining : undefined,
        remainingMeasuredAt: input.existing?.remainingMeasuredAt,
      };

  if (input.measurementOnly) {
    // Only a dry run that walked the whole table measured the whole table. A
    // cursor-scoped dry run counted one page and must not present that page's
    // pending count as the table's -- nor overwrite a real full-table figure.
    return input.measuredWholeTable
      ? {
          // A fresh whole-table count at the current cutoff resolves any
          // outstanding disagreement about which cutoff the record describes.
          cutoffChangedAt: undefined,
          remaining: input.remaining,
          remainingMeasuredAt: input.now,
        }
      : carried;
  }
  if (input.cutoffChanged || cutoffChangedAt !== undefined) {
    // Includes a "complete" chain run at a wrong cutoff: relative to the cutoff
    // it was handed, nothing was pending, but that says nothing about the
    // cutoff the earlier measurement used. The record stays unmeasured rather
    // than banking a zero the run did not earn under the disputed cutoff.
    return unmeasured;
  }
  if (input.complete) {
    // The chain walked the whole table from the beginning and left nothing
    // pending: a zero this run actually earned.
    return {
      cutoffChangedAt: undefined,
      remaining: 0,
      remainingMeasuredAt: input.now,
    };
  }
  if (input.drainedWithoutProof) {
    // Converted everything it saw but cannot prove coverage. The prior
    // measurement counted rows this run has since converted, so it is now
    // false; drop it rather than report a stale number as current.
    return unmeasured;
  }
  // Mid-chain applying batch: its own pending count is structurally zero, so
  // it carries the last real measurement forward untouched.
  return carried;
}

async function upsertMigrationRun(
  ctx: MutationCtx,
  input: {
    complete: boolean;
    cutoffTimestamp: number;
    drainedWithoutProof?: boolean;
    measuredWholeTable?: boolean;
    measurementOnly?: boolean;
    migrated: number;
    now: number;
    remaining: number;
    skipped: number;
    table: PosMoneyTable;
  },
) {
  const existing = await ctx.db
    .query("posAmountMigrationRun")
    .withIndex("by_table", (q) => q.eq("table", input.table))
    .first();
  const measurementOnly = input.measurementOnly === true;
  // Only a dry run can measure how much work is left -- an applying batch
  // converts what it sees, so its own "pending" is structurally zero. A dry
  // run therefore still records that measurement, but must never touch the
  // gate: `complete` and the cumulative counters are carried forward
  // untouched, so re-inspecting a finished table before cutover cannot clear
  // it. An applying batch owns the gate.
  const value = {
    complete: measurementOnly ? (existing?.complete ?? false) : input.complete,
    cutoffTimestamp: input.cutoffTimestamp,
    migrated: measurementOnly
      ? (existing?.migrated ?? 0)
      : (existing?.migrated ?? 0) + input.migrated,
    ...nextRemaining({
      complete: input.complete,
      cutoffChanged:
        existing != null && existing.cutoffTimestamp !== input.cutoffTimestamp,
      drainedWithoutProof: input.drainedWithoutProof === true,
      existing,
      measuredWholeTable: input.measuredWholeTable === true,
      measurementOnly,
      now: input.now,
      remaining: input.remaining,
    }),
    // Cumulative, exactly like `migrated`: two adjacent counters with
    // different scopes is a trap for whoever reads the record next.
    skipped: measurementOnly
      ? (existing?.skipped ?? 0)
      : (existing?.skipped ?? 0) + input.skipped,
    table: input.table,
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
 * Migrate one bounded page of one POS money table. A row is converted only when
 * it was created before the deployment cutoff (legacy cedis) AND is not already
 * marked. Defaults to a dry run: the caller must pass `dryRun: false` to write.
 *
 * The completion marker records `complete: true` only on the final page of an
 * applying chain that left nothing pending, so a dry run or an interrupted chain
 * can never claim the table is drained.
 */
export async function migratePosAmountTableWithCtx(
  ctx: MutationCtx,
  args: BatchArgs,
) {
  const now = Date.now();
  const dryRun = args.dryRun !== false;
  const page = await posPage(ctx, args);

  let migrated = 0;
  let skipped = 0;
  let pending = 0;

  for (const row of page.page as Array<
    Row & { _id: string; _creationTime: number; pesewasMigratedAt?: number }
  >) {
    if (!needsPesewasConversion(row, args.cutoffTimestamp)) {
      // Already marked, or created after the pesewas-writer deploy.
      skipped++;
      continue;
    }
    if (dryRun) {
      pending++;
      continue;
    }
    await ctx.db.patch(
      args.table as never,
      row._id as never,
      pesewasPatchForRow(args.table, row, now) as never,
    );
    migrated++;
  }

  const totals = {
    migrated: (args.migratedSoFar ?? 0) + migrated,
    pending: (args.pendingSoFar ?? 0) + pending,
    processed: (args.processedSoFar ?? 0) + page.page.length,
    skipped: (args.skippedSoFar ?? 0) + skipped,
  };

  // A chain only proves the table is drained when it walked the whole table.
  // Resuming from a caller-supplied cursor skips every page before it, so
  // reaching the last page says nothing about the rows behind the start point.
  const startedAtBeginning = args.startedAtBeginning ?? args.cursor == null;
  const complete =
    !dryRun && page.isDone && startedAtBeginning && totals.pending === 0;

  // A whole-table pending count exists only when the walk covered the whole
  // table: from the first page through the last. A cursor-scoped dry run
  // measured a slice, not the table.
  const walkedWholeTable = page.isDone && startedAtBeginning;
  const run = await upsertMigrationRun(ctx, {
    complete,
    cutoffTimestamp: args.cutoffTimestamp,
    // An applying chain that reached the end of what it walked with nothing
    // pending, yet could not prove coverage: it drained rows a prior
    // measurement had counted, so that measurement is now stale.
    drainedWithoutProof:
      !dryRun && page.isDone && !complete && totals.pending === 0,
    measuredWholeTable: dryRun && walkedWholeTable,
    measurementOnly: dryRun,
    migrated,
    now,
    remaining: totals.pending,
    skipped,
    table: args.table,
  });

  console.log(
    `[migratePosAmountsToPesewas] ${JSON.stringify({
      batch: {
        migrated,
        pending,
        processed: page.page.length,
        skipped,
      },
      complete: run.complete,
      dryRun,
      isDone: page.isDone,
      table: args.table,
      totals,
    })}`,
  );

  // Scheduled from inside the transaction this batch committed, so the chain
  // cannot skip a page: either the writes and their successor both land, or
  // neither does and the operator resumes from the last cursor.
  if (args.autoContinue && !page.isDone) {
    await ctx.scheduler.runAfter(
      0,
      internal.migrations.migratePosAmountsToPesewas
        .migratePosAmountsToPesewas,
      {
        autoContinue: true,
        cursor: page.continueCursor,
        cutoffTimestamp: args.cutoffTimestamp,
        dryRun: args.dryRun,
        limit: args.limit,
        migratedSoFar: totals.migrated,
        pendingSoFar: totals.pending,
        processedSoFar: totals.processed,
        skippedSoFar: totals.skipped,
        startedAtBeginning,
        table: args.table,
      },
    );
  }

  return {
    complete: run.complete,
    continueCursor: page.continueCursor,
    dryRun,
    isDone: page.isDone,
    migrated,
    pending,
    processed: page.page.length,
    remaining: totals.pending,
    skipped,
    table: args.table,
    totals,
  };
}

/**
 * Read-only verification for one bounded page. Answers "is this table drained?"
 * from the data itself rather than from the stored run record, using the same
 * `needsPesewasConversion` predicate the migration uses. Walk every page; a
 * drained table reports `pendingCount: 0` throughout.
 */
export async function verifyPosAmountsToPesewasWithCtx(
  ctx: QueryCtx,
  args: Pick<BatchArgs, "cursor" | "cutoffTimestamp" | "limit" | "table">,
) {
  const page = await posPage(ctx, args);
  let migratedCount = 0;
  let pendingCount = 0;

  for (const row of page.page as Array<{
    _creationTime: number;
    pesewasMigratedAt?: number;
  }>) {
    if (row.pesewasMigratedAt !== undefined) migratedCount++;
    else if (needsPesewasConversion(row, args.cutoffTimestamp)) pendingCount++;
  }

  return {
    continueCursor: page.continueCursor,
    isDone: page.isDone,
    migratedCount,
    pendingCount,
    processedCount: page.page.length,
    table: args.table,
  };
}

/**
 * The cutover board. `remaining: null` means "not measured" — never "measured
 * as zero"; only a number is a claim about outstanding work. `cutoffTimestamp`
 * is projected so a chain run against a wrong cutoff (which can still satisfy
 * the completion gate, because relative to that cutoff nothing was eligible)
 * cannot present as a clean board: the wrong cutoff is on the row.
 */
export async function posAmountMigrationStatusWithCtx(ctx: QueryCtx) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- one marker row per POS money table (bounded, tiny table)
  const runs = await ctx.db.query("posAmountMigrationRun").collect();
  const byTable = new Map(runs.map((run) => [run.table, run]));
  return POS_MONEY_TABLES.map((table) => {
    const run = byTable.get(table);
    return {
      complete: run?.complete ?? false,
      cutoffChangedAt: run?.cutoffChangedAt ?? null,
      cutoffTimestamp: run?.cutoffTimestamp ?? null,
      migrated: run?.migrated ?? 0,
      remaining: run?.remaining ?? null,
      remainingMeasuredAt: run?.remainingMeasuredAt ?? null,
      skipped: run?.skipped ?? 0,
      table,
      updatedAt: run?.updatedAt ?? null,
    };
  });
}

const posTableValidator = v.union(
  v.literal("posTransaction"),
  v.literal("posTransactionItem"),
  v.literal("posSession"),
  v.literal("registerSession"),
);

export const migratePosAmountsToPesewas = internalMutation({
  args: {
    autoContinue: v.optional(v.boolean()),
    cursor: v.optional(v.union(v.string(), v.null())),
    cutoffTimestamp: v.number(),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    migratedSoFar: v.optional(v.number()),
    pendingSoFar: v.optional(v.number()),
    processedSoFar: v.optional(v.number()),
    skippedSoFar: v.optional(v.number()),
    startedAtBeginning: v.optional(v.boolean()),
    table: posTableValidator,
  },
  handler: migratePosAmountTableWithCtx,
});

export const verifyPosAmountsToPesewas = internalQuery({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    cutoffTimestamp: v.number(),
    limit: v.optional(v.number()),
    table: posTableValidator,
  },
  handler: verifyPosAmountsToPesewasWithCtx,
});

export const posAmountMigrationStatus = internalQuery({
  args: {},
  handler: async (ctx) => posAmountMigrationStatusWithCtx(ctx),
});
