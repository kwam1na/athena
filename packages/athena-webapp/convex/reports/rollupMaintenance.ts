import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { readPipelineControl } from "./pipelineControl";

export const ROLLUP_INPUT_CLEANUP_CHUNK_BATCH = 20;
type CleanupResult = {
  cursor: string | null;
  done: boolean;
  deletedChunks: number;
  deletedInputs: number;
  retained: number;
};

/**
 * One header and at most twenty child deletes. The maintenance caller persists
 * the cursor in this transaction and schedules independent continuations.
 * Unknown/retired epochs and old parity proofs deliberately pin their inputs;
 * only explicit lifecycle retirement may remove those references.
 */
export async function cleanupObsoleteRollupInputBatchWithCtx(
  ctx: MutationCtx,
  args: { storeId: Id<"store">; cursor: string | null },
  now: number,
): Promise<CleanupResult> {
  if (!Number.isFinite(now) || now < 0)
    throw new Error("report_rollup_invalid_time");
  const empty = {
    cursor: null,
    done: true,
    deletedChunks: 0,
    deletedInputs: 0,
    retained: 0,
  };
  const control = await readPipelineControl(ctx, args.storeId);
  const store = await ctx.db.get("store", args.storeId);
  if (
    !control ||
    control.mode === "paused" ||
    !store ||
    store.reportingReseedStartedAt !== undefined
  )
    return empty;
  const page = await ctx.db
    .query("reportRollupInput")
    .withIndex("by_storeId_operatingDate_revision", (q) =>
      q.eq("storeId", args.storeId),
    )
    .paginate({ cursor: args.cursor, numItems: 1 });
  const input = page.page[0];
  const advanced = {
    ...empty,
    cursor: page.isDone ? null : page.continueCursor,
    done: page.isDone,
  };
  if (!input) return advanced;
  const retain = { ...advanced, retained: 1 };
  const pointer = await ctx.db
    .query("reportRollupInputCurrent")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", args.storeId).eq("operatingDate", input.operatingDate),
    )
    .unique();
  if (!pointer || pointer.inputId === input._id) return retain;
  const current = await ctx.db.get("reportRollupInput", pointer.inputId);
  if (
    !current ||
    current.storeId !== args.storeId ||
    current.operatingDate !== input.operatingDate ||
    current.revision !== pointer.revision ||
    current.revision <= input.revision
  )
    return retain;
  const [state, proof] = await Promise.all([
    ctx.db
      .query("reportRollupDayState")
      .withIndex("by_inputId", (q) => q.eq("inputId", input._id))
      .first(),
    ctx.db
      .query("reportRollupParity")
      .withIndex("by_inputId", (q) => q.eq("inputId", input._id))
      .first(),
  ]);
  if (state || proof) return retain;
  const children = await ctx.db
    .query("reportRollupInputChunk")
    .withIndex("by_inputId_ordinal", (q) => q.eq("inputId", input._id))
    .take(ROLLUP_INPUT_CLEANUP_CHUNK_BATCH + 1);
  if (children.some((child) => child.storeId !== args.storeId)) return retain;
  const batch = children.slice(0, ROLLUP_INPUT_CLEANUP_CHUNK_BATCH);
  for (const child of batch)
    await ctx.db.delete("reportRollupInputChunk", child._id);
  if (children.length > ROLLUP_INPUT_CLEANUP_CHUNK_BATCH)
    return {
      ...empty,
      cursor: args.cursor,
      done: false,
      deletedChunks: batch.length,
    };
  await ctx.db.delete("reportRollupInput", input._id);
  return { ...advanced, deletedChunks: batch.length, deletedInputs: 1 };
}
