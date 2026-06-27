import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  EOD_AUTO_COMPLETE_POLICY_ACTION,
  OPENING_AUTO_START_POLICY_ACTION,
  OPENING_AUTO_START_POLICY_DOMAIN,
} from "../automation/runLedger";
import {
  isValidStoreTimezone,
  validateStoreScheduleDraft,
  type StoreScheduleDraft,
  type StoreScheduleWindow,
} from "../lib/storeScheduleTime";

type TrustedTimezoneInput = {
  source: string;
  storeId: Id<"store">;
  timezone: string;
};

type BackfillArgs = {
  candidateCloseMinute?: number;
  cursor?: string | null;
  dryRun?: boolean;
  effectiveFrom?: number;
  limit?: number;
  trustedTimezones?: TrustedTimezoneInput[];
};

type CompatibilityMetadata = {
  eodLocalCompletionWindowMinutes?: number;
  openingLocalStartMinutes?: number;
  operatingTimezoneOffsetMinutes?: number;
};

type BackfillRow = {
  action:
    | "compatibility_only"
    | "inserted_candidate"
    | "skipped_existing_schedule"
    | "would_insert_candidate";
  compatibilityMetadata: CompatibilityMetadata;
  existingScheduleId?: Id<"storeSchedule">;
  reason?: string;
  scheduleId?: Id<"storeSchedule">;
  storeId: Id<"store">;
  timezone?: string;
  weeklyWindows?: StoreScheduleWindow[];
};

const MAX_BACKFILL_LIMIT = 100;
const DEFAULT_BACKFILL_LIMIT = 25;
const MINUTES_PER_DAY = 24 * 60;
const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

function normalizeLimit(value: number | undefined) {
  if (!Number.isInteger(value) || value === undefined || value <= 0) {
    return DEFAULT_BACKFILL_LIMIT;
  }

  return Math.min(value, MAX_BACKFILL_LIMIT);
}

function isValidMinute(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < MINUTES_PER_DAY
  );
}

function firstPolicy(
  policies: Doc<"automationPolicy">[],
): Doc<"automationPolicy"> | null {
  return policies.length === 1 ? policies[0] : null;
}

async function listPoliciesForStoreAction(
  ctx: Pick<MutationCtx, "db">,
  args: {
    action: string;
    storeId: Id<"store">;
  },
) {
  return await ctx.db
    .query("automationPolicy")
    .withIndex("by_storeId_domain_action", (policy) =>
      policy
        .eq("storeId", args.storeId)
        .eq("domain", OPENING_AUTO_START_POLICY_DOMAIN)
        .eq("action", args.action),
    )
    .take(2);
}

async function listSchedulesForStoreByStatus(
  ctx: Pick<MutationCtx, "db">,
  args: {
    status: "active" | "candidate";
    storeId: Id<"store">;
  },
) {
  return await ctx.db
    .query("storeSchedule")
    .withIndex("by_storeId_status_effectiveFrom", (schedule) =>
      schedule.eq("storeId", args.storeId).eq("status", args.status),
    )
    .take(10);
}

function findExistingScheduleToSkip(
  activeSchedules: Doc<"storeSchedule">[],
  candidateSchedules: Doc<"storeSchedule">[],
) {
  return (
    activeSchedules[0] ??
    candidateSchedules.find((schedule) => schedule.source === "admin") ??
    candidateSchedules.find((schedule) => schedule.source === "seed") ??
    null
  );
}

function trustedTimezoneForStore(
  trustedTimezones: TrustedTimezoneInput[] | undefined,
  storeId: Id<"store">,
) {
  return trustedTimezones?.find((entry) => entry.storeId === storeId) ?? null;
}

function compatibilityMetadata(args: {
  eodPolicy: Doc<"automationPolicy"> | null;
  openingPolicy: Doc<"automationPolicy"> | null;
}): CompatibilityMetadata {
  return {
    ...(isValidMinute(args.openingPolicy?.openingLocalStartMinutes)
      ? { openingLocalStartMinutes: args.openingPolicy.openingLocalStartMinutes }
      : {}),
    ...(typeof args.openingPolicy?.operatingTimezoneOffsetMinutes === "number"
      ? {
          operatingTimezoneOffsetMinutes:
            args.openingPolicy.operatingTimezoneOffsetMinutes,
        }
      : typeof args.eodPolicy?.operatingTimezoneOffsetMinutes === "number"
        ? {
            operatingTimezoneOffsetMinutes:
              args.eodPolicy.operatingTimezoneOffsetMinutes,
          }
        : {}),
    ...(isValidMinute(args.eodPolicy?.eodLocalCompletionWindowMinutes)
      ? {
          eodLocalCompletionWindowMinutes:
            args.eodPolicy.eodLocalCompletionWindowMinutes,
        }
      : {}),
  };
}

function buildCandidateWeeklyWindows(args: {
  candidateCloseMinute: number;
  openingLocalStartMinutes: number;
}) {
  return WEEK_DAYS.map((dayOfWeek) => ({
    dayOfWeek,
    startMinute: args.openingLocalStartMinutes,
    endMinute: args.candidateCloseMinute,
  }));
}

function compatibilityOnlyRow(args: {
  compatibilityMetadata: CompatibilityMetadata;
  reason: string;
  storeId: Id<"store">;
}): BackfillRow {
  return {
    action: "compatibility_only",
    compatibilityMetadata: args.compatibilityMetadata,
    reason: args.reason,
    storeId: args.storeId,
  };
}

async function buildBackfillRow(
  ctx: Pick<MutationCtx, "db">,
  args: {
    candidateCloseMinute?: number;
    dryRun: boolean;
    effectiveFrom: number;
    store: Doc<"store">;
    trustedTimezones?: TrustedTimezoneInput[];
  },
): Promise<BackfillRow> {
  const activeSchedules = await listSchedulesForStoreByStatus(ctx, {
    status: "active",
    storeId: args.store._id,
  });
  const candidateSchedules = await listSchedulesForStoreByStatus(ctx, {
    status: "candidate",
    storeId: args.store._id,
  });
  const existingSchedule = findExistingScheduleToSkip(
    activeSchedules,
    candidateSchedules,
  );

  if (existingSchedule) {
    return {
      action: "skipped_existing_schedule",
      compatibilityMetadata: {},
      existingScheduleId: existingSchedule._id,
      storeId: args.store._id,
    };
  }

  const openingPolicies = await listPoliciesForStoreAction(ctx, {
    action: OPENING_AUTO_START_POLICY_ACTION,
    storeId: args.store._id,
  });
  const eodPolicies = await listPoliciesForStoreAction(ctx, {
    action: EOD_AUTO_COMPLETE_POLICY_ACTION,
    storeId: args.store._id,
  });
  const openingPolicy = firstPolicy(openingPolicies);
  const eodPolicy = firstPolicy(eodPolicies);
  const metadata = compatibilityMetadata({ eodPolicy, openingPolicy });

  if (openingPolicies.length > 1) {
    return compatibilityOnlyRow({
      compatibilityMetadata: metadata,
      reason: "ambiguous_opening_policy",
      storeId: args.store._id,
    });
  }

  if (!isValidMinute(openingPolicy?.openingLocalStartMinutes)) {
    return compatibilityOnlyRow({
      compatibilityMetadata: metadata,
      reason: "missing_opening_start",
      storeId: args.store._id,
    });
  }

  if (!isValidMinute(args.candidateCloseMinute)) {
    return compatibilityOnlyRow({
      compatibilityMetadata: metadata,
      reason: "missing_candidate_close",
      storeId: args.store._id,
    });
  }

  const trustedTimezone = trustedTimezoneForStore(
    args.trustedTimezones,
    args.store._id,
  );
  if (!trustedTimezone) {
    return compatibilityOnlyRow({
      compatibilityMetadata: metadata,
      reason: "missing_trusted_timezone",
      storeId: args.store._id,
    });
  }

  if (!isValidStoreTimezone(trustedTimezone.timezone)) {
    return compatibilityOnlyRow({
      compatibilityMetadata: metadata,
      reason: "invalid_trusted_timezone",
      storeId: args.store._id,
    });
  }

  const weeklyWindows = buildCandidateWeeklyWindows({
    candidateCloseMinute: args.candidateCloseMinute,
    openingLocalStartMinutes: openingPolicy.openingLocalStartMinutes,
  });
  const candidate: StoreScheduleDraft = {
    organizationId: args.store.organizationId,
    storeId: args.store._id,
    timezone: trustedTimezone.timezone,
    weeklyWindows,
    weeklyClosedDays: [],
    dateExceptions: [],
    effectiveFrom: args.effectiveFrom,
    status: "candidate",
    source: "seed",
    createdAt: args.effectiveFrom,
    updatedAt: args.effectiveFrom,
  };
  const validation = validateStoreScheduleDraft(candidate);

  if (!validation.ok) {
    return compatibilityOnlyRow({
      compatibilityMetadata: metadata,
      reason: "invalid_candidate_schedule",
      storeId: args.store._id,
    });
  }

  if (args.dryRun) {
    return {
      action: "would_insert_candidate",
      compatibilityMetadata: metadata,
      storeId: args.store._id,
      timezone: trustedTimezone.timezone,
      weeklyWindows,
    };
  }

  const scheduleId = await ctx.db.insert("storeSchedule", candidate);
  return {
    action: "inserted_candidate",
    compatibilityMetadata: metadata,
    scheduleId,
    storeId: args.store._id,
    timezone: trustedTimezone.timezone,
    weeklyWindows,
  };
}

export async function backfillStoreSchedulesFromLegacyPolicyWithCtx(
  ctx: MutationCtx,
  args: BackfillArgs,
) {
  const limit = normalizeLimit(args.limit);
  const dryRun = args.dryRun !== false;
  const effectiveFrom = args.effectiveFrom ?? Date.now();
  const page = await ctx.db.query("store").paginate({
    numItems: limit,
    cursor: args.cursor ?? null,
  });
  const rows: BackfillRow[] = [];

  for (const store of page.page) {
    rows.push(
      await buildBackfillRow(ctx, {
        candidateCloseMinute: args.candidateCloseMinute,
        dryRun,
        effectiveFrom,
        store,
        trustedTimezones: args.trustedTimezones,
      }),
    );
  }

  return {
    dryRun,
    processedCount: page.page.length,
    candidateCount: rows.filter(
      (row) =>
        row.action === "would_insert_candidate" ||
        row.action === "inserted_candidate",
    ).length,
    insertedCount: rows.filter((row) => row.action === "inserted_candidate").length,
    skippedExistingScheduleCount: rows.filter(
      (row) => row.action === "skipped_existing_schedule",
    ).length,
    compatibilityOnlyCount: rows.filter(
      (row) => row.action === "compatibility_only",
    ).length,
    isDone: page.isDone,
    cursor: page.continueCursor,
    rows,
  };
}

export const backfillStoreSchedulesFromLegacyPolicy = internalMutation({
  args: {
    candidateCloseMinute: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    effectiveFrom: v.optional(v.number()),
    limit: v.optional(v.number()),
    trustedTimezones: v.optional(
      v.array(
        v.object({
          source: v.string(),
          storeId: v.id("store"),
          timezone: v.string(),
        }),
      ),
    ),
  },
  handler: backfillStoreSchedulesFromLegacyPolicyWithCtx,
});
