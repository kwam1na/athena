import type {
  LocalPinVerifierMetadata,
  WrappedLocalStaffProof,
} from "@/lib/security/localPinVerifier";
import type {
  PosRegisterCatalogAvailabilityRowDto,
  PosRegisterCatalogRowDto,
  PosServiceCatalogRowDto,
} from "./dto";
import type { PosTerminalLoginMode } from "~/shared/posTerminalLoginMode";
import type { PosTerminalTransactionCapability } from "~/shared/posTerminalCapability";
import type { PosRegisterSessionActivitySkipReasonCode } from "~/shared/posRegisterSessionActivityContract";
import { canUploadPosLocalSyncLocalEventType } from "~/shared/posLocalSyncContract";

export const POS_LOCAL_LOGICAL_RECORD_VERSION = 1;

export type PosLocalEntityKind =
  | "registerSession"
  | "posSession"
  | "posTransaction"
  | "expenseSession"
  | "expenseTransaction"
  | "pendingCheckoutItem";

export type PosLocalEventType =
  | "terminal.seeded"
  | "register.opened"
  | "store_day.started"
  | "session.started"
  | "session.payments_updated"
  | "cart.cleared"
  | "cart.item_added"
  | "pending_checkout_item.defined"
  | "cart.service_added"
  | "cart.service_removed"
  | "transaction.completed"
  | "expense.session_started"
  | "expense.item_added"
  | "expense.item_updated"
  | "expense.item_removed"
  | "expense.cart_cleared"
  | "expense.held"
  | "expense.resumed"
  | "expense.voided"
  | "expense.canceled"
  | "expense.completed"
  | "register.closeout_started"
  | "register.reopened"
  | "cash.movement_recorded";

export function canUploadPosLocalEventType(type: PosLocalEventType): boolean {
  return canUploadPosLocalSyncLocalEventType(type);
}

export type PosLocalSyncEventStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "locally_resolved"
  | "needs_review"
  | "failed";
export type PosLocalActivityReportStatus =
  "pending" | "reported" | "mapping_pending" | "failed";
export type PosLocalActivityReportReasonCode =
  | PosRegisterSessionActivitySkipReasonCode
  | "mapping_missing"
  | "network_error"
  | "server_rejected"
  | "unknown";
export interface PosLocalActivityReportState {
  attemptedAt?: number;
  reasonCode?: PosLocalActivityReportReasonCode;
  reportedAt?: number;
  status: PosLocalActivityReportStatus;
}
export type PosLocalReviewResolutionReason = "terminal_recovery_command";
export interface PosLocalReviewResolutionMetadata {
  reason: PosLocalReviewResolutionReason;
  resolvedAt: number;
  status: "local_review_cleared";
  /**
   * Set once the server has acknowledged the corresponding conflict as
   * resolved (U6 round-trip). Until then a locally-cleared review is NOT
   * treated as fully settled by the sync-status derivation, so the terminal
   * cannot show "synced" while the server still holds an open conflict.
   */
  serverConfirmedAt?: number;
}
export type PosLocalEventValidationFlag =
  "app-session-unverified" | "cloud-validation-uncertain";
export type PosLocalEventUploadDeferral = "app-session-validated";
export interface PosLocalEventValidationMetadata {
  flags: PosLocalEventValidationFlag[];
  observedAt?: number;
  uploadDeferredUntil?: PosLocalEventUploadDeferral;
}

export interface PosProvisionedTerminalSeed {
  terminalId: string;
  cloudTerminalId: string;
  syncSecretHash: string;
  storeId: string;
  orgUrlSlug?: string;
  registerNumber?: string;
  loginMode?: PosTerminalLoginMode;
  transactionCapability?: PosTerminalTransactionCapability;
  displayName: string;
  provisionedAt: number;
  schemaVersion: number;
  storeUrlSlug?: string;
}

export interface PosLocalEventRecord {
  localEventId: string;
  schemaVersion: number;
  sequence: number;
  uploadSequence?: number;
  type: PosLocalEventType;
  terminalId: string;
  storeId: string;
  registerNumber?: string;
  localRegisterSessionId?: string;
  localExpenseSessionId?: string;
  localPosSessionId?: string;
  localTransactionId?: string;
  staffProfileId?: string;
  staffProofToken?: string;
  validationMetadata?: PosLocalEventValidationMetadata;
  payload: unknown;
  createdAt: number;
  catalogRevision?: PosRegisterCatalogRevision;
  activity?: PosLocalActivityReportState;
  sync: {
    status: PosLocalSyncEventStatus;
    cloudEventId?: string;
    error?: string;
    localResolution?: PosLocalReviewResolutionMetadata;
    uploaded?: boolean;
  };
}

export type PosLocalLedgerSummary = {
  eventCount: number;
  oldestEventAt?: number;
};

export type PosLocalLedgerPurgeResult =
  | { status: "blocked"; reason: "active_presence" }
  | {
      status: "completed";
      purgedCount: number;
      purgedSequences: number[];
      retainedCount: number;
    };

export interface PosLocalCloudMapping {
  entity: PosLocalEntityKind;
  localId: string;
  cloudId: string;
  mappedAt: number;
  mappingAuthorityRevision?: number;
  registerCandidateState?: "current" | "historical";
  registerNumber?: string;
  storeId?: string;
  terminalId?: string;
}

export type PosRegisterAuthorityCursor = {
  lifecycleRevision: number;
  mappingAuthorityRevision: number;
};
export type PosRegisterLifecycleServerAuthority = {
  classification: "sale_usable" | "sale_blocked" | "repair_required";
  cloudRegisterSessionId?: string;
  cursor?: PosRegisterAuthorityCursor;
  message?: string;
  observedAt: number;
  reason?: "cloud_closed" | "authority_unknown";
  source: "dedicated_snapshot" | "legacy_runtime_directive";
  status: "healthy" | "blocked";
};
export type PosRegisterLifecycleAuthorityObservation =
  PosRegisterLifecycleServerAuthority & {
    localRegisterSessionId: string;
    registerNumber?: string;
  };
export type PosDrawerLocalReviewAuthority = {
  message?: string;
  observedAt: number;
  reason: "lifecycle_rejected" | "authority_unknown";
  status: "blocked";
};
export type PosDrawerAuthorityStatus = "healthy" | "blocked";
export type PosDrawerAuthorityBlockReason =
  "cloud_closed" | "lifecycle_rejected" | "authority_unknown";
export interface PosDrawerAuthorityState {
  cloudRegisterSessionId?: string;
  localRegisterSessionId: string;
  message?: string;
  observedAt: number;
  reason?: PosDrawerAuthorityBlockReason;
  registerNumber?: string;
  status: PosDrawerAuthorityStatus;
  storeId: string;
  terminalId: string;
  localReviewAuthority?: PosDrawerLocalReviewAuthority;
  serverAuthority?: PosRegisterLifecycleServerAuthority;
}
export type PosRegisterLifecycleAuthorityApplyResult =
  | {
      disposition: "applied";
      reason: "committed";
      value: PosDrawerAuthorityState;
    }
  | { disposition: "noop"; reason: "duplicate" | "lower_confidence" | "stale" }
  | {
      disposition: "rejected";
      reason: "cursor_conflict" | "mapping_invalidated";
    };

export type PosTerminalIntegrityStatus =
  "healthy" | "repairing" | "requires_reprovision" | "reset_required";
export type PosTerminalIntegrityReason =
  | "authorization_failed"
  | "repair_rejected"
  | "seed_write_failed"
  | "terminal_revoked"
  | "ownership_conflict"
  | "store_access_missing"
  | "unknown";
export interface PosTerminalIntegrityState {
  cloudTerminalId?: string;
  message?: string;
  observedAt: number;
  reason?: PosTerminalIntegrityReason;
  registerNumber?: string;
  status: PosTerminalIntegrityStatus;
  storeId: string;
  terminalId: string;
}
export interface PosLocalStoreDayReadiness {
  storeId: string;
  operatingDate: string;
  status: "started" | "not_started" | "closed" | "reopened" | "unknown";
  source: "daily_opening" | "daily_close" | "local";
  updatedAt: number;
  closeLifecycleStatus?: "active" | "reopened" | "superseded";
}
export type PosLocalStaffAuthorityRecord = {
  activeRoles: Array<"cashier" | "manager">;
  credentialId: string;
  credentialVersion: number;
  displayName?: string | null;
  expiresAt: number;
  issuedAt: number;
  organizationId: string;
  refreshedAt: number;
  staffProfileId: string;
  status: "active" | "revoked";
  storeId: string;
  terminalId: string;
  username: string;
  verifier: LocalPinVerifierMetadata;
  wrappedPosLocalStaffProof?: WrappedLocalStaffProof;
};
export type PosLocalStaffAuthorityReadiness = "missing" | "expired" | "ready";
export type PosLocalActiveCashierPresenceRecord = {
  activeRoles: Array<"cashier" | "manager">;
  credentialId: string;
  credentialVersion: number;
  displayName?: string | null;
  expiresAt: number;
  lastValidatedAt: number;
  offlineFreshUntil: number;
  operatingDate: string;
  organizationId: string;
  signedInAt: number;
  staffProfileId: string;
  storeId: string;
  terminalId: string;
  username: string;
  wrappedPosLocalStaffProof: WrappedLocalStaffProof;
};
export type PosLocalCashierPresenceScope = {
  operatingDate: string;
  organizationId: string;
  storeId: string;
  terminalId: string;
};
export type PosLocalCashierPresenceDiagnostic = Omit<
  PosLocalActiveCashierPresenceRecord,
  "wrappedPosLocalStaffProof"
> & {
  proof: { expiresAt: number; status: "present" };
};
export interface PosLocalRegisterCatalogSnapshot {
  refreshedAt: number;
  rows: PosRegisterCatalogRowDto[];
  schemaVersion: number;
  storeId: string;
}
export type PosRegisterCatalogRevision = number | "legacy";
export interface PosLocalRegisterCatalogVersion {
  persistedAt: number;
  revision: PosRegisterCatalogRevision;
  rows: PosRegisterCatalogRowDto[];
  schemaVersion: number;
  storeId: string;
}
export interface PosLocalRegisterCatalogVersionState {
  active: PosLocalRegisterCatalogVersion | null;
  activeRevision: PosRegisterCatalogRevision | null;
  staged: PosLocalRegisterCatalogVersion | null;
  stagedRevision: PosRegisterCatalogRevision | null;
}
export interface PosLocalRegisterCatalogPin {
  leaseExpiresAt?: number;
  ownerId?: string;
  pinnedAt: number;
  revision: PosRegisterCatalogRevision;
  storeId: string;
  terminalId: string;
}
export type PosLocalRegisterCatalogVersionWriteOutcome = {
  revision: PosRegisterCatalogRevision;
  status: "staged" | "promoted" | "already_current" | "already_newer";
  version: PosLocalRegisterCatalogVersion;
};
export interface PosLocalRegisterServiceCatalogSnapshot {
  refreshedAt: number;
  rows: PosServiceCatalogRowDto[];
  schemaVersion: number;
  storeId: string;
}
export interface PosLocalRegisterAvailabilitySnapshot {
  refreshedAt: number;
  rows: PosRegisterCatalogAvailabilityRowDto[];
  schemaVersion: number;
  storeId: string;
}
export type PosRegisterOperationalStateResetResult =
  | {
      status: "applied";
      deletedAuthorityCount: number;
      deletedEventCount: number;
      deletedMappingCount: number;
      resetAt: number;
    }
  | { status: "already_applied"; resetAt: number };
export type PosLocalAppendEventInput = {
  type: PosLocalEventType;
  terminalId: string;
  storeId: string;
  registerNumber?: string;
  localRegisterSessionId?: string;
  localExpenseSessionId?: string;
  localPosSessionId?: string;
  localTransactionId?: string;
  staffProfileId?: string;
  staffProofToken?: string;
  validationMetadata?: PosLocalEventValidationMetadata;
  initialSyncStatus?: PosLocalSyncEventStatus;
  payload: unknown;
  catalogPin?: {
    ownerId?: string;
    revision: PosRegisterCatalogRevision;
    rows: PosRegisterCatalogRowDto[];
  };
};

export type PosLocalStoreErrorCode =
  | "contention"
  | "corruption"
  | "maintenance"
  | "missing_object_stores"
  | "quota_exceeded"
  | "read_failed"
  | "unavailable"
  | "unsupported_logical_record_version"
  | "unsupported_schema_version"
  | "write_failed";
export type PosLocalStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: PosLocalStoreErrorCode; message: string } };

export type PosLocalOpaqueContinuation = string & {
  readonly __posLocalOpaqueContinuation: unique symbol;
};
