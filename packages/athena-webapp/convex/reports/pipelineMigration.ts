import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { readPipelineControl } from "./pipelineControl";
import { seedRollupEpochBatchWithCtx } from "./rollupPipeline";
import { enqueueReportWork } from "./pipelineWork";
import { foldAndReplaceDay, openPolicyForReason } from "./sweeper";
import {
  beginPipelineMigrationWithCtx,
  readPipelineMigration as migrationRow,
  requirePipelineMigrationStore as requireStore,
} from "./pipelineMigrationStart";
export { beginPipelineMigrationWithCtx } from "./pipelineMigrationStart";
import {
  backfillCloseWeeklyPageWithCtx,
  verifyCloseCoveragePageWithCtx,
} from "./pipelineCloseBackfill";
import {
  beginInventoryContributionRebuildWithCtx,
  stepInventoryContributionRebuildWithCtx,
} from "../operations/inventoryContributionRebuild";
import { readCompactInventoryAttention } from "../operations/inventoryContributions";
import { verifyRollupParityBatchWithCtx } from "./rollupParity";
import { markDirty } from "./marks";
import { recordPipelineOutcomeWithCtx } from "./pipelineEvidence";
import { verifyAcceptedBaselinePageWithCtx } from "./pipelineAcceptedParity";
type MigrationArgs = {
  storeId: Id<"store">;
  epoch: string;
  generation: number;
};
const migrationArgs = {
  storeId: v.id("store"),
  epoch: v.string(),
  generation: v.number(),
};
async function outstandingBasis(
  ctx: QueryCtx,
  storeId: Id<"store">,
  epoch: string,
) {
  const dirty = await ctx.db
    .query("reportDirtyDay")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
    .first();
  const close = await ctx.db
    .query("reportPipelineWork")
    .withIndex("by_storeId_kind_createdAt", (q) =>
      q.eq("storeId", storeId).eq("kind", "close-evidence"),
    )
    .first();
  const obligation = await ctx.db
    .query("reportPeriodObligation")
    .withIndex("by_storeId_epoch_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("epoch", epoch),
    )
    .first();
  const gate = obligation
    ? await ctx.db
        .query("reportPeriodReadiness")
        .withIndex("by_storeId_epoch_periodKey", (q) =>
          q
            .eq("storeId", storeId)
            .eq("epoch", epoch)
            .eq("periodKey", obligation.periodKey),
        )
        .unique()
    : null;
  return {
    pending: Boolean(dirty || close || obligation),
    blocked:
      close?.status === "blocked"
        ? "close_work_blocked"
        : dirty?.reason === "fact_cap_exceeded"
          ? "day_capacity_exceeded"
          : gate?.status === "blocked"
            ? "period_blocked"
            : undefined,
  };
}

async function canonicalPage(
  ctx: MutationCtx,
  storeId: Id<"store">,
  cursor: string | null,
  now: number,
) {
  const page = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
    .paginate({ cursor, numItems: 1 });
  for (const day of page.page) {
    await foldAndReplaceDay(ctx, storeId, day.operatingDate, now, {
      deferRollups: true,
      compactCloseEvidence: true,
      openPolicy: "preserve-existing",
    });
    await enqueueReportWork(
      ctx,
      { storeId, kind: "resolve-week-date", operatingDate: day.operatingDate },
      now,
    );
  }
  return page;
}

async function dayCoveragePage(
  ctx: MutationCtx,
  storeId: Id<"store">,
  cursor: string | null,
) {
  const page = await ctx.db
    .query("reportDay")
    .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
    .paginate({ cursor, numItems: 1 });
  for (const day of page.page) {
    const input = await ctx.db
      .query("reportRollupInputCurrent")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", storeId).eq("operatingDate", day.operatingDate),
      )
      .unique();
    if (!input || input.revision !== day.certifiedFoldRevision)
      return { page, valid: false };
  }
  return { page, valid: true };
}

/** Every cursor and the corresponding data writes commit in this transaction. */
export async function stepPipelineMigrationWithCtx(
  ctx: MutationCtx,
  args: MigrationArgs,
  now: number,
): Promise<"advanced" | "waiting" | "ready" | "stale" | "blocked"> {
  await requireStore(ctx, args.storeId);
  const migration = await migrationRow(ctx, args.storeId);
  const control = await readPipelineControl(ctx, args.storeId);
  if (
    !migration ||
    migration.epoch !== args.epoch ||
    migration.generation !== args.generation ||
    !control ||
    control.fence !== migration.controlFence ||
    control.targetRollupEpoch !== args.epoch
  )
    return "stale";
  if (migration.phase === "active") return "stale";
  const patch = async (fields: Partial<typeof migration>) => {
    await ctx.db.patch("reportPipelineMigration", migration._id, {
      ...fields,
      updatedAt: now,
      lastFailure: undefined,
    });
  };
  const block = async (reason: string) => {
    await ctx.db.patch("reportPipelineMigration", migration._id, {
      lastFailure: reason,
      updatedAt: now,
    });
    await recordPipelineOutcomeWithCtx(ctx, {
      storeId: args.storeId,
      lane: "maintenance",
      now,
      outcome: "blocked",
    });
    return "blocked" as const;
  };
  if (migration.phase === "closes" || migration.phase === "legacy-week") {
    const page = await backfillCloseWeeklyPageWithCtx(ctx, {
      storeId: args.storeId,
      phase: migration.phase,
      cursor: migration.cursor,
      now,
    });
    await patch({
      phase: page.done
        ? "inventory"
        : page.nextPhase === "days"
          ? "legacy-week"
          : page.nextPhase,
      cursor: page.nextCursor,
    });
    return "advanced";
  }
  if (migration.phase === "inventory") {
    if (migration.inventoryGeneration === undefined) {
      const generation = await beginInventoryContributionRebuildWithCtx(
        ctx,
        args.storeId,
        now,
      );
      await patch({ inventoryGeneration: generation });
      return "advanced";
    }
    const progress = await stepInventoryContributionRebuildWithCtx(
      ctx,
      { storeId: args.storeId, generation: migration.inventoryGeneration },
      now,
    );
    if (progress.status === "stale") return "blocked";
    if (progress.status === "complete")
      await patch({ phase: "fact-dates", cursor: null });
    return "advanced";
  }
  if (migration.phase === "fact-dates") {
    // Jump to the next indexed date, not through every fact within a date.
    const fact = await ctx.db
      .query("reportFact")
      .withIndex("by_storeId_operatingDate", (q) =>
        migration.cursor === null
          ? q.eq("storeId", args.storeId)
          : q.eq("storeId", args.storeId).gt("operatingDate", migration.cursor),
      )
      .first();
    if (!fact) await patch({ phase: "canonical", cursor: null });
    else {
      const dirty = await ctx.db
        .query("reportDirtyDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", args.storeId).eq("operatingDate", fact.operatingDate),
        )
        .unique();
      if (!dirty)
        await markDirty(ctx, args.storeId, fact.operatingDate, "reseed", now);
      await patch({ cursor: fact.operatingDate });
    }
    return "advanced";
  }
  if (migration.phase === "canonical") {
    const close = await ctx.db
      .query("reportPipelineWork")
      .withIndex("by_storeId_kind_createdAt", (q) =>
        q.eq("storeId", args.storeId).eq("kind", "close-evidence"),
      )
      .first();
    if (close?.status === "blocked") return block("close_work_blocked");
    if (close) return "waiting";
    const dirty = await ctx.db
      .query("reportDirtyDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", args.storeId),
      )
      .first();
    if (dirty) {
      await foldAndReplaceDay(ctx, args.storeId, dirty.operatingDate, now, {
        deferRollups: true,
        compactCloseEvidence: true,
        openPolicy: openPolicyForReason(dirty.reason),
      });
      await enqueueReportWork(
        ctx,
        {
          storeId: args.storeId,
          kind: "resolve-week-date",
          operatingDate: dirty.operatingDate,
        },
        now,
      );
      await enqueueReportWork(
        ctx,
        { storeId: args.storeId, kind: "current" },
        now,
      );
      await enqueueReportWork(
        ctx,
        { storeId: args.storeId, kind: "overview" },
        now,
      );
      await ctx.db.delete("reportDirtyDay", dirty._id);
      return "advanced";
    }
    const page = await canonicalPage(ctx, args.storeId, migration.cursor, now);
    await patch({
      phase: page.isDone ? "seed" : "canonical",
      cursor: page.isDone ? null : page.continueCursor,
    });
    return "advanced";
  }
  if (migration.phase === "seed") {
    if (await seedRollupEpochBatchWithCtx(ctx, args, now))
      await patch({ phase: "drain", cursor: null });
    return "advanced";
  }
  if (migration.phase === "drain") {
    const basis = await outstandingBasis(ctx, args.storeId, args.epoch);
    if (basis.blocked) return block(basis.blocked);
    if (basis.pending) return "waiting";
    await patch({
      phase: "close-coverage",
      proofWatermark: control.sourceWatermark,
      proofAcceptedWatermark: control.acceptedWatermark ?? 0,
      cursor: null,
    });
    return "advanced";
  }
  const basis = await outstandingBasis(ctx, args.storeId, args.epoch);
  if (basis.blocked) return block(basis.blocked);
  if (
    control.sourceWatermark !== migration.proofWatermark ||
    (control.acceptedWatermark ?? 0) !== migration.proofAcceptedWatermark ||
    basis.pending
  ) {
    await patch({ phase: "drain", cursor: null, proofWatermark: undefined });
    return "waiting";
  }
  if (migration.phase === "close-coverage") {
    const page = await verifyCloseCoveragePageWithCtx(ctx, {
      storeId: args.storeId,
      cursor: migration.cursor,
    });
    if (page.issues.length) {
      await ctx.db.patch("reportPipelineMigration", migration._id, {
        lastFailure: `close_${page.issues[0].reason}`,
        updatedAt: now,
      });
      return "blocked";
    }
    await patch({
      phase: page.done ? "accepted-coverage" : "close-coverage",
      cursor: page.nextCursor,
    });
    return "advanced";
  }
  if (migration.phase === "accepted-coverage") {
    const page = await verifyAcceptedBaselinePageWithCtx(ctx, {
      storeId: args.storeId,
      cursor: migration.cursor,
    });
    if (page.issues.length) {
      await ctx.db.patch("reportPipelineMigration", migration._id, {
        lastFailure: `accepted_${page.issues[0].reason}`,
        updatedAt: now,
      });
      return "blocked";
    }
    await patch({
      phase: page.done ? "day-coverage" : "accepted-coverage",
      cursor: page.nextCursor,
    });
    return "advanced";
  }
  if (migration.phase === "day-coverage") {
    const { page, valid } = await dayCoveragePage(
      ctx,
      args.storeId,
      migration.cursor,
    );
    if (!valid) {
      await patch({
        phase: "canonical",
        cursor: null,
        proofWatermark: undefined,
      });
      return "waiting";
    }
    await patch({
      phase: page.isDone ? "parity" : "day-coverage",
      cursor: page.isDone ? null : page.continueCursor,
    });
    return "advanced";
  }
  if (migration.phase === "parity") {
    const result = await verifyRollupParityBatchWithCtx(
      ctx,
      { storeId: args.storeId, epoch: args.epoch },
      now,
    );
    if (result === "blocked") return "blocked";
    if (result === "ready") {
      await patch({ phase: "ready" });
      return "ready";
    }
    return "advanced";
  }
  return "ready";
}

/** The switch conflicts atomically with every later canonical fold/source handoff. */
export async function activatePipelineWithCtx(
  ctx: MutationCtx,
  args: MigrationArgs,
  now: number,
) {
  await requireStore(ctx, args.storeId);
  const migration = await migrationRow(ctx, args.storeId);
  const control = await readPipelineControl(ctx, args.storeId);
  if (
    !migration ||
    migration.epoch !== args.epoch ||
    migration.generation !== args.generation ||
    migration.phase !== "ready" ||
    !control ||
    control.fence !== migration.controlFence ||
    control.targetRollupEpoch !== args.epoch ||
    control.sourceWatermark !== migration.proofWatermark ||
    (control.acceptedWatermark ?? 0) !== migration.proofAcceptedWatermark
  )
    throw new Error("pipeline_coverage_not_ready");
  const epoch = await ctx.db
    .query("reportRollupEpoch")
    .withIndex("by_storeId_epoch", (q) =>
      q.eq("storeId", args.storeId).eq("epoch", args.epoch),
    )
    .unique();
  const parity = await ctx.db
    .query("reportRollupParity")
    .withIndex("by_storeId_epoch", (q) =>
      q.eq("storeId", args.storeId).eq("epoch", args.epoch),
    )
    .unique();
  const inventory = await ctx.db
    .query("operationalInventoryCoverage")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .unique();
  if (
    !epoch?.backfillComplete ||
    !inventory?.complete ||
    parity?.phase !== "ready" ||
    parity.controlFence !== control.fence ||
    parity.sourceWatermark !== control.sourceWatermark ||
    (await outstandingBasis(ctx, args.storeId, args.epoch)).pending
  )
    throw new Error("pipeline_coverage_not_ready");
  const attention = await readCompactInventoryAttention(ctx, args.storeId, now);
  if (attention.completeness !== "complete")
    throw new Error("pipeline_inventory_coverage_not_ready");
  await ctx.db.patch("reportPipelineControl", control._id, {
    mode: "active",
    hasActivated: true,
    activeRollupEpoch: args.epoch,
    targetRollupEpoch: undefined,
    fence: control.fence + 1,
  });
  await ctx.db.patch("reportPipelineMigration", migration._id, {
    phase: "active",
    updatedAt: now,
  });
  for (const kind of ["current", "overview", "inventory"] as const)
    await enqueueReportWork(ctx, { storeId: args.storeId, kind }, now);
  return "active" as const;
}

export const beginMigration = internalMutation({
  args: {
    storeId: v.id("store"),
    epoch: v.string(),
    dryRun: v.optional(v.boolean()),
    rollback: v.optional(v.boolean()),
    autoContinue: v.optional(v.boolean()),
    resumeActivePipeline: v.optional(v.boolean()),
    restartProof: v.optional(v.boolean()),
  },
  returns: v.object({
    status: v.union(
      v.literal("planned"),
      v.literal("started"),
      v.literal("resumed"),
    ),
    generation: v.number(),
  }),
  handler: (ctx, args) => beginPipelineMigrationWithCtx(ctx, args, Date.now()),
});
export const activate = internalMutation({
  args: migrationArgs,
  returns: v.literal("active"),
  handler: (ctx, args) => activatePipelineWithCtx(ctx, args, Date.now()),
});
export const stepMigration = internalMutation({
  args: migrationArgs,
  returns: v.union(
    v.literal("advanced"),
    v.literal("waiting"),
    v.literal("ready"),
    v.literal("stale"),
    v.literal("blocked"),
  ),
  handler: (ctx, args) => stepPipelineMigrationWithCtx(ctx, args, Date.now()),
});
export const recordMigrationFailure = internalMutation({
  args: migrationArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const migration = await migrationRow(ctx, args.storeId);
    const control = await readPipelineControl(ctx, args.storeId);
    if (
      !migration ||
      migration.epoch !== args.epoch ||
      migration.generation !== args.generation ||
      migration.controlFence !== control?.fence
    )
      return null;
    await ctx.db.patch("reportPipelineMigration", migration._id, {
      lastFailure: "worker_failed",
      updatedAt: Date.now(),
    });
    await recordPipelineOutcomeWithCtx(ctx, {
      storeId: args.storeId,
      lane: "maintenance",
      now: Date.now(),
      outcome: "failed",
    });
    return null;
  },
});
export const resumeAfterProof = internalMutation({
  args: migrationArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const migration = await migrationRow(ctx, args.storeId);
    if (
      migration?.epoch === args.epoch &&
      migration.generation === args.generation &&
      migration.resumeActivePipeline
    )
      await activatePipelineWithCtx(ctx, args, Date.now());
    return null;
  },
});
export const runMigration = internalAction({
  args: migrationArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const result = await ctx.runMutation(
        makeFunctionReference<
          "mutation",
          MigrationArgs,
          "advanced" | "waiting" | "ready" | "stale" | "blocked"
        >("reports/pipelineMigration:stepMigration"),
        args,
      );
      if (result === "ready") {
        await ctx.runMutation(
          makeFunctionReference<"mutation", MigrationArgs>(
            "reports/pipelineMigration:resumeAfterProof",
          ),
          args,
        );
      } else if (result === "advanced" || result === "waiting") {
        await ctx.scheduler.runAfter(
          result === "waiting" ? 30_000 : 0,
          makeFunctionReference<"action", MigrationArgs>(
            "reports/pipelineMigration:runMigration",
          ),
          args,
        );
      }
    } catch {
      await ctx.runMutation(
        makeFunctionReference<"mutation", MigrationArgs>(
          "reports/pipelineMigration:recordMigrationFailure",
        ),
        args,
      );
    }
    return null;
  },
});
export const migrationStatus = internalQuery({
  args: { storeId: v.id("store") },
  handler: async (ctx, args) => {
    await requireStore(ctx, args.storeId);
    const control = await readPipelineControl(ctx, args.storeId);
    const migration = await migrationRow(ctx, args.storeId);
    return { control, migration };
  },
});
