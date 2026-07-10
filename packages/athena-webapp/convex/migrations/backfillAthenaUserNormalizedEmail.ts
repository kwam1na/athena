import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { normalizeAthenaUserEmail } from "../lib/athenaUserAuth";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

type BackfillArgs = {
  automationIdentity: string;
  cursor?: string | null;
  dryRun?: boolean;
  limit?: number;
  previewRunId?: Id<"reportingIdentityMigrationRun">;
  runId?: Id<"reportingIdentityMigrationRun">;
};

type CandidateAction = Doc<"reportingIdentityMigrationCandidate">["action"];

function boundedLimit(limit: number | undefined) {
  if (!Number.isInteger(limit) || limit === undefined || limit < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(limit, MAX_LIMIT);
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function normalizedIdentityFingerprint(email: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalizeAthenaUserEmail(email)),
  );
  return `sha256:${toHex(digest)}`;
}

async function candidateForUserWithCtx(
  ctx: MutationCtx,
  runId: Id<"reportingIdentityMigrationRun">,
  userId: Id<"athenaUser">,
) {
  const candidates = await ctx.db
    .query("reportingIdentityMigrationCandidate")
    .withIndex("by_runId_userId", (q) =>
      q.eq("runId", runId).eq("userId", userId),
    )
    .take(2);
  if (candidates.length > 1) {
    throw new Error("Identity migration candidate identity is not unique.");
  }
  return candidates[0] ?? null;
}

async function recordIdentityConflictWithCtx(
  ctx: MutationCtx,
  input: { now: number; userId: Id<"athenaUser"> },
) {
  await ctx.db.insert("reportingIntegrityAttempt", {
    operation: "athena_user_normalized_email_backfill",
    outcome: "conflict",
    safeReason: "normalized_email_duplicate",
    actorRef: String(input.userId),
    occurredAt: input.now,
  });
}

export async function backfillAthenaUserNormalizedEmailBatchWithCtx(
  ctx: MutationCtx,
  args: BackfillArgs,
) {
  const now = Date.now();
  const dryRun = args.dryRun ?? true;
  const operation = dryRun ? ("preview" as const) : ("apply" as const);
  const existingRun = args.runId
    ? await ctx.db.get("reportingIdentityMigrationRun", args.runId)
    : null;

  if (
    existingRun &&
    (existingRun.operation !== operation ||
      existingRun.automationIdentity !== args.automationIdentity ||
      existingRun.previewRunId !== args.previewRunId)
  ) {
    throw new Error("Identity migration run does not match this operation.");
  }
  if (existingRun && existingRun.status !== "running") {
    throw new Error("Identity migration run is no longer active.");
  }
  if (existingRun && (existingRun.cursor ?? null) !== (args.cursor ?? null)) {
    throw new Error(
      "Identity migration cursor does not match durable progress.",
    );
  }

  const previewRun = dryRun
    ? null
    : args.previewRunId
      ? await ctx.db.get("reportingIdentityMigrationRun", args.previewRunId)
      : null;
  if (
    !dryRun &&
    (!previewRun ||
      previewRun.operation !== "preview" ||
      previewRun.status !== "completed" ||
      previewRun.coverageComplete !== true ||
      previewRun.conflictCount !== 0 ||
      previewRun.automationIdentity !== args.automationIdentity)
  ) {
    throw new Error(
      "A completed conflict-free identity preview is required before apply.",
    );
  }

  const runId =
    existingRun?._id ??
    (await ctx.db.insert("reportingIdentityMigrationRun", {
      operation,
      automationIdentity: args.automationIdentity,
      ...(args.previewRunId ? { previewRunId: args.previewRunId } : {}),
      status: "running",
      scannedCount: 0,
      changedCount: 0,
      conflictCount: 0,
      coverageComplete: false,
      startedAt: now,
      updatedAt: now,
    }));
  const page = await ctx.db.query("athenaUser").paginate({
    cursor: args.cursor ?? null,
    numItems: boundedLimit(args.limit),
  });

  const candidates: Array<{
    action: CandidateAction;
    userId: Id<"athenaUser">;
  }> = [];
  const conflictingUserIds = new Set<Id<"athenaUser">>();
  const newlyConflictingUserIds = new Set<Id<"athenaUser">>();
  let changedCount = 0;
  let scannedCount = 0;

  for (const user of page.page) {
    const normalizedEmail = normalizeAthenaUserEmail(user.email);
    const fingerprint = await normalizedIdentityFingerprint(normalizedEmail);
    const existingCandidate = await candidateForUserWithCtx(
      ctx,
      runId,
      user._id,
    );
    if (existingCandidate) {
      candidates.push({
        action: existingCandidate.action,
        userId: user._id,
      });
      if (existingCandidate.action === "conflict") {
        conflictingUserIds.add(user._id);
      }
      continue;
    }

    const indexedMatches = await ctx.db
      .query("athenaUser")
      .withIndex("by_normalizedEmail", (q) =>
        q.eq("normalizedEmail", normalizedEmail),
      )
      .take(3);
    const otherIndexedMatches = indexedMatches.filter(
      (match) => match._id !== user._id,
    );
    const stagedMatches = await ctx.db
      .query("reportingIdentityMigrationCandidate")
      .withIndex("by_runId_normalizedIdentityFingerprint", (q) =>
        q
          .eq("runId", dryRun ? runId : args.previewRunId!)
          .eq("normalizedIdentityFingerprint", fingerprint),
      )
      .take(3);
    const otherStagedMatches = stagedMatches.filter(
      (match) => match.userId !== user._id,
    );
    const previewCandidate = dryRun
      ? null
      : await candidateForUserWithCtx(ctx, args.previewRunId!, user._id);
    const previewMismatch =
      !dryRun &&
      (!previewCandidate ||
        previewCandidate.action === "conflict" ||
        previewCandidate.normalizedIdentityFingerprint !== fingerprint);
    const hasConflict =
      previewMismatch ||
      otherIndexedMatches.length > 0 ||
      otherStagedMatches.length > 0;

    let action: CandidateAction =
      previewCandidate?.action ??
      (user.normalizedEmail === normalizedEmail ? "unchanged" : "update");
    if (hasConflict) {
      action = "conflict";
      conflictingUserIds.add(user._id);
      newlyConflictingUserIds.add(user._id);
      for (const match of [...otherStagedMatches]) {
        conflictingUserIds.add(match.userId);
        if (match.action !== "conflict" && dryRun) {
          newlyConflictingUserIds.add(match.userId);
          await ctx.db.patch("reportingIdentityMigrationCandidate", match._id, {
            action: "conflict",
            updatedAt: now,
          });
          await recordIdentityConflictWithCtx(ctx, {
            now,
            userId: match.userId,
          });
        }
      }
      for (const match of otherIndexedMatches) {
        conflictingUserIds.add(match._id);
      }
      await recordIdentityConflictWithCtx(ctx, { now, userId: user._id });
    } else if (!dryRun && user.normalizedEmail !== normalizedEmail) {
      await ctx.db.patch("athenaUser", user._id, { normalizedEmail });
      changedCount += 1;
    }

    await ctx.db.insert("reportingIdentityMigrationCandidate", {
      action,
      createdAt: now,
      normalizedIdentityFingerprint: fingerprint,
      runId,
      updatedAt: now,
      userId: user._id,
    });
    scannedCount += 1;
    candidates.push({ action, userId: user._id });
  }

  const totalConflictCount =
    (existingRun?.conflictCount ?? 0) + newlyConflictingUserIds.size;
  const missingCoverage = dryRun
    ? null
    : await ctx.db
        .query("athenaUser")
        .withIndex("by_normalizedEmail", (q) =>
          q.eq("normalizedEmail", undefined),
        )
        .first();
  const coverageComplete =
    page.isDone && !missingCoverage && totalConflictCount === 0;
  const nextStatus =
    totalConflictCount > 0
      ? ("blocked" as const)
      : page.isDone
        ? ("completed" as const)
        : ("running" as const);

  await ctx.db.patch("reportingIdentityMigrationRun", runId, {
    status: nextStatus,
    cursor: nextStatus === "running" ? page.continueCursor : undefined,
    scannedCount: (existingRun?.scannedCount ?? 0) + scannedCount,
    changedCount: (existingRun?.changedCount ?? 0) + changedCount,
    conflictCount: totalConflictCount,
    coverageComplete,
    updatedAt: now,
    ...(nextStatus === "completed" ? { completedAt: now } : {}),
  });

  return {
    runId,
    operation,
    status: nextStatus,
    candidates,
    conflictingUserIds: [...conflictingUserIds].sort(),
    continueCursor: nextStatus === "running" ? page.continueCursor : null,
    isDone: nextStatus !== "running",
    coverageComplete,
  };
}

export const backfillAthenaUserNormalizedEmailBatch = internalMutation({
  args: {
    automationIdentity: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    previewRunId: v.optional(v.id("reportingIdentityMigrationRun")),
    runId: v.optional(v.id("reportingIdentityMigrationRun")),
  },
  handler: backfillAthenaUserNormalizedEmailBatchWithCtx,
});
