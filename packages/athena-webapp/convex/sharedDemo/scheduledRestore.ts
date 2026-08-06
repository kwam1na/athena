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
  source: "daily" | "hourly" | "manual";
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
    source: v.union(v.literal("daily"), v.literal("hourly"), v.literal("manual")),
    storeId: v.id("store"),
  },
  handler: continueRestoreWithCtx,
});

/**
 * Milliseconds in the reset cycle, and so the width of the idempotency bucket.
 *
 * The bucket is what makes a retried or duplicated cron firing a no-op, so it
 * has to be exactly one cycle wide: narrower and a retry restores a second
 * time, wider and a genuine next-day reset is swallowed as already-done.
 */
const RESTORE_CYCLE_MS = 86_400_000;

/**
 * Bring the persisted foundation up to the code's baseline version.
 *
 * This is the half of the scheduled work that is SAFE to run at any time. It
 * writes `sharedDemoRestoreState` — which is what admission compares
 * `SHARED_DEMO_BASELINE_VERSION` against — but begins no restore lease, so it
 * never replaces a visitor's rows. Returns `null` when the demo is disabled.
 */
async function provisionForScheduledWorkWithCtx(
  ctx: Pick<ActionCtx, "runMutation">,
  environment: Record<string, string | undefined>,
): Promise<{ now: number; storeId: string } | null> {
  if (!sharedDemoRestoreEnabled(environment)) return null;
  const storeId = environment.ATHENA_SHARED_DEMO_STORE_ID;
  if (!storeId) return null;
  const now = Date.now();
  const provisioned: { storeId: string } = await ctx.runMutation(
    (internal as any).sharedDemo.provision.provisionSharedDemo,
    { now },
  );
  if (String(provisioned.storeId) !== storeId) {
    throw new Error("The configured demo store does not match provisioning.");
  }
  return { now, storeId };
}

/**
 * Hourly self-heal for a baseline version the deploy failed to migrate.
 *
 * Admission rejects every visitor while the persisted `baselineVersion` trails
 * the constant in code, and `scripts/deploy-vps.sh` migrates it right after
 * `convex deploy` — but a deploy-time failure would otherwise leave the demo
 * locked until the next scheduled run. At the old hourly restore cadence that
 * was at most an hour; a midnight-only reset would have made it up to a day.
 *
 * So the heal keeps the old hourly rhythm while the RESET moves to midnight.
 * They are deliberately different jobs: provisioning is idempotent and
 * non-destructive, whereas restoring wipes visitor activity — running that
 * hourly is exactly what the cadence change was meant to stop.
 */
export async function runHourlyProvisionHealWithCtx(
  ctx: Pick<ActionCtx, "runMutation">,
  environment: Record<string, string | undefined>,
): Promise<unknown> {
  const provisioned = await provisionForScheduledWorkWithCtx(ctx, environment);
  if (!provisioned) return { kind: "disabled" as const };
  return { kind: "provisioned" as const, storeId: provisioned.storeId };
}

export async function runDailyRestoreWithCtx(
  ctx: Pick<ActionCtx, "runMutation">,
  environment: Record<string, string | undefined>,
): Promise<unknown> {
    const provisioned = await provisionForScheduledWorkWithCtx(
      ctx,
      environment,
    );
    if (!provisioned) return { kind: "disabled" as const };
    const { now, storeId } = provisioned;
    // The UTC day number, which is also the demo store's own calendar day —
    // `Africa/Accra` is UTC+0 year-round. See the cron's note in `crons.ts`.
    const idempotencyKey = `daily:${Math.floor(now / RESTORE_CYCLE_MS)}`;
    const begun: {
      baselineVersion: number;
      epoch: number;
      kind: "busy" | "existing" | "started";
    } = await ctx.runMutation(
      (internal as any).sharedDemo.restore.beginRestoreLease,
      {
        idempotencyKey,
        now,
        source: "daily",
        storeId,
      },
    );
    return begun;
}

export const runDailyRestore = internalAction({
  args: {},
  handler: async (ctx): Promise<unknown> =>
    runDailyRestoreWithCtx(ctx, process.env),
});

export const runHourlyProvisionHeal = internalAction({
  args: {},
  handler: async (ctx): Promise<unknown> =>
    runHourlyProvisionHealWithCtx(ctx, process.env),
});

/** Callable production verification path; uses the exact cron implementation. */
export const verifyDailyRestoreNow = internalAction({
  args: {},
  handler: async (ctx): Promise<unknown> =>
    runDailyRestoreWithCtx(ctx, process.env),
});
