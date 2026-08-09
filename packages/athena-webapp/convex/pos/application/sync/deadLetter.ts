import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { PERSISTENT_SYNC_FAILURE_SUMMARY } from "./registerSessionSyncReview";

/**
 * Dead-letter marker for a poison sync batch.
 *
 * The terminal's sync scheduler calls this (via `reportLocalSyncDeadLetter`)
 * when the SAME batch has failed `consecutiveFailureCount` uploads in a row —
 * the server is throwing on every attempt, so blind retry under backoff will
 * never resolve it. The marker is a `needs_review` conflict on the register
 * session, which puts it in front of a manager through the existing sync
 * review surface instead of leaving the wedge visible only on the terminal
 * detail page.
 *
 * Deliberately tiny write surface: one indexed read plus at most one insert,
 * no projection — this mutation must succeed precisely when the heavyweight
 * ingest path cannot.
 */
export type RecordLocalSyncDeadLetterArgs = {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  localRegisterSessionId: string;
  /** Head event of the wedged batch — the identity of the dead letter. */
  localEventId: string;
  sequence: number;
  /** How many events are stuck behind the head. */
  eventCount: number;
  consecutiveFailureCount: number;
  failureMessage: string | null;
  reportedAt: number;
};

export async function recordLocalSyncDeadLetter(
  ctx: MutationCtx,
  args: RecordLocalSyncDeadLetterArgs,
): Promise<{ conflict: Doc<"posLocalSyncConflict">; created: boolean }> {
  const existingForEvent = await ctx.db
    .query("posLocalSyncConflict")
    .withIndex("by_store_terminal_localEvent", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("terminalId", args.terminalId)
        .eq("localEventId", args.localEventId),
    )
    .take(100);
  // One OPEN dead-letter per wedged head: a later report of the same wedge
  // (the streak kept growing) must not fan out into more review items. A
  // resolved marker does not suppress a new one — if the wedge comes back
  // after a manager resolved it, that is new information.
  const existing = existingForEvent.find(
    (conflict) =>
      conflict.status === "needs_review" &&
      conflict.summary === PERSISTENT_SYNC_FAILURE_SUMMARY,
  );
  if (existing) return { conflict: existing, created: false };

  const row = {
    storeId: args.storeId,
    terminalId: args.terminalId,
    localRegisterSessionId: args.localRegisterSessionId,
    localEventId: args.localEventId,
    sequence: args.sequence,
    conflictType: "server_rejected" as const,
    status: "needs_review" as const,
    summary: PERSISTENT_SYNC_FAILURE_SUMMARY,
    details: {
      code: "persistent_sync_failure",
      consecutiveFailureCount: args.consecutiveFailureCount,
      eventCount: args.eventCount,
      ...(args.failureMessage ? { failureMessage: args.failureMessage } : {}),
    },
    createdAt: args.reportedAt,
  };
  const id = await ctx.db.insert("posLocalSyncConflict", row);
  return {
    conflict: { _id: id, _creationTime: args.reportedAt, ...row },
    created: true,
  };
}
