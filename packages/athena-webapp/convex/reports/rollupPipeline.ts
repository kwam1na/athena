import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  descendingSortKey,
  type ReportSkuDayMetrics,
} from "../../shared/reportsContract";
import { affectedPeriodKeys } from "./rollups";
import { stableStringHash } from "./fingerprint";
import { readPipelineControl } from "./pipelineControl";
import { enqueueReportWork } from "./pipelineWork";

export const ROLLUP_INPUT_CHUNK_SIZE = 100;
export const ROLLUP_DELETE_BATCH_SIZE = 100;
export const ROLLUP_REPAIR_DAY_BATCH_SIZE = 10;
export const MAX_ROLLUP_INPUT_ROWS = 2000;

type Scope = { storeId: Id<"store">; epoch: string };
type DayScope = Scope & { operatingDate: string };
type InputRow = ReportSkuDayMetrics & { productSkuId: Id<"productSku"> };
const numericKeys = [
  "unitsSold",
  "unitsReturned",
  "grossSalesMinor",
  "netSalesMinor",
  "refundsMinor",
  "uncostedRevenueMinor",
] as const;

function contribution(value: ReportSkuDayMetrics): ReportSkuDayMetrics {
  return {
    unitsSold: value.unitsSold,
    unitsReturned: value.unitsReturned,
    grossSalesMinor: value.grossSalesMinor,
    netSalesMinor: value.netSalesMinor,
    refundsMinor: value.refundsMinor,
    uncostedRevenueMinor: value.uncostedRevenueMinor,
    grossProfitMinor: value.grossProfitMinor,
  };
}
function assertRevision(revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 1)
    throw new Error("report_rollup_invalid_revision");
}
function assertDate(date: string) {
  const value = Date.parse(`${date}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(value) ||
    new Date(value).toISOString().slice(0, 10) !== date
  )
    throw new Error("report_rollup_invalid_date");
}
function assertNow(now: number) {
  if (!Number.isFinite(now) || now < 0)
    throw new Error("report_rollup_invalid_time");
}
export function configuredRollupEpochs(control: {
  activeRollupEpoch?: string;
  targetRollupEpoch?: string;
}): string[] {
  return [
    ...new Set(
      [control.activeRollupEpoch, control.targetRollupEpoch].filter(
        (epoch): epoch is string => !!epoch,
      ),
    ),
  ];
}
async function epochRow(ctx: MutationCtx, scope: Scope) {
  return ctx.db
    .query("reportRollupEpoch")
    .withIndex("by_storeId_epoch", (q) =>
      q.eq("storeId", scope.storeId).eq("epoch", scope.epoch),
    )
    .unique();
}
async function dayState(ctx: MutationCtx, scope: DayScope) {
  return ctx.db
    .query("reportRollupDayState")
    .withIndex("by_storeId_epoch_operatingDate", (q) =>
      q
        .eq("storeId", scope.storeId)
        .eq("epoch", scope.epoch)
        .eq("operatingDate", scope.operatingDate),
    )
    .unique();
}

/** Create an empty target, never associate new checkpoints with existing totals. */
export async function initializeRollupEpochWithCtx(
  ctx: MutationCtx,
  args: Scope,
  now: number,
) {
  assertNow(now);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(args.epoch))
    throw new Error("report_rollup_invalid_epoch");
  const control = await readPipelineControl(ctx, args.storeId);
  if (!control) throw new Error("report_rollup_missing_control");
  const existing = await epochRow(ctx, args);
  if (existing) {
    if (control.targetRollupEpoch !== args.epoch)
      throw new Error("report_rollup_epoch_reuse");
    return existing._id;
  }
  const [output, checkpoint, state, readiness, obligation] = await Promise.all([
    ctx.db
      .query("reportEpochSkuRollup")
      .withIndex("by_storeId_epoch_periodKey_productSkuId", (q) =>
        q.eq("storeId", args.storeId).eq("epoch", args.epoch),
      )
      .first(),
    ctx.db
      .query("reportRollupCheckpoint")
      .withIndex("by_storeId_epoch_operatingDate_productSkuId", (q) =>
        q.eq("storeId", args.storeId).eq("epoch", args.epoch),
      )
      .first(),
    ctx.db
      .query("reportRollupDayState")
      .withIndex("by_storeId_epoch_operatingDate", (q) =>
        q.eq("storeId", args.storeId).eq("epoch", args.epoch),
      )
      .first(),
    ctx.db
      .query("reportPeriodReadiness")
      .withIndex("by_storeId_epoch_periodKey", (q) =>
        q.eq("storeId", args.storeId).eq("epoch", args.epoch),
      )
      .first(),
    ctx.db
      .query("reportPeriodObligation")
      .withIndex("by_storeId_epoch_operatingDate", (q) =>
        q.eq("storeId", args.storeId).eq("epoch", args.epoch),
      )
      .first(),
  ]);
  if (output || checkpoint || state || readiness || obligation)
    throw new Error("report_rollup_epoch_not_empty");
  const id = await ctx.db.insert("reportRollupEpoch", {
    ...args,
    createdAt: now,
    backfillCursor: null,
    backfillComplete: false,
  });
  await ctx.db.patch("reportPipelineControl", control._id, {
    targetRollupEpoch: args.epoch,
    fence: control.fence + 1,
  });
  return id;
}

async function retainPeriodObligations(
  ctx: MutationCtx,
  scope: DayScope,
  revision: number,
  now: number,
) {
  for (const periodKey of affectedPeriodKeys([scope.operatingDate])) {
    const obligation = await ctx.db
      .query("reportPeriodObligation")
      .withIndex("by_storeId_epoch_periodKey_operatingDate", (q) =>
        q
          .eq("storeId", scope.storeId)
          .eq("epoch", scope.epoch)
          .eq("periodKey", periodKey)
          .eq("operatingDate", scope.operatingDate),
      )
      .unique();
    const ready = await ctx.db
      .query("reportPeriodReadiness")
      .withIndex("by_storeId_epoch_periodKey", (q) =>
        q
          .eq("storeId", scope.storeId)
          .eq("epoch", scope.epoch)
          .eq("periodKey", periodKey),
      )
      .unique();
    if (obligation) {
      if (obligation.revision > revision)
        throw new Error("report_rollup_stale_obligation");
      await ctx.db.patch("reportPeriodObligation", obligation._id, {
        revision,
      });
    } else
      await ctx.db.insert("reportPeriodObligation", {
        ...scope,
        periodKey,
        revision,
      });
    if (ready)
      await ctx.db.patch("reportPeriodReadiness", ready._id, {
        status: "pending",
        pendingDays: ready.pendingDays + (obligation ? 0 : 1),
        updatedAt: now,
      });
    else {
      if (obligation) throw new Error("report_rollup_missing_readiness");
      await ctx.db.insert("reportPeriodReadiness", {
        storeId: scope.storeId,
        epoch: scope.epoch,
        periodKey,
        status: "pending",
        pendingDays: 1,
        publicationRevision: 0,
        updatedAt: now,
      });
    }
  }
}

/** Called ONLY with the canonical fold's in-memory map in the fold transaction. */
export async function captureRollupInputWithCtx(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    operatingDate: string;
    revision: number;
    skuDays: ReadonlyMap<string, ReportSkuDayMetrics>;
  },
  now: number,
): Promise<Id<"reportRollupInput"> | null> {
  assertNow(now);
  assertDate(args.operatingDate);
  assertRevision(args.revision);
  const control = await readPipelineControl(ctx, args.storeId);
  if (!control) return null;
  if (args.skuDays.size > MAX_ROLLUP_INPUT_ROWS)
    throw new Error("report_rollup_input_capacity");
  const rows: InputRow[] = [...args.skuDays]
    .map(([skuId, value]) => {
      const productSkuId = ctx.db.normalizeId("productSku", skuId);
      if (
        !productSkuId ||
        numericKeys.some((key) => !Number.isFinite(value[key])) ||
        (value.grossProfitMinor !== null &&
          !Number.isFinite(value.grossProfitMinor))
      )
        throw new Error("report_rollup_invalid_input");
      return { productSkuId, ...contribution(value) };
    })
    .sort((a, b) =>
      a.productSkuId < b.productSkuId
        ? -1
        : a.productSkuId > b.productSkuId
          ? 1
          : 0,
    );
  const digest = stableStringHash(JSON.stringify(rows));
  const existing = await ctx.db
    .query("reportRollupInput")
    .withIndex("by_storeId_operatingDate_revision", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("operatingDate", args.operatingDate)
        .eq("revision", args.revision),
    )
    .unique();
  if (existing) {
    if (existing.digest !== digest || existing.rowCount !== rows.length)
      throw new Error("report_rollup_input_conflict");
    // The short digest is only a quick rejection, never equality authority.
    // Replayed revision identity is exact, bounded by the canonical day cap.
    const chunks = await ctx.db
      .query("reportRollupInputChunk")
      .withIndex("by_inputId_ordinal", (q) => q.eq("inputId", existing._id))
      .take(Math.ceil(MAX_ROLLUP_INPUT_ROWS / ROLLUP_INPUT_CHUNK_SIZE) + 1);
    if (
      existing.chunkCount !==
        Math.ceil(rows.length / ROLLUP_INPUT_CHUNK_SIZE) ||
      chunks.length !== existing.chunkCount ||
      chunks.some(
        (chunk, ordinal) =>
          chunk.storeId !== args.storeId ||
          chunk.ordinal !== ordinal ||
          chunk.rows.length !==
            Math.min(
              ROLLUP_INPUT_CHUNK_SIZE,
              rows.length - ordinal * ROLLUP_INPUT_CHUNK_SIZE,
            ) ||
          chunk.rows.some((row, index) => {
            const expected = rows[ordinal * ROLLUP_INPUT_CHUNK_SIZE + index];
            return (
              !expected ||
              row.productSkuId !== expected.productSkuId ||
              !equalContribution(row, expected)
            );
          }),
      )
    )
      throw new Error("report_rollup_input_conflict");
    return existing._id;
  }
  const current = await ctx.db
    .query("reportRollupInputCurrent")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", args.storeId).eq("operatingDate", args.operatingDate),
    )
    .unique();
  if (current && current.revision >= args.revision)
    throw new Error("report_rollup_stale_input");
  const inputId = await ctx.db.insert("reportRollupInput", {
    storeId: args.storeId,
    operatingDate: args.operatingDate,
    revision: args.revision,
    rowCount: rows.length,
    chunkCount: Math.ceil(rows.length / ROLLUP_INPUT_CHUNK_SIZE),
    digest,
    createdAt: now,
  });
  for (let start = 0; start < rows.length; start += ROLLUP_INPUT_CHUNK_SIZE) {
    await ctx.db.insert("reportRollupInputChunk", {
      storeId: args.storeId,
      inputId,
      ordinal: start / ROLLUP_INPUT_CHUNK_SIZE,
      rows: rows.slice(start, start + ROLLUP_INPUT_CHUNK_SIZE),
    });
  }
  if (current)
    await ctx.db.patch("reportRollupInputCurrent", current._id, {
      inputId,
      revision: args.revision,
    });
  else
    await ctx.db.insert("reportRollupInputCurrent", {
      storeId: args.storeId,
      operatingDate: args.operatingDate,
      inputId,
      revision: args.revision,
    });
  for (const epoch of configuredRollupEpochs(control)) {
    if (!(await epochRow(ctx, { storeId: args.storeId, epoch })))
      throw new Error("report_rollup_missing_epoch");
    await retainPeriodObligations(
      ctx,
      { storeId: args.storeId, epoch, operatingDate: args.operatingDate },
      args.revision,
      now,
    );
  }
  await enqueueReportWork(
    ctx,
    {
      storeId: args.storeId,
      kind: "rollup",
      operatingDate: args.operatingDate,
    },
    now,
  );
  await ctx.db.patch("reportPipelineControl", control._id, {
    sourceWatermark: control.sourceWatermark + 1,
  });
  return inputId;
}

function equalContribution(a: ReportSkuDayMetrics, b: ReportSkuDayMetrics) {
  return (
    numericKeys.every((key) => a[key] === b[key]) &&
    a.grossProfitMinor === b.grossProfitMinor
  );
}
async function applyDelta(
  ctx: MutationCtx,
  scope: DayScope,
  skuId: Id<"productSku">,
  old: ReportSkuDayMetrics | null,
  next: ReportSkuDayMetrics | null,
) {
  if (old && next && equalContribution(old, next)) return;
  for (const periodKey of affectedPeriodKeys([scope.operatingDate])) {
    const existing = await ctx.db
      .query("reportEpochSkuRollup")
      .withIndex("by_storeId_epoch_periodKey_productSkuId", (q) =>
        q
          .eq("storeId", scope.storeId)
          .eq("epoch", scope.epoch)
          .eq("periodKey", periodKey)
          .eq("productSkuId", skuId),
      )
      .unique();
    if (old && !existing) throw new Error("report_rollup_missing_output");
    const numeric = {
      unitsSold: 0,
      unitsReturned: 0,
      grossSalesMinor: 0,
      netSalesMinor: 0,
      refundsMinor: 0,
      uncostedRevenueMinor: 0,
    };
    for (const key of numericKeys)
      numeric[key] =
        (existing?.[key] ?? 0) - (old?.[key] ?? 0) + (next?.[key] ?? 0);
    const knownProfitMinor =
      (existing?.knownProfitMinor ?? 0) -
      (old?.grossProfitMinor ?? 0) +
      (next?.grossProfitMinor ?? 0);
    const unknownProfitDays =
      (existing?.unknownProfitDays ?? 0) -
      (old?.grossProfitMinor === null ? 1 : 0) +
      (next?.grossProfitMinor === null ? 1 : 0);
    const contributingDays =
      (existing?.contributingDays ?? 0) - (old ? 1 : 0) + (next ? 1 : 0);
    if (
      numericKeys.some((key) => !Number.isFinite(numeric[key])) ||
      !Number.isFinite(knownProfitMinor)
    )
      throw new Error("report_rollup_numeric_overflow");
    if (
      contributingDays < 0 ||
      unknownProfitDays < 0 ||
      unknownProfitDays > contributingDays
    )
      throw new Error("report_rollup_invalid_checkpoint");
    if (contributingDays === 0) {
      if (
        numericKeys.some((key) => numeric[key] !== 0) ||
        knownProfitMinor !== 0 ||
        unknownProfitDays !== 0
      )
        throw new Error("report_rollup_unbalanced_delete");
      if (existing) await ctx.db.delete("reportEpochSkuRollup", existing._id);
      continue;
    }
    const fields = {
      ...numeric,
      knownProfitMinor,
      unknownProfitDays,
      contributingDays,
      grossProfitMinor: unknownProfitDays > 0 ? null : knownProfitMinor,
      revenueSortKey: descendingSortKey(numeric.netSalesMinor),
      unitsSortKey: descendingSortKey(numeric.unitsSold),
    };
    if (existing)
      await ctx.db.patch("reportEpochSkuRollup", existing._id, fields);
    else
      await ctx.db.insert("reportEpochSkuRollup", {
        storeId: scope.storeId,
        epoch: scope.epoch,
        periodKey,
        productSkuId: skuId,
        ...fields,
      });
  }
}
async function finishPeriods(
  ctx: MutationCtx,
  scope: DayScope,
  revision: number,
  now: number,
) {
  for (const periodKey of affectedPeriodKeys([scope.operatingDate])) {
    const obligation = await ctx.db
      .query("reportPeriodObligation")
      .withIndex("by_storeId_epoch_periodKey_operatingDate", (q) =>
        q
          .eq("storeId", scope.storeId)
          .eq("epoch", scope.epoch)
          .eq("periodKey", periodKey)
          .eq("operatingDate", scope.operatingDate),
      )
      .unique();
    if (!obligation || obligation.revision !== revision)
      throw new Error("report_rollup_obligation_mismatch");
    const ready = await ctx.db
      .query("reportPeriodReadiness")
      .withIndex("by_storeId_epoch_periodKey", (q) =>
        q
          .eq("storeId", scope.storeId)
          .eq("epoch", scope.epoch)
          .eq("periodKey", periodKey),
      )
      .unique();
    if (!ready || ready.pendingDays < 1)
      throw new Error("report_rollup_readiness_mismatch");
    const pendingDays = ready.pendingDays - 1;
    await ctx.db.delete("reportPeriodObligation", obligation._id);
    await ctx.db.patch("reportPeriodReadiness", ready._id, {
      pendingDays,
      status: pendingDays === 0 ? "ready" : "pending",
      publicationRevision:
        ready.publicationRevision + (pendingDays === 0 ? 1 : 0),
      updatedAt: now,
    });
  }
}

/** One immutable chunk or one cursor-bounded checkpoint deletion page. */
export async function applyRollupDayBatchWithCtx(
  ctx: MutationCtx,
  args: DayScope,
  now: number,
): Promise<"more" | "done"> {
  assertNow(now);
  assertDate(args.operatingDate);
  if (!(await epochRow(ctx, args)))
    throw new Error("report_rollup_missing_epoch");
  const current = await ctx.db
    .query("reportRollupInputCurrent")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", args.storeId).eq("operatingDate", args.operatingDate),
    )
    .unique();
  if (!current) throw new Error("report_rollup_missing_input");
  const input = await ctx.db.get("reportRollupInput", current.inputId);
  if (
    !input ||
    input.storeId !== args.storeId ||
    input.operatingDate !== args.operatingDate ||
    input.revision !== current.revision
  )
    throw new Error("report_rollup_input_ownership");
  if (
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    !Number.isSafeInteger(input.rowCount) ||
    input.rowCount < 0 ||
    input.rowCount > MAX_ROLLUP_INPUT_ROWS ||
    input.chunkCount !== Math.ceil(input.rowCount / ROLLUP_INPUT_CHUNK_SIZE)
  )
    throw new Error("report_rollup_invalid_input");
  let state = await dayState(ctx, args);
  if (
    state?.inputId === input._id &&
    (state.revision !== input.revision ||
      !Number.isSafeInteger(state.nextChunk) ||
      state.nextChunk < 0 ||
      state.nextChunk > input.chunkCount ||
      (state.phase !== "apply" && state.nextChunk !== input.chunkCount))
  )
    throw new Error("report_rollup_invalid_checkpoint");
  if (state?.inputId === input._id && state.phase === "done") return "done";
  if (!state || state.inputId !== input._id) {
    await retainPeriodObligations(ctx, args, input.revision, now);
    const fields = {
      inputId: input._id,
      revision: input.revision,
      phase: "apply" as const,
      nextChunk: 0,
      deleteCursor: null,
      updatedAt: now,
    };
    if (state) {
      await ctx.db.patch("reportRollupDayState", state._id, fields);
      state = { ...state, ...fields };
    } else {
      const id = await ctx.db.insert("reportRollupDayState", {
        ...args,
        ...fields,
      });
      state = { ...args, ...fields, _id: id, _creationTime: now };
    }
  }
  if (state.phase === "apply" && state.nextChunk < input.chunkCount) {
    const chunk = await ctx.db
      .query("reportRollupInputChunk")
      .withIndex("by_inputId_ordinal", (q) =>
        q.eq("inputId", input._id).eq("ordinal", state.nextChunk),
      )
      .unique();
    const expectedRows = Math.min(
      ROLLUP_INPUT_CHUNK_SIZE,
      input.rowCount - state.nextChunk * ROLLUP_INPUT_CHUNK_SIZE,
    );
    if (
      !chunk ||
      chunk.storeId !== args.storeId ||
      chunk.inputId !== input._id ||
      chunk.rows.length !== expectedRows ||
      chunk.rows.some(
        (row, index) =>
          numericKeys.some((key) => !Number.isFinite(row[key])) ||
          (row.grossProfitMinor !== null &&
            !Number.isFinite(row.grossProfitMinor)) ||
          (index > 0 && row.productSkuId <= chunk.rows[index - 1].productSkuId),
      )
    )
      throw new Error("report_rollup_incomplete_chunk");
    for (const row of chunk.rows) {
      const checkpoint = await ctx.db
        .query("reportRollupCheckpoint")
        .withIndex("by_storeId_epoch_operatingDate_productSkuId", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("epoch", args.epoch)
            .eq("operatingDate", args.operatingDate)
            .eq("productSkuId", row.productSkuId),
        )
        .unique();
      await applyDelta(ctx, args, row.productSkuId, checkpoint, row);
      if (checkpoint)
        await ctx.db.patch("reportRollupCheckpoint", checkpoint._id, {
          ...contribution(row),
          revision: input.revision,
        });
      else
        await ctx.db.insert("reportRollupCheckpoint", {
          ...args,
          productSkuId: row.productSkuId,
          revision: input.revision,
          ...contribution(row),
        });
    }
    await ctx.db.patch("reportRollupDayState", state._id, {
      nextChunk: state.nextChunk + 1,
      phase: state.nextChunk + 1 === input.chunkCount ? "delete" : "apply",
      updatedAt: now,
    });
    return "more";
  }
  const page = await ctx.db
    .query("reportRollupCheckpoint")
    .withIndex("by_storeId_epoch_operatingDate_productSkuId", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("epoch", args.epoch)
        .eq("operatingDate", args.operatingDate),
    )
    .paginate({
      cursor: state.deleteCursor,
      numItems: ROLLUP_DELETE_BATCH_SIZE,
    });
  for (const old of page.page) {
    if (old.revision === input.revision) continue;
    await applyDelta(ctx, args, old.productSkuId, old, null);
    await ctx.db.delete("reportRollupCheckpoint", old._id);
  }
  if (page.isDone) {
    await finishPeriods(ctx, args, input.revision, now);
    await ctx.db.patch("reportRollupDayState", state._id, {
      phase: "done",
      deleteCursor: null,
      updatedAt: now,
    });
    return "done";
  }
  await ctx.db.patch("reportRollupDayState", state._id, {
    phase: "delete",
    deleteCursor: page.continueCursor,
    updatedAt: now,
  });
  return "more";
}

/**
 * Resumable full rebuild/repair into a NEW epoch. Current immutable inputs are
 * the source, never mutable SKU-day pages or existing legacy aggregate rows.
 * Concurrent captures enqueue their own exact target obligations atomically.
 * U8 separately proves complete historical input coverage before activation.
 */
export async function seedRollupEpochBatchWithCtx(
  ctx: MutationCtx,
  args: Scope,
  now: number,
): Promise<boolean> {
  assertNow(now);
  const epoch = await epochRow(ctx, args);
  const control = await readPipelineControl(ctx, args.storeId);
  if (!epoch || control?.targetRollupEpoch !== args.epoch)
    throw new Error("report_rollup_wrong_target_epoch");
  if (epoch.backfillComplete) return true;
  const page = await ctx.db
    .query("reportRollupInputCurrent")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", args.storeId))
    .paginate({
      cursor: epoch.backfillCursor,
      numItems: ROLLUP_REPAIR_DAY_BATCH_SIZE,
    });
  for (const input of page.page) {
    const scope = { ...args, operatingDate: input.operatingDate };
    const state = await dayState(ctx, scope);
    if (state?.inputId === input.inputId && state.phase === "done") continue;
    await retainPeriodObligations(ctx, scope, input.revision, now);
    await enqueueReportWork(
      ctx,
      {
        storeId: args.storeId,
        kind: "rollup",
        operatingDate: input.operatingDate,
      },
      now,
    );
  }
  await ctx.db.patch("reportRollupEpoch", epoch._id, {
    backfillCursor: page.continueCursor,
    backfillComplete: page.isDone,
  });
  return page.isDone;
}
