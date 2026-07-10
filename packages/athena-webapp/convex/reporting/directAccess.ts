import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import { requireReportingStoreAccess } from "./access";

export const reportingDirectAccessOperationValidator = v.union(
  v.literal("custom_range_status"),
  v.literal("custom_range_result"),
  v.literal("export_status"),
  v.literal("export_download"),
);

type ReportingDirectAccessOperation =
  | "custom_range_status"
  | "custom_range_result"
  | "export_status"
  | "export_download";

async function actorRefWithCtx(ctx: MutationCtx) {
  try {
    return String((await requireAuthenticatedAthenaUserWithCtx(ctx))._id);
  } catch {
    return undefined;
  }
}

export async function recordReportingDirectAccessDenialWithCtx(
  ctx: MutationCtx,
  input: {
    operation: ReportingDirectAccessOperation;
    requestedStoreRef: string;
    safeReason: string;
    storeId?: Id<"store">;
  },
) {
  const actorRef = await actorRefWithCtx(ctx);
  await ctx.db.insert("reportingIntegrityAttempt", {
    ...(actorRef ? { actorRef } : {}),
    operation: input.operation,
    outcome: "denied",
    occurredAt: Date.now(),
    requestedStoreRef: input.requestedStoreRef,
    safeReason: input.safeReason,
    ...(input.storeId ? { storeId: input.storeId } : {}),
  });
}

export async function preflightReportingRunAccessWithCtx(
  ctx: MutationCtx,
  args: {
    expectedRunType: "custom_range" | "export";
    operation: ReportingDirectAccessOperation;
    runId: Id<"reportingRun">;
    storeId: Id<"store">;
  },
) {
  try {
    await requireReportingStoreAccess(ctx, args.storeId);
  } catch {
    await recordReportingDirectAccessDenialWithCtx(ctx, {
      operation: args.operation,
      requestedStoreRef: String(args.storeId),
      safeReason: "reporting_store_access_denied",
    });
    return { allowed: false as const };
  }
  const run = await ctx.db.get("reportingRun", args.runId);
  if (
    !run ||
    run.storeId !== args.storeId ||
    run.runType !== args.expectedRunType
  ) {
    await recordReportingDirectAccessDenialWithCtx(ctx, {
      operation: args.operation,
      requestedStoreRef: String(args.storeId),
      safeReason: "reporting_run_scope_mismatch",
      storeId: args.storeId,
    });
    return { allowed: false as const };
  }
  return { allowed: true as const };
}

export const preflightReportingRunAccess = internalMutation({
  args: {
    expectedRunType: v.union(v.literal("custom_range"), v.literal("export")),
    operation: reportingDirectAccessOperationValidator,
    runId: v.id("reportingRun"),
    storeId: v.id("store"),
  },
  handler: preflightReportingRunAccessWithCtx,
});

export const recordReportingRunReadRaceDenial = internalMutation({
  args: {
    operation: reportingDirectAccessOperationValidator,
    requestedStoreRef: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) =>
    recordReportingDirectAccessDenialWithCtx(ctx, {
      operation: args.operation,
      requestedStoreRef: args.requestedStoreRef,
      safeReason: "reporting_run_read_authority_changed",
      storeId: args.storeId,
    }),
});
