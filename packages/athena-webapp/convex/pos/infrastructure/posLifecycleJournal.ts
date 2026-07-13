import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

export type PosLifecycleJournalEventKind =
  | "completed"
  | "voided"
  | "refunded"
  | "adjustment_applied"
  | "payment_method_corrected";

export type PosLifecycleJournalOrigin = "cloud" | "local_sync";

export type AppendPosLifecycleJournalInput = {
  organizationId: Id<"organization">;
  storeId: Id<"store">;
  transactionId: Id<"posTransaction">;
  adjustmentId?: Id<"posTransactionAdjustment">;
  localSyncEventId?: Id<"posLocalSyncEvent">;
  eventKind: PosLifecycleJournalEventKind;
  eventKey: string;
  contentFingerprint: string;
  occurredAt: number;
  origin: PosLifecycleJournalOrigin;
};

type JournalRow = AppendPosLifecycleJournalInput & {
  _id: string;
  recordedAt: number;
};

type JournalCursorRow = {
  _id: string;
  nextSequence: number;
  storeId: Id<"store">;
};

type JournalDb = {
  patch(id: string, value: Record<string, unknown>): Promise<void>;
  query(tableName: string): {
    withIndex(
      indexName: string,
      apply: (query: JournalIndexQuery) => unknown,
    ): { unique(): Promise<JournalRow | JournalCursorRow | null> };
  };
  insert(tableName: string, value: Record<string, unknown>): Promise<string>;
};

type JournalIndexQuery = {
  eq(field: string, value: unknown): JournalIndexQuery;
};

/**
 * Append immutable POS lifecycle evidence in the caller's Convex transaction.
 * Replaying the same stable identity and fingerprint is a no-op. Reusing an
 * identity for different material evidence fails the source mutation so the
 * journal can never silently disagree with authoritative POS state.
 */
export async function appendPosLifecycleJournalWithCtx(
  ctx: MutationCtx,
  input: AppendPosLifecycleJournalInput,
) {
  const db = ctx.db as unknown as JournalDb;
  const existing = await db
    .query("posLifecycleJournal")
    .withIndex("by_storeId_eventKey", (query) =>
      query.eq("storeId", input.storeId).eq("eventKey", input.eventKey),
    )
    .unique() as JournalRow | null;

  if (existing) {
    if (
      existing.contentFingerprint !== input.contentFingerprint ||
      existing.transactionId !== input.transactionId ||
      existing.eventKind !== input.eventKind ||
      existing.organizationId !== input.organizationId
    ) {
      throw new Error(
        `POS lifecycle journal identity conflict for ${input.eventKey}.`,
      );
    }
    return { disposition: "existing" as const, journalId: existing._id };
  }

  const cursor = (await db
    .query("posLifecycleJournalCursor")
    .withIndex("by_storeId", (query) =>
      query.eq("storeId", input.storeId),
    )
    .unique()) as JournalCursorRow | null;
  const sequence = cursor?.nextSequence ?? 1;
  if (cursor) {
    await db.patch(cursor._id, {
      nextSequence: sequence + 1,
      updatedAt: Date.now(),
    });
  } else {
    await db.insert("posLifecycleJournalCursor", {
      nextSequence: 2,
      storeId: input.storeId,
      updatedAt: Date.now(),
    });
  }
  const journalId = await db.insert("posLifecycleJournal", {
    ...input,
    recordedAt: Date.now(),
    sequence,
  });
  return { disposition: "created" as const, journalId };
}
