import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { SHARED_DEMO_BASELINE_VERSION } from "./config";
import { restoreMutableDemoStoreRowsWithCtx } from "./domainRestore";
import { rollSharedDemoOpeningBaselineWithCtx } from "./openingBaseline";

export const SHARED_DEMO_BASELINE = {
  version: SHARED_DEMO_BASELINE_VERSION,
  narrative: "A product-led neighborhood store in an active operating day.",
  expectedCounts: {
    cash: 1,
    inventory: 1,
    operations: 2,
    orders: 1,
    pos: 1,
    staff: 1,
  },
} as const;

export type RestoreState = {
  appliedAt?: number;
  baselineVersion: number;
  cleanupTerminalIds?: Id<"posTerminal">[];
  completedAt?: number;
  epoch: number;
  failureCode?: string;
  idempotencyKey?: string;
  phase?: "leased" | "applied";
  restoredDocuments?: number;
  restoreSource?: "hourly" | "manual";
  startedAt?: number;
  status: "ready" | "restoring" | "failed";
};

export const SHARED_DEMO_RESTORE_FAILURE_CODE = "baseline_restore_failed";

type RestoreLeaseArgs = {
  epoch: number;
  idempotencyKey: string;
  source: "hourly" | "manual";
  storeId: Id<"store">;
};

export function requireCurrentSharedDemoBaseline<T extends RestoreState>(
  state: T | null,
): T {
  if (!state || state.baselineVersion !== SHARED_DEMO_BASELINE.version) {
    throw new Error("The demo baseline requires provisioning.");
  }
  return state;
}

export function beginRestore(
  state: RestoreState,
  args: { idempotencyKey: string; now: number },
) {
  if (state.status === "restoring") {
    return state.idempotencyKey === args.idempotencyKey
      ? { kind: "existing" as const, epoch: state.epoch, state }
      : { kind: "busy" as const, epoch: state.epoch, state };
  }
  return {
    kind: "started" as const,
    state: {
      baselineVersion: SHARED_DEMO_BASELINE.version,
      epoch: state.epoch + 1,
      idempotencyKey: args.idempotencyKey,
      startedAt: args.now,
      status: "restoring" as const,
    },
  };
}

export function assertSharedDemoWriteEpoch(
  state: RestoreState,
  expectedEpoch: number,
) {
  if (state.status !== "ready" || state.epoch !== expectedEpoch) {
    throw new Error("The demo is being restored. Try again shortly.");
  }
  return state;
}

function baselineMatches(
  actualCounts: Record<string, number>,
  expectedCounts: Record<string, number>,
) {
  return (
    Object.entries(expectedCounts).every(
      ([domain, count]) => actualCounts[domain] === count,
    ) && Object.keys(actualCounts).length === Object.keys(expectedCounts).length
  );
}

export function completeRestore(
  state: RestoreState,
  args: {
    actualCounts: Record<string, number>;
    expectedCounts: Record<string, number>;
    now: number;
  },
): RestoreState {
  if (
    state.status !== "restoring" ||
    !baselineMatches(args.actualCounts, args.expectedCounts)
  ) {
    throw new Error("Demo baseline verification failed.");
  }
  return {
    baselineVersion: SHARED_DEMO_BASELINE.version,
    completedAt: args.now,
    epoch: state.epoch,
    status: "ready",
  };
}

const restoreSource = v.union(v.literal("hourly"), v.literal("manual"));

async function applyBaselineDocumentsWithCtx(
  ctx: MutationCtx,
  args: { now: number; storeId: Id<"store"> },
) {
  const existingRows = await ctx.db
    .query("sharedDemoBaselineRow")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .take(20);
  for (const row of existingRows)
    await ctx.db.delete("sharedDemoBaselineRow", row._id);
  const domainRestore = await restoreMutableDemoStoreRowsWithCtx(
    ctx,
    args.storeId,
  );
  await rollSharedDemoOpeningBaselineWithCtx(ctx, {
    now: args.now,
    storeId: args.storeId,
  });

  for (const [domain, expectedCount] of Object.entries(
    domainRestore.expectedCounts,
  )) {
    await ctx.db.insert("sharedDemoBaselineRow", {
      baselineVersion: SHARED_DEMO_BASELINE.version,
      domain,
      expectedCount,
      storeId: args.storeId,
    });
  }

  completeRestore(
    {
      baselineVersion: SHARED_DEMO_BASELINE.version,
      epoch: 0,
      status: "restoring",
    },
    {
      actualCounts: domainRestore.actualCounts,
      expectedCounts: domainRestore.expectedCounts,
      now: args.now,
    },
  );
  return {
    actualCounts: domainRestore.actualCounts,
    expectedCounts: domainRestore.expectedCounts,
    restoredDocuments: domainRestore.restored,
  };
}

async function readRestoreStateWithCtx(
  ctx: Pick<MutationCtx, "db">,
  storeId: Id<"store">,
) {
  return ctx.db
    .query("sharedDemoRestoreState")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
}

function requireMatchingRestoreLease<T extends RestoreState>(
  state: T | null,
  args: Pick<RestoreLeaseArgs, "epoch" | "idempotencyKey">,
) {
  const current = requireCurrentSharedDemoBaseline(state);
  if (
    current.status !== "restoring" ||
    current.epoch !== args.epoch ||
    current.idempotencyKey !== args.idempotencyKey
  ) {
    throw new Error("The demo restore lease changed.");
  }
  return current;
}

async function scheduleRestoreContinuation(
  ctx: Pick<MutationCtx, "scheduler">,
  args: RestoreLeaseArgs,
) {
  await ctx.scheduler.runAfter(
    0,
    (internal as any).sharedDemo.scheduledRestore.continueRestore,
    args,
  );
}

export async function beginRestoreLeaseWithCtx(
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  args: {
    cleanupTerminalId?: Id<"posTerminal">;
    idempotencyKey: string;
    now?: number;
    source: "hourly" | "manual";
    storeId: Id<"store">;
  },
) {
  const now = args.now ?? Date.now();
  const current = requireCurrentSharedDemoBaseline(
    await readRestoreStateWithCtx(ctx, args.storeId),
  );
  const decision = beginRestore(current, {
    idempotencyKey: args.idempotencyKey,
    now,
  });
  if (decision.kind !== "started") {
    const cleanupTerminalIds = args.cleanupTerminalId
      ? [...new Set([...(current.cleanupTerminalIds ?? []), args.cleanupTerminalId])]
      : current.cleanupTerminalIds;
    if (cleanupTerminalIds !== current.cleanupTerminalIds) {
      await ctx.db.patch("sharedDemoRestoreState", current._id, {
        cleanupTerminalIds,
      });
    }
    if (current.status === "restoring" && current.idempotencyKey) {
      await scheduleRestoreContinuation(ctx, {
        epoch: current.epoch,
        idempotencyKey: current.idempotencyKey,
        source: current.restoreSource ?? args.source,
        storeId: args.storeId,
      });
    }
    return {
      baselineVersion: current.baselineVersion,
      epoch: current.epoch,
      kind: decision.kind,
    };
  }
  await ctx.db.patch("sharedDemoRestoreState", current._id, {
    ...decision.state,
    appliedAt: undefined,
    cleanupTerminalIds: args.cleanupTerminalId
      ? [args.cleanupTerminalId]
      : undefined,
    completedAt: undefined,
    failureCode: undefined,
    phase: "leased",
    restoredDocuments: undefined,
    restoreSource: args.source,
  });
  await scheduleRestoreContinuation(ctx, {
    epoch: decision.state.epoch,
    idempotencyKey: args.idempotencyKey,
    source: args.source,
    storeId: args.storeId,
  });
  return {
    baselineVersion: SHARED_DEMO_BASELINE.version,
    epoch: decision.state.epoch,
    kind: "started" as const,
  };
}

export async function applyRestoreLeaseWithCtx(
  ctx: MutationCtx,
  args: RestoreLeaseArgs & { now?: number },
) {
  const current = requireCurrentSharedDemoBaseline(
    await readRestoreStateWithCtx(ctx, args.storeId),
  );
  if (
    current.epoch === args.epoch &&
    current.idempotencyKey === args.idempotencyKey &&
    current.phase === "applied" &&
    current.appliedAt !== undefined &&
    current.restoredDocuments !== undefined &&
    (current.cleanupTerminalIds?.length ?? 0) === 0
  ) {
    return {
      appliedAt: current.appliedAt,
      restoredDocuments: current.restoredDocuments,
    };
  }
  const state = requireMatchingRestoreLease(current, args);
  if (state.phase !== "leased" && state.phase !== "applied") {
    throw new Error("The demo restore phase changed.");
  }
  const appliedAt = args.now ?? Date.now();
  const result = state.phase === "applied"
    ? {
        restoredDocuments: state.restoredDocuments ?? 0,
      }
    : await applyBaselineDocumentsWithCtx(ctx, {
        now: appliedAt,
        storeId: args.storeId,
      });
  for (const terminalId of state.cleanupTerminalIds ?? []) {
    const terminal = await ctx.db.get("posTerminal", terminalId);
    if (!terminal) continue;
    if (terminal.storeId !== args.storeId) {
      throw new Error("The demo browser terminal could not be verified.");
    }
    const remainingSessions = await ctx.db
      .query("registerSession")
      .withIndex("by_terminalId", (q) => q.eq("terminalId", terminalId))
      .take(1);
    if (remainingSessions.length > 0) {
      throw new Error("Demo browser sessions could not be reset.");
    }
    await ctx.db.delete("posTerminal", terminal._id);
  }
  await ctx.db.patch("sharedDemoRestoreState", state._id, {
    appliedAt: state.appliedAt ?? appliedAt,
    cleanupTerminalIds: undefined,
    completedAt: state.appliedAt ?? appliedAt,
    phase: "applied",
    restoredDocuments: result.restoredDocuments,
  });
  return { ...result, appliedAt: state.appliedAt ?? appliedAt };
}

export async function completeRestoreLeaseWithCtx(
  ctx: MutationCtx,
  args: RestoreLeaseArgs & { appliedAt: number; now?: number },
) {
  const current = requireCurrentSharedDemoBaseline(
    await readRestoreStateWithCtx(ctx, args.storeId),
  );
  if (
    current.status === "ready" &&
    current.epoch === args.epoch &&
    current.idempotencyKey === args.idempotencyKey &&
    current.phase === "applied" &&
    current.appliedAt === args.appliedAt
  ) {
    return {
      baselineVersion: current.baselineVersion,
      epoch: current.epoch,
    };
  }
  const state = requireMatchingRestoreLease(current, args);
  if (
    state.phase !== "applied" ||
    state.appliedAt !== args.appliedAt ||
    (state.cleanupTerminalIds?.length ?? 0) > 0
  ) {
    throw new Error("The demo baseline has not been applied.");
  }
  const ready = completeRestore(state, {
    actualCounts: SHARED_DEMO_BASELINE.expectedCounts,
    expectedCounts: SHARED_DEMO_BASELINE.expectedCounts,
    now: args.now ?? Date.now(),
  });
  await ctx.db.patch("sharedDemoRestoreState", state._id, ready);
  await ctx.db.insert("sharedDemoRestoreAudit", {
    baselineVersion: ready.baselineVersion,
    epoch: ready.epoch,
    occurredAt: ready.completedAt!,
    outcome: "ready",
    source: args.source,
    storeId: args.storeId,
  });
  return { baselineVersion: ready.baselineVersion, epoch: ready.epoch };
}

export async function failRestoreLeaseWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: RestoreLeaseArgs & { now?: number },
) {
  const state = await readRestoreStateWithCtx(ctx, args.storeId);
  if (
    !state ||
    state.status !== "restoring" ||
    state.epoch !== args.epoch ||
    state.idempotencyKey !== args.idempotencyKey
  ) {
    return { kind: "stale" as const };
  }
  const failedAt = args.now ?? Date.now();
  await ctx.db.patch("sharedDemoRestoreState", state._id, {
    appliedAt: undefined,
    cleanupTerminalIds: undefined,
    completedAt: undefined,
    failureCode: SHARED_DEMO_RESTORE_FAILURE_CODE,
    phase: undefined,
    restoredDocuments: undefined,
    status: "failed",
  });
  await ctx.db.insert("sharedDemoRestoreAudit", {
    baselineVersion: state.baselineVersion,
    epoch: state.epoch,
    occurredAt: failedAt,
    outcome: "failed",
    source: args.source,
    storeId: args.storeId,
  });
  return { kind: "failed" as const };
}

export const beginRestoreLease = internalMutation({
  args: {
    cleanupTerminalId: v.optional(v.id("posTerminal")),
    idempotencyKey: v.string(),
    now: v.optional(v.number()),
    source: restoreSource,
    storeId: v.id("store"),
  },
  handler: beginRestoreLeaseWithCtx,
});

export const applyRestoreLease = internalMutation({
  args: {
    epoch: v.number(),
    idempotencyKey: v.string(),
    now: v.optional(v.number()),
    source: restoreSource,
    storeId: v.id("store"),
  },
  handler: applyRestoreLeaseWithCtx,
});

export const completeRestoreLease = internalMutation({
  args: {
    appliedAt: v.number(),
    epoch: v.number(),
    idempotencyKey: v.string(),
    now: v.optional(v.number()),
    source: restoreSource,
    storeId: v.id("store"),
  },
  handler: completeRestoreLeaseWithCtx,
});

export const failRestoreLease = internalMutation({
  args: {
    epoch: v.number(),
    idempotencyKey: v.string(),
    now: v.optional(v.number()),
    source: restoreSource,
    storeId: v.id("store"),
  },
  handler: failRestoreLeaseWithCtx,
});

export async function requireReadySharedDemoWriteWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: { expectedEpoch?: number; storeId: Id<"store"> },
) {
  const state = await ctx.db
    .query("sharedDemoRestoreState")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .unique();
  if (!state) throw new Error("Demo restore state is unavailable.");
  if (args.expectedEpoch !== undefined) {
    return assertSharedDemoWriteEpoch(state, args.expectedEpoch);
  }
  if (state.status !== "ready") {
    throw new Error("The demo is being restored. Try again shortly.");
  }
  return state;
}
