import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

export type ReportingRunStatus =
  "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

const RUN_TRANSITIONS: Record<ReportingRunStatus, Set<ReportingRunStatus>> = {
  pending: new Set(["running", "cancelled", "failed"]),
  running: new Set(["paused", "completed", "failed", "cancelled"]),
  paused: new Set(["running", "cancelled"]),
  completed: new Set(),
  failed: new Set(["running", "cancelled"]),
  cancelled: new Set(),
};

export function assertReportingRunTransition(
  current: ReportingRunStatus,
  next: ReportingRunStatus,
) {
  if (current === next) return;
  if (!RUN_TRANSITIONS[current].has(next)) {
    throw new Error(`Invalid reporting run transition: ${current} -> ${next}`);
  }
}

export function buildReportingRun(input: {
  actorKind: "human" | "automation";
  actorUserId?: string;
  automationIdentity?: string;
  createdAt: number;
  domain: string;
  factContractVersion: number;
  metricContractVersion: number;
  operation: string;
  organizationId: string;
  projectionContractVersion: number;
  requestKey?: string;
  runType:
    | "identity_backfill"
    | "backfill"
    | "rebuild"
    | "reconciliation"
    | "repair"
    | "activation"
    | "rollback"
    | "export"
    | "custom_range"
    | "cutover";
  storeId: string;
}) {
  if (input.actorKind === "human" && !input.actorUserId) {
    throw new Error("Human reporting runs require an actor user");
  }
  if (input.actorKind === "automation" && !input.automationIdentity) {
    throw new Error("Automation reporting runs require an automation identity");
  }
  return {
    ...input,
    failedCount: 0,
    processedCount: 0,
    status: "pending" as const,
  };
}

export async function createReportingRunWithCtx(
  ctx: MutationCtx,
  input: Omit<
    Parameters<typeof buildReportingRun>[0],
    "organizationId" | "storeId"
  > & {
    organizationId: Id<"organization">;
    storeId: Id<"store">;
  },
) {
  if (input.requestKey) {
    const matches = await ctx.db
      .query("reportingRun")
      .withIndex("by_storeId_runType_requestKey", (q) =>
        q
          .eq("storeId", input.storeId)
          .eq("runType", input.runType)
          .eq("requestKey", input.requestKey),
      )
      .take(2);
    if (matches.length > 1) {
      throw new Error("Reporting run identity is not unique");
    }
    if (matches[0]) {
      return { created: false as const, run: matches[0] };
    }
  }
  const record = buildReportingRun({
    ...input,
    organizationId: String(input.organizationId),
    storeId: String(input.storeId),
  });
  const runId = await ctx.db.insert("reportingRun", {
    ...record,
    actorUserId: record.actorUserId as Id<"athenaUser"> | undefined,
    organizationId: input.organizationId,
    storeId: input.storeId,
  });
  const run = await ctx.db.get("reportingRun", runId);
  if (!run) throw new Error("Reporting run could not be created");
  await ctx.db.insert("reportingRunEvent", {
    eventType: "created",
    occurredAt: input.createdAt,
    outcome: "pending",
    runId,
    sequence: 1,
    storeId: input.storeId,
  });
  return { created: true as const, run };
}
