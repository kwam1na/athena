import type { Id } from "~/convex/_generated/dataModel";

export type TerminalRecord = {
  _creationTime?: number;
  _id: Id<"posTerminal"> | string;
  browserInfo?: {
    colorDepth?: number;
    language?: string;
    platform?: string;
    screenResolution?: string;
    userAgent: string;
    vendor?: string;
  };
  displayName: string;
  registeredAt: number;
  registeredByUserId: Id<"athenaUser"> | string;
  registerNumber?: string | null;
  status: "active" | "lost" | "revoked" | string;
  storeId?: Id<"store"> | string;
};

export type TerminalRuntimeStatus = {
  _creationTime?: number;
  _id?: string;
  appVersion?: string;
  browserInfo?: {
    language?: string;
    online?: boolean;
    platform?: string;
    userAgent?: string;
  };
  buildSha?: string;
  localStore: {
    available: boolean;
    failureMessage?: string;
    schemaVersion?: number;
    terminalSeedReady: boolean;
  };
  receivedAt: number;
  reportedAt: number;
  snapshots: {
    availabilityAgeMs?: number;
    catalogAgeMs?: number;
    registerReadModelAgeMs?: number;
  };
  source:
    | "pos-hub"
    | "register"
    | "support-diagnostics"
    | "sync-runtime"
    | string;
  staffAuthority: {
    expiresAt?: number;
    staffProfileId?: Id<"staffProfile"> | string;
    status: "expired" | "missing" | "ready" | "unknown" | string;
  };
  storeId?: Id<"store"> | string;
  sync: {
    failedEventCount: number;
    lastFailureMessage?: string;
    lastSyncedSequence?: number;
    lastTrigger?: string;
    localOnlyEventCount: number;
    nextPendingUploadSequence?: number;
    oldestPendingEventAt?: number;
    pendingEventCount: number;
    reviewEventCount: number;
    status:
      | "failed"
      | "idle"
      | "needs_review"
      | "pending"
      | "syncing"
      | "unavailable"
      | "unknown"
      | string;
    uploadableEventCount: number;
  };
  terminalId?: Id<"posTerminal"> | string;
};

export type TerminalSyncEvent = {
  _id?: string;
  acceptedAt?: number;
  eventType: string;
  heldReason?: string;
  localEventId: string;
  localRegisterSessionId: string;
  occurredAt: number;
  projectedAt?: number;
  rejectionCode?: string;
  rejectionMessage?: string;
  sequence: number;
  status: string;
  submittedAt: number;
};

export type TerminalSyncConflict = {
  _id: string;
  conflictType: string;
  createdAt: number;
  localEventId: string;
  localRegisterSessionId: string;
  sequence: number;
  summary: string;
};

export type TerminalSyncEvidence = {
  acceptedCount?: number;
  acceptedThroughSequence?: number | null;
  conflictedCount?: number;
  cursorUpdatedAt?: number | null;
  heldCount?: number;
  latestEvent?: TerminalSyncEvent | null;
  projectedCount?: number;
  rejectedCount?: number;
  sampledEventCount?: number;
  unresolvedConflictCount?: number;
  unresolvedConflicts?: TerminalSyncConflict[];
};

export type TerminalHealthSummary = {
  health?: "needs_attention" | "offline" | "online" | "stale" | "unknown" | string;
  runtimeStatus: TerminalRuntimeStatus | null;
  syncEvidence: TerminalSyncEvidence;
  terminal: TerminalRecord;
};

export type TerminalHealthDetail = TerminalHealthSummary;
