import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { SHARED_DEMO_BASELINE_VERSION } from "./config";
import { restoreMutableDemoStoreRowsWithCtx } from "./domainRestore";

export const SHARED_DEMO_BASELINE = {
  version: SHARED_DEMO_BASELINE_VERSION,
  narrative: "A product-led neighborhood store in an active operating day.",
  expectedCounts: {
    cash: 1,
    inventory: 1,
    operations: 1,
    orders: 1,
    pos: 1,
    staff: 1,
  },
} as const;

export type RestoreState = {
  baselineVersion: number;
  completedAt?: number;
  epoch: number;
  failureCode?: string;
  idempotencyKey?: string;
  startedAt?: number;
  status: "ready" | "restoring" | "failed";
};

export function requireCurrentSharedDemoBaseline<T extends RestoreState>(
  state: T | null,
): T {
  if (!state || state.baselineVersion !== SHARED_DEMO_BASELINE.version) {
    throw new Error("The shared demo baseline requires provisioning.");
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

export function assertSharedDemoWriteEpoch(state: RestoreState, expectedEpoch: number) {
  if (state.status !== "ready" || state.epoch !== expectedEpoch) {
    throw new Error("The shared demo is being restored. Try again shortly.");
  }
  return state;
}

function baselineMatches(actualCounts: Record<string, number>, expectedCounts: Record<string, number>) {
  return Object.entries(expectedCounts).every(
    ([domain, count]) => actualCounts[domain] === count,
  ) && Object.keys(actualCounts).length === Object.keys(expectedCounts).length;
}

export function completeRestore(
  state: RestoreState,
  args: { actualCounts: Record<string, number>; expectedCounts: Record<string, number>; now: number },
): RestoreState {
  if (state.status !== "restoring" || !baselineMatches(args.actualCounts, args.expectedCounts)) {
    throw new Error("Shared demo baseline verification failed.");
  }
  return {
    baselineVersion: SHARED_DEMO_BASELINE.version,
    completedAt: args.now,
    epoch: state.epoch,
    status: "ready",
  };
}

const restoreSource = v.union(v.literal("hourly"), v.literal("manual"));

export async function restoreBaselineWithCtx(
  ctx: MutationCtx,
  args: { idempotencyKey: string; now?: number; source: "hourly" | "manual"; storeId: Id<"store"> },
) {
    const now = args.now ?? Date.now();
    const existing = await ctx.db
      .query("sharedDemoRestoreState")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .unique();
    const current = requireCurrentSharedDemoBaseline(existing);
    const decision = beginRestore(current, {
      idempotencyKey: args.idempotencyKey,
      now,
    });
    if (decision.kind !== "started") {
      return { baselineVersion: current.baselineVersion, epoch: current.epoch, kind: decision.kind };
    }

    await ctx.db.patch("sharedDemoRestoreState", current._id, decision.state);

    const existingRows = await ctx.db
      .query("sharedDemoBaselineRow")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .take(20);
    for (const row of existingRows) await ctx.db.delete("sharedDemoBaselineRow", row._id);
    const domainRestore = await restoreMutableDemoStoreRowsWithCtx(ctx, args.storeId);

    for (const [domain, expectedCount] of Object.entries(domainRestore.expectedCounts)) {
      await ctx.db.insert("sharedDemoBaselineRow", {
        baselineVersion: SHARED_DEMO_BASELINE.version,
        domain,
        expectedCount,
        storeId: args.storeId,
      });
    }

    const ready = completeRestore(decision.state, {
      actualCounts: domainRestore.actualCounts,
      expectedCounts: domainRestore.expectedCounts,
      now,
    });
    const state = await ctx.db
      .query("sharedDemoRestoreState")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .unique();
    if (!state) throw new Error("Shared demo restore state disappeared.");
    await ctx.db.patch("sharedDemoRestoreState", state._id, ready);
    await ctx.db.insert("sharedDemoRestoreAudit", {
      baselineVersion: ready.baselineVersion,
      epoch: ready.epoch,
      occurredAt: now,
      outcome: "ready",
      source: args.source,
      storeId: args.storeId,
    });
    await ctx.scheduler.runAfter(
      0,
      (internal as any).reporting.readModels.materialize
        .materializeActiveReportsWorkspaceForStore,
      { storeId: args.storeId },
    );
    return {
      baselineVersion: ready.baselineVersion,
      epoch: ready.epoch,
      kind: "started" as const,
      restoredDocuments: domainRestore.restored,
    };
}

export const restoreBaseline = internalMutation({
  args: {
    idempotencyKey: v.string(),
    now: v.optional(v.number()),
    source: restoreSource,
    storeId: v.id("store"),
  },
  handler: restoreBaselineWithCtx,
});

export async function requireReadySharedDemoWriteWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: { expectedEpoch?: number; storeId: Id<"store"> },
) {
  const state = await ctx.db
    .query("sharedDemoRestoreState")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .unique();
  if (!state) throw new Error("Shared demo restore state is unavailable.");
  if (args.expectedEpoch !== undefined) {
    return assertSharedDemoWriteEpoch(state, args.expectedEpoch);
  }
  if (state.status !== "ready") {
    throw new Error("The shared demo is being restored. Try again shortly.");
  }
  return state;
}
