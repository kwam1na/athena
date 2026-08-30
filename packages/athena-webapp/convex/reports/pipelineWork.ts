import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type ReportWorkInput = { storeId: Id<"store"> } & (
  | { kind: "close-evidence"; closeId: Id<"dailyClose"> }
  | { kind: "resolve-week-date"; operatingDate: string }
  | { kind: "current" }
  | {
      kind: "accept";
      cycleStartDate: string;
      closeId: Id<"dailyClose">;
      cutoffObservedAt: number;
    }
  | { kind: "refresh"; cycleStartDate: string }
  | { kind: "rollup"; operatingDate: string }
  | { kind: "overview" }
  | { kind: "inventory" }
);
export type ReportWorkKind = ReportWorkInput["kind"];
export type ReportWorkClaim = {
  workId: Id<"reportPipelineWork">;
  storeId: Id<"store">;
  kind: ReportWorkKind;
  generation: number;
  dispatchFence: number;
};

export const REPORT_WORK_CLAIM_LIMIT = 4;
export const REPORT_WORK_LEASE_MS = 60_000;
export const REPORT_WORK_MAX_LEASE_MS = 10 * 60_000;
export const REPORT_WORK_RETRY_BASE_MS = 5_000;
export const REPORT_WORK_RETRY_MAX_MS = 30 * 60_000;

type WorkRow = Doc<"reportPipelineWork">;
type FailureCode = NonNullable<WorkRow["lastFailure"]>["code"];

function assertTime(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new Error("report_work_invalid_time");
  }
}

function assertDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString().slice(0, 10) !== value
  ) {
    throw new Error("report_work_invalid_date");
  }
}

function advanceCounter(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value >= Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("report_work_counter_exhausted");
  }
  return value + 1;
}

/** Structural JSON tuples have no delimiter collisions or lossy hashes. */
export function reportWorkKey(input: ReportWorkInput): string {
  const prefix = [String(input.storeId), input.kind];
  switch (input.kind) {
    case "close-evidence":
      return JSON.stringify([...prefix, String(input.closeId)]);
    case "accept":
      assertDate(input.cycleStartDate);
      assertTime(input.cutoffObservedAt);
      // The cutoff is immutable DATA, not part of the dedupe identity.
      return JSON.stringify([
        ...prefix,
        input.cycleStartDate,
        String(input.closeId),
      ]);
    case "refresh":
      assertDate(input.cycleStartDate);
      return JSON.stringify([...prefix, input.cycleStartDate]);
    case "resolve-week-date":
    case "rollup":
      assertDate(input.operatingDate);
      return JSON.stringify([...prefix, input.operatingDate]);
    case "current":
    case "overview":
    case "inventory":
      return JSON.stringify(prefix);
  }
}

function toClaim(
  row: Pick<
    WorkRow,
    "_id" | "storeId" | "kind" | "generation" | "dispatchFence"
  >,
): ReportWorkClaim {
  return {
    workId: row._id,
    storeId: row.storeId,
    kind: row.kind,
    generation: row.generation,
    dispatchFence: row.dispatchFence,
  };
}

/**
 * A bounded handoff from trusted source/derived writers. Never hydrate source
 * documents here: source-close ownership is checked at materialization. Every
 * signal advances generation; retries use failure/lease recovery, not enqueue.
 * The original createdAt survives coalescing so backlog age remains honest.
 */
export async function enqueueReportWork(
  ctx: MutationCtx,
  input: ReportWorkInput,
  now: number,
): Promise<ReportWorkClaim> {
  assertTime(now);
  const key = reportWorkKey(input);
  const existing = await ctx.db
    .query("reportPipelineWork")
    .withIndex("by_storeId_workKey", (q) =>
      q.eq("storeId", input.storeId).eq("workKey", key),
    )
    .unique();
  if (existing) {
    if (
      input.kind === "accept" &&
      (existing.kind !== "accept" ||
        existing.cutoffObservedAt !== input.cutoffObservedAt)
    ) {
      throw new Error("report_work_cutoff_conflict");
    }
    const generation = advanceCounter(existing.generation);
    await ctx.db.patch("reportPipelineWork", existing._id, {
      generation,
      status: "pending",
      updatedAt: now,
      eligibleAt: now,
      attempts: 0,
      claimedAt: undefined,
      leaseUntil: undefined,
      lastFailure: undefined,
    });
    return { ...toClaim(existing), generation };
  }
  const workId = await ctx.db.insert("reportPipelineWork", {
    ...input,
    workKey: key,
    generation: 1,
    dispatchFence: 0,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    eligibleAt: now,
    attempts: 0,
  });
  return {
    workId,
    storeId: input.storeId,
    kind: input.kind,
    generation: 1,
    dispatchFence: 0,
  };
}

/**
 * At most limit+1 eligible rows plus one oldest-row read, scoped by store/lane.
 * The caller rotates stores/lanes and owns allowlist/reseed/control admission.
 * Leasing and scheduling must commit together in the dispatcher's transaction.
 * A dropped schedule becomes eligible again; stale scheduled tokens cannot run.
 */
export async function claimReportWorkWithCtx(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    kind: ReportWorkKind;
    limit?: number;
    leaseMs?: number;
  },
  now: number,
): Promise<{
  claims: ReportWorkClaim[];
  hasMore: boolean;
  oldestAgeMs: number | null;
}> {
  assertTime(now);
  const requestedLimit = args.limit ?? 1;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    throw new Error("report_work_invalid_limit");
  }
  const requestedLease = args.leaseMs ?? REPORT_WORK_LEASE_MS;
  if (!Number.isFinite(requestedLease) || requestedLease <= 0) {
    throw new Error("report_work_invalid_lease");
  }
  const limit = Math.min(requestedLimit, REPORT_WORK_CLAIM_LIMIT);
  const leaseUntil = now + Math.min(requestedLease, REPORT_WORK_MAX_LEASE_MS);
  assertTime(leaseUntil);
  const rows = await ctx.db
    .query("reportPipelineWork")
    .withIndex("by_storeId_kind_eligibleAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("kind", args.kind)
        .lte("eligibleAt", now),
    )
    .order("asc")
    .take(limit + 1);
  const oldest = await ctx.db
    .query("reportPipelineWork")
    .withIndex("by_storeId_kind_createdAt", (q) =>
      q.eq("storeId", args.storeId).eq("kind", args.kind),
    )
    .order("asc")
    .first();
  const claims: ReportWorkClaim[] = [];
  for (const row of rows.slice(0, limit)) {
    const dispatchFence = advanceCounter(row.dispatchFence);
    await ctx.db.patch("reportPipelineWork", row._id, {
      dispatchFence,
      status: "pending",
      updatedAt: now,
      claimedAt: now,
      leaseUntil,
      eligibleAt: leaseUntil,
    });
    claims.push({ ...toClaim(row), dispatchFence });
  }
  return {
    claims,
    hasMore: rows.length > limit,
    // Outstanding includes blocked/leased rows, not just this eligible page.
    oldestAgeMs: oldest ? Math.max(0, now - oldest.createdAt) : null,
  };
}

/** Match a still-outstanding dispatch attempt, even after its lease expires. */
async function matchingClaim(
  ctx: QueryCtx,
  claim: ReportWorkClaim,
): Promise<WorkRow | null> {
  const row = await ctx.db.get("reportPipelineWork", claim.workId);
  if (
    !row ||
    row.storeId !== claim.storeId ||
    row.kind !== claim.kind ||
    row.generation !== claim.generation ||
    row.dispatchFence !== claim.dispatchFence ||
    row.claimedAt === undefined ||
    row.leaseUntil === undefined
  ) {
    return null;
  }
  return row;
}

/** Call inside the same mutation as output publication and acknowledgement. */
export async function getClaimedReportWorkWithCtx(
  ctx: QueryCtx,
  claim: ReportWorkClaim,
  now: number,
): Promise<WorkRow | null> {
  assertTime(now);
  const row = await matchingClaim(ctx, claim);
  return row && row.leaseUntil! > now ? row : null;
}

/** Output/checkpoint and acknowledgement must commit in one transaction. */
export async function completeReportWorkWithCtx(
  ctx: MutationCtx,
  claim: ReportWorkClaim,
  now: number,
): Promise<"applied" | "stale"> {
  const row = await getClaimedReportWorkWithCtx(ctx, claim, now);
  if (!row) return "stale";
  await ctx.db.delete("reportPipelineWork", row._id);
  return "applied";
}

function safeFailureCode(code: unknown): FailureCode {
  switch (code) {
    case "capacity_exceeded":
    case "missing_evidence":
    case "invalid_evidence":
    case "missing_schedule":
    case "missing_timezone":
    case "schedule_history_cap":
    case "matching_fold_pending":
    case "store_reseeding":
    case "coverage_incomplete":
    case "stale_source":
      return code;
    default:
      return "unexpected_failure";
  }
}

/**
 * Known refusals can call this in their worker transaction. Unexpected thrown
 * failures must call it from a separate mutation after the worker rolls back.
 * A late failure may record backoff until a newer dispatch replaces its fence;
 * clearing the outstanding lease makes duplicate failure delivery a no-op.
 * Never persist arbitrary exception messages/source payloads on this hot row.
 */
export async function failReportWorkWithCtx(
  ctx: MutationCtx,
  claim: ReportWorkClaim,
  failure: { code: unknown; blocked?: boolean },
  now: number,
): Promise<"applied" | "stale"> {
  assertTime(now);
  const row = await matchingClaim(ctx, claim);
  if (!row) return "stale";
  const attempts = advanceCounter(row.attempts);
  const retryDelay = Math.min(
    REPORT_WORK_RETRY_BASE_MS * 2 ** Math.min(attempts - 1, 20),
    REPORT_WORK_RETRY_MAX_MS,
  );
  const eligibleAt = now + retryDelay;
  assertTime(eligibleAt);
  await ctx.db.patch("reportPipelineWork", row._id, {
    attempts,
    status: failure.blocked ? "blocked" : "pending",
    updatedAt: now,
    eligibleAt,
    claimedAt: undefined,
    leaseUntil: undefined,
    lastFailure: { code: safeFailureCode(failure.code), at: now },
  });
  return "applied";
}
