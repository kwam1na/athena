import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../_generated/server";
import { scheduleReportingWorkBestEffort } from "./scheduling";

export const REPORTING_PROJECTION_RECOVERY_LIMIT = 20;

type ProjectionWorkPatch = {
  projectionAttemptCount: number;
  projectionLastAttemptAt: number;
  projectionLatestFailureAt?: number;
  projectionLatestFailureCode?: string;
  projectionStatus: "pending" | "completed" | "failed";
  projectedAt?: number;
};

export function pendingProjectionWorkPatch(
  row: Pick<
    Doc<"reportingFact"> | Doc<"reportingInventoryEffect">,
    "projectionAttemptCount"
  >,
  now: number,
): ProjectionWorkPatch {
  return {
    projectionAttemptCount: (row.projectionAttemptCount ?? 0) + 1,
    projectionLastAttemptAt: now,
    projectionStatus: "pending",
  };
}

export function completedProjectionWorkPatch(
  row: Pick<
    Doc<"reportingFact"> | Doc<"reportingInventoryEffect">,
    "projectionAttemptCount" | "projectionLastAttemptAt"
  >,
  now: number,
): ProjectionWorkPatch {
  return {
    projectionAttemptCount: row.projectionAttemptCount ?? 1,
    projectionLastAttemptAt: row.projectionLastAttemptAt ?? now,
    projectionLatestFailureAt: undefined,
    projectionLatestFailureCode: undefined,
    projectionStatus: "completed",
    projectedAt: now,
  };
}

export function failedProjectionWorkPatch(
  row: Pick<
    Doc<"reportingFact"> | Doc<"reportingInventoryEffect">,
    "projectionAttemptCount" | "projectionLastAttemptAt"
  >,
  now: number,
  safeCode: string,
): ProjectionWorkPatch {
  return {
    projectionAttemptCount: row.projectionAttemptCount ?? 1,
    projectionLastAttemptAt: row.projectionLastAttemptAt ?? now,
    projectionLatestFailureAt: now,
    projectionLatestFailureCode: safeCode,
    projectionStatus: "failed",
  };
}

export async function markFactProjectionPendingWithCtx(
  ctx: MutationCtx,
  factId: Id<"reportingFact">,
) {
  const fact = await ctx.db.get("reportingFact", factId);
  if (!fact) return;
  await ctx.db.patch(
    "reportingFact",
    factId,
    pendingProjectionWorkPatch(fact, Date.now()),
  );
}

export async function markInventoryEffectProjectionPendingWithCtx(
  ctx: MutationCtx,
  effectId: Id<"reportingInventoryEffect">,
) {
  const effect = await ctx.db.get("reportingInventoryEffect", effectId);
  if (!effect) return;
  await ctx.db.patch(
    "reportingInventoryEffect",
    effectId,
    pendingProjectionWorkPatch(effect, Date.now()),
  );
}

const projectionWorkInternal = (internal as any).reporting.projectionWork;
const projectionProcessorInternal = (internal as any).reporting.projections
  .processor;
const inventoryProjectionInternal = (internal as any).reporting.projections
  .inventory;

export async function scheduleFactProjectionBatchWithCtx(
  ctx: MutationCtx,
  factIds: Id<"reportingFact">[],
) {
  if (factIds.length === 0 || factIds.length > 20) {
    throw new Error("Projection batches require between 1 and 20 facts");
  }
  const facts = await Promise.all(
    factIds.map((factId) => ctx.db.get("reportingFact", factId)),
  );
  const now = Date.now();
  for (const fact of facts) {
    if (!fact || fact.status !== "canonical") continue;
    await ctx.db.patch(
      "reportingFact",
      fact._id,
      pendingProjectionWorkPatch(fact, now),
    );
  }
  const scheduled = await scheduleReportingWorkBestEffort(
    ctx,
    projectionWorkInternal.processFactProjectionBatch,
    { factIds },
  );
  if (!scheduled) {
    for (const fact of facts) {
      if (!fact || fact.status !== "canonical") continue;
      await ctx.db.patch(
        "reportingFact",
        fact._id,
        failedProjectionWorkPatch(
          {
            projectionAttemptCount: (fact.projectionAttemptCount ?? 0) + 1,
            projectionLastAttemptAt: now,
          },
          now,
          "projection_schedule_failed",
        ),
      );
    }
  }
  return scheduled;
}

export async function scheduleInventoryEffectProjectionWithCtx(
  ctx: MutationCtx,
  effectId: Id<"reportingInventoryEffect">,
) {
  const effect = await ctx.db.get("reportingInventoryEffect", effectId);
  if (!effect) return false;
  const now = Date.now();
  await ctx.db.patch(
    "reportingInventoryEffect",
    effect._id,
    pendingProjectionWorkPatch(effect, now),
  );
  const scheduled = await scheduleReportingWorkBestEffort(
    ctx,
    projectionWorkInternal.processInventoryEffectProjection,
    { effectId },
  );
  if (!scheduled) {
    await ctx.db.patch(
      "reportingInventoryEffect",
      effect._id,
      failedProjectionWorkPatch(
        {
          projectionAttemptCount: (effect.projectionAttemptCount ?? 0) + 1,
          projectionLastAttemptAt: now,
        },
        now,
        "projection_schedule_failed",
      ),
    );
  }
  return scheduled;
}

export const recordFactProjectionFailure = internalMutation({
  args: {
    factIds: v.array(v.id("reportingFact")),
    safeCode: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const factId of args.factIds) {
      const fact = await ctx.db.get("reportingFact", factId);
      if (!fact || fact.projectionStatus === "completed") continue;
      await ctx.db.patch(
        "reportingFact",
        fact._id,
        failedProjectionWorkPatch(fact, now, args.safeCode),
      );
    }
  },
});

export const recordInventoryEffectProjectionFailure = internalMutation({
  args: {
    effectId: v.id("reportingInventoryEffect"),
    safeCode: v.string(),
  },
  handler: async (ctx, args) => {
    const effect = await ctx.db.get("reportingInventoryEffect", args.effectId);
    if (!effect || effect.projectionStatus === "completed") return;
    await ctx.db.patch(
      "reportingInventoryEffect",
      effect._id,
      failedProjectionWorkPatch(effect, Date.now(), args.safeCode),
    );
  },
});

export const processFactProjectionBatch = internalAction({
  args: { factIds: v.array(v.id("reportingFact")) },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(
        projectionProcessorInternal.processCanonicalFacts,
        args,
      );
    } catch {
      await ctx.runMutation(
        projectionWorkInternal.recordFactProjectionFailure,
        {
          factIds: args.factIds,
          safeCode: "projection_worker_failed",
        },
      );
    }
  },
});

export const processInventoryEffectProjection = internalAction({
  args: { effectId: v.id("reportingInventoryEffect") },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(
        inventoryProjectionInternal.processInventoryEffect,
        args,
      );
    } catch {
      await ctx.runMutation(
        projectionWorkInternal.recordInventoryEffectProjectionFailure,
        {
          effectId: args.effectId,
          safeCode: "projection_worker_failed",
        },
      );
    }
  },
});

export const resumePendingProjectionWorkForStore = internalMutation({
  args: {
    limit: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? REPORTING_PROJECTION_RECOVERY_LIMIT;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > REPORTING_PROJECTION_RECOVERY_LIMIT
    ) {
      throw new Error("Pending projection recovery batch size is invalid.");
    }
    const [pendingFacts, failedFacts, pendingEffects, failedEffects] =
      await Promise.all([
        ctx.db
          .query("reportingFact")
          .withIndex("by_storeId_projectionStatus_createdAt", (q) =>
            q.eq("storeId", args.storeId).eq("projectionStatus", "pending"),
          )
          .order("asc")
          .take(limit),
        ctx.db
          .query("reportingFact")
          .withIndex("by_storeId_projectionStatus_createdAt", (q) =>
            q.eq("storeId", args.storeId).eq("projectionStatus", "failed"),
          )
          .order("asc")
          .take(limit),
        ctx.db
          .query("reportingInventoryEffect")
          .withIndex("by_storeId_projectionStatus_createdAt", (q) =>
            q.eq("storeId", args.storeId).eq("projectionStatus", "pending"),
          )
          .order("asc")
          .take(limit),
        ctx.db
          .query("reportingInventoryEffect")
          .withIndex("by_storeId_projectionStatus_createdAt", (q) =>
            q.eq("storeId", args.storeId).eq("projectionStatus", "failed"),
          )
          .order("asc")
          .take(limit),
      ]);
    const workRows = [
      ...pendingFacts.map((row) => ({ kind: "fact" as const, row })),
      ...failedFacts.map((row) => ({ kind: "fact" as const, row })),
      ...pendingEffects.map((row) => ({ kind: "effect" as const, row })),
      ...failedEffects.map((row) => ({ kind: "effect" as const, row })),
    ]
      .sort((left, right) => left.row.createdAt - right.row.createdAt)
      .slice(0, limit);
    const factRows = workRows.flatMap((work) =>
      work.kind === "fact" ? [work.row] : [],
    );
    const effectRows = workRows.flatMap((work) =>
      work.kind === "effect" ? [work.row] : [],
    );
    let scheduledCount = 0;
    let failedCount = 0;
    for (let index = 0; index < factRows.length; index += 20) {
      const batch = factRows.slice(index, index + 20);
      const scheduled = await scheduleFactProjectionBatchWithCtx(
        ctx,
        batch.map((row) => row._id),
      );
      scheduledCount += scheduled ? batch.length : 0;
      failedCount += scheduled ? 0 : batch.length;
    }
    for (const effect of effectRows) {
      const scheduled = await scheduleInventoryEffectProjectionWithCtx(
        ctx,
        effect._id,
      );
      scheduledCount += scheduled ? 1 : 0;
      failedCount += scheduled ? 0 : 1;
    }
    return {
      failedCount,
      inspectedCount: factRows.length + effectRows.length,
      scheduledCount,
      storeId: args.storeId,
    };
  },
});
