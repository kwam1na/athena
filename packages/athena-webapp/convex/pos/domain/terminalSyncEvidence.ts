import type { Doc, Id } from "../../_generated/dataModel";

export type TerminalSyncReviewEvent = {
  localEventId: string;
  localRegisterSessionId: string;
  sequence: number;
  eventType: Doc<"posLocalSyncEvent">["eventType"];
  status: Doc<"posLocalSyncEvent">["status"];
};

export type TerminalSyncEvidence = {
  latestEvent: {
    localEventId: string;
    localRegisterSessionId: string;
    sequence: number;
    eventType: Doc<"posLocalSyncEvent">["eventType"];
    status: Doc<"posLocalSyncEvent">["status"];
    occurredAt: number;
    submittedAt: number;
    acceptedAt?: number;
    projectedAt?: number;
  } | null;
  latestReviewEvent?: TerminalSyncReviewEvent | null;
  latestReviewEventsByStatus?: {
    conflicted?: TerminalSyncReviewEvent | null;
    held?: TerminalSyncReviewEvent | null;
    rejected?: TerminalSyncReviewEvent | null;
  };
  sampledEventCount: number;
  acceptedCount: number;
  projectedCount: number;
  conflictedCount: number;
  heldCount: number;
  rejectedCount: number;
  unresolvedConflictCount?: number;
  unresolvedConflicts?: Array<{
    _id: Id<"posLocalSyncConflict">;
    conflictType: Doc<"posLocalSyncConflict">["conflictType"];
    createdAt: number;
    localEventId: string;
    localRegisterSessionId: string;
    reviewTarget?: {
      type: "open_work";
      workItemId: Id<"operationalWorkItem">;
      workItemType: "synced_sale_inventory_review";
    };
    sequence: number;
    summary: string;
  }>;
  acceptedThroughSequence?: number;
  cursorUpdatedAt?: number;
};
