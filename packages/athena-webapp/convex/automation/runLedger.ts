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

export type AutomationDecisionEvidenceValue =
  | string
  | number
  | boolean
  | string[]
  | null;

export type AutomationDecisionEvidence = {
  kind: string;
  classification?: string;
  eligible?: boolean;
  observed?: Record<string, AutomationDecisionEvidenceValue>;
  policy?: Record<string, AutomationDecisionEvidenceValue>;
  gates?: Array<{
    key: string;
    passed: boolean;
    reason?: string;
  }>;
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
  decisionEvidence?: AutomationDecisionEvidence;
  eventIds?: Id<"operationalEvent">[];
  error?: {
    code: string;
    message: string;
  };
};

export type OpeningAutoStartBlockerHandling = "skip" | "manager_review";

export const OPENING_AUTO_START_POLICY_DOMAIN = "daily_operations";
export const OPENING_AUTO_START_POLICY_ACTION = "opening.auto_start";
export const EOD_AUTO_COMPLETE_POLICY_ACTION = "eod.auto_complete";
export const DEFAULT_OPENING_LOCAL_START_MINUTES = 0;
export const DEFAULT_OPENING_BLOCKER_HANDLING: OpeningAutoStartBlockerHandling =
  "skip";
export const DEFAULT_EOD_LOCAL_COMPLETION_WINDOW_MINUTES = 0;
export const DEFAULT_EOD_MAX_ABSOLUTE_CASH_VARIANCE = 0;
export const DEFAULT_EOD_MAX_VOIDED_SALE_COUNT = 0;
export const DEFAULT_EOD_MAX_VOIDED_SALE_TOTAL = 0;

export type OpeningAutoStartPolicyConfig = {
  configured: boolean;
  mode: AutomationPolicyMode;
  openingBlockerHandling: OpeningAutoStartBlockerHandling;
  openingLocalStartMinutes: number;
  paused: boolean;
  policy: Doc<"automationPolicy"> | null;
};

export type EodAutoCompletePolicyConfig = {
  cleanDayAutoCompleteEnabled: boolean;
  configured: boolean;
  localCompletionWindowMinutes: number;
  maxAbsoluteCashVariance: number;
  maxVoidedSaleCount: number;
  maxVoidedSaleTotal: number;
  mode: AutomationPolicyMode;
  paused: boolean;
  policy: Doc<"automationPolicy"> | null;
};

function normalizeOpeningLocalStartMinutes(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < 24 * 60
    ? value
    : DEFAULT_OPENING_LOCAL_START_MINUTES;
}

function normalizeEodLocalCompletionWindowMinutes(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < 24 * 60
    ? value
    : DEFAULT_EOD_LOCAL_COMPLETION_WINDOW_MINUTES;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

function normalizeOpeningBlockerHandling(
  value: unknown,
): OpeningAutoStartBlockerHandling {
  return value === "manager_review" ? "manager_review" : "skip";
}

function assertValidOpeningLocalStartMinutes(value: number) {
  if (!Number.isInteger(value) || value < 0 || value >= 24 * 60) {
    throw new Error("Opening local start minutes must be within one local day.");
  }
}

function assertValidOpeningBlockerHandling(
  value: OpeningAutoStartBlockerHandling,
) {
  if (value !== "skip" && value !== "manager_review") {
    throw new Error("Opening blocker handling is not supported.");
  }
}

function assertValidEodLocalCompletionWindowMinutes(value: number) {
  if (!Number.isInteger(value) || value < 0 || value >= 24 * 60) {
    throw new Error("EOD local completion window must be within one local day.");
  }
}

function assertValidEodThreshold(value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("EOD auto-complete thresholds must be non-negative.");
  }
}

function assertValidOperatingTimezoneOffsetMinutes(value?: number) {
  if (value === undefined) return;

  if (
    !Number.isInteger(value) ||
    value < -14 * 60 ||
    value > 14 * 60
  ) {
    throw new Error("Operating timezone offset must be within UTC-14 to UTC+14.");
  }
}

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

export async function getOpeningAutoStartPolicyConfigWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    storeId: Id<"store">;
  },
): Promise<OpeningAutoStartPolicyConfig> {
  const policies = await listAutomationPoliciesForStoreActionWithCtx(ctx, {
    action: OPENING_AUTO_START_POLICY_ACTION,
    domain: OPENING_AUTO_START_POLICY_DOMAIN,
    storeId: args.storeId,
  });

  if (policies.length > 1) {
    throw new Error(
      "Opening auto-start policy configuration is ambiguous for this store.",
    );
  }

  const policy = policies[0] ?? null;

  return {
    configured: Boolean(policy),
    mode: policy?.mode ?? "disabled",
    openingBlockerHandling: normalizeOpeningBlockerHandling(
      policy?.openingBlockerHandling,
    ),
    openingLocalStartMinutes: normalizeOpeningLocalStartMinutes(
      policy?.openingLocalStartMinutes,
    ),
    paused: Boolean(policy?.paused),
    policy,
  };
}

export async function getEodAutoCompletePolicyConfigWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    storeId: Id<"store">;
  },
): Promise<EodAutoCompletePolicyConfig> {
  const policies = await listAutomationPoliciesForStoreActionWithCtx(ctx, {
    action: EOD_AUTO_COMPLETE_POLICY_ACTION,
    domain: OPENING_AUTO_START_POLICY_DOMAIN,
    storeId: args.storeId,
  });

  if (policies.length > 1) {
    throw new Error(
      "EOD auto-complete policy configuration is ambiguous for this store.",
    );
  }

  const policy = policies[0] ?? null;

  return {
    cleanDayAutoCompleteEnabled: Boolean(
      policy?.eodCleanDayAutoCompleteEnabled,
    ),
    configured: Boolean(policy),
    localCompletionWindowMinutes: normalizeEodLocalCompletionWindowMinutes(
      policy?.eodLocalCompletionWindowMinutes,
    ),
    maxAbsoluteCashVariance: normalizeNonNegativeInteger(
      policy?.eodMaxAbsoluteCashVariance,
      DEFAULT_EOD_MAX_ABSOLUTE_CASH_VARIANCE,
    ),
    maxVoidedSaleCount: normalizeNonNegativeInteger(
      policy?.eodMaxVoidedSaleCount,
      DEFAULT_EOD_MAX_VOIDED_SALE_COUNT,
    ),
    maxVoidedSaleTotal: normalizeNonNegativeInteger(
      policy?.eodMaxVoidedSaleTotal,
      DEFAULT_EOD_MAX_VOIDED_SALE_TOTAL,
    ),
    mode: policy?.mode ?? "disabled",
    paused: Boolean(policy?.paused),
    policy,
  };
}

export async function upsertOpeningAutoStartPolicyConfigWithCtx(
  ctx: MutationCtx,
  args: {
    mode: AutomationPolicyMode;
    openingBlockerHandling: OpeningAutoStartBlockerHandling;
    openingLocalStartMinutes: number;
    operatingTimezoneOffsetMinutes?: number;
    organizationId?: Id<"organization">;
    paused?: boolean;
    policyVersion?: string;
    rolloutNotes?: string;
    storeId: Id<"store">;
    updatedByUserId?: Id<"athenaUser">;
  },
) {
  assertValidOpeningLocalStartMinutes(args.openingLocalStartMinutes);
  assertValidOpeningBlockerHandling(args.openingBlockerHandling);
  assertValidOperatingTimezoneOffsetMinutes(args.operatingTimezoneOffsetMinutes);

  const policies = await listAutomationPoliciesForStoreActionWithCtx(ctx, {
    action: OPENING_AUTO_START_POLICY_ACTION,
    domain: OPENING_AUTO_START_POLICY_DOMAIN,
    storeId: args.storeId,
  });

  if (policies.length > 1) {
    throw new Error(
      "Opening auto-start policy configuration is ambiguous for this store.",
    );
  }

  const now = Date.now();
  const patch = {
    mode: args.mode,
    operatingTimezoneOffsetMinutes: args.operatingTimezoneOffsetMinutes,
    openingBlockerHandling: args.openingBlockerHandling,
    openingLocalStartMinutes: args.openingLocalStartMinutes,
    organizationId: args.organizationId,
    paused: args.paused ?? false,
    policyVersion: args.policyVersion ?? "daily-operations.v1",
    rolloutNotes: args.rolloutNotes,
    updatedAt: now,
    updatedByUserId: args.updatedByUserId,
  };
  const existingPolicy = policies[0] ?? null;

  if (existingPolicy) {
    await ctx.db.patch("automationPolicy", existingPolicy._id, patch);
    const updatedPolicy = await ctx.db.get(
      "automationPolicy",
      existingPolicy._id,
    );

    if (!updatedPolicy) {
      throw new Error("Opening auto-start policy could not be loaded.");
    }

    return updatedPolicy;
  }

  const policyId = await ctx.db.insert("automationPolicy", {
    ...patch,
    action: OPENING_AUTO_START_POLICY_ACTION,
    createdAt: now,
    domain: OPENING_AUTO_START_POLICY_DOMAIN,
    storeId: args.storeId,
  });
  const policy = await ctx.db.get("automationPolicy", policyId);

  if (!policy) {
    throw new Error("Opening auto-start policy could not be loaded.");
  }

  return policy;
}

export async function upsertEodAutoCompletePolicyConfigWithCtx(
  ctx: MutationCtx,
  args: {
    cleanDayAutoCompleteEnabled: boolean;
    localCompletionWindowMinutes: number;
    maxAbsoluteCashVariance: number;
    maxVoidedSaleCount: number;
    maxVoidedSaleTotal: number;
    mode: AutomationPolicyMode;
    operatingTimezoneOffsetMinutes?: number;
    organizationId?: Id<"organization">;
    paused?: boolean;
    policyVersion?: string;
    rolloutNotes?: string;
    storeId: Id<"store">;
    updatedByUserId?: Id<"athenaUser">;
  },
) {
  assertValidEodLocalCompletionWindowMinutes(
    args.localCompletionWindowMinutes,
  );
  assertValidEodThreshold(args.maxAbsoluteCashVariance);
  assertValidEodThreshold(args.maxVoidedSaleCount);
  assertValidEodThreshold(args.maxVoidedSaleTotal);
  assertValidOperatingTimezoneOffsetMinutes(args.operatingTimezoneOffsetMinutes);

  const policies = await listAutomationPoliciesForStoreActionWithCtx(ctx, {
    action: EOD_AUTO_COMPLETE_POLICY_ACTION,
    domain: OPENING_AUTO_START_POLICY_DOMAIN,
    storeId: args.storeId,
  });

  if (policies.length > 1) {
    throw new Error(
      "EOD auto-complete policy configuration is ambiguous for this store.",
    );
  }

  const now = Date.now();
  const patch = {
    eodCleanDayAutoCompleteEnabled: args.cleanDayAutoCompleteEnabled,
    eodLocalCompletionWindowMinutes: args.localCompletionWindowMinutes,
    eodMaxAbsoluteCashVariance: args.maxAbsoluteCashVariance,
    eodMaxVoidedSaleCount: args.maxVoidedSaleCount,
    eodMaxVoidedSaleTotal: args.maxVoidedSaleTotal,
    mode: args.mode,
    operatingTimezoneOffsetMinutes: args.operatingTimezoneOffsetMinutes,
    organizationId: args.organizationId,
    paused: args.paused ?? false,
    policyVersion: args.policyVersion ?? "daily-operations.v1",
    rolloutNotes: args.rolloutNotes,
    updatedAt: now,
    updatedByUserId: args.updatedByUserId,
  };
  const existingPolicy = policies[0] ?? null;

  if (existingPolicy) {
    await ctx.db.patch("automationPolicy", existingPolicy._id, patch);
    const updatedPolicy = await ctx.db.get("automationPolicy", existingPolicy._id);

    if (!updatedPolicy) {
      throw new Error("EOD auto-complete policy could not be loaded.");
    }

    return updatedPolicy;
  }

  const policyId = await ctx.db.insert("automationPolicy", {
    ...patch,
    action: EOD_AUTO_COMPLETE_POLICY_ACTION,
    createdAt: now,
    domain: OPENING_AUTO_START_POLICY_DOMAIN,
    storeId: args.storeId,
  });
  const policy = await ctx.db.get("automationPolicy", policyId);

  if (!policy) {
    throw new Error("EOD auto-complete policy could not be loaded.");
  }

  return policy;
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

export async function upsertAutomationRunWithCtx(
  ctx: MutationCtx,
  args: AutomationRunRecordInput,
) {
  const existingRun = await getAutomationRunByIdempotencyKeyWithCtx(ctx, {
    idempotencyKey: args.idempotencyKey,
    storeId: args.storeId,
  });

  if (!existingRun) {
    return recordAutomationRunWithCtx(ctx, args);
  }

  await ctx.db.patch("automationRun", existingRun._id, {
    ...args,
    appliedAt: args.outcome === "applied" ? existingRun.appliedAt : undefined,
    error: args.error,
    eventIds: args.eventIds ?? [],
    updatedAt: Date.now(),
  });

  const run = await ctx.db.get("automationRun", existingRun._id);

  if (!run) {
    throw new Error("Automation run could not be loaded after update.");
  }

  return run;
}

export async function patchAutomationRunOutcomeWithCtx(
  ctx: MutationCtx,
  args: {
    appliedAt?: number;
    decisionEvidence?: AutomationDecisionEvidence;
    error?: { code: string; message: string };
    eventIds?: Id<"operationalEvent">[];
    outcome: AutomationRunOutcome;
    runId: Id<"automationRun">;
  },
) {
  await ctx.db.patch("automationRun", args.runId, {
    appliedAt: args.appliedAt,
    decisionEvidence: args.decisionEvidence,
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
