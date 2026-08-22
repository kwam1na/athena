import { v } from "convex/values";

import { internal } from "../_generated/api";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { toPesewas } from "../lib/currency";
import { toV2Config } from "../inventory/storeConfigV2";

/**
 * Cursor-batched, dry-run-capable, idempotent replacement for the legacy
 * `migrateAmountsToPesewas.ts` one-shot mutations.
 *
 * What the legacy module did, and why each part had to go (see
 * `migrateAmountsToPesewas.characterization.test.ts` in the history of this
 * ticket for the pinned behaviour):
 *
 * - It pulled every row of each money table with `.collect()` in a single
 *   mutation. On a grown table that is a Convex transaction-limit failure.
 *   Here every batch reads one bounded page and either stops or schedules its
 *   own successor.
 *
 * - Nothing recorded that a row had been converted, so a second run multiplied
 *   the same amount by 100 again. Here each converted row is stamped with
 *   `pesewasMigratedAt` in the SAME `ctx.db.patch` as the money fields, so the
 *   marker and the converted values commit or roll back together. Classification
 *   consults the marker before anything else, so a stamped row can never be
 *   re-selected. That is the idempotency guarantee, and it is structural rather
 *   than heuristic.
 *
 * - `productSku` decided conversion by asking whether `price < 10_000`, silently
 *   skipping anything below and silently converting anything above. Both
 *   branches were guesses about data the code could not actually distinguish,
 *   and both landed in the same undifferentiated `skipped` counter. Here a value
 *   that cannot be proven to be cedis is classified `ambiguous`, reported with a
 *   reason, and never written.
 */

/** Money values at or above this bound are reported rather than converted. */
const DEFAULT_AMBIGUOUS_AT_OR_ABOVE = 10_000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

type Row = Record<string, any> & { _id: any; _creationTime: number };

/**
 * Per-table description of where the money lives. `readValues` feeds
 * classification; `buildPatch` is only consulted once a row is known eligible,
 * and never adds the marker itself — the driver does that so no table spec can
 * forget it.
 */
type TableSpec = {
  table: string;
  readValues: (row: Row) => Array<number | undefined>;
  buildPatch: (row: Row) => Record<string, unknown>;
};

function flatMoney(table: string, fields: readonly string[]): TableSpec {
  return {
    table,
    readValues: (row) =>
      fields.map((field) =>
        typeof row[field] === "number" ? (row[field] as number) : undefined,
      ),
    buildPatch: (row) => {
      const patch: Record<string, unknown> = {};
      for (const field of fields) {
        if (typeof row[field] === "number") {
          patch[field] = toPesewas(row[field] as number);
        }
      }
      return patch;
    },
  };
}

function storeConfigMoney(row: Row) {
  const config = (row.config ?? undefined) as Record<string, any> | undefined;
  if (!config) return undefined;
  const v2 = toV2Config(config);
  const fees = v2.commerce.deliveryFees as Record<string, any>;
  const waive = v2.commerce.waiveDeliveryFees as any;
  return { config, fees, waive };
}

const STORE_SPEC: TableSpec = {
  table: "store",
  readValues: (row) => {
    const money = storeConfigMoney(row);
    if (!money) return [];
    const { fees, waive } = money;
    const values = [
      fees.withinAccra,
      fees.otherRegions,
      fees.international,
      typeof waive === "object" && waive ? waive.minimumOrderAmount : undefined,
    ];
    return values.map((value) =>
      typeof value === "number" ? value : undefined,
    );
  },
  buildPatch: (row) => {
    const money = storeConfigMoney(row);
    if (!money) return {};
    const { config, fees, waive } = money;
    const nextFees = {
      ...fees,
      ...(typeof fees.withinAccra === "number" && {
        withinAccra: toPesewas(fees.withinAccra),
      }),
      ...(typeof fees.otherRegions === "number" && {
        otherRegions: toPesewas(fees.otherRegions),
      }),
      ...(typeof fees.international === "number" && {
        international: toPesewas(fees.international),
      }),
    };
    const nextWaive =
      typeof waive === "object" &&
      waive &&
      typeof waive.minimumOrderAmount === "number"
        ? { ...waive, minimumOrderAmount: toPesewas(waive.minimumOrderAmount) }
        : waive;
    return {
      config: {
        ...config,
        commerce: {
          ...(config.commerce ?? {}),
          deliveryFees: nextFees,
          waiveDeliveryFees: nextWaive,
        },
      },
    };
  },
};

/**
 * `onlineOrder.amount` and `onlineOrder.paymentDue` are deliberately absent.
 * The legacy module had both conversions commented out, so those columns were
 * never converted in any environment; converting them here would be a new and
 * unreviewed data change rather than a refactor of an existing one.
 */
export const AMOUNT_TABLE_SPECS: readonly TableSpec[] = [
  flatMoney("checkoutSession", ["amount", "deliveryFee"]),
  flatMoney("checkoutSessionItem", ["price"]),
  flatMoney("onlineOrder", ["deliveryFee"]),
  flatMoney("onlineOrderItem", ["price"]),
  flatMoney("bagItem", ["price"]),
  flatMoney("productSku", ["price", "netPrice", "unitCost"]),
  STORE_SPEC,
];

export const AMOUNT_MONEY_TABLES = AMOUNT_TABLE_SPECS.map(
  (spec) => spec.table,
) as readonly string[];

export function specForTable(table: string): TableSpec {
  const spec = AMOUNT_TABLE_SPECS.find((candidate) => candidate.table === table);
  if (!spec) {
    throw new Error(
      `Unknown amount money table "${table}". Known: ${AMOUNT_MONEY_TABLES.join(", ")}`,
    );
  }
  return spec;
}

export type AmbiguityReason =
  | "nonFiniteValue"
  | "negativeValue"
  | "subPesewaPrecision"
  | "magnitudeIndistinguishable";

export type RowClassification =
  | { status: "alreadyMigrated" }
  | { status: "notEligible"; reason: "afterCutoff" | "noMoneyValues" }
  | { status: "ambiguous"; reason: AmbiguityReason }
  | { status: "eligible" };

/**
 * Decide what to do with one row, using only the row, the cutoff, and the
 * ambiguity bound — no wall clock, no table state — so the same row always
 * classifies the same way and the verifier can reuse it verbatim.
 *
 * Order matters. The marker is checked first so an already-converted row is
 * never re-examined on its converted values, which is what makes re-running the
 * backfill a no-op instead of a second multiplication by 100.
 */
export function classifyRow(
  spec: TableSpec,
  row: Row,
  args: { cutoffTimestamp: number; ambiguousAtOrAbove: number },
): RowClassification {
  if (row.pesewasMigratedAt !== undefined) return { status: "alreadyMigrated" };
  if (row._creationTime >= args.cutoffTimestamp) {
    // Written after the pesewas writers deployed, so already minor units.
    return { status: "notEligible", reason: "afterCutoff" };
  }

  const values = spec
    .readValues(row)
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) {
    return { status: "notEligible", reason: "noMoneyValues" };
  }

  for (const value of values) {
    if (!Number.isFinite(value)) {
      return { status: "ambiguous", reason: "nonFiniteValue" };
    }
    if (value < 0) {
      return { status: "ambiguous", reason: "negativeValue" };
    }
    // Converting 10.005 cedis silently rounds real money away.
    if (!Number.isInteger(Math.round(value * 100_000) / 1_000)) {
      return { status: "ambiguous", reason: "subPesewaPrecision" };
    }
    // A whole number this large is as plausibly pesewas left behind by an
    // earlier unmarked run as it is cedis. The legacy code resolved exactly
    // this case by guessing; we refuse to, and surface it instead.
    if (Number.isInteger(value) && value >= args.ambiguousAtOrAbove) {
      return { status: "ambiguous", reason: "magnitudeIndistinguishable" };
    }
  }

  return { status: "eligible" };
}

type BatchArgs = {
  ambiguousAtOrAbove?: number;
  ambiguousSoFar?: number;
  autoContinue?: boolean;
  convertedSoFar?: number;
  cursor?: string | null;
  cutoffTimestamp: number;
  dryRun?: boolean;
  eligibleSoFar?: number;
  limit?: number;
  processedSoFar?: number;
  skippedSoFar?: number;
  table: string;
};

function boundedLimit(limit?: number) {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(limit, MAX_LIMIT);
}

function boundedAmbiguity(value?: number) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_AMBIGUOUS_AT_OR_ABOVE;
  }
  return value;
}

async function amountPage(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  args: Pick<BatchArgs, "cursor" | "limit" | "table">,
) {
  return await (ctx.db.query(args.table as never) as any).paginate({
    cursor: args.cursor ?? null,
    numItems: boundedLimit(args.limit),
  });
}

function emptyReasonCounts() {
  return {
    magnitudeIndistinguishable: 0,
    negativeValue: 0,
    nonFiniteValue: 0,
    subPesewaPrecision: 0,
  } satisfies Record<AmbiguityReason, number>;
}

/**
 * One bounded batch. Defaults to a dry run: the caller must pass
 * `dryRun: false` to write anything, so an accidental invocation reports
 * instead of converting.
 */
export async function backfillAmountsToPesewasWithCtx(
  ctx: MutationCtx,
  args: BatchArgs,
) {
  const spec = specForTable(args.table);
  const dryRun = args.dryRun !== false;
  const ambiguousAtOrAbove = boundedAmbiguity(args.ambiguousAtOrAbove);
  const markerAt = Date.now();
  const page = await amountPage(ctx, args);

  let ambiguousCount = 0;
  let convertedCount = 0;
  let eligibleCount = 0;
  let skippedCount = 0;
  const ambiguousReasons = emptyReasonCounts();
  const ambiguousIds: string[] = [];

  for (const row of page.page as Row[]) {
    const classification = classifyRow(spec, row, {
      ambiguousAtOrAbove,
      cutoffTimestamp: args.cutoffTimestamp,
    });

    if (classification.status === "ambiguous") {
      ambiguousCount += 1;
      ambiguousReasons[classification.reason] += 1;
      // Bounded by the page size, so the summary stays a summary.
      ambiguousIds.push(String(row._id));
      continue;
    }
    if (classification.status !== "eligible") {
      skippedCount += 1;
      continue;
    }

    eligibleCount += 1;
    if (dryRun) continue;

    // Marker and money in one patch: a converted row is stamped in the same
    // transaction that converted it, so there is no window in which the row is
    // converted but re-selectable.
    await ctx.db.patch(args.table as never, row._id, {
      ...spec.buildPatch(row),
      pesewasMigratedAt: markerAt,
    } as never);
    convertedCount += 1;
  }

  const totals = {
    ambiguousCount: (args.ambiguousSoFar ?? 0) + ambiguousCount,
    convertedCount: (args.convertedSoFar ?? 0) + convertedCount,
    eligibleCount: (args.eligibleSoFar ?? 0) + eligibleCount,
    processedCount: (args.processedSoFar ?? 0) + page.page.length,
    skippedCount: (args.skippedSoFar ?? 0) + skippedCount,
  };

  // Run summary for the operator: emitted per batch so a long autoContinue
  // chain leaves a trail rather than one line at the very end.
  console.log(
    `[backfillAmountsToPesewas] ${JSON.stringify({
      ambiguousIds,
      ambiguousReasons,
      batch: {
        ambiguousCount,
        convertedCount,
        eligibleCount,
        processedCount: page.page.length,
        skippedCount,
      },
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
      internal.migrations.backfillAmountsToPesewas.backfillAmountsToPesewas,
      {
        ambiguousAtOrAbove: args.ambiguousAtOrAbove,
        ambiguousSoFar: totals.ambiguousCount,
        autoContinue: true,
        convertedSoFar: totals.convertedCount,
        cursor: page.continueCursor,
        cutoffTimestamp: args.cutoffTimestamp,
        dryRun: args.dryRun,
        eligibleSoFar: totals.eligibleCount,
        limit: args.limit,
        processedSoFar: totals.processedCount,
        skippedSoFar: totals.skippedCount,
        table: args.table,
      },
    );
  }

  return {
    ambiguousCount,
    ambiguousIds,
    ambiguousReasons,
    continueCursor: page.continueCursor,
    convertedCount,
    dryRun,
    eligibleCount,
    isDone: page.isDone,
    processedCount: page.page.length,
    skippedCount,
    table: args.table,
    // Cumulative across an `autoContinue` chain; equal to this batch when the
    // caller drives the cursor itself.
    totals,
  };
}

/**
 * Read-only verification. Answers "is this table drained?" from the data
 * itself rather than from a stored run record, using the SAME `classifyRow`
 * the backfill uses, so the two can never disagree about what remains.
 *
 * A successful migration leaves `eligibleCount` at zero on every page.
 * `ambiguousCount` may legitimately remain non-zero — those rows are for a
 * human to resolve, and the verifier's job is to keep reporting them.
 */
export async function verifyAmountsToPesewasWithCtx(
  ctx: QueryCtx,
  args: Pick<
    BatchArgs,
    "ambiguousAtOrAbove" | "cursor" | "cutoffTimestamp" | "limit" | "table"
  >,
) {
  const spec = specForTable(args.table);
  const ambiguousAtOrAbove = boundedAmbiguity(args.ambiguousAtOrAbove);
  const page = await amountPage(ctx, args);

  let ambiguousCount = 0;
  let eligibleCount = 0;
  let migratedCount = 0;
  const ambiguousReasons = emptyReasonCounts();

  for (const row of page.page as Row[]) {
    const classification = classifyRow(spec, row, {
      ambiguousAtOrAbove,
      cutoffTimestamp: args.cutoffTimestamp,
    });
    if (classification.status === "ambiguous") {
      ambiguousCount += 1;
      ambiguousReasons[classification.reason] += 1;
    } else if (classification.status === "eligible") {
      eligibleCount += 1;
    } else if (classification.status === "alreadyMigrated") {
      migratedCount += 1;
    }
  }

  return {
    ambiguousCount,
    ambiguousReasons,
    continueCursor: page.continueCursor,
    eligibleCount,
    isDone: page.isDone,
    migratedCount,
    processedCount: page.page.length,
    table: args.table,
  };
}

const batchArgs = {
  ambiguousAtOrAbove: v.optional(v.number()),
  ambiguousSoFar: v.optional(v.number()),
  autoContinue: v.optional(v.boolean()),
  convertedSoFar: v.optional(v.number()),
  cursor: v.optional(v.union(v.string(), v.null())),
  cutoffTimestamp: v.number(),
  dryRun: v.optional(v.boolean()),
  eligibleSoFar: v.optional(v.number()),
  limit: v.optional(v.number()),
  processedSoFar: v.optional(v.number()),
  skippedSoFar: v.optional(v.number()),
  table: v.string(),
};

export const backfillAmountsToPesewas = internalMutation({
  args: batchArgs,
  handler: backfillAmountsToPesewasWithCtx,
});

export const verifyAmountsToPesewas = internalQuery({
  args: {
    ambiguousAtOrAbove: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    cutoffTimestamp: v.number(),
    limit: v.optional(v.number()),
    table: v.string(),
  },
  handler: verifyAmountsToPesewasWithCtx,
});
