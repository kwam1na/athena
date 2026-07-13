import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "../../_generated/server";
import { requireReportingStoreAccess } from "../access";
import { resolveReportingOperatingPeriod } from "../operatingPeriods";
import type {
  StoreScheduleDateException,
  StoreScheduleWindow,
} from "../../lib/storeScheduleTime";
import { validateStoreScheduleDraft } from "../../lib/storeScheduleTime";

const FAILED_MANIFEST_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const APPLIED_MANIFEST_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const CLEANUP_BATCH_LIMIT = 100;

export type HistoricalPolicyContent = {
  dateExceptionsJson: string;
  evidenceSummary: string;
  intervalEnd: number;
  intervalStart: number;
  organizationId: string;
  revenueCurrencyCode: string;
  revenueCurrencyMinorUnitScale: number;
  storeId: string;
  timezone: string;
  version: number;
  weeklyWindowsJson: string;
};

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizeHistoricalPolicyContent(
  input: HistoricalPolicyContent,
): HistoricalPolicyContent {
  const revenueCurrencyCode = input.revenueCurrencyCode.trim().toUpperCase();
  const timezone = input.timezone.trim();
  const evidenceSummary = input.evidenceSummary.trim();
  if (
    !Number.isSafeInteger(input.intervalStart) ||
    !Number.isSafeInteger(input.intervalEnd) ||
    input.intervalStart >= input.intervalEnd
  ) {
    throw new Error("Historical reporting policy interval is invalid");
  }
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    throw new Error("Historical reporting policy version is invalid");
  }
  if (revenueCurrencyCode !== "GHS" || input.revenueCurrencyMinorUnitScale !== 2) {
    throw new Error("Historical reporting policy currency is unsupported");
  }
  if (timezone !== "Africa/Accra" || evidenceSummary.length < 8) {
    throw new Error("Historical reporting policy evidence is incomplete");
  }
  let weeklyWindows: unknown;
  let dateExceptions: unknown;
  try {
    weeklyWindows = JSON.parse(input.weeklyWindowsJson);
    dateExceptions = JSON.parse(input.dateExceptionsJson);
  } catch {
    throw new Error("Historical reporting policy schedule JSON is invalid");
  }
  if (
    !Array.isArray(weeklyWindows) ||
    !weeklyWindows.every(
      (window) =>
        window !== null &&
        typeof window === "object" &&
        Number.isInteger((window as StoreScheduleWindow).dayOfWeek) &&
        Number.isInteger((window as StoreScheduleWindow).startMinute) &&
        Number.isInteger((window as StoreScheduleWindow).endMinute) &&
        ((window as StoreScheduleWindow).label === undefined ||
          typeof (window as StoreScheduleWindow).label === "string"),
    ) ||
    !Array.isArray(dateExceptions) ||
    !dateExceptions.every(
      (exception) =>
        exception !== null &&
        typeof exception === "object" &&
        typeof (exception as StoreScheduleDateException).localDate === "string" &&
        typeof (exception as StoreScheduleDateException).closed === "boolean" &&
        Array.isArray((exception as StoreScheduleDateException).windows) &&
        (exception as StoreScheduleDateException).windows.every(
          (window) =>
            window !== null &&
            typeof window === "object" &&
            Number.isInteger(window.startMinute) &&
            Number.isInteger(window.endMinute) &&
            (window.label === undefined || typeof window.label === "string"),
        ) &&
        ((exception as StoreScheduleDateException).note === undefined ||
          typeof (exception as StoreScheduleDateException).note === "string"),
    )
  ) {
    throw new Error("Historical reporting policy schedule JSON is invalid");
  }
  const validatedWeeklyWindows = weeklyWindows as StoreScheduleWindow[];
  const validatedDateExceptions = dateExceptions as StoreScheduleDateException[];
  const scheduledDays = new Set(
    validatedWeeklyWindows.map((window) => window.dayOfWeek),
  );
  const scheduleValidation = validateStoreScheduleDraft({
    createdAt: input.intervalStart,
    dateExceptions: validatedDateExceptions,
    effectiveFrom: input.intervalStart,
    effectiveTo: input.intervalEnd,
    organizationId: input.organizationId,
    source: "system",
    status: "active",
    storeId: input.storeId,
    timezone,
    updatedAt: input.intervalStart,
    weeklyClosedDays: Array.from({ length: 7 }, (_, day) => day).filter(
      (day) => !scheduledDays.has(day),
    ),
    weeklyWindows: validatedWeeklyWindows,
  });
  if (!scheduleValidation.ok) {
    throw new Error("Historical reporting policy schedule is invalid");
  }
  return { ...input, evidenceSummary, revenueCurrencyCode, timezone };
}

export function historicalPolicyContentHash(input: HistoricalPolicyContent) {
  const value = normalizeHistoricalPolicyContent(input);
  return `historical-policy-v1:${fnv1a(JSON.stringify([
    value.organizationId,
    value.storeId,
    value.version,
    value.intervalStart,
    value.intervalEnd,
    value.timezone,
    value.weeklyWindowsJson,
    value.dateExceptionsJson,
    value.revenueCurrencyCode,
    value.revenueCurrencyMinorUnitScale,
    value.evidenceSummary,
  ]))}`;
}

export function historicalPolicyApprovalHash(input: {
  approverUserId: string;
  contentHash: string;
  creatorUserId: string;
}) {
  return `historical-policy-approval-v1:${fnv1a(JSON.stringify([
    input.contentHash,
    input.creatorUserId,
    input.approverUserId,
  ]))}`;
}

export function resolveHistoricalPolicyOperatingPeriod(input: {
  occurrenceAt: number;
  policy: Pick<
    Doc<"reportingHistoricalInterpretationPolicy">,
    | "_id"
    | "organizationId"
    | "storeId"
    | "status"
    | "intervalStart"
    | "intervalEnd"
    | "timezone"
    | "weeklyWindowsJson"
    | "dateExceptionsJson"
    | "contentHash"
    | "approvalHash"
  >;
}) {
  const { occurrenceAt, policy } = input;
  if (
    policy.status !== "approved" ||
    !policy.approvalHash ||
    occurrenceAt < policy.intervalStart ||
    occurrenceAt >= policy.intervalEnd
  ) {
    return { kind: "outside_policy" as const, occurrenceAt };
  }
  const weeklyWindows = JSON.parse(policy.weeklyWindowsJson) as StoreScheduleWindow[];
  const dateExceptions = JSON.parse(
    policy.dateExceptionsJson,
  ) as StoreScheduleDateException[];
  const scheduledDays = new Set(weeklyWindows.map((window) => window.dayOfWeek));
  const resolved = resolveReportingOperatingPeriod({
    occurrenceAt,
    schedule: {
      _id: policy._id,
      organizationId: policy.organizationId,
      storeId: policy.storeId,
      timezone: policy.timezone,
      weeklyWindows,
      weeklyClosedDays: Array.from({ length: 7 }, (_, day) => day).filter(
        (day) => !scheduledDays.has(day),
      ),
      dateExceptions,
      effectiveFrom: policy.intervalStart,
      effectiveTo: policy.intervalEnd,
      status: "active",
      source: "system",
      createdAt: policy.intervalStart,
      updatedAt: policy.intervalStart,
    },
  });
  if (resolved.kind !== "resolved") return resolved;
  return {
    ...resolved,
    scheduleVersionId: undefined,
    historicalInterpretationPolicyId: String(policy._id),
    historicalInterpretationPolicyHash: policy.approvalHash,
  };
}

export function manifestCleanupEligibleAt(input: {
  completedAt: number;
  status: Doc<"reportingBackfillApplyManifest">["status"];
}) {
  if (input.status === "failed" || input.status === "cancelled") {
    return input.completedAt + FAILED_MANIFEST_RETENTION_MS;
  }
  if (input.status === "completed") {
    return input.completedAt + APPLIED_MANIFEST_RETENTION_MS;
  }
  throw new Error("Non-terminal manifest cannot become cleanup eligible");
}

async function requireFirstStoreScheduleBoundaryWithCtx(
  ctx: Pick<MutationCtx, "db">,
  input: { intervalEnd: number; storeId: Id<"store"> },
) {
  const [active, superseded] = await Promise.all(
    (["active", "superseded"] as const).map((status) =>
      ctx.db
        .query("storeSchedule")
        .withIndex("by_storeId_status_effectiveFrom", (q) =>
          q.eq("storeId", input.storeId).eq("status", status),
        )
        .first(),
    ),
  );
  const firstBoundary = [active, superseded]
    .filter((schedule): schedule is NonNullable<typeof schedule> => Boolean(schedule))
    .reduce<number | null>(
      (earliest, schedule) =>
        earliest === null
          ? schedule.effectiveFrom
          : Math.min(earliest, schedule.effectiveFrom),
      null,
    );
  if (firstBoundary === null || input.intervalEnd !== firstBoundary) {
    throw new Error(
      "Historical reporting policy must end at the first Store Schedule boundary",
    );
  }
}

async function assertNoApprovedPolicyOverlapWithCtx(
  ctx: Pick<MutationCtx, "db">,
  input: { intervalEnd: number; intervalStart: number; storeId: Id<"store"> },
) {
  const nearestPredecessor = await ctx.db
    .query("reportingHistoricalInterpretationPolicy")
    .withIndex("by_storeId_status_intervalStart", (q) =>
      q
        .eq("storeId", input.storeId)
        .eq("status", "approved")
        .lt("intervalStart", input.intervalEnd),
    )
    .order("desc")
    .first();
  if (
    nearestPredecessor &&
    input.intervalStart < nearestPredecessor.intervalEnd
  ) {
    throw new Error("Historical reporting policy interval overlaps approval");
  }
}

const policyArgs = {
  storeId: v.id("store"),
  version: v.number(),
  intervalStart: v.number(),
  intervalEnd: v.number(),
  timezone: v.string(),
  weeklyWindowsJson: v.string(),
  dateExceptionsJson: v.string(),
  revenueCurrencyCode: v.string(),
  revenueCurrencyMinorUnitScale: v.number(),
  evidenceSummary: v.string(),
};

export const createDraft = mutation({
  args: policyArgs,
  handler: async (ctx, args) => {
    const access = await requireReportingStoreAccess(ctx, args.storeId);
    const content = normalizeHistoricalPolicyContent({
      ...args,
      organizationId: String(access.store.organizationId),
      storeId: String(args.storeId),
    });
    await requireFirstStoreScheduleBoundaryWithCtx(ctx, {
      intervalEnd: content.intervalEnd,
      storeId: args.storeId,
    });
    const existingVersion = await ctx.db
      .query("reportingHistoricalInterpretationPolicy")
      .withIndex("by_storeId_version", (q) =>
        q.eq("storeId", args.storeId).eq("version", args.version),
      )
      .take(2);
    if (existingVersion.length > 0) {
      throw new Error("Historical reporting policy version already exists");
    }
    await assertNoApprovedPolicyOverlapWithCtx(ctx, {
      intervalEnd: content.intervalEnd,
      intervalStart: content.intervalStart,
      storeId: args.storeId,
    });
    const now = Date.now();
    const contentHash = historicalPolicyContentHash(content);
    return await ctx.db.insert("reportingHistoricalInterpretationPolicy", {
      ...args,
      contentHash,
      createdAt: now,
      createdByUserId: access.athenaUser._id,
      evidenceSummary: content.evidenceSummary,
      organizationId: access.store.organizationId,
      revenueCurrencyCode: content.revenueCurrencyCode,
      status: "draft",
      timezone: content.timezone,
    });
  },
});

export const approveDraft = mutation({
  args: {
    policyId: v.id("reportingHistoricalInterpretationPolicy"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const access = await requireReportingStoreAccess(ctx, args.storeId);
    const policy = await ctx.db.get("reportingHistoricalInterpretationPolicy", args.policyId);
    if (
      !policy ||
      policy.storeId !== args.storeId ||
      policy.organizationId !== access.store.organizationId ||
      policy.status !== "draft"
    ) {
      throw new Error("Historical reporting policy is unavailable for approval");
    }
    const recomputedContentHash = historicalPolicyContentHash({
      dateExceptionsJson: policy.dateExceptionsJson,
      evidenceSummary: policy.evidenceSummary,
      intervalEnd: policy.intervalEnd,
      intervalStart: policy.intervalStart,
      organizationId: String(policy.organizationId),
      revenueCurrencyCode: policy.revenueCurrencyCode,
      revenueCurrencyMinorUnitScale: policy.revenueCurrencyMinorUnitScale,
      storeId: String(policy.storeId),
      timezone: policy.timezone,
      version: policy.version,
      weeklyWindowsJson: policy.weeklyWindowsJson,
    });
    if (recomputedContentHash !== policy.contentHash) {
      throw new Error("Historical reporting policy content hash changed");
    }
    await requireFirstStoreScheduleBoundaryWithCtx(ctx, {
      intervalEnd: policy.intervalEnd,
      storeId: args.storeId,
    });
    await assertNoApprovedPolicyOverlapWithCtx(ctx, {
      intervalEnd: policy.intervalEnd,
      intervalStart: policy.intervalStart,
      storeId: args.storeId,
    });
    const approvalHash = historicalPolicyApprovalHash({
      approverUserId: String(access.athenaUser._id),
      contentHash: policy.contentHash,
      creatorUserId: String(policy.createdByUserId),
    });
    const now = Date.now();
    await ctx.db.patch("reportingHistoricalInterpretationPolicy", policy._id, {
      approvalHash,
      approvedAt: now,
      approvedByUserId: access.athenaUser._id,
      status: "approved",
    });
    return { approvalHash, policyId: policy._id };
  },
});

export async function requireApprovedHistoricalPolicyWithCtx(
  ctx: Pick<MutationCtx, "db">,
  input: {
    policyId: Id<"reportingHistoricalInterpretationPolicy">;
    policyHash: string;
    storeId: Id<"store">;
  },
) {
  const policy = await ctx.db.get("reportingHistoricalInterpretationPolicy", input.policyId);
  if (
    !policy ||
    policy.storeId !== input.storeId ||
    policy.status !== "approved" ||
    policy.approvalHash !== input.policyHash
  ) {
    throw new Error("Historical reporting policy is not approved");
  }
  return policy;
}

export const cleanupManifestBatch = internalMutation({
  args: {
    manifestId: v.id("reportingBackfillApplyManifest"),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const manifest = await ctx.db.get("reportingBackfillApplyManifest", args.manifestId);
    if (
      !manifest ||
      manifest.cleanupEligibleAt === undefined ||
      manifest.cleanupEligibleAt > args.now ||
      !["completed", "failed", "cancelled"].includes(manifest.status)
    ) {
      return { deleted: 0, done: true };
    }
    const items = await ctx.db
      .query("reportingBackfillApplyManifestItem")
      .withIndex("by_manifestId_sequence", (q) => q.eq("manifestId", manifest._id))
      .take(CLEANUP_BATCH_LIMIT);
    for (const item of items) {
      await ctx.db.delete("reportingBackfillApplyManifestItem", item._id);
    }
    if (items.length === CLEANUP_BATCH_LIMIT) {
      return { deleted: items.length, done: false };
    }
    await ctx.db.delete("reportingBackfillApplyManifest", manifest._id);
    return { deleted: items.length, done: true };
  },
});
