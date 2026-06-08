import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type {
  AutomationPolicyMode,
  AutomationRunOutcome,
} from "./actionRegistry";

export type AutomationSourceSubject = {
  type: string;
  id: string;
  label?: string;
};

export type AutomationRunRecordInput = {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  operatingDate: string;
  domain: string;
  action: string;
  triggerType: string;
  idempotencyKey: string;
  outcome: AutomationRunOutcome;
  policyMode: AutomationPolicyMode;
  policyVersion: string;
  mutationBoundary: string;
  sourceSubjects: AutomationSourceSubject[];
  snapshotCounts: Record<string, number>;
  decisionReason?: string;
  eventIds?: Id<"operationalEvent">[];
  error?: {
    code: string;
    message: string;
  };
};

export async function listAutomationPoliciesForStoreActionWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    action: string;
    domain: string;
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("automationPolicy")
    .withIndex("by_storeId_domain_action", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("domain", args.domain)
        .eq("action", args.action),
    )
    .take(2);
}

export async function getAutomationPolicyWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    action: string;
    domain: string;
    storeId: Id<"store">;
  },
) {
  const policies = await listAutomationPoliciesForStoreActionWithCtx(ctx, args);

  return policies[0] ?? null;
}

export async function listAutomationRunsByIdempotencyKeyWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    idempotencyKey: string;
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("automationRun")
    .withIndex("by_storeId_idempotencyKey", (q) =>
      q.eq("storeId", args.storeId).eq("idempotencyKey", args.idempotencyKey),
    )
    .take(50);
}

export async function getAutomationRunByIdempotencyKeyWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    idempotencyKey: string;
    storeId: Id<"store">;
  },
) {
  const runs = await listAutomationRunsByIdempotencyKeyWithCtx(ctx, args);

  return runs[0] ?? null;
}

export async function recordAutomationRunWithCtx(
  ctx: MutationCtx,
  args: AutomationRunRecordInput & { dedupe?: boolean },
) {
  if (args.dedupe !== false) {
    const existingRun = await getAutomationRunByIdempotencyKeyWithCtx(ctx, {
      idempotencyKey: args.idempotencyKey,
      storeId: args.storeId,
    });

    if (existingRun) {
      return existingRun;
    }
  }

  const now = Date.now();
  const { dedupe: _dedupe, ...runArgs } = args;
  const runId = await ctx.db.insert("automationRun", {
    ...runArgs,
    eventIds: args.eventIds ?? [],
    createdAt: now,
    updatedAt: now,
  });

  const run = await ctx.db.get("automationRun", runId);

  if (!run) {
    throw new Error("Automation run could not be loaded after insert.");
  }

  return run;
}

export async function patchAutomationRunOutcomeWithCtx(
  ctx: MutationCtx,
  args: {
    appliedAt?: number;
    error?: { code: string; message: string };
    eventIds?: Id<"operationalEvent">[];
    outcome: AutomationRunOutcome;
    runId: Id<"automationRun">;
  },
) {
  await ctx.db.patch("automationRun", args.runId, {
    appliedAt: args.appliedAt,
    error: args.error,
    eventIds: args.eventIds,
    outcome: args.outcome,
    updatedAt: Date.now(),
  });

  return ctx.db.get("automationRun", args.runId) as Promise<
    Doc<"automationRun"> | null
  >;
}

export async function listAutomationRunsForStoreDayActionWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    action: string;
    domain: string;
    operatingDate: string;
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("automationRun")
    .withIndex("by_storeId_operatingDate_domain_action", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("operatingDate", args.operatingDate)
        .eq("domain", args.domain)
        .eq("action", args.action),
    )
    .order("desc")
    .take(50);
}
