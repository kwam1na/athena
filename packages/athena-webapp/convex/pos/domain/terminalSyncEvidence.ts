import type { Doc, Id } from "../../_generated/dataModel";

export type TerminalSyncReviewTarget = {
  type: "open_work";
  workItemId: Id<"operationalWorkItem">;
  workItemType: "synced_sale_inventory_review";
};

export type TerminalSyncReviewActionTarget = {
  type: "register_session";
  registerSessionId: Id<"registerSession">;
};

export type TerminalSyncReviewEvent = {
  localEventId: string;
  localRegisterSessionId: string;
  sequence: number;
  eventType: Doc<"posLocalSyncEvent">["eventType"];
  status: Doc<"posLocalSyncEvent">["status"];
};

export type TerminalSyncReviewSummaryGroup = {
  actionTarget?: TerminalSyncReviewActionTarget;
  actionability:
    | "cash_controls_review"
    | "diagnostic_only"
    | "manual_review"
    | "open_work_review";
  conflictType: Doc<"posLocalSyncConflict">["conflictType"];
  count: number;
  latestCreatedAt: number;
  latestSequence: number;
  owner:
    | "cash_controls"
    | "diagnostic"
    | "manual_review"
    | "operations_open_work";
  reviewTarget?: TerminalSyncReviewTarget;
};

export type TerminalSyncReviewSummary = {
  groups: TerminalSyncReviewSummaryGroup[];
  meta: {
    sampledCount: number;
    cap: number;
    hasMore: boolean;
    targetResolutionIncomplete: boolean;
  };
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
    reviewTarget?: TerminalSyncReviewTarget;
    sequence: number;
    summary: string;
  }>;
  reviewSummary?: TerminalSyncReviewSummary;
  acceptedThroughSequence?: number;
  cursorUpdatedAt?: number;
};
