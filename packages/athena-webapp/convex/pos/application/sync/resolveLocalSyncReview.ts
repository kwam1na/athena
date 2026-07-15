import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { createConvexLocalSyncRepository } from "../../infrastructure/repositories/localSyncRepository";

const MAX_LOCAL_SYNC_REVIEW_EVENTS_PER_REQUEST = 100;

export type ResolveLocalSyncReviewResult = {
  resolvedEventIds: string[];
  resolvedConflictCount: number;
};

type ResolveLocalSyncReviewRepository = {
  resolveConflictsForEvent(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    localEventId: string;
    resolvedAt: number;
    resolvedByStaffProfileId?: Id<"staffProfile">;
    resolvedByUserId?: Id<"athenaUser">;
  }): Promise<number>;
};

type ResolveLocalSyncReviewArgs = {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  localEventIds: string[];
  resolvedByUserId?: Id<"athenaUser">;
  resolvedByStaffProfileId?: Id<"staffProfile">;
  now?: number;
};

/**
 * Core resolution: transitions the matching `posLocalSyncConflict` rows for each
 * event from `needs_review` to `resolved` via the existing
 * `resolveConflictsForEvent` primitive, recording who resolved them and when.
 * Idempotent — an already-resolved conflict is left untouched — so a client
 * retry converges rather than double-resolving. Deduplicates event ids and
 * bounds the batch. Authorization is the caller's responsibility.
 */
export async function resolveLocalSyncReview(
  repository: ResolveLocalSyncReviewRepository,
  args: ResolveLocalSyncReviewArgs,
): Promise<ResolveLocalSyncReviewResult> {
  const resolvedAt = args.now ?? Date.now();
  const uniqueEventIds = [...new Set(args.localEventIds)]
    .filter((eventId) => eventId.trim().length > 0)
    .slice(0, MAX_LOCAL_SYNC_REVIEW_EVENTS_PER_REQUEST);

  const resolvedEventIds: string[] = [];
  let resolvedConflictCount = 0;
  for (const localEventId of uniqueEventIds) {
    const resolvedCount = await repository.resolveConflictsForEvent({
      storeId: args.storeId,
      terminalId: args.terminalId,
      localEventId,
      resolvedAt,
      ...(args.resolvedByUserId
        ? { resolvedByUserId: args.resolvedByUserId }
        : {}),
      ...(args.resolvedByStaffProfileId
        ? { resolvedByStaffProfileId: args.resolvedByStaffProfileId }
        : {}),
    });
    resolvedConflictCount += resolvedCount;
    resolvedEventIds.push(localEventId);
  }

  return { resolvedEventIds, resolvedConflictCount };
}

/**
 * Convex entry point: round-trips a terminal-local review resolution to the
 * server against the concrete repository. See {@link resolveLocalSyncReview}.
 */
export async function resolveLocalSyncReviewWithCtx(
  ctx: MutationCtx,
  args: ResolveLocalSyncReviewArgs,
): Promise<ResolveLocalSyncReviewResult> {
  return resolveLocalSyncReview(createConvexLocalSyncRepository(ctx), args);
}

export const MAX_LOCAL_SYNC_REVIEW_EVENTS = MAX_LOCAL_SYNC_REVIEW_EVENTS_PER_REQUEST;
