import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import {
  internalAction,
  internalMutation,
  mutation,
  query,
} from "../_generated/server";
import { v } from "convex/values";
import { defineAutomationAction } from "../automation/actionRegistry";
import { evaluateAutomationActionWithCtx } from "../automation/automationFoundation";
import {
  DEFAULT_EOD_LOCAL_COMPLETION_WINDOW_MINUTES,
  DEFAULT_OPENING_BLOCKER_HANDLING,
  DEFAULT_OPENING_LOCAL_START_MINUTES,
  EOD_AUTO_COMPLETE_POLICY_ACTION,
  getAutomationRunByIdempotencyKeyWithCtx,
  getEodAutoCompletePolicyConfigWithCtx,
  getOpeningAutoStartPolicyConfigWithCtx,
  listAutomationRunsForStoreDayActionWithCtx,
  patchAutomationRunOutcomeWithCtx,
  recordAutomationRunWithCtx,
  type AutomationDecisionEvidence,
  type EodAutoCompletePolicyConfig,
  upsertEodAutoCompletePolicyConfigWithCtx,
  upsertAutomationRunWithCtx,
  upsertOpeningAutoStartPolicyConfigWithCtx,
  type OpeningAutoStartBlockerHandling,
} from "../automation/runLedger";
import {
  buildDailyOpeningSnapshotWithCtx,
  startStoreDayWithCtx,
} from "./dailyOpening";
import {
  buildDailyCloseSnapshotWithCtx,
  completeDailyCloseForAutomationWithCtx,
} from "./dailyClose";
import { requireStoreFullAdminAccess } from "../stockOps/access";
import {
  getStoreScheduleContextForStoreAtWithCtx,
  resolveStoreOperatingRangeForDateWithCtx,
} from "../inventory/storeSchedule";

export const DAILY_OPERATIONS_AUTOMATION_DOMAIN = "daily_operations";
const OPENING_AUTO_START_ACTION = "opening.auto_start";
const EOD_PREPARE_ACTION = "eod.prepare";
const EOD_AUTO_COMPLETE_ACTION = EOD_AUTO_COMPLETE_POLICY_ACTION;
const AUTOMATION_POLICY_CRON_LIMIT = 500;
const DAILY_OPERATIONS_POLICY_VERSION = "daily-operations.v1";
const CONFIGURED_AUTOMATION_LOOKBACK_MS = 2 * 60 * 60 * 1000;
const HISTORIC_EOD_AUTO_CLOSE_TRIGGER_TYPE = "support_batch";
const HISTORIC_EOD_AUTO_CLOSE_MAX_DAYS_LIMIT = 100;
const EOD_AUTO_COMPLETE_LOW_RISK_REVIEW_CATEGORIES = new Set([
  "cash_variance",
  "voided_sale",
]);
const MINUTE_MS = 60 * 1000;

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

export const dailyOperationsEodAutoCompleteAction = defineAutomationAction({
  action: EOD_AUTO_COMPLETE_ACTION,
  allowedOutcomes: [
    "disabled",
    "dry_run",
    "skipped",
    "eligible",
    "applied",
    "failed",
  ],
  domain: DAILY_OPERATIONS_AUTOMATION_DOMAIN,
  mutationBoundary: "EOD Review automation completion and audit event only",
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

export type DailyOperationsAutomationStoreDayContext = {
  source: "canonical_schedule";
  operatingDate: string;
  storeScheduleId: string;
  scheduleVersion: string;
  openedAt?: number;
  closedAt?: number;
  openingEvaluationAt?: number;
  openingWindowStartMinutes?: number;
  eodEvaluationAt?: number;
  eodWindowEndMinutes?: number;
};

type DailyOperationsAutomationTimingEvidence = {
  evaluationAt?: number;
  openedAt?: number;
  closedAt?: number;
  scheduleVersion?: string;
  source: "canonical_schedule" | "compatibility_policy";
  storeScheduleId?: string;
};

type ConfiguredStoreScheduleContext = {
  phase:
    | "before_first_window"
    | "during_window"
    | "between_windows"
    | "after_last_window"
    | "closed"
    | "unavailable";
  storeDayContext?: DailyOperationsAutomationStoreDayContext;
};

type HistoricEodAutoCloseMode = "dry_run" | "apply";

type HistoricEodStoreRangeResolution =
  | {
      kind: "resolved";
      endAt: number;
      scheduleEvidence: DailyOperationsAutomationTimingEvidence;
      startAt: number;
      storeDayContext: DailyOperationsAutomationStoreDayContext;
    }
  | {
      kind: "unavailable";
    }
  | {
      kind: "quarantine";
      classification:
        | "quarantine_store_schedule_ambiguous"
        | "quarantine_store_schedule_closed"
        | "quarantine_missing_store_schedule";
      reason:
        | "missing_store_schedule"
        | "store_schedule_ambiguous"
        | "store_schedule_closed";
      scheduleEvidence?: DailyOperationsAutomationTimingEvidence;
      storeScheduleId?: string;
    };

type HistoricEodDateResult = {
  action:
    | "applied"
    | "already_completed"
    | "dry_run"
    | "failed"
    | "quarantined"
    | "skipped";
  classification?: string;
  operatingDate: string;
  runId?: Id<"automationRun">;
};

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

async function getEodAutoCompletePolicyForApi(
  ctx: QueryCtx,
  args: { storeId: Id<"store"> },
) {
  await requireStoreFullAdminAccess(ctx, args.storeId);
  const config = await getEodAutoCompletePolicyConfigWithCtx(ctx, args);

  return {
    cleanDayAutoCompleteEnabled: config.cleanDayAutoCompleteEnabled,
    configured: config.configured,
    localCompletionWindowMinutes: config.localCompletionWindowMinutes,
    maxAbsoluteCashVariance: config.maxAbsoluteCashVariance,
    maxVoidedSaleCount: config.maxVoidedSaleCount,
    maxVoidedSaleTotal: config.maxVoidedSaleTotal,
    mode: config.mode,
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

function numberFromRecord(
  record: Record<string, unknown> | undefined,
  key: string,
) {
  const value = record?.[key];

  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function eodAutoCompleteDecision(
  snapshot: Awaited<ReturnType<typeof buildDailyCloseSnapshotWithCtx>>,
  policyConfig: EodAutoCompletePolicyConfig,
  timing?: {
    insideCompletionWindow: boolean;
    localCompletionWindowMinutes: number;
    localMinuteOfDay: number;
    scheduleEvidence?: DailyOperationsAutomationTimingEvidence;
  } | null,
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
  const voidedSaleTotal = snapshot.reviewItems
    .filter((item) => item.category === "voided_sale")
    .reduce((sum, item) => sum + numberFromRecord(item.metadata, "total"), 0);
  const absoluteCashVariance = Math.abs(snapshot.summary.netCashVariance);
  const unsupportedReviewCategories = Array.from(
    new Set(
      snapshot.reviewItems
        .map((item) => item.category)
        .filter(
          (category) =>
            !EOD_AUTO_COMPLETE_LOW_RISK_REVIEW_CATEGORIES.has(category),
        ),
    ),
  );
  const disqualifyingCategories = Array.from(
    new Set([
      ...snapshot.blockers.map((item) => item.category),
      ...unsupportedReviewCategories,
    ]),
  ).sort();
  const observed: NonNullable<AutomationDecisionEvidence["observed"]> = {
    absoluteCashVariance,
    blockerCount: snapshot.readiness.blockerCount,
    carryForwardItemKeys: snapshot.carryForwardItems.map((item) => item.key),
    carryForwardCount: snapshot.readiness.carryForwardCount,
    carryForwardPreserved:
      snapshot.readiness.carryForwardCount > 0 ||
      snapshot.carryForwardItems.length > 0,
    disqualifyingCategories,
    reviewCount: snapshot.readiness.reviewCount,
    voidedSaleCount: snapshot.summary.voidedTransactionCount,
    voidedSaleTotal,
  };
  const evidenceBase = {
    kind: "eod_auto_complete",
    observed,
    policy: {
      cleanDayAutoCompleteEnabled: policyConfig.cleanDayAutoCompleteEnabled,
      localCompletionWindowMinutes: policyConfig.localCompletionWindowMinutes,
      maxAbsoluteCashVariance: policyConfig.maxAbsoluteCashVariance,
      maxVoidedSaleCount: policyConfig.maxVoidedSaleCount,
      maxVoidedSaleTotal: policyConfig.maxVoidedSaleTotal,
      mode: policyConfig.paused ? "disabled" : policyConfig.mode,
    },
  } satisfies AutomationDecisionEvidence;

  if (timing?.scheduleEvidence) {
    evidenceBase.observed = {
      ...evidenceBase.observed,
      scheduleEvidenceSource: timing.scheduleEvidence.source,
      ...(timing.scheduleEvidence.storeScheduleId
        ? { storeScheduleId: timing.scheduleEvidence.storeScheduleId }
        : {}),
      ...(timing.scheduleEvidence.scheduleVersion
        ? { scheduleVersion: timing.scheduleEvidence.scheduleVersion }
        : {}),
      ...(typeof timing.scheduleEvidence.openedAt === "number"
        ? { scheduleOpenedAt: timing.scheduleEvidence.openedAt }
        : {}),
      ...(typeof timing.scheduleEvidence.closedAt === "number"
        ? { scheduleClosedAt: timing.scheduleEvidence.closedAt }
        : {}),
      ...(typeof timing.scheduleEvidence.evaluationAt === "number"
        ? { scheduleEvaluationAt: timing.scheduleEvidence.evaluationAt }
        : {}),
    };
  }

  const decision = (args: {
    classification: string;
    decisionReason: string;
    eligible: boolean;
    gates?: AutomationDecisionEvidence["gates"];
    outcome: "eligible" | "skipped";
  }) => ({
    decisionEvidence: {
      ...evidenceBase,
      classification: args.classification,
      eligible: args.eligible,
      ...(args.gates ? { gates: args.gates } : {}),
    },
    decisionReason: args.decisionReason,
    outcome: args.outcome,
    snapshotCounts,
    sourceSubjects,
  });

  if (timing && !timing.insideCompletionWindow) {
    return decision({
      classification: "outside_completion_window",
      decisionReason:
        "EOD Review auto-complete is outside the configured local completion window.",
      eligible: false,
      gates: [
        {
          key: "local_completion_window",
          passed: false,
          reason: `${timing.localMinuteOfDay} >= ${timing.localCompletionWindowMinutes}`,
        },
      ],
      outcome: "skipped",
    });
  }

  if (snapshot.status === "completed") {
    return decision({
      classification: "completed",
      decisionReason: "EOD Review is already completed for this store day.",
      eligible: false,
      outcome: "skipped",
    });
  }

  if (snapshot.readiness.blockerCount > 0 || disqualifyingCategories.length > 0) {
    return decision({
      classification: "blocked",
      decisionReason:
        "EOD Review has blockers or unsupported review evidence and requires human review.",
      eligible: false,
      outcome: "skipped",
    });
  }

  if (snapshot.readiness.reviewCount === 0) {
    return policyConfig.cleanDayAutoCompleteEnabled
      ? decision({
          classification: "clean_day",
          decisionReason: "EOD Review is clean and eligible for auto-complete.",
          eligible: true,
          outcome: "eligible",
        })
      : decision({
          classification: "clean_day",
          decisionReason:
            "EOD Review is clean, but clean-day auto-complete is disabled by policy.",
          eligible: false,
          outcome: "skipped",
        });
  }

  const gates = [
    {
      key: "absolute_cash_variance",
      passed: absoluteCashVariance <= policyConfig.maxAbsoluteCashVariance,
      reason: `${absoluteCashVariance} <= ${policyConfig.maxAbsoluteCashVariance}`,
    },
    {
      key: "voided_sale_count",
      passed:
        snapshot.summary.voidedTransactionCount <=
        policyConfig.maxVoidedSaleCount,
      reason: `${snapshot.summary.voidedTransactionCount} <= ${policyConfig.maxVoidedSaleCount}`,
    },
    {
      key: "voided_sale_total",
      passed: voidedSaleTotal <= policyConfig.maxVoidedSaleTotal,
      reason: `${voidedSaleTotal} <= ${policyConfig.maxVoidedSaleTotal}`,
    },
  ];
  const lowRisk = gates.every((gate) => gate.passed);

  return lowRisk
    ? decision({
        classification: "low_risk_review",
        decisionReason:
          "EOD Review has only low-risk review evidence within policy thresholds.",
        eligible: true,
        gates,
        outcome: "eligible",
      })
    : decision({
        classification: "review_threshold_exceeded",
        decisionReason:
          "EOD Review review evidence exceeds auto-complete policy thresholds.",
        eligible: false,
        gates,
        outcome: "skipped",
      });
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

export async function runDailyCloseAutoCompleteEligibilityWithCtx(
  ctx: MutationCtx,
  args: {
    completionWindowSatisfied?: boolean;
    endAt?: number;
    now?: number;
    operatingDate: string;
    startAt?: number;
    storeDayContext?: DailyOperationsAutomationStoreDayContext;
    storeId: Id<"store">;
  },
) {
  const snapshot = await buildDailyCloseSnapshotWithCtx(ctx, args);
  const policyConfig = await getEodAutoCompletePolicyConfigWithCtx(ctx, {
    storeId: args.storeId,
  });
  const adapterDecision = eodAutoCompleteDecision(
    snapshot,
    policyConfig,
    args.completionWindowSatisfied
      ? {
          insideCompletionWindow: true,
          localCompletionWindowMinutes: policyConfig.localCompletionWindowMinutes,
          localMinuteOfDay: policyConfig.localCompletionWindowMinutes,
          scheduleEvidence: scheduleEvidenceForStoreDayContext(
            args.storeDayContext,
            "eod.auto_complete",
          ),
        }
      : args.now
      ? eodAutoCompleteTiming({
          now: args.now,
          policyConfig,
          storeDayContext: args.storeDayContext,
        })
      : null,
  );
  const policyReviewedItemKeys =
    adapterDecision.decisionEvidence.classification === "low_risk_review"
      ? snapshot.reviewItems.map((item) => item.key)
      : [];

  return evaluateAutomationActionWithCtx(ctx, {
    action: dailyOperationsEodAutoCompleteAction,
    adapterDecision,
    apply: async ({ run }) => {
      const result = await completeDailyCloseForAutomationWithCtx(ctx, {
        automationDecisionReason:
          run.decisionReason ?? "EOD Review completed by automation policy.",
        automationPolicyVersion: run.policyVersion,
        automationRunId: run._id,
        eodAutoCompletePolicy: {
          cleanDayAutoCompleteEnabled:
            policyConfig.cleanDayAutoCompleteEnabled,
          maxAbsoluteCashVariance: policyConfig.maxAbsoluteCashVariance,
          maxVoidedSaleCount: policyConfig.maxVoidedSaleCount,
          maxVoidedSaleTotal: policyConfig.maxVoidedSaleTotal,
        },
        automationScheduleEvidence: scheduleEvidenceForStoreDayContext(
          args.storeDayContext,
          "eod.auto_complete",
        ),
        endAt: args.endAt,
        operatingDate: args.operatingDate,
        organizationId: snapshot.organizationId ?? undefined,
        policyReviewedItemKeys,
        startAt: args.startAt,
        storeId: args.storeId,
      });

      if (result.kind !== "ok") {
        return {
          error:
            result.kind === "user_error"
              ? {
                  code: result.error.code,
                  message: result.error.message,
                }
              : {
                  code: "eod_auto_complete_failed",
                  message: "EOD Review automation could not complete.",
                },
          outcome:
            result.kind === "user_error"
              ? ("skipped" as const)
              : ("failed" as const),
        };
      }

      return {
        eventIds: result.data.operationalEventId
          ? [result.data.operationalEventId]
          : [],
        decisionEvidence: result.data.automationDecisionEvidence,
        outcome:
          result.data.action === "already_completed"
            ? ("skipped" as const)
            : ("applied" as const),
      };
    },
    idempotencyKey: automationIdempotencyKey({
      action: EOD_AUTO_COMPLETE_ACTION,
      domain: DAILY_OPERATIONS_AUTOMATION_DOMAIN,
      operatingDate: args.operatingDate,
      storeId: args.storeId,
    }),
    operatingDate: args.operatingDate,
    organizationId: snapshot.organizationId ?? undefined,
    storeId: args.storeId,
  });
}

function isValidOperatingDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = Date.parse(`${value}T00:00:00.000Z`);

  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}

function addDaysToOperatingDate(operatingDate: string, days: number) {
  return new Date(
    Date.parse(`${operatingDate}T00:00:00.000Z`) + days * 24 * 60 * 60_000,
  )
    .toISOString()
    .slice(0, 10);
}

function historicEodAutoCloseIdempotencyKey(args: {
  operatingDate: string;
  storeId: Id<"store">;
}) {
  return `${DAILY_OPERATIONS_AUTOMATION_DOMAIN}:${EOD_AUTO_COMPLETE_ACTION}:historic:${args.storeId}:${args.operatingDate}`;
}

function policyEvidenceForHistoricRun(policyConfig: EodAutoCompletePolicyConfig) {
  return {
    cleanDayAutoCompleteEnabled: policyConfig.cleanDayAutoCompleteEnabled,
    localCompletionWindowMinutes: policyConfig.localCompletionWindowMinutes,
    maxAbsoluteCashVariance: policyConfig.maxAbsoluteCashVariance,
    maxVoidedSaleCount: policyConfig.maxVoidedSaleCount,
    maxVoidedSaleTotal: policyConfig.maxVoidedSaleTotal,
    mode: policyConfig.paused ? "disabled" : policyConfig.mode,
  };
}

function historicQuarantineEvidence(args: {
  classification: string;
  operatingDate: string;
  policyConfig: EodAutoCompletePolicyConfig;
  quarantineReason: string;
  scheduleEvidence?: DailyOperationsAutomationTimingEvidence;
}): AutomationDecisionEvidence {
  return {
    kind: "eod_auto_complete",
    classification: args.classification,
    eligible: false,
    observed: {
      operatingDate: args.operatingDate,
      quarantineReason: args.quarantineReason,
      ...(args.scheduleEvidence
        ? {
            scheduleEvidenceSource: args.scheduleEvidence.source,
            ...(args.scheduleEvidence.storeScheduleId
              ? { storeScheduleId: args.scheduleEvidence.storeScheduleId }
              : {}),
            ...(args.scheduleEvidence.scheduleVersion
              ? { scheduleVersion: args.scheduleEvidence.scheduleVersion }
              : {}),
            ...(typeof args.scheduleEvidence.openedAt === "number"
              ? { scheduleOpenedAt: args.scheduleEvidence.openedAt }
              : {}),
            ...(typeof args.scheduleEvidence.closedAt === "number"
              ? { scheduleClosedAt: args.scheduleEvidence.closedAt }
              : {}),
            ...(typeof args.scheduleEvidence.evaluationAt === "number"
              ? { scheduleEvaluationAt: args.scheduleEvidence.evaluationAt }
              : {}),
          }
        : {}),
    },
    policy: policyEvidenceForHistoricRun(args.policyConfig),
  };
}

async function recordHistoricEodQuarantineWithCtx(
  ctx: MutationCtx,
  args: {
    classification: string;
    decisionReason: string;
    operatingDate: string;
    policyConfig: EodAutoCompletePolicyConfig;
    quarantineReason: string;
    scheduleEvidence?: DailyOperationsAutomationTimingEvidence;
    storeId: Id<"store">;
  },
): Promise<HistoricEodDateResult> {
  const run = await upsertAutomationRunWithCtx(ctx, {
    action: EOD_AUTO_COMPLETE_ACTION,
    decisionEvidence: historicQuarantineEvidence({
      classification: args.classification,
      operatingDate: args.operatingDate,
      policyConfig: args.policyConfig,
      quarantineReason: args.quarantineReason,
      scheduleEvidence: args.scheduleEvidence,
    }),
    decisionReason: args.decisionReason,
    domain: DAILY_OPERATIONS_AUTOMATION_DOMAIN,
    eventIds: [],
    idempotencyKey: historicEodAutoCloseIdempotencyKey(args),
    mutationBoundary: dailyOperationsEodAutoCompleteAction.mutationBoundary,
    operatingDate: args.operatingDate,
    organizationId: args.policyConfig.policy?.organizationId,
    outcome: "skipped",
    policyMode: args.policyConfig.paused
      ? "disabled"
      : args.policyConfig.mode,
    policyVersion:
      args.policyConfig.policy?.policyVersion ?? DAILY_OPERATIONS_POLICY_VERSION,
    snapshotCounts: {},
    sourceSubjects: [
      {
        id: args.operatingDate,
        label: args.operatingDate,
        type: "daily_close",
      },
    ],
    storeId: args.storeId,
    triggerType: HISTORIC_EOD_AUTO_CLOSE_TRIGGER_TYPE,
  });

  return {
    action: "quarantined",
    classification: args.classification,
    operatingDate: args.operatingDate,
    runId: run._id,
  };
}

async function resolveHistoricEodStoreRangeForDateWithCtx(
  ctx: MutationCtx,
  args: {
    operatingDate: string;
    storeId: Id<"store">;
  },
): Promise<HistoricEodStoreRangeResolution> {
  const { range } = await resolveStoreOperatingRangeForDateWithCtx(ctx, {
    operatingDate: args.operatingDate,
    storeId: args.storeId,
  });

  const scheduleEvidence = {
    closedAt: range.kind === "resolved" ? range.endAt : undefined,
    evaluationAt: range.kind === "resolved" ? range.endAt : undefined,
    openedAt: range.kind === "resolved" ? range.startAt : undefined,
    scheduleVersion: range.scheduleVersionId ?? undefined,
    source: "canonical_schedule" as const,
    storeScheduleId: range.scheduleVersionId ?? undefined,
  };

  if (range.kind === "invalid") {
    return {
      kind: "quarantine",
      classification: "quarantine_store_schedule_ambiguous",
      reason: "store_schedule_ambiguous",
      scheduleEvidence,
      storeScheduleId: range.scheduleVersionId ?? undefined,
    };
  }

  if (range.kind === "missing_schedule") {
    return {
      kind: "quarantine",
      classification: "quarantine_missing_store_schedule",
      reason: "missing_store_schedule",
      scheduleEvidence,
      storeScheduleId: range.scheduleVersionId ?? undefined,
    };
  }

  if (range.kind === "closed") {
    return {
      kind: "quarantine",
      classification: "quarantine_store_schedule_closed",
      reason: "store_schedule_closed",
      scheduleEvidence,
      storeScheduleId: range.scheduleVersionId ?? undefined,
    };
  }

  if (!range.scheduleVersionId) {
    return {
      kind: "quarantine",
      classification: "quarantine_store_schedule_ambiguous",
      reason: "store_schedule_ambiguous",
      scheduleEvidence,
    };
  }

  const storeDayContext: DailyOperationsAutomationStoreDayContext = {
    closedAt: range.endAt,
    eodEvaluationAt: range.endAt,
    openedAt: range.startAt,
    openingEvaluationAt: range.startAt,
    operatingDate: args.operatingDate,
    scheduleVersion: range.scheduleVersionId,
    source: "canonical_schedule",
    storeScheduleId: range.scheduleVersionId,
  };

  return {
    kind: "resolved",
    endAt: range.endAt,
    scheduleEvidence,
    startAt: range.startAt,
    storeDayContext,
  };
}

export async function runHistoricEodAutoCloseForDateWithCtx(
  ctx: MutationCtx,
  args: {
    asOfOperatingDate: string;
    mode: HistoricEodAutoCloseMode;
    operatingDate: string;
    storeId: Id<"store">;
  },
): Promise<HistoricEodDateResult> {
  const policyConfig = await getEodAutoCompletePolicyConfigWithCtx(ctx, {
    storeId: args.storeId,
  });
  const idempotencyKey = historicEodAutoCloseIdempotencyKey(args);
  const existingRun = await getAutomationRunByIdempotencyKeyWithCtx(ctx, {
    idempotencyKey,
    storeId: args.storeId,
  });

  if (existingRun?.outcome === "applied") {
    const activeCompletedClose = await ctx.db
      .query("dailyClose")
      .withIndex("by_storeId_operatingDate_lifecycleStatus", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("operatingDate", args.operatingDate)
          .eq("lifecycleStatus", "active"),
      )
      .first();

    if (
      activeCompletedClose?.status === "completed" &&
      activeCompletedClose.automationRunId === existingRun._id
    ) {
      return {
        action: "already_completed",
        classification:
          typeof existingRun.decisionEvidence?.classification === "string"
            ? existingRun.decisionEvidence.classification
            : "completed",
        operatingDate: args.operatingDate,
        runId: existingRun._id,
      };
    }
  }

  if (!isValidOperatingDate(args.operatingDate)) {
    return recordHistoricEodQuarantineWithCtx(ctx, {
      classification: "quarantine_invalid_operating_date",
      decisionReason:
        "Historic EOD auto-close requires an operating date in YYYY-MM-DD format.",
      operatingDate: args.operatingDate,
      policyConfig,
      quarantineReason: "invalid_operating_date",
      storeId: args.storeId,
    });
  }

  if (args.operatingDate >= args.asOfOperatingDate) {
    return recordHistoricEodQuarantineWithCtx(ctx, {
      classification: "quarantine_current_or_future_date",
      decisionReason:
        "Historic EOD auto-close is support-owned and only processes past operating dates.",
      operatingDate: args.operatingDate,
      policyConfig,
      quarantineReason: "current_or_future_date",
      storeId: args.storeId,
    });
  }

  const scheduleRange = await resolveHistoricEodStoreRangeForDateWithCtx(ctx, {
    operatingDate: args.operatingDate,
    storeId: args.storeId,
  });

  if (scheduleRange.kind === "quarantine") {
    return recordHistoricEodQuarantineWithCtx(ctx, {
      classification: scheduleRange.classification,
      decisionReason:
        "Historic EOD auto-close quarantined this date for Store Schedule review.",
      operatingDate: args.operatingDate,
      policyConfig,
      quarantineReason: scheduleRange.reason,
      scheduleEvidence: scheduleRange.scheduleEvidence,
      storeId: args.storeId,
    });
  }

  if (scheduleRange.kind === "unavailable" && args.mode === "apply") {
    return recordHistoricEodQuarantineWithCtx(ctx, {
      classification: "quarantine_missing_store_schedule",
      decisionReason:
        "Historic EOD auto-close apply mode requires Store Schedule range evidence.",
      operatingDate: args.operatingDate,
      policyConfig,
      quarantineReason: "missing_store_schedule",
      storeId: args.storeId,
    });
  }

  if (scheduleRange.kind === "resolved" && scheduleRange.endAt > Date.now()) {
    return recordHistoricEodQuarantineWithCtx(ctx, {
      classification: "quarantine_store_day_still_open",
      decisionReason:
        "Historic EOD auto-close waits until the resolved store-local operating day has ended.",
      operatingDate: args.operatingDate,
      policyConfig,
      quarantineReason: "store_day_still_open",
      scheduleEvidence: scheduleRange.scheduleEvidence,
      storeId: args.storeId,
    });
  }

  const snapshot = await buildDailyCloseSnapshotWithCtx(ctx, {
    endAt: scheduleRange.kind === "resolved" ? scheduleRange.endAt : undefined,
    operatingDate: args.operatingDate,
    startAt:
      scheduleRange.kind === "resolved" ? scheduleRange.startAt : undefined,
    storeId: args.storeId,
  });

  if (!snapshot.sourceCompleteness.complete) {
    return recordHistoricEodQuarantineWithCtx(ctx, {
      classification: "quarantine_incomplete_source_reads",
      decisionReason:
        "Historic EOD auto-close requires complete Daily Close source reads.",
      operatingDate: args.operatingDate,
      policyConfig,
      quarantineReason: "incomplete_source_reads",
      scheduleEvidence:
        scheduleRange.kind === "resolved"
          ? scheduleRange.scheduleEvidence
          : undefined,
      storeId: args.storeId,
    });
  }

  const adapterDecision = eodAutoCompleteDecision(snapshot, policyConfig, {
    insideCompletionWindow: true,
    localCompletionWindowMinutes: policyConfig.localCompletionWindowMinutes,
    localMinuteOfDay: policyConfig.localCompletionWindowMinutes,
    scheduleEvidence:
      scheduleRange.kind === "resolved"
        ? scheduleRange.scheduleEvidence
        : undefined,
  });
  const policyReviewedItemKeys =
    adapterDecision.decisionEvidence.classification === "low_risk_review"
      ? snapshot.reviewItems.map((item) => item.key)
      : [];
  const supportPolicyMode =
    args.mode === "dry_run"
      ? "dry_run"
      : policyConfig.paused
        ? "disabled"
        : policyConfig.mode;
  const initialOutcome =
    args.mode === "dry_run"
      ? "dry_run"
      : supportPolicyMode === "enabled"
        ? adapterDecision.outcome
        : supportPolicyMode;
  const run = await upsertAutomationRunWithCtx(ctx, {
    action: EOD_AUTO_COMPLETE_ACTION,
    decisionEvidence: adapterDecision.decisionEvidence,
    decisionReason: adapterDecision.decisionReason,
    domain: DAILY_OPERATIONS_AUTOMATION_DOMAIN,
    eventIds: [],
    idempotencyKey,
    mutationBoundary: dailyOperationsEodAutoCompleteAction.mutationBoundary,
    operatingDate: args.operatingDate,
    organizationId:
      snapshot.organizationId ?? policyConfig.policy?.organizationId,
    outcome: initialOutcome,
    policyMode: supportPolicyMode,
    policyVersion:
      policyConfig.policy?.policyVersion ?? DAILY_OPERATIONS_POLICY_VERSION,
    snapshotCounts: adapterDecision.snapshotCounts,
    sourceSubjects: adapterDecision.sourceSubjects,
    storeId: args.storeId,
    triggerType: HISTORIC_EOD_AUTO_CLOSE_TRIGGER_TYPE,
  });

  if (args.mode === "dry_run") {
    return {
      action: "dry_run",
      classification: adapterDecision.decisionEvidence.classification,
      operatingDate: args.operatingDate,
      runId: run._id,
    };
  }

  if (supportPolicyMode !== "enabled" || adapterDecision.outcome !== "eligible") {
    return {
      action:
        adapterDecision.decisionEvidence.classification === "completed"
          ? "already_completed"
          : "skipped",
      classification: adapterDecision.decisionEvidence.classification,
      operatingDate: args.operatingDate,
      runId: run._id,
    };
  }

  const result = await completeDailyCloseForAutomationWithCtx(ctx, {
    automationDecisionReason:
      run.decisionReason ?? "Historic EOD Review completed by automation policy.",
    automationPolicyVersion: run.policyVersion,
    automationRunId: run._id,
    automationScheduleEvidence:
      scheduleRange.kind === "resolved"
        ? scheduleRange.scheduleEvidence
        : undefined,
    currentnessMode: "historical_record",
    eodAutoCompletePolicy: {
      cleanDayAutoCompleteEnabled: policyConfig.cleanDayAutoCompleteEnabled,
      maxAbsoluteCashVariance: policyConfig.maxAbsoluteCashVariance,
      maxVoidedSaleCount: policyConfig.maxVoidedSaleCount,
      maxVoidedSaleTotal: policyConfig.maxVoidedSaleTotal,
    },
    endAt: scheduleRange.kind === "resolved" ? scheduleRange.endAt : undefined,
    operatingDate: args.operatingDate,
    organizationId: snapshot.organizationId ?? undefined,
    policyReviewedItemKeys,
    startAt:
      scheduleRange.kind === "resolved" ? scheduleRange.startAt : undefined,
    storeId: args.storeId,
  });

  if (result.kind !== "ok") {
    await patchAutomationRunOutcomeWithCtx(ctx, {
      error:
        result.kind === "user_error"
          ? {
              code: result.error.code,
              message: result.error.message,
            }
          : {
              code: "historic_eod_auto_close_failed",
              message: "Historic EOD auto-close could not complete.",
            },
      outcome: result.kind === "user_error" ? "skipped" : "failed",
      runId: run._id,
    });

    return {
      action: result.kind === "user_error" ? "skipped" : "failed",
      classification: adapterDecision.decisionEvidence.classification,
      operatingDate: args.operatingDate,
      runId: run._id,
    };
  }

  await patchAutomationRunOutcomeWithCtx(ctx, {
    appliedAt: result.data.action === "completed" ? Date.now() : undefined,
    decisionEvidence: result.data.automationDecisionEvidence,
    eventIds: result.data.operationalEventId
      ? [result.data.operationalEventId]
      : [],
    outcome: result.data.action === "completed" ? "applied" : "skipped",
    runId: run._id,
  });

  return {
    action:
      result.data.action === "completed" ? "applied" : "already_completed",
    classification: adapterDecision.decisionEvidence.classification,
    operatingDate: args.operatingDate,
    runId: run._id,
  };
}

export async function runHistoricEodAutoCloseBatchWithCtx(
  ctx: MutationCtx,
  args: {
    asOfOperatingDate?: string;
    endOperatingDate: string;
    maxDays: number;
    mode: HistoricEodAutoCloseMode;
    startOperatingDate: string;
    storeId: Id<"store">;
  },
) {
  if (
    !isValidOperatingDate(args.startOperatingDate) ||
    !isValidOperatingDate(args.endOperatingDate)
  ) {
    throw new Error("Historic EOD auto-close requires valid date range bounds.");
  }

  if (
    !Number.isInteger(args.maxDays) ||
    args.maxDays < 1 ||
    args.maxDays > HISTORIC_EOD_AUTO_CLOSE_MAX_DAYS_LIMIT
  ) {
    throw new Error("Historic EOD auto-close maxDays is out of range.");
  }

  const asOfOperatingDate =
    args.asOfOperatingDate ?? new Date(Date.now()).toISOString().slice(0, 10);
  if (!isValidOperatingDate(asOfOperatingDate)) {
    throw new Error("Historic EOD auto-close as-of date is invalid.");
  }

  const results: HistoricEodDateResult[] = [];
  let operatingDate = args.startOperatingDate;

  while (operatingDate <= args.endOperatingDate && results.length < args.maxDays) {
    const result = await runHistoricEodAutoCloseForDateWithCtx(ctx, {
      asOfOperatingDate,
      mode: args.mode,
      operatingDate,
      storeId: args.storeId,
    });

    results.push(result);
    operatingDate = addDaysToOperatingDate(operatingDate, 1);
  }

  return summarizeHistoricEodAutoCloseBatch(args.mode, results, {
    endOperatingDate: args.endOperatingDate,
    nextOperatingDate: operatingDate,
  });
}

function summarizeHistoricEodAutoCloseBatch(
  mode: HistoricEodAutoCloseMode,
  results: HistoricEodDateResult[],
  args: {
    endOperatingDate: string;
    nextOperatingDate: string;
  },
) {
  return {
    alreadyCompleted: results.filter(
      (result) => result.action === "already_completed",
    ).length,
    applied: results.filter((result) => result.action === "applied").length,
    candidates: results.length,
    failed: results.filter((result) => result.action === "failed").length,
    mode,
    nextOperatingDate:
      args.nextOperatingDate <= args.endOperatingDate
        ? args.nextOperatingDate
        : null,
    quarantined: results.filter((result) => result.action === "quarantined")
      .length,
    results,
    skipped: results.filter((result) => result.action === "skipped").length,
  };
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

function openingLocalStartMinutesForPolicy(policy: Doc<"automationPolicy">) {
  return typeof policy.openingLocalStartMinutes === "number" &&
    Number.isInteger(policy.openingLocalStartMinutes)
    ? policy.openingLocalStartMinutes
    : DEFAULT_OPENING_LOCAL_START_MINUTES;
}

function normalizedPolicyOffsetFromScheduleStart(args: {
  policyLocalStartMinutes: number;
  scheduleStartMinutes: number;
}) {
  const rawOffset = args.policyLocalStartMinutes - args.scheduleStartMinutes;

  return rawOffset > 12 * 60
    ? rawOffset - 24 * 60
    : rawOffset < -12 * 60
      ? rawOffset + 24 * 60
      : rawOffset;
}

function eodLocalCompletionWindowMinutesForPolicy(
  policy: Doc<"automationPolicy">,
) {
  return typeof policy.eodLocalCompletionWindowMinutes === "number" &&
    Number.isInteger(policy.eodLocalCompletionWindowMinutes)
    ? policy.eodLocalCompletionWindowMinutes
    : DEFAULT_EOD_LOCAL_COMPLETION_WINDOW_MINUTES;
}

function openingPolicyStartAtForStoreDay(args: {
  policy: Doc<"automationPolicy">;
  storeDayContext: DailyOperationsAutomationStoreDayContext;
}) {
  if (
    typeof args.storeDayContext.openedAt !== "number" ||
    typeof args.storeDayContext.openingWindowStartMinutes !== "number"
  ) {
    return null;
  }

  const offsetMinutes = normalizedPolicyOffsetFromScheduleStart({
    policyLocalStartMinutes: openingLocalStartMinutesForPolicy(args.policy),
    scheduleStartMinutes: args.storeDayContext.openingWindowStartMinutes,
  });

  return args.storeDayContext.openedAt + offsetMinutes * MINUTE_MS;
}

function eodPolicyCompletionAtForStoreDay(args: {
  policy: Doc<"automationPolicy">;
  storeDayContext: DailyOperationsAutomationStoreDayContext;
}) {
  if (
    typeof args.storeDayContext.closedAt !== "number" ||
    typeof args.storeDayContext.eodWindowEndMinutes !== "number"
  ) {
    return null;
  }

  const offsetMinutes = normalizedPolicyOffsetFromScheduleStart({
    policyLocalStartMinutes: eodLocalCompletionWindowMinutesForPolicy(args.policy),
    scheduleStartMinutes: args.storeDayContext.eodWindowEndMinutes,
  });

  return args.storeDayContext.closedAt + offsetMinutes * MINUTE_MS;
}

function configuredOpeningOperatingDate(args: {
  cronWindow: ReturnType<typeof openingPolicyCronWindow>;
  now: number;
  policy: Doc<"automationPolicy">;
  scheduleContext: ConfiguredStoreScheduleContext;
}) {
  const storeDayContext = args.scheduleContext.storeDayContext;

  if (!storeDayContext) {
    return args.cronWindow?.operatingDate ?? null;
  }

  if (
    args.scheduleContext.phase === "closed" ||
    args.scheduleContext.phase === "after_last_window"
  ) {
    return null;
  }

  const policyStartAt = openingPolicyStartAtForStoreDay({
    policy: args.policy,
    storeDayContext,
  });

  if (typeof policyStartAt === "number") {
    return args.now >= policyStartAt ? storeDayContext.operatingDate : null;
  }

  if (
    args.scheduleContext.phase === "during_window" ||
    args.scheduleContext.phase === "between_windows"
  ) {
    return storeDayContext.operatingDate;
  }

  return args.cronWindow?.operatingDate === storeDayContext.operatingDate
    ? storeDayContext.operatingDate
    : null;
}

function configuredEodAutoCompleteStoreDayContext(args: {
  cronWindow: ReturnType<typeof eodAutoCompletePolicyCronWindow>;
  policy: Doc<"automationPolicy">;
  scheduleContext: ConfiguredStoreScheduleContext;
}) {
  if (args.cronWindow?.completionWindowSatisfied === false) {
    return {
      completionWindowSatisfied: false,
      operatingDate: null,
      storeDayContext: undefined,
    };
  }

  const operatingDate = args.cronWindow?.operatingDate ?? null;
  const storeDayContext = args.scheduleContext.storeDayContext;

  if (!operatingDate || storeDayContext?.operatingDate !== operatingDate) {
    return {
      completionWindowSatisfied: args.cronWindow?.completionWindowSatisfied,
      operatingDate,
      storeDayContext: undefined,
    };
  }

  const policyCompletionAt = eodPolicyCompletionAtForStoreDay({
    policy: args.policy,
    storeDayContext,
  });

  return {
    completionWindowSatisfied: true,
    operatingDate,
    storeDayContext:
      typeof policyCompletionAt === "number"
        ? { ...storeDayContext, eodEvaluationAt: policyCompletionAt }
        : storeDayContext,
  };
}

function scheduleEvidenceForStoreDayContext(
  storeDayContext: DailyOperationsAutomationStoreDayContext | undefined,
  action: "opening.auto_start" | "eod.auto_complete",
): DailyOperationsAutomationTimingEvidence | undefined {
  if (!storeDayContext) return undefined;

  return {
    closedAt: storeDayContext.closedAt,
    evaluationAt:
      action === "opening.auto_start"
        ? storeDayContext.openingEvaluationAt
        : storeDayContext.eodEvaluationAt,
    openedAt: storeDayContext.openedAt,
    scheduleVersion: storeDayContext.scheduleVersion,
    source: "canonical_schedule",
    storeScheduleId: storeDayContext.storeScheduleId,
  };
}

function eodAutoCompleteTiming(args: {
  now: number;
  policyConfig: EodAutoCompletePolicyConfig;
  storeDayContext?: DailyOperationsAutomationStoreDayContext;
}) {
  if (args.storeDayContext) {
    const evaluationAt =
      args.storeDayContext.eodEvaluationAt ?? args.storeDayContext.closedAt;

    return {
      insideCompletionWindow:
        typeof evaluationAt === "number" ? args.now >= evaluationAt : false,
      localCompletionWindowMinutes:
        args.policyConfig.localCompletionWindowMinutes,
      localMinuteOfDay: args.policyConfig.localCompletionWindowMinutes,
      scheduleEvidence: scheduleEvidenceForStoreDayContext(
        args.storeDayContext,
        "eod.auto_complete",
      ),
    };
  }

  const localDate = localDateForPolicy({
    now: args.now,
    operatingTimezoneOffsetMinutes:
      args.policyConfig.policy?.operatingTimezoneOffsetMinutes,
  });

  if (!localDate) return null;

  const localMinuteOfDay =
    localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
  const localCompletionWindowMinutes =
    args.policyConfig.localCompletionWindowMinutes;

  return {
    insideCompletionWindow: localMinuteOfDay >= localCompletionWindowMinutes,
    localCompletionWindowMinutes,
    localMinuteOfDay,
    scheduleEvidence: {
      source: "compatibility_policy" as const,
    },
  };
}

async function resolveConfiguredStoreScheduleContext(
  ctx: MutationCtx,
  args: {
    now: number;
    storeId: Id<"store">;
  },
): Promise<ConfiguredStoreScheduleContext> {
  const { context } = await getStoreScheduleContextForStoreAtWithCtx(ctx, {
    at: args.now,
    storeId: args.storeId,
  });

  if (context.kind !== "resolved" || !context.scheduleVersionId) {
    return { phase: "unavailable" };
  }

  const relevantWindow = context.currentWindow ?? context.nextWindow ?? null;

  return {
    phase: context.phase,
    storeDayContext: {
      closedAt:
        context.phase === "after_last_window"
          ? args.now
          : relevantWindow?.endsAt,
      eodEvaluationAt:
        context.phase === "after_last_window"
          ? args.now
          : relevantWindow?.endsAt,
      eodWindowEndMinutes:
        context.phase === "after_last_window"
          ? undefined
          : relevantWindow?.endMinute,
      openedAt: relevantWindow?.startsAt,
      openingEvaluationAt: relevantWindow?.startsAt,
      openingWindowStartMinutes: relevantWindow?.startMinute,
      operatingDate: context.operatingDate,
      scheduleVersion: context.scheduleVersionId,
      source: "canonical_schedule",
      storeScheduleId: context.scheduleVersionId,
    },
  };
}

function eodAutoCompletePolicyCronWindow(args: {
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

  const localCompletionWindowMinutes =
    typeof args.policy.eodLocalCompletionWindowMinutes === "number" &&
    Number.isInteger(args.policy.eodLocalCompletionWindowMinutes)
      ? args.policy.eodLocalCompletionWindowMinutes
      : DEFAULT_EOD_LOCAL_COMPLETION_WINDOW_MINUTES;
  const localMinuteOfDay =
    localDate.getUTCHours() * 60 + localDate.getUTCMinutes();
  const currentOperatingDate = localDate.toISOString().slice(0, 10);

  if (
    localMinuteOfDay < localCompletionWindowMinutes &&
    localMinuteOfDay * 60_000 <= CONFIGURED_AUTOMATION_LOOKBACK_MS
  ) {
    const previousLocalDate = new Date(localDate.getTime() - 24 * 60 * 60_000);

    return {
      completionWindowSatisfied: true,
      operatingDate: previousLocalDate.toISOString().slice(0, 10),
    };
  }

  return {
    completionWindowSatisfied: localMinuteOfDay >= localCompletionWindowMinutes,
    operatingDate: currentOperatingDate,
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
    now?: number;
    operatingDate: string;
  },
) {
  const now = args.now ?? Date.now();
  const [openingPolicies, eodPolicies, eodAutoCompletePolicies] =
    await Promise.all([
    listConfiguredAutomationPolicies(ctx, { action: OPENING_AUTO_START_ACTION }),
    listConfiguredAutomationPolicies(ctx, { action: EOD_PREPARE_ACTION }),
    listConfiguredAutomationPolicies(ctx, { action: EOD_AUTO_COMPLETE_ACTION }),
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
  const eodAutoCompleteResults = await Promise.all(
    eodAutoCompletePolicies.map((policy) =>
      runConfiguredPolicySafely(ctx, {
        action: EOD_AUTO_COMPLETE_ACTION,
        operatingDate: args.operatingDate,
        policy,
        run: (operatingDate) =>
          runDailyCloseAutoCompleteEligibilityWithCtx(ctx, {
            now,
            operatingDate,
            storeId: policy.storeId,
          }),
      }),
    ),
  );

  return {
    eodAutoCompleteResults,
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
  const [openingPolicies, eodPolicies, eodAutoCompletePolicies] =
    await Promise.all([
    listConfiguredAutomationPolicies(ctx, { action: OPENING_AUTO_START_ACTION }),
    listConfiguredAutomationPolicies(ctx, { action: EOD_PREPARE_ACTION }),
    listConfiguredAutomationPolicies(ctx, { action: EOD_AUTO_COMPLETE_ACTION }),
  ]);
  const openingResults = await Promise.all(
    openingPolicies.map(async (policy) => {
      const scheduleContext = await resolveConfiguredStoreScheduleContext(ctx, {
        now,
        storeId: policy.storeId,
      });
      const cronWindow = openingPolicyCronWindow({
        now,
        policy,
      });
      const operatingDate = configuredOpeningOperatingDate({
        cronWindow,
        now,
        policy,
        scheduleContext,
      });

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
    eodPolicies.map(async (policy) => {
      const scheduleContext = await resolveConfiguredStoreScheduleContext(ctx, {
        now,
        storeId: policy.storeId,
      });
      const operatingDate =
        scheduleContext.storeDayContext && scheduleContext.phase !== "closed"
          ? scheduleContext.storeDayContext.operatingDate
          : scheduleContext.phase === "closed"
            ? null
            : operatingDateForPolicy({
                now,
                operatingTimezoneOffsetMinutes:
                  policy.operatingTimezoneOffsetMinutes,
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
  const eodAutoCompleteResults = await Promise.all(
    eodAutoCompletePolicies.map(async (policy) => {
      const scheduleContext = await resolveConfiguredStoreScheduleContext(ctx, {
        now,
        storeId: policy.storeId,
      });
      const cronWindow = eodAutoCompletePolicyCronWindow({
        now,
        policy,
      });
      const eodStoreDayContext = configuredEodAutoCompleteStoreDayContext({
        cronWindow,
        policy,
        scheduleContext,
      });

      return runConfiguredPolicySafely(ctx, {
        action: EOD_AUTO_COMPLETE_ACTION,
        operatingDate: eodStoreDayContext.operatingDate,
        policy,
        run: (operatingDate) =>
          runDailyCloseAutoCompleteEligibilityWithCtx(ctx, {
            completionWindowSatisfied:
              eodStoreDayContext.completionWindowSatisfied,
            now,
            operatingDate,
            storeDayContext: eodStoreDayContext.storeDayContext,
            storeId: policy.storeId,
          }),
      });
    }),
  );

  return {
    eodAutoCompleteResults: eodAutoCompleteResults.filter(
      (result) => result !== null,
    ),
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

export const runHistoricEodAutoCloseForDate = internalMutation({
  args: {
    asOfOperatingDate: v.string(),
    mode: v.union(v.literal("dry_run"), v.literal("apply")),
    operatingDate: v.string(),
    storeId: v.id("store"),
  },
  handler: (ctx, args) => runHistoricEodAutoCloseForDateWithCtx(ctx, args),
});

async function runHistoricEodAutoCloseBatchActionWithCtx(
  ctx: Pick<ActionCtx, "runMutation">,
  args: {
    asOfOperatingDate?: string;
    endOperatingDate: string;
    maxDays: number;
    mode: HistoricEodAutoCloseMode;
    startOperatingDate: string;
    storeId: Id<"store">;
  },
) {
  if (
    !isValidOperatingDate(args.startOperatingDate) ||
    !isValidOperatingDate(args.endOperatingDate)
  ) {
    throw new Error("Historic EOD auto-close requires valid date range bounds.");
  }

  if (
    !Number.isInteger(args.maxDays) ||
    args.maxDays < 1 ||
    args.maxDays > HISTORIC_EOD_AUTO_CLOSE_MAX_DAYS_LIMIT
  ) {
    throw new Error("Historic EOD auto-close maxDays is out of range.");
  }

  const asOfOperatingDate =
    args.asOfOperatingDate ?? new Date(Date.now()).toISOString().slice(0, 10);
  if (!isValidOperatingDate(asOfOperatingDate)) {
    throw new Error("Historic EOD auto-close as-of date is invalid.");
  }

  const results: HistoricEodDateResult[] = [];
  let operatingDate = args.startOperatingDate;

  while (operatingDate <= args.endOperatingDate && results.length < args.maxDays) {
    const result = await ctx.runMutation(
      internal.operations.dailyOperationsAutomation.runHistoricEodAutoCloseForDate,
      {
        asOfOperatingDate,
        mode: args.mode,
        operatingDate,
        storeId: args.storeId,
      },
    );

    results.push(result as HistoricEodDateResult);
    operatingDate = addDaysToOperatingDate(operatingDate, 1);
  }

  return summarizeHistoricEodAutoCloseBatch(args.mode, results, {
    endOperatingDate: args.endOperatingDate,
    nextOperatingDate: operatingDate,
  });
}

export const runHistoricEodAutoCloseBatch = internalAction({
  args: {
    asOfOperatingDate: v.optional(v.string()),
    endOperatingDate: v.string(),
    maxDays: v.number(),
    mode: v.union(v.literal("dry_run"), v.literal("apply")),
    startOperatingDate: v.string(),
    storeId: v.id("store"),
  },
  handler: (ctx, args) => runHistoricEodAutoCloseBatchActionWithCtx(ctx, args),
});

export const getOpeningAutoStartPolicy = query({
  args: {
    storeId: v.id("store"),
  },
  handler: (ctx, args) => getOpeningAutoStartPolicyForApi(ctx, args),
});

export const getEodAutoCompletePolicy = query({
  args: {
    storeId: v.id("store"),
  },
  handler: (ctx, args) => getEodAutoCompletePolicyForApi(ctx, args),
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

export const updateEodAutoCompletePolicy = mutation({
  args: {
    cleanDayAutoCompleteEnabled: v.boolean(),
    localCompletionWindowMinutes: v.number(),
    maxAbsoluteCashVariance: v.number(),
    maxVoidedSaleCount: v.number(),
    maxVoidedSaleTotal: v.number(),
    mode: v.union(
      v.literal("disabled"),
      v.literal("dry_run"),
      v.literal("enabled"),
    ),
    operatingTimezoneOffsetMinutes: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const { athenaUser, store } = await requireStoreFullAdminAccess(
      ctx,
      args.storeId,
    );
    const policy = await upsertEodAutoCompletePolicyConfigWithCtx(ctx, {
      cleanDayAutoCompleteEnabled: args.cleanDayAutoCompleteEnabled,
      localCompletionWindowMinutes: args.localCompletionWindowMinutes,
      maxAbsoluteCashVariance: args.maxAbsoluteCashVariance,
      maxVoidedSaleCount: args.maxVoidedSaleCount,
      maxVoidedSaleTotal: args.maxVoidedSaleTotal,
      mode: args.mode,
      operatingTimezoneOffsetMinutes: args.operatingTimezoneOffsetMinutes,
      organizationId: store.organizationId,
      policyVersion: DAILY_OPERATIONS_POLICY_VERSION,
      storeId: args.storeId,
      updatedByUserId: athenaUser._id,
    });

    return {
      cleanDayAutoCompleteEnabled: Boolean(
        policy.eodCleanDayAutoCompleteEnabled,
      ),
      configured: true,
      localCompletionWindowMinutes:
        policy.eodLocalCompletionWindowMinutes ??
        DEFAULT_EOD_LOCAL_COMPLETION_WINDOW_MINUTES,
      maxAbsoluteCashVariance: policy.eodMaxAbsoluteCashVariance ?? 0,
      maxVoidedSaleCount: policy.eodMaxVoidedSaleCount ?? 0,
      maxVoidedSaleTotal: policy.eodMaxVoidedSaleTotal ?? 0,
      mode: policy.mode,
      operatingTimezoneOffsetMinutes:
        policy.operatingTimezoneOffsetMinutes ?? null,
      paused: Boolean(policy.paused),
      policyVersion: policy.policyVersion,
    };
  },
});
