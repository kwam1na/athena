import { v } from "convex/values";

import { internal } from "../_generated/api";
import { internalAction, type ActionCtx } from "../_generated/server";
import { isSharedDemoEnabled } from "./config";

export function sharedDemoRestoreEnabled(
  environment: Record<string, string | undefined>,
) {
  return isSharedDemoEnabled(environment);
}

type RestoreCoordinatorArgs = {
  epoch: number;
  idempotencyKey: string;
  source: "hourly" | "manual";
  storeId: string;
};

export async function continueRestoreWithCtx(
  ctx: Pick<ActionCtx, "runMutation">,
  args: RestoreCoordinatorArgs,
) {
  try {
    const applied: { appliedAt: number; restoredDocuments: number } =
      await ctx.runMutation(
        (internal as any).sharedDemo.restore.applyRestoreLease,
        args,
      );
    const completed: { baselineVersion: number; epoch: number } =
      await ctx.runMutation(
        (internal as any).sharedDemo.restore.completeRestoreLease,
        { ...args, appliedAt: applied.appliedAt },
      );
    return {
      ...completed,
      kind: "started" as const,
      restoredDocuments: applied.restoredDocuments,
    };
  } catch {
    await ctx.runMutation(
      (internal as any).sharedDemo.restore.failRestoreLease,
      args,
    );
    return { epoch: args.epoch, kind: "failed" as const };
  }
}

export const continueRestore = internalAction({
  args: {
    epoch: v.number(),
    idempotencyKey: v.string(),
    source: v.union(v.literal("hourly"), v.literal("manual")),
    storeId: v.id("store"),
  },
  handler: continueRestoreWithCtx,
});

export async function runHourlyRestoreWithCtx(
  ctx: Pick<ActionCtx, "runMutation">,
  environment: Record<string, string | undefined>,
): Promise<unknown> {
    if (!sharedDemoRestoreEnabled(environment))
      return { kind: "disabled" as const };
    const storeId = environment.ATHENA_SHARED_DEMO_STORE_ID;
    if (!storeId) return { kind: "disabled" as const };
    const now = Date.now();
    const provisioned: { storeId: string } = await ctx.runMutation(
      (internal as any).sharedDemo.provision.provisionSharedDemo,
      { now },
    );
    if (String(provisioned.storeId) !== storeId) {
      throw new Error("The configured demo store does not match provisioning.");
    }
    const idempotencyKey = `hourly:${Math.floor(now / 3_600_000)}`;
    const begun: {
      baselineVersion: number;
      epoch: number;
      kind: "busy" | "existing" | "started";
    } = await ctx.runMutation(
      (internal as any).sharedDemo.restore.beginRestoreLease,
      {
        idempotencyKey,
        now,
        source: "hourly",
        storeId,
      },
    );
    return begun;
}

export const runHourlyRestore = internalAction({
  args: {},
  handler: async (ctx): Promise<unknown> =>
    runHourlyRestoreWithCtx(ctx, process.env),
});

/** Callable production verification path; uses the exact cron implementation. */
export const verifyHourlyRestoreNow = internalAction({
  args: {},
  handler: async (ctx): Promise<unknown> =>
    runHourlyRestoreWithCtx(ctx, process.env),
});
