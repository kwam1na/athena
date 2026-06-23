import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type {
  AutomationActionDefinition,
  AutomationRunOutcome,
} from "./actionRegistry";
import {
  listAutomationPoliciesForStoreActionWithCtx,
  listAutomationRunsByIdempotencyKeyWithCtx,
  patchAutomationRunOutcomeWithCtx,
  recordAutomationRunWithCtx,
  type AutomationDecisionEvidence,
  type AutomationSourceSubject,
} from "./runLedger";

export const DEFAULT_AUTOMATION_POLICY_VERSION = "automation-foundation.v1";

type AdapterDecision = {
  outcome: Exclude<AutomationRunOutcome, "disabled" | "dry_run" | "applied">;
  decisionReason?: string;
  sourceSubjects: AutomationSourceSubject[];
  snapshotCounts: Record<string, number>;
  decisionEvidence?: AutomationDecisionEvidence;
};

type EvaluateAutomationActionArgs = {
  action: AutomationActionDefinition;
  adapterDecision: AdapterDecision;
  apply?: (args: {
    run: Doc<"automationRun">;
  }) => Promise<{
    eventIds?: Id<"operationalEvent">[];
    outcome?: "applied" | "prepared" | "skipped" | "failed";
    error?: { code: string; message: string };
  }>;
  idempotencyKey: string;
  operatingDate: string;
  organizationId?: Id<"organization">;
  storeId: Id<"store">;
};

function isValidOperatingDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = Date.parse(`${value}T00:00:00.000Z`);

  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}

function validateAdapterDecision(
  action: AutomationActionDefinition,
  decision: AdapterDecision,
) {
  if (!action.allowedOutcomes.includes(decision.outcome)) {
    return {
      code: "invalid_outcome",
      message: `Automation action ${action.domain}.${action.action} cannot record ${decision.outcome}.`,
    };
  }

  if (action.requiresSourceSubjects && decision.sourceSubjects.length === 0) {
    return {
      code: "missing_source_subjects",
      message: "Automation decision requires source subjects.",
    };
  }

  return null;
}

export async function evaluateAutomationActionWithCtx(
  ctx: MutationCtx,
  args: EvaluateAutomationActionArgs,
) {
  const existingRuns = await listAutomationRunsByIdempotencyKeyWithCtx(ctx, {
    idempotencyKey: args.idempotencyKey,
    storeId: args.storeId,
  });
  const appliedRun = existingRuns.find((run) => run.outcome === "applied");

  if (appliedRun) {
    return {
      action: "already_recorded" as const,
      run: appliedRun,
    };
  }

  const decisionError = !isValidOperatingDate(args.operatingDate)
    ? {
        code: "invalid_operating_date",
        message: "Automation requires an operating date in YYYY-MM-DD format.",
      }
    : validateAdapterDecision(args.action, args.adapterDecision);
  const policies = await listAutomationPoliciesForStoreActionWithCtx(ctx, {
    action: args.action.action,
    domain: args.action.domain,
    storeId: args.storeId,
  });
  const duplicatePolicyError =
    policies.length > 1
      ? {
          code: "duplicate_policy",
          message:
            "Automation policy configuration is ambiguous for this store action.",
        }
      : null;
  const policy = policies[0] ?? null;
  const policyMode = policy?.paused
    ? "disabled"
    : (policy?.mode ?? "disabled");
  const policyVersion =
    policy?.policyVersion ?? DEFAULT_AUTOMATION_POLICY_VERSION;
  const baseRunArgs = {
    action: args.action.action,
    decisionReason:
      decisionError?.message ?? args.adapterDecision.decisionReason,
    domain: args.action.domain,
    idempotencyKey: args.idempotencyKey,
    mutationBoundary: args.action.mutationBoundary,
    operatingDate: args.operatingDate,
    organizationId: args.organizationId,
    policyMode,
    policyVersion,
    decisionEvidence: args.adapterDecision.decisionEvidence,
    snapshotCounts: args.adapterDecision.snapshotCounts,
    sourceSubjects: args.adapterDecision.sourceSubjects,
    storeId: args.storeId,
    triggerType: args.action.triggerType,
  };

  if (decisionError || duplicatePolicyError) {
    const run = await recordAutomationRunWithCtx(ctx, {
      ...baseRunArgs,
      dedupe: false,
      decisionReason: (decisionError ?? duplicatePolicyError)?.message,
      error: (decisionError ?? duplicatePolicyError)!,
      outcome: "failed",
    });

    return {
      action: "recorded" as const,
      run,
    };
  }

  if (policyMode === "disabled") {
    const run = await recordAutomationRunWithCtx(ctx, {
      ...baseRunArgs,
      dedupe: false,
      decisionReason:
        args.adapterDecision.decisionReason ??
        "Automation policy is disabled for this store action.",
      outcome: "disabled",
    });

    return {
      action: "recorded" as const,
      run,
    };
  }

  if (policyMode === "dry_run") {
    const run = await recordAutomationRunWithCtx(ctx, {
      ...baseRunArgs,
      dedupe: false,
      outcome: "dry_run",
    });

    return {
      action: "recorded" as const,
      run,
    };
  }

  const run = await recordAutomationRunWithCtx(ctx, {
    ...baseRunArgs,
    dedupe: false,
    outcome: args.adapterDecision.outcome,
  });

  if (args.adapterDecision.outcome !== "eligible" || !args.apply) {
    return {
      action: "recorded" as const,
      run,
    };
  }

  const applied = await args.apply({ run });
  const patchedRun = await patchAutomationRunOutcomeWithCtx(ctx, {
    appliedAt:
      applied.outcome === "applied" || !applied.outcome
        ? Date.now()
        : undefined,
    decisionEvidence: args.adapterDecision.decisionEvidence,
    error: applied.error,
    eventIds: applied.eventIds,
    outcome: applied.outcome ?? "applied",
    runId: run._id,
  });

  return {
    action: "applied" as const,
    run: patchedRun ?? run,
  };
}
