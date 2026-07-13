import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { isSharedDemoEnabled } from "./config";

export function sharedDemoRestoreEnabled(environment: Record<string, string | undefined>) {
  return isSharedDemoEnabled(environment);
}

export const runHourlyRestore = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!sharedDemoRestoreEnabled(process.env)) return { kind: "disabled" as const };
    const storeId = process.env.ATHENA_SHARED_DEMO_STORE_ID;
    if (!storeId) return { kind: "disabled" as const };
    const now = Date.now();
    return ctx.runMutation((internal as any).sharedDemo.restore.restoreBaseline, {
      idempotencyKey: `hourly:${Math.floor(now / 3_600_000)}`,
      now,
      source: "hourly",
      storeId,
    });
  },
});
