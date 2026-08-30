import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
  descendingSortKey,
  periodKeysForOperatingDate,
  type ReportPeriodKey,
  type ReportSkuDayMetrics,
} from "../../shared/reportsContract";
import { readPipelineControl } from "./pipelineControl";
import {
  MAX_ROLLUP_INPUT_ROWS,
  ROLLUP_INPUT_CHUNK_SIZE,
} from "./rollupPipeline";
import { periodDateRange } from "./rollups";

export const ROLLUP_PARITY_CONTRIBUTION_BATCH = 20;
export const ROLLUP_PARITY_OUTPUT_BATCH = 3;
type Scope = { storeId: Id<"store">; epoch: string };
type Proof = Doc<"reportRollupParity">;
type Result = "pending" | "ready" | "blocked";
const measureKeys = [
  "unitsSold",
  "unitsReturned",
  "grossSalesMinor",
  "netSalesMinor",
  "refundsMinor",
  "uncostedRevenueMinor",
] as const;
const validMetrics = (value: ReportSkuDayMetrics) =>
  measureKeys.every((key) => Number.isFinite(value[key])) &&
  (value.grossProfitMinor === null || Number.isFinite(value.grossProfitMinor));
const sameMetrics = (a: ReportSkuDayMetrics, b: ReportSkuDayMetrics) =>
  measureKeys.every((key) => a[key] === b[key]) &&
  a.grossProfitMinor === b.grossProfitMinor;
function validDate(value: string) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}
async function block(
  ctx: MutationCtx,
  proof: Proof,
  reason: NonNullable<Proof["reason"]>,
  now: number,
): Promise<Result> {
  await ctx.db.patch("reportRollupParity", proof._id, {
    phase: "blocked",
    reason,
    updatedAt: now,
  });
  return "blocked";
}
async function progress(
  ctx: MutationCtx,
  proof: Proof,
  fields: Partial<Omit<Proof, "_id" | "_creationTime">>,
  now: number,
): Promise<Result> {
  await ctx.db.patch("reportRollupParity", proof._id, {
    ...fields,
    updatedAt: now,
  });
  return fields.phase === "ready" ? "ready" : "pending";
}

/**
 * Verify a drained fresh target against immutable inputs, never legacy totals.
 * The caller separately proves canonical reportDay -> current-input coverage.
 * Each successful page commits only resumable proof state. Control/source drift
 * restarts it; a mismatch never repairs the candidate to make the proof pass.
 */
export async function verifyRollupParityBatchWithCtx(
  ctx: MutationCtx,
  args: Scope & { restart?: boolean },
  now: number,
): Promise<Result> {
  if (!Number.isFinite(now) || now < 0)
    throw new Error("report_rollup_invalid_time");
  const control = await readPipelineControl(ctx, args.storeId);
  if (
    !control ||
    control.targetRollupEpoch !== args.epoch ||
    control.mode === "paused"
  )
    throw new Error("report_rollup_wrong_target_epoch");
  let proof = await ctx.db
    .query("reportRollupParity")
    .withIndex("by_storeId_epoch", (q) =>
      q.eq("storeId", args.storeId).eq("epoch", args.epoch),
    )
    .unique();
  if (
    !proof ||
    args.restart ||
    proof.controlFence !== control.fence ||
    proof.sourceWatermark !== control.sourceWatermark
  ) {
    const fields = {
      storeId: args.storeId,
      epoch: args.epoch,
      controlFence: control.fence,
      sourceWatermark: control.sourceWatermark,
      phase: "inputs" as const,
      cursor: null,
      inputId: undefined,
      nextInputCursor: undefined,
      inputPageDone: undefined,
      chunkOrdinal: 0,
      rowOffset: 0,
      lastSkuId: undefined,
      inputRows: 0,
      checkpointRows: 0,
      outputRows: 0,
      reason: undefined,
      updatedAt: now,
    };
    if (proof) {
      await ctx.db.patch("reportRollupParity", proof._id, fields);
      proof = { ...proof, ...fields };
    } else {
      const id = await ctx.db.insert("reportRollupParity", fields);
      proof = { ...fields, _id: id, _creationTime: now };
    }
  }
  if (proof.phase === "blocked") return "blocked";
  const epoch = await ctx.db
    .query("reportRollupEpoch")
    .withIndex("by_storeId_epoch", (q) =>
      q.eq("storeId", args.storeId).eq("epoch", args.epoch),
    )
    .unique();
  const obligation = await ctx.db
    .query("reportPeriodObligation")
    .withIndex("by_storeId_epoch_operatingDate", (q) =>
      q.eq("storeId", args.storeId).eq("epoch", args.epoch),
    )
    .first();
  if (!epoch?.backfillComplete || obligation)
    return block(ctx, proof, "not_drained", now);
  if (proof.phase === "ready") return "ready";
  if (proof.phase === "inputs") return verifyInputBatch(ctx, proof, now);
  if (proof.phase === "checkpoints")
    return verifyCheckpointBatch(ctx, proof, now);
  return verifyOutputBatch(ctx, proof, now);
}

async function verifyInputBatch(
  ctx: MutationCtx,
  original: Proof,
  now: number,
): Promise<Result> {
  let proof = original;
  if (!proof.inputId) {
    const page = await ctx.db
      .query("reportRollupInputCurrent")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", proof.storeId),
      )
      .paginate({ cursor: proof.cursor, numItems: 1 });
    const pointer = page.page[0];
    if (!pointer)
      return progress(ctx, proof, { phase: "checkpoints", cursor: null }, now);
    const pointedInput = await ctx.db.get("reportRollupInput", pointer.inputId);
    if (
      !pointedInput ||
      pointedInput.storeId !== proof.storeId ||
      pointedInput.operatingDate !== pointer.operatingDate ||
      pointedInput.revision !== pointer.revision
    )
      return block(ctx, proof, "input_mismatch", now);
    const state = await ctx.db
      .query("reportRollupDayState")
      .withIndex("by_storeId_epoch_operatingDate", (q) =>
        q
          .eq("storeId", proof.storeId)
          .eq("epoch", proof.epoch)
          .eq("operatingDate", pointer.operatingDate),
      )
      .unique();
    if (
      !validDate(pointer.operatingDate) ||
      state?.inputId !== pointer.inputId ||
      state.revision !== pointer.revision ||
      state.phase !== "done"
    )
      return block(ctx, proof, "input_mismatch", now);
    for (const periodKey of periodKeysForOperatingDate(pointer.operatingDate)) {
      const gate = await ctx.db
        .query("reportPeriodReadiness")
        .withIndex("by_storeId_epoch_periodKey", (q) =>
          q
            .eq("storeId", proof.storeId)
            .eq("epoch", proof.epoch)
            .eq("periodKey", periodKey),
        )
        .unique();
      if (gate?.status !== "ready" || gate.pendingDays !== 0)
        return block(ctx, proof, "not_drained", now);
    }
    proof = {
      ...proof,
      inputId: pointer.inputId,
      nextInputCursor: page.continueCursor,
      inputPageDone: page.isDone,
      chunkOrdinal: 0,
      rowOffset: 0,
      lastSkuId: undefined,
    };
  }
  const input = await ctx.db.get("reportRollupInput", proof.inputId!);
  if (
    !input ||
    input.storeId !== proof.storeId ||
    !validDate(input.operatingDate) ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    !Number.isSafeInteger(input.rowCount) ||
    input.rowCount < 0 ||
    input.rowCount > MAX_ROLLUP_INPUT_ROWS ||
    input.chunkCount !== Math.ceil(input.rowCount / ROLLUP_INPUT_CHUNK_SIZE)
  )
    return block(ctx, proof, "input_mismatch", now);
  let inputRows = proof.inputRows;
  let rowOffset = proof.rowOffset;
  let chunkOrdinal = proof.chunkOrdinal;
  let lastSkuId = proof.lastSkuId;
  if (chunkOrdinal < input.chunkCount) {
    const chunks = await ctx.db
      .query("reportRollupInputChunk")
      .withIndex("by_inputId_ordinal", (q) =>
        q.eq("inputId", input._id).eq("ordinal", chunkOrdinal),
      )
      .take(2);
    const chunk = chunks[0];
    if (
      chunks.length !== 1 ||
      chunk.storeId !== proof.storeId ||
      chunk.rows.length !==
        Math.min(
          ROLLUP_INPUT_CHUNK_SIZE,
          input.rowCount - chunkOrdinal * ROLLUP_INPUT_CHUNK_SIZE,
        )
    )
      return block(ctx, proof, "input_mismatch", now);
    const rows = chunk.rows.slice(
      rowOffset,
      rowOffset + ROLLUP_PARITY_CONTRIBUTION_BATCH,
    );
    for (const row of rows) {
      if (
        !validMetrics(row) ||
        (lastSkuId !== undefined && row.productSkuId <= lastSkuId)
      )
        return block(ctx, proof, "input_mismatch", now);
      const checkpoints = await ctx.db
        .query("reportRollupCheckpoint")
        .withIndex("by_storeId_epoch_operatingDate_productSkuId", (q) =>
          q
            .eq("storeId", proof.storeId)
            .eq("epoch", proof.epoch)
            .eq("operatingDate", input.operatingDate)
            .eq("productSkuId", row.productSkuId),
        )
        .take(2);
      const checkpoint = checkpoints[0];
      if (
        checkpoints.length !== 1 ||
        checkpoint.revision !== input.revision ||
        !validMetrics(checkpoint) ||
        !sameMetrics(checkpoint, row)
      )
        return block(ctx, proof, "checkpoint_mismatch", now);
      inputRows++;
      lastSkuId = row.productSkuId;
    }
    rowOffset += rows.length;
    if (rowOffset === chunk.rows.length) {
      chunkOrdinal++;
      rowOffset = 0;
    }
  }
  if (chunkOrdinal === input.chunkCount)
    return progress(
      ctx,
      proof,
      {
        phase: proof.inputPageDone ? "checkpoints" : "inputs",
        cursor: proof.inputPageDone ? null : proof.nextInputCursor!,
        inputId: undefined,
        nextInputCursor: undefined,
        inputPageDone: undefined,
        rowOffset: 0,
        chunkOrdinal: 0,
        lastSkuId: undefined,
        inputRows,
      },
      now,
    );
  return progress(
    ctx,
    proof,
    {
      inputId: proof.inputId,
      nextInputCursor: proof.nextInputCursor,
      inputPageDone: proof.inputPageDone,
      chunkOrdinal,
      rowOffset,
      lastSkuId,
      inputRows,
    },
    now,
  );
}

async function verifyCheckpointBatch(
  ctx: MutationCtx,
  proof: Proof,
  now: number,
): Promise<Result> {
  const page = await ctx.db
    .query("reportRollupCheckpoint")
    .withIndex("by_storeId_epoch_operatingDate_productSkuId", (q) =>
      q.eq("storeId", proof.storeId).eq("epoch", proof.epoch),
    )
    .paginate({
      cursor: proof.cursor,
      numItems: ROLLUP_PARITY_CONTRIBUTION_BATCH,
    });
  for (const row of page.page) {
    if (!validDate(row.operatingDate) || !validMetrics(row))
      return block(ctx, proof, "checkpoint_mismatch", now);
    // Input verification proved every desired checkpoint exactly. This inverse
    // pass proves there are no extras and no omitted day/week/month output.
    for (const periodKey of periodKeysForOperatingDate(row.operatingDate)) {
      const outputs = await ctx.db
        .query("reportEpochSkuRollup")
        .withIndex("by_storeId_epoch_periodKey_productSkuId", (q) =>
          q
            .eq("storeId", proof.storeId)
            .eq("epoch", proof.epoch)
            .eq("periodKey", periodKey)
            .eq("productSkuId", row.productSkuId),
        )
        .take(2);
      if (outputs.length !== 1)
        return block(ctx, proof, "output_mismatch", now);
    }
  }
  const checkpointRows = proof.checkpointRows + page.page.length;
  if (
    checkpointRows > proof.inputRows ||
    (page.isDone && checkpointRows !== proof.inputRows)
  )
    return block(ctx, proof, "checkpoint_mismatch", now);
  return progress(
    ctx,
    proof,
    {
      checkpointRows,
      phase: page.isDone ? "outputs" : "checkpoints",
      cursor: page.isDone ? null : page.continueCursor,
    },
    now,
  );
}

async function verifyOutputBatch(
  ctx: MutationCtx,
  proof: Proof,
  now: number,
): Promise<Result> {
  const page = await ctx.db
    .query("reportEpochSkuRollup")
    .withIndex("by_storeId_epoch_periodKey_productSkuId", (q) =>
      q.eq("storeId", proof.storeId).eq("epoch", proof.epoch),
    )
    .paginate({ cursor: proof.cursor, numItems: ROLLUP_PARITY_OUTPUT_BATCH });
  for (const row of page.page) {
    const range = periodDateRange(row.periodKey as ReportPeriodKey);
    if (
      !range ||
      !validDate(range.startDate) ||
      !validDate(range.endDate) ||
      !periodKeysForOperatingDate(range.startDate).includes(
        row.periodKey as ReportPeriodKey,
      ) ||
      !validMetrics(row)
    )
      return block(ctx, proof, "output_mismatch", now);
    const contributors = await ctx.db
      .query("reportRollupCheckpoint")
      .withIndex("by_storeId_epoch_productSkuId_operatingDate", (q) =>
        q
          .eq("storeId", proof.storeId)
          .eq("epoch", proof.epoch)
          .eq("productSkuId", row.productSkuId)
          .gte("operatingDate", range.startDate)
          .lte("operatingDate", range.endDate),
      )
      .take(32);
    if (
      contributors.length === 0 ||
      contributors.length > 31 ||
      new Set(contributors.map((item) => item.operatingDate)).size !==
        contributors.length ||
      contributors.some((item) => !validMetrics(item))
    )
      return block(ctx, proof, "output_mismatch", now);
    const sum = {
      unitsSold: 0,
      unitsReturned: 0,
      grossSalesMinor: 0,
      netSalesMinor: 0,
      refundsMinor: 0,
      uncostedRevenueMinor: 0,
    };
    let knownProfitMinor = 0;
    let unknownProfitDays = 0;
    for (const item of contributors) {
      for (const key of measureKeys) sum[key] += item[key];
      knownProfitMinor += item.grossProfitMinor ?? 0;
      unknownProfitDays += Number(item.grossProfitMinor === null);
    }
    const expected = {
      ...sum,
      grossProfitMinor: unknownProfitDays > 0 ? null : knownProfitMinor,
    };
    if (
      !sameMetrics(row, expected) ||
      row.knownProfitMinor !== knownProfitMinor ||
      row.unknownProfitDays !== unknownProfitDays ||
      row.contributingDays !== contributors.length ||
      row.revenueSortKey !== descendingSortKey(sum.netSalesMinor) ||
      row.unitsSortKey !== descendingSortKey(sum.unitsSold)
    )
      return block(ctx, proof, "output_mismatch", now);
  }
  return progress(
    ctx,
    proof,
    {
      outputRows: proof.outputRows + page.page.length,
      phase: page.isDone ? "ready" : "outputs",
      cursor: page.isDone ? null : page.continueCursor,
    },
    now,
  );
}
