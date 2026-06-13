import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { defineAutomationAction } from "../automation/actionRegistry";
import { evaluateAutomationActionWithCtx } from "../automation/automationFoundation";
import {
  DEFAULT_OPENING_BLOCKER_HANDLING,
  DEFAULT_OPENING_LOCAL_START_MINUTES,
  getOpeningAutoStartPolicyConfigWithCtx,
  listAutomationRunsForStoreDayActionWithCtx,
  recordAutomationRunWithCtx,
  upsertOpeningAutoStartPolicyConfigWithCtx,
  type OpeningAutoStartBlockerHandling,
} from "../automation/runLedger";
import {
  buildDailyOpeningSnapshotWithCtx,
  startStoreDayWithCtx,
} from "./dailyOpening";
import { buildDailyCloseSnapshotWithCtx } from "./dailyClose";
import { requireStoreFullAdminAccess } from "../stockOps/access";

export const DAILY_OPERATIONS_AUTOMATION_DOMAIN = "daily_operations";
const OPENING_AUTO_START_ACTION = "opening.auto_start";
const EOD_PREPARE_ACTION = "eod.prepare";
const AUTOMATION_POLICY_CRON_LIMIT = 500;
const DAILY_OPERATIONS_POLICY_VERSION = "daily-operations.v1";
const CONFIGURED_AUTOMATION_LOOKBACK_MS = 2 * 60 * 60 * 1000;

export const dailyOperationsOpeningAutoStartAction = defineAutomationAction({
  action: OPENING_AUTO_START_ACTION,
  allowedOutcomes: [
    "disabled",
    "dry_run",
    "skipped",
    "eligible",
    "applied",
    "failed",
  ],
  domain: DAILY_OPERATIONS_AUTOMATION_DOMAIN,
  mutationBoundary: "Opening Handoff lifecycle record and audit event only",
  requiresSourceSubjects: true,
  triggerType: "scheduled",
});

export const dailyOperationsEodPrepareAction = defineAutomationAction({
  action: EOD_PREPARE_ACTION,
  allowedOutcomes: [
    "disabled",
    "dry_run",
    "skipped",
    "prepared",
    "failed",
  ],
  domain: DAILY_OPERATIONS_AUTOMATION_DOMAIN,
  mutationBoundary: "EOD Review preparation ledger only",
  requiresSourceSubjects: true,
  triggerType: "scheduled",
});

export type DailyOperationsAutomationStatus = {
  id: Id<"automationRun">;
  outcome: Doc<"automationRun">["outcome"];
  occurredAt: number;
  policyMode: Doc<"automationRun">["policyMode"];
  decisionReason?: string;
};

type OpeningAutoStartApiBlockerHandling =
  | "skip_when_blocked"
  | "start_with_manager_review";

function toApiOpeningBlockerHandling(
  value: OpeningAutoStartBlockerHandling,
): OpeningAutoStartApiBlockerHandling {
  return value === "manager_review"
    ? "start_with_manager_review"
    : "skip_when_blocked";
}

function fromApiOpeningBlockerHandling(
  value: OpeningAutoStartApiBlockerHandling,
): OpeningAutoStartBlockerHandling {
  return value === "start_with_manager_review" ? "manager_review" : "skip";
}

async function getOpeningAutoStartPolicyForApi(
  ctx: QueryCtx,
  args: { storeId: Id<"store"> },
) {
  await requireStoreFullAdminAccess(ctx, args.storeId);
  const config = await getOpeningAutoStartPolicyConfigWithCtx(ctx, args);

  return {
    configured: config.configured,
    localStartMinutes: config.openingLocalStartMinutes,
    mode: config.mode,
    openingBlockerHandling: toApiOpeningBlockerHandling(
      config.openingBlockerHandling,
    ),
    operatingTimezoneOffsetMinutes:
      config.policy?.operatingTimezoneOffsetMinutes ?? null,
    paused: config.paused,
    policyVersion: config.policy?.policyVersion ?? DAILY_OPERATIONS_POLICY_VERSION,
  };
}

function summarizeAutomationRun(
  run: Doc<"automationRun"> | null | undefined,
): DailyOperationsAutomationStatus | null {
  if (!run) return null;

  return {
    id: run._id,
    decisionReason: run.decisionReason,
    occurredAt: run.appliedAt ?? run.updatedAt ?? run.createdAt,
    outcome: run.outcome,
    policyMode: run.policyMode,
  };
}

export async function getLatestDailyOperationsAutomationStatusWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    action: string;
    operatingDate: string;
    storeId: Id<"store">;
  },
) {
  const runs = await listAutomationRunsForStoreDayActionWithCtx(ctx, {
    action: args.action,
    domain: DAILY_OPERATIONS_AUTOMATION_DOMAIN,
    operatingDate: args.operatingDate,
    storeId: args.storeId,
  });

  const latestRun =
    runs.sort(
      (left, right) =>
        (right.appliedAt ?? right.updatedAt ?? right.createdAt) -
        (left.appliedAt ?? left.updatedAt ?? left.createdAt),
    )[0] ?? null;

  return summarizeAutomationRun(latestRun);
}

function automationIdempotencyKey(args: {
  action: string;
  domain: string;
  operatingDate: string;
  storeId: Id<"store">;
}) {
  return `${args.domain}:${args.action}:${args.storeId}:${args.operatingDate}`;
}

function sourceSubjectsOrStoreDay(args: {
  operatingDate: string;
  sourceSubjects: Array<{ id: string; label?: string; type: string }>;
  subjectType: string;
}) {
  return args.sourceSubjects.length > 0
    ? args.sourceSubjects
    : [
        {
          id: args.operatingDate,
          label: args.operatingDate,
          type: args.subjectType,
        },
      ];
}

function openingDecision(
  snapshot: Awaited<ReturnType<typeof buildDailyOpeningSnapshotWithCtx>>,
  args: {
    openingBlockerHandling?: OpeningAutoStartBlockerHandling;
  } = {},
) {
  const snapshotCounts = {
    blockerCount: snapshot.readiness.blockerCount,
    carryForwardCount: snapshot.readiness.carryForwardCount,
    readyCount: snapshot.readiness.readyCount,
    reviewCount: snapshot.readiness.reviewCount,
  };
  const sourceSubjects = sourceSubjectsOrStoreDay({
    operatingDate: snapshot.operatingDate,
    sourceSubjects: snapshot.sourceSubjects,
    subjectType: "daily_opening",
  });

  if (snapshot.existingOpening) {
    return {
      decisionReason: "Opening Handoff is already started for this store day.",
      outcome: "skipped" as const,
      snapshotCounts,
      sourceSubjects,
    };
  }

  if (
    snapshot.readiness.blockerCount > 0 ||
    snapshot.readiness.reviewCount > 0 ||
    snapshot.readiness.carryForwardCount > 0
  ) {
    if (args.openingBlockerHandling === "manager_review") {
      return {
        decisionReason:
          "Opening Handoff started with manager review evidence from automation policy.",
        outcome: "eligible" as const,
        snapshotCounts,
        sourceSubjects,
      };
    }

    return {
      decisionReason:
        "Opening Handoff requires human review or carry-forward acknowledgement.",
      outcome: "skipped" as const,
      snapshotCounts,
      sourceSubjects,
    };
  }

  return {
    decisionReason: "Opening Handoff snapshot is clean.",
    outcome: "eligible" as const,
    snapshotCounts,
    sourceSubjects,
  };
}

function eodDecision(
  snapshot: Awaited<ReturnType<typeof buildDailyCloseSnapshotWithCtx>>,
) {
  const snapshotCounts = {
    blockerCount: snapshot.readiness.blockerCount,
    carryForwardCount: snapshot.readiness.carryForwardCount,
    readyCount: snapshot.readiness.readyCount,
    reviewCount: snapshot.readiness.reviewCount,
  };
  const sourceSubjects = sourceSubjectsOrStoreDay({
    operatingDate: snapshot.operatingDate,
    sourceSubjects: snapshot.sourceSubjects,
    subjectType: "daily_close",
  });

  if (snapshot.status === "completed") {
    return {
      decisionReason: "EOD Review is already completed for this store day.",
      outcome: "skipped" as const,
      snapshotCounts,
      sourceSubjects,
    };
  }

  const decisionReason =
    snapshot.readiness.blockerCount > 0
      ? "EOD Review has blockers and remains routed for human resolution."
      : snapshot.readiness.reviewCount > 0
        ? "EOD Review has review items and remains routed for human acknowledgement."
        : "EOD Review is ready for manager approval; automation will not complete it.";

  return {
    decisionReason,
    outcome: "prepared" as const,
    snapshotCounts,
    sourceSubjects,
  };
}

export async function runDailyOpeningAutomationWithCtx(
  ctx: MutationCtx,
  args: {
    endAt?: number;
    operatingDate: string;
    startAt?: number;
    storeId: Id<"store">;
  },
) {
  const snapshot = await buildDailyOpeningSnapshotWithCtx(ctx, args);
  const policyConfig = await getOpeningAutoStartPolicyConfigWithCtx(ctx, {
    storeId: args.storeId,
  });
  const openingBlockerHandling =
    policyConfig.openingBlockerHandling ?? DEFAULT_OPENING_BLOCKER_HANDLING;
  const decision = openingDecision(snapshot, { openingBlockerHandling });

  return evaluateAutomationActionWithCtx(ctx, {
    action: dailyOperationsOpeningAutoStartAction,
    adapterDecision: decision,
    apply: async ({ run }) => {
      const result = await startStoreDayWithCtx(ctx, {
        actorType: "automation",
        automationBlockerHandling:
          openingBlockerHandling === "manager_review"
            ? "manager_review"
            : undefined,
        automationDecisionReason: run.decisionReason,
        automationPolicyVersion: run.policyVersion,
        automationRunId: run._id,
        endAt: args.endAt,
        operatingDate: args.operatingDate,
        organizationId: snapshot.organizationId ?? undefined,
        startAt: args.startAt,
        storeId: args.storeId,
      });

      if (result.kind !== "ok") {
        return {
          error: {
            code:
              result.kind === "user_error"
                ? result.error.code
                : "opening_auto_start_failed",
            message:
              result.kind === "user_error"
                ? result.error.message
                : "Opening automation failed.",
          },
          outcome: "failed" as const,
        };
      }

      return {
        eventIds: result.data.operationalEventId
          ? [result.data.operationalEventId]
          : [],
        outcome:
          result.data.action === "already_started"
            ? ("skipped" as const)
            : ("applied" as const),
      };
    },
    idempotencyKey: automationIdempotencyKey({
      action: OPENING_AUTO_START_ACTION,
      domain: DAILY_OPERATIONS_AUTOMATION_DOMAIN,
      operatingDate: args.operatingDate,
      storeId: args.storeId,
    }),
    operatingDate: args.operatingDate,
    organizationId: snapshot.organizationId ?? undefined,
    storeId: args.storeId,
  });
}

export async function prepareDailyCloseAutomationWithCtx(
  ctx: MutationCtx,
  args: {
    endAt?: number;
    operatingDate: string;
    startAt?: number;
    storeId: Id<"store">;
  },
) {
  const snapshot = await buildDailyCloseSnapshotWithCtx(ctx, args);

  return evaluateAutomationActionWithCtx(ctx, {
    action: dailyOperationsEodPrepareAction,
    adapterDecision: eodDecision(snapshot),
    idempotencyKey: automationIdempotencyKey({
      action: EOD_PREPARE_ACTION,
      domain: DAILY_OPERATIONS_AUTOMATION_DOMAIN,
      operatingDate: args.operatingDate,
      storeId: args.storeId,
    }),
    operatingDate: args.operatingDate,
    organizationId: snapshot.organizationId ?? undefined,
    storeId: args.storeId,
  });
}

function operatingDateForPolicy(args: {
  now: number;
  operatingTimezoneOffsetMinutes?: number;
}) {
  const localDate = localDateForPolicy(args);

  return localDate ? localDate.toISOString().slice(0, 10) : null;
}

function localDateForPolicy(args: {
  now: number;
  operatingTimezoneOffsetMinutes?: number;
}) {
  if (
    typeof args.operatingTimezoneOffsetMinutes !== "number" ||
    !Number.isInteger(args.operatingTimezoneOffsetMinutes) ||
    args.operatingTimezoneOffsetMinutes < -14 * 60 ||
    args.operatingTimezoneOffsetMinutes > 14 * 60
  ) {
    return null;
  }

  const localDate = new Date(
    args.now - args.operatingTimezoneOffsetMinutes * 60_000,
  );

  return Number.isFinite(localDate.getTime()) ? localDate : null;
}

function openingPolicyCronWindow(args: {
  now: number;
  policy: Doc<"automationPolicy">;
}) {
  const localDate = localDateForPolicy({
    now: args.now,
    operatingTimezoneOffsetMinutes: args.policy.operatingTimezoneOffsetMinutes,
  });

  if (!localDate) {
    return null;
  }

  const localMinuteOfDay =
    localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
  const openingLocalStartMinutes =
    typeof args.policy.openingLocalStartMinutes === "number" &&
    Number.isInteger(args.policy.openingLocalStartMinutes)
      ? args.policy.openingLocalStartMinutes
      : DEFAULT_OPENING_LOCAL_START_MINUTES;

  if (localMinuteOfDay < openingLocalStartMinutes) {
    const previousLocalDate = localDateForPolicy({
      now: args.now - CONFIGURED_AUTOMATION_LOOKBACK_MS,
      operatingTimezoneOffsetMinutes: args.policy.operatingTimezoneOffsetMinutes,
    });
    const previousOperatingDate = previousLocalDate
      ?.toISOString()
      .slice(0, 10);
    const currentOperatingDate = localDate.toISOString().slice(0, 10);
    const previousMinuteOfDay = previousLocalDate
      ? previousLocalDate.getUTCHours() * 60 + previousLocalDate.getUTCMinutes()
      : null;

    if (
      previousLocalDate &&
      previousOperatingDate !== currentOperatingDate &&
      previousMinuteOfDay !== null &&
      previousMinuteOfDay < openingLocalStartMinutes
    ) {
      return {
        operatingDate: previousOperatingDate,
      };
    }

    return null;
  }

  return {
    operatingDate: localDate.toISOString().slice(0, 10),
  };
}

function automationErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Automation policy failed.";
}

async function recordConfiguredAutomationFailureWithCtx(
  ctx: MutationCtx,
  args: {
    action: string;
    error: unknown;
    operatingDate: string;
    policy: Doc<"automationPolicy">;
  },
) {
  const run = await recordAutomationRunWithCtx(ctx, {
    action: args.action,
    decisionReason: "Configured automation policy failed before completion.",
    domain: DAILY_OPERATIONS_AUTOMATION_DOMAIN,
    error: {
      code: "configured_automation_failed",
      message: automationErrorMessage(args.error),
    },
    eventIds: [],
    idempotencyKey: `${DAILY_OPERATIONS_AUTOMATION_DOMAIN}:${args.action}:${args.policy.storeId}:${args.operatingDate}:configured_failure`,
    mutationBoundary:
      args.action === OPENING_AUTO_START_ACTION
        ? "daily_opening"
        : "daily_close",
    operatingDate: args.operatingDate,
    organizationId: args.policy.organizationId,
    outcome: "failed",
    policyMode: args.policy.mode,
    policyVersion: args.policy.policyVersion,
    snapshotCounts: {},
    sourceSubjects: [],
    storeId: args.policy.storeId,
    triggerType: "scheduled",
  });

  return {
    action: "failed" as const,
    run,
  };
}

async function runConfiguredPolicySafely<T>(
  ctx: MutationCtx,
  args: {
    action: string;
    operatingDate: string | null;
    policy: Doc<"automationPolicy">;
    run: (operatingDate: string) => Promise<T>;
  },
) {
  if (!args.operatingDate) return null;

  try {
    return await args.run(args.operatingDate);
  } catch (error) {
    return recordConfiguredAutomationFailureWithCtx(ctx, {
      action: args.action,
      error,
      operatingDate: args.operatingDate,
      policy: args.policy,
    });
  }
}

async function listConfiguredAutomationPolicies(
  ctx: MutationCtx,
  args: {
    action: string;
  },
) {
  const policies = await Promise.all(
    (["dry_run", "enabled"] as const).map((mode) =>
      ctx.db
        .query("automationPolicy")
        .withIndex("by_domain_action_mode", (q) =>
          q
            .eq("domain", DAILY_OPERATIONS_AUTOMATION_DOMAIN)
            .eq("action", args.action)
            .eq("mode", mode),
        )
        .take(AUTOMATION_POLICY_CRON_LIMIT),
    ),
  );

  return policies
    .flat()
    .filter((policy) => !policy.paused)
    .reduce<Array<Doc<"automationPolicy">>>((uniquePolicies, policy) => {
      if (
        !uniquePolicies.some(
          (existingPolicy) => existingPolicy.storeId === policy.storeId,
        )
      ) {
        uniquePolicies.push(policy);
      }

      return uniquePolicies;
    }, []);
}

export async function runScheduledDailyOperationsAutomationWithCtx(
  ctx: MutationCtx,
  args: {
    operatingDate: string;
  },
) {
  const [openingPolicies, eodPolicies] = await Promise.all([
    listConfiguredAutomationPolicies(ctx, { action: OPENING_AUTO_START_ACTION }),
    listConfiguredAutomationPolicies(ctx, { action: EOD_PREPARE_ACTION }),
  ]);
  const openingResults = await Promise.all(
    openingPolicies.map((policy) =>
      runConfiguredPolicySafely(ctx, {
        action: OPENING_AUTO_START_ACTION,
        operatingDate: args.operatingDate,
        policy,
        run: (operatingDate) =>
          runDailyOpeningAutomationWithCtx(ctx, {
            operatingDate,
            storeId: policy.storeId,
          }),
      }),
    ),
  );
  const eodResults = await Promise.all(
    eodPolicies.map((policy) =>
      runConfiguredPolicySafely(ctx, {
        action: EOD_PREPARE_ACTION,
        operatingDate: args.operatingDate,
        policy,
        run: (operatingDate) =>
          prepareDailyCloseAutomationWithCtx(ctx, {
            operatingDate,
            storeId: policy.storeId,
          }),
      }),
    ),
  );

  return {
    eodResults,
    openingResults,
  };
}

export async function runConfiguredDailyOperationsAutomationWithCtx(
  ctx: MutationCtx,
  args: {
    now?: number;
  } = {},
) {
  const now = args.now ?? Date.now();
  const [openingPolicies, eodPolicies] = await Promise.all([
    listConfiguredAutomationPolicies(ctx, { action: OPENING_AUTO_START_ACTION }),
    listConfiguredAutomationPolicies(ctx, { action: EOD_PREPARE_ACTION }),
  ]);
  const openingResults = await Promise.all(
    openingPolicies.map((policy) => {
      const cronWindow = openingPolicyCronWindow({
        now,
        policy,
      });
      const operatingDate = cronWindow?.operatingDate ?? null;

      return runConfiguredPolicySafely(ctx, {
        action: OPENING_AUTO_START_ACTION,
        operatingDate,
        policy,
        run: (operatingDate) =>
          runDailyOpeningAutomationWithCtx(ctx, {
            operatingDate,
            storeId: policy.storeId,
          }),
      });
    }),
  );
  const eodResults = await Promise.all(
    eodPolicies.map((policy) => {
      const operatingDate = operatingDateForPolicy({
        now,
        operatingTimezoneOffsetMinutes: policy.operatingTimezoneOffsetMinutes,
      });

      return runConfiguredPolicySafely(ctx, {
        action: EOD_PREPARE_ACTION,
        operatingDate,
        policy,
        run: (operatingDate) =>
          prepareDailyCloseAutomationWithCtx(ctx, {
            operatingDate,
            storeId: policy.storeId,
          }),
      });
    }),
  );

  return {
    eodResults: eodResults.filter((result) => result !== null),
    openingResults: openingResults.filter((result) => result !== null),
  };
}

export const runScheduledDailyOperationsAutomation = internalMutation({
  args: {
    operatingDate: v.string(),
  },
  handler: (ctx, args) =>
    runScheduledDailyOperationsAutomationWithCtx(ctx, args),
});

export const runConfiguredDailyOperationsAutomation = internalMutation({
  args: {},
  handler: (ctx) => runConfiguredDailyOperationsAutomationWithCtx(ctx),
});

export const getOpeningAutoStartPolicy = query({
  args: {
    storeId: v.id("store"),
  },
  handler: (ctx, args) => getOpeningAutoStartPolicyForApi(ctx, args),
});

export const updateOpeningAutoStartPolicy = mutation({
  args: {
    localStartMinutes: v.number(),
    mode: v.union(
      v.literal("disabled"),
      v.literal("dry_run"),
      v.literal("enabled"),
    ),
    openingBlockerHandling: v.union(
      v.literal("skip_when_blocked"),
      v.literal("start_with_manager_review"),
    ),
    operatingTimezoneOffsetMinutes: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const { athenaUser, store } = await requireStoreFullAdminAccess(
      ctx,
      args.storeId,
    );
    const policy = await upsertOpeningAutoStartPolicyConfigWithCtx(ctx, {
      mode: args.mode,
      openingBlockerHandling: fromApiOpeningBlockerHandling(
        args.openingBlockerHandling,
      ),
      openingLocalStartMinutes: args.localStartMinutes,
      operatingTimezoneOffsetMinutes: args.operatingTimezoneOffsetMinutes,
      organizationId: store.organizationId,
      policyVersion: DAILY_OPERATIONS_POLICY_VERSION,
      storeId: args.storeId,
      updatedByUserId: athenaUser._id,
    });

    return {
      configured: true,
      localStartMinutes:
        policy.openingLocalStartMinutes ?? DEFAULT_OPENING_LOCAL_START_MINUTES,
      mode: policy.mode,
      openingBlockerHandling: toApiOpeningBlockerHandling(
        policy.openingBlockerHandling === "manager_review"
          ? "manager_review"
          : "skip",
      ),
      operatingTimezoneOffsetMinutes:
        policy.operatingTimezoneOffsetMinutes ?? null,
      paused: Boolean(policy.paused),
      policyVersion: policy.policyVersion,
    };
  },
});
