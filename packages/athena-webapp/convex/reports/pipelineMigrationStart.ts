import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { makeFunctionReference } from "convex/server";
import { readPipelineControl } from "./pipelineControl";
import { initializeRollupEpochWithCtx } from "./rollupPipeline";
import { readStoreAllowlist } from "./pipelineAllowlist";

type StartArgs = {
  storeId: Id<"store">;
  epoch: string;
  dryRun?: boolean;
  rollback?: boolean;
  autoContinue?: boolean;
  resumeActivePipeline?: boolean;
  restartProof?: boolean;
};
export async function readPipelineMigration(
  ctx: QueryCtx,
  storeId: Id<"store">,
) {
  return ctx.db
    .query("reportPipelineMigration")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
}
export async function requirePipelineMigrationStore(
  ctx: QueryCtx,
  storeId: Id<"store">,
) {
  if (!readStoreAllowlist().has(String(storeId)))
    throw new Error("pipeline_store_not_allowed");
  const store = await ctx.db.get("store", storeId);
  if (!store || store.reportingReseedStartedAt !== undefined)
    throw new Error("pipeline_store_unavailable");
  return store;
}

/** Bounded durable start, safe for source/reset transactions to import. Workers
 * and operation-admission consumers deliberately remain outside this module. */
export async function beginPipelineMigrationWithCtx(
  ctx: MutationCtx,
  args: StartArgs,
  now: number,
) {
  await requirePipelineMigrationStore(ctx, args.storeId);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(args.epoch))
    throw new Error("pipeline_invalid_epoch");
  const existing = await readPipelineMigration(ctx, args.storeId);
  if (args.dryRun !== false)
    return {
      status: "planned" as const,
      generation: (existing?.generation ?? 0) + 1,
    };
  if (existing?.epoch === args.epoch) {
    const control = await readPipelineControl(ctx, args.storeId);
    if (control?.fence !== existing.controlFence)
      throw new Error("pipeline_migration_fenced");
    if (args.restartProof) {
      const parity = await ctx.db
        .query("reportRollupParity")
        .withIndex("by_storeId_epoch", (q) =>
          q.eq("storeId", args.storeId).eq("epoch", args.epoch),
        )
        .unique();
      if (parity) await ctx.db.delete("reportRollupParity", parity._id);
      await ctx.db.patch("reportPipelineMigration", existing._id, {
        phase: "drain",
        cursor: null,
        proofWatermark: undefined,
        proofAcceptedWatermark: undefined,
        lastFailure: undefined,
        updatedAt: now,
      });
    }
    if (args.autoContinue)
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference<
          "action",
          { storeId: Id<"store">; epoch: string; generation: number }
        >("reports/pipelineMigration:runMigration"),
        {
          storeId: args.storeId,
          epoch: args.epoch,
          generation: existing.generation,
        },
      );
    return { status: "resumed" as const, generation: existing.generation };
  }
  let control = await readPipelineControl(ctx, args.storeId);
  if (!control) {
    await ctx.db.insert("reportPipelineControl", {
      storeId: args.storeId,
      mode: "shadow",
      fence: 1,
      sourceWatermark: 0,
    });
    control = await readPipelineControl(ctx, args.storeId);
  }
  if (!control) throw new Error("pipeline_missing_control");
  if (
    args.resumeActivePipeline &&
    !control.hasActivated &&
    !control.activeRollupEpoch
  )
    throw new Error("pipeline_cannot_resume_never_active_store");
  if (args.rollback || control.mode === "paused") {
    await ctx.db.patch("reportPipelineControl", control._id, {
      mode: "shadow",
      fence: control.fence + 1,
    });
  }
  await initializeRollupEpochWithCtx(
    ctx,
    { storeId: args.storeId, epoch: args.epoch },
    now,
  );
  const nextControl = await readPipelineControl(ctx, args.storeId);
  const data = {
    storeId: args.storeId,
    epoch: args.epoch,
    generation: (existing?.generation ?? 0) + 1,
    controlFence: nextControl!.fence,
    phase: "closes" as const,
    cursor: null,
    startedAt: now,
    updatedAt: now,
    rollback: args.rollback ?? false,
    resumeActivePipeline: args.resumeActivePipeline ?? false,
    inventoryGeneration: undefined,
    proofWatermark: undefined,
    proofAcceptedWatermark: undefined,
    lastFailure: undefined,
  };
  if (existing)
    await ctx.db.replace("reportPipelineMigration", existing._id, data);
  else await ctx.db.insert("reportPipelineMigration", data);
  if (args.autoContinue)
    await ctx.scheduler.runAfter(
      0,
      makeFunctionReference<
        "action",
        { storeId: Id<"store">; epoch: string; generation: number }
      >("reports/pipelineMigration:runMigration"),
      { storeId: args.storeId, epoch: args.epoch, generation: data.generation },
    );
  return { status: "started" as const, generation: data.generation };
}
