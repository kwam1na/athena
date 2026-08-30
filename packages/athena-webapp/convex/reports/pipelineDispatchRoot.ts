import { makeFunctionReference } from "convex/server";
import type { MutationCtx } from "../_generated/server";

/**
 * The cron's lightweight scheduling root must not import lane implementations.
 * Canonical folding and legacy maintenance can share this root without pulling
 * their worker callers back into a backend dependency cycle.
 */
export async function dispatchReportPipeline(ctx: MutationCtx) {
  const lanes = [
    makeFunctionReference<"mutation", Record<string, never>>(
      "reports/pipelineDispatch:dispatchDays",
    ),
    makeFunctionReference<"mutation", Record<string, never>>(
      "reports/pipelineDispatch:dispatchLegacy",
    ),
    makeFunctionReference<"mutation", Record<string, never>>(
      "reports/pipelineDispatch:dispatchCloseEvidence",
    ),
    makeFunctionReference<"mutation", Record<string, never>>(
      "reports/pipelineDispatch:dispatchOverview",
    ),
    makeFunctionReference<"mutation", Record<string, never>>(
      "reports/pipelineDispatch:maintenance",
    ),
    makeFunctionReference<"mutation", Record<string, never>>(
      "reports/pipelineDispatch:dispatchResolveWeekDate",
    ),
    makeFunctionReference<"mutation", Record<string, never>>(
      "reports/pipelineDispatch:dispatchCurrent",
    ),
    makeFunctionReference<"mutation", Record<string, never>>(
      "reports/pipelineDispatch:dispatchAccept",
    ),
    makeFunctionReference<"mutation", Record<string, never>>(
      "reports/pipelineDispatch:dispatchRefresh",
    ),
    makeFunctionReference<"mutation", Record<string, never>>(
      "reports/pipelineDispatch:dispatchInventory",
    ),
    makeFunctionReference<"mutation", Record<string, never>>(
      "reports/pipelineDispatch:dispatchRollup",
    ),
    makeFunctionReference<"mutation", Record<string, never>>(
      "reports/pipelineDispatch:dispatchWeeklyRecovery",
    ),
    makeFunctionReference<"mutation", Record<string, never>>(
      "reports/pipelineDispatch:dispatchSummaryRanges",
    ),
    makeFunctionReference<"mutation", Record<string, never>>(
      "reports/pipelineDispatch:dispatchRetention",
    ),
  ] as const;
  for (const lane of lanes) {
    await ctx.scheduler.runAfter(0, lane, {});
  }
  return { lanesScheduled: lanes.length };
}
