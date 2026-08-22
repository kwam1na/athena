import {
  isPosUsableRegisterSessionStatus,
  isRegisterSessionConflictBlockingStatus,
  type RegisterSessionStatus,
} from "./registerSessionStatus";

export const REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY =
  "Register closeout variance requires manager review before synced closeout can be applied.";

export type RegisterSessionLifecycleEventType =
  | "register.opened"
  | "register.closeout_started"
  | string;

export type RegisterSessionLifecycleReviewStatus =
  | "needs_review"
  | "pending"
  | "syncing"
  | "synced"
  | "failed"
  | string;

export type RegisterSessionLifecycleDrawerAuthorityReason =
  | "cloud_closed"
  | "lifecycle_rejected"
  | "authority_unknown"
  | string;

export type RegisterSessionLifecycleDrawerAuthority = {
  cloudRegisterSessionId?: string;
  localRegisterSessionId: string;
  reason?: RegisterSessionLifecycleDrawerAuthorityReason;
  status: "blocked" | "healthy" | string;
};

export type RegisterSessionLifecycleScopedSession = {
  localRegisterSessionId?: string | null;
  cloudRegisterSessionId?: string | null;
  status?: RegisterSessionStatus | string | null;
  storeId?: string | null;
  terminalId?: string | null;
};

export type RegisterSessionLifecycleReviewConflict = {
  details?: Record<string, unknown>;
  localEventId?: string | null;
  status?: string | null;
  summary?: string | null;
};

export function isNonBlockingRegisterLifecycleReviewEvent(input: {
  sync?: { status?: RegisterSessionLifecycleReviewStatus } | null;
  type: RegisterSessionLifecycleEventType;
}) {
  return (
    input.sync?.status === "needs_review" &&
    (input.type === "register.opened" ||
      input.type === "register.closeout_started")
  );
}

export function isRegisterSessionSaleUsable(
  session: Pick<RegisterSessionLifecycleScopedSession, "status"> | null | undefined,
) {
  return isPosUsableRegisterSessionStatus(session?.status);
}

export type RegisterSessionVoidApplicationStatus =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "missing_session"
        | "wrong_store"
        | "wrong_terminal"
        | "blocked_status";
    };

export function getRegisterSessionVoidApplicationStatus(input: {
  registerSession?: RegisterSessionLifecycleScopedSession | null;
  storeId: string;
  terminalId: string;
}): RegisterSessionVoidApplicationStatus {
  const { registerSession } = input;

  if (!registerSession) {
    return { allowed: false, reason: "missing_session" };
  }

  if (registerSession.storeId !== input.storeId) {
    return { allowed: false, reason: "wrong_store" };
  }

  if (!registerSession.terminalId || registerSession.terminalId !== input.terminalId) {
    return { allowed: false, reason: "wrong_terminal" };
  }

  if (
    registerSession.status === "open" ||
    registerSession.status === "active" ||
    registerSession.status === "closing"
  ) {
    return { allowed: true };
  }

  return { allowed: false, reason: "blocked_status" };
}

export function isRegisterSessionConflictBlocking(
  session: Pick<RegisterSessionLifecycleScopedSession, "status"> | null | undefined,
) {
  return isRegisterSessionConflictBlockingStatus(session?.status);
}

export function isRegisterSessionReplacementBlocking(input: {
  hasSubmittedCloseout?: boolean;
  session: Pick<RegisterSessionLifecycleScopedSession, "status"> | null | undefined;
}) {
  if (!input.session) return false;
  if (input.session.status === "closeout_rejected") return false;
  if (input.session.status === "closing" && input.hasSubmittedCloseout) {
    return false;
  }

  return isRegisterSessionConflictBlocking(input.session);
}

export function getSaleBlockingDrawerAuthority<
  Authority extends RegisterSessionLifecycleDrawerAuthority,
>(input: {
  activeRegisterSession?: RegisterSessionLifecycleScopedSession | null;
  drawerAuthority?: Authority | null;
}): Authority | null {
  const drawerAuthority = input.drawerAuthority;
  if (!drawerAuthority) return null;
  if (drawerAuthority.status !== "blocked") return null;
  if (
    !drawerAuthorityMatchesActiveRegisterSession({
      activeRegisterSession: input.activeRegisterSession,
      drawerAuthority,
    })
  ) {
    return null;
  }
  if (
    drawerAuthority.reason === "lifecycle_rejected" &&
    drawerAuthority.localRegisterSessionId ===
      input.activeRegisterSession?.localRegisterSessionId
  ) {
    return null;
  }

  return drawerAuthority;
}

export function isDrawerAuthoritySaleBlocking(input: {
  activeRegisterSession?: RegisterSessionLifecycleScopedSession | null;
  drawerAuthority?: RegisterSessionLifecycleDrawerAuthority | null;
}) {
  return Boolean(getSaleBlockingDrawerAuthority(input));
}

export function canReuseCloudRegisterSessionForLocalOpen(input: {
  hasOpenRegisterCloseoutReview: boolean;
  localRegisterSessionId: string;
  registerSession?: RegisterSessionLifecycleScopedSession | null;
  storeId: string;
  terminalId: string;
}) {
  const isSameDrawerIdentity =
    input.localRegisterSessionId === input.registerSession?.localRegisterSessionId ||
    input.localRegisterSessionId === input.registerSession?.cloudRegisterSessionId;

  return (
    isScopedRegisterSession(input) &&
    isSameDrawerIdentity &&
    isRegisterSessionSaleUsable(input.registerSession) &&
    !input.hasOpenRegisterCloseoutReview
  );
}

type RegisterSessionSupersedeFreshnessInput =
  | {
      closeoutReviewBoundaryAt: number | null | undefined;
      replacementOpenedAt: number;
      allowUnknownCloseoutReviewBoundary?: never;
    }
  | {
      allowUnknownCloseoutReviewBoundary: true;
      closeoutReviewBoundaryAt?: number | null;
      replacementOpenedAt?: number | null;
    };

export function canSupersedeReviewedRegisterSessionForLocalOpen(input: {
  hasOpenRegisterCloseoutReview: boolean;
  replacementLocalRegisterSessionId: string;
  registerSession?: RegisterSessionLifecycleScopedSession | null;
  storeId: string;
  terminalId: string;
} & RegisterSessionSupersedeFreshnessInput) {
  const isDistinctReplacement =
    input.replacementLocalRegisterSessionId !==
      input.registerSession?.localRegisterSessionId &&
    input.replacementLocalRegisterSessionId !==
      input.registerSession?.cloudRegisterSessionId;
  const hasSubmittedCloseout =
    input.registerSession?.status === "closing";
  const closeoutReviewBoundaryAt = input.closeoutReviewBoundaryAt;
  const replacementOpenedAt = input.replacementOpenedAt;
  const hasKnownCloseoutBoundary =
    typeof closeoutReviewBoundaryAt === "number";
  const hasKnownReplacementOpenedAt =
    typeof replacementOpenedAt === "number";
  const hasFreshReplacement =
    input.allowUnknownCloseoutReviewBoundary === true ||
    (hasKnownCloseoutBoundary &&
      hasKnownReplacementOpenedAt &&
      replacementOpenedAt > closeoutReviewBoundaryAt);
  const hasReplacementHold =
    input.hasOpenRegisterCloseoutReview || hasSubmittedCloseout;

  return (
    isScopedRegisterSession(input) &&
    isDistinctReplacement &&
    hasFreshReplacement &&
    (isRegisterSessionSaleUsable(input.registerSession) ||
      input.registerSession?.status === "closing" ||
      input.registerSession?.status === "closeout_rejected") &&
    hasReplacementHold
  );
}

export const OBSOLETE_REGISTER_OPEN_SYNC_REVIEW_SUMMARY =
  "Register open predates the authoritative drawer close boundary.";

export const UNSAFE_REGISTER_OPEN_SYNC_REVIEW_SUMMARY =
  "Register open chronology could not be verified against the authoritative drawer close boundary.";

/**
 * Lifecycle close evidence for one scoped register session. Only occurrence and
 * close timestamps are compared; document insertion order is never used.
 */
export type RegisterSessionLifecycleCloseEvidence = {
  closedAt?: number | null;
  closeoutOwnedAt?: number | null;
  closeoutRecords?: readonly unknown[] | null;
  status?: RegisterSessionStatus | string | null;
};

export type RegisterSessionAuthoritativeCloseBoundary = {
  /** True when a close happened but no close occurrence timestamp is derivable. */
  hasAmbiguousCloseEvidence: boolean;
  latestAuthoritativeCloseAt: number | null;
};

/**
 * Derives the latest authoritative close/review boundary for a scoped drawer
 * from a bounded window of register sessions.
 */
export function getRegisterSessionAuthoritativeCloseBoundary(
  sessions: readonly (RegisterSessionLifecycleCloseEvidence | null | undefined)[],
): RegisterSessionAuthoritativeCloseBoundary {
  let latestAuthoritativeCloseAt: number | null = null;
  let hasAmbiguousCloseEvidence = false;

  for (const session of sessions) {
    if (!session) continue;
    const closeAt = getRegisterSessionCloseOccurrenceAt(session);
    if (closeAt === null) {
      if (session.status === "closed") {
        hasAmbiguousCloseEvidence = true;
      }
      continue;
    }

    latestAuthoritativeCloseAt =
      latestAuthoritativeCloseAt === null
        ? closeAt
        : Math.max(latestAuthoritativeCloseAt, closeAt);
  }

  return { hasAmbiguousCloseEvidence, latestAuthoritativeCloseAt };
}

export type RegisterOpenLifecycleBoundaryEvidence = {
  hasAmbiguousCloseEvidence?: boolean;
  latestAuthoritativeCloseAt?: number | null;
  storeId?: string | null;
  terminalId?: string | null;
};

export type RegisterOpenLifecycleCandidateEvidence = {
  hasExistingProjection?: boolean;
  localRegisterSessionId: string;
  occurredAt?: number | null;
  storeId: string;
  terminalId: string;
};

export type RegisterOpenLifecycleDisposition =
  | {
      disposition: "fresh";
      reason: "after_authoritative_boundary" | "no_authoritative_boundary";
    }
  | { disposition: "duplicate"; reason: "existing_projection" }
  | {
      candidateOccurredAt: number;
      disposition: "obsolete";
      latestAuthoritativeCloseAt: number;
      reason: "at_or_before_authoritative_boundary";
    }
  | {
      disposition: "unsafe";
      reason: "ambiguous_close_evidence" | "missing_occurrence_evidence";
    };

/**
 * Single decision point for whether a register open may still create or reuse a
 * cloud drawer. Pure and reusable: projection and terminal cloud repair both
 * classify candidates through this function.
 */
export function classifyRegisterOpenAgainstLifecycleBoundary(input: {
  boundary?: RegisterOpenLifecycleBoundaryEvidence | null;
  candidate: RegisterOpenLifecycleCandidateEvidence;
}): RegisterOpenLifecycleDisposition {
  const { boundary, candidate } = input;

  if (candidate.hasExistingProjection) {
    return { disposition: "duplicate", reason: "existing_projection" };
  }

  const isScopedBoundary =
    Boolean(boundary) &&
    (boundary?.storeId === undefined ||
      boundary.storeId === null ||
      boundary.storeId === candidate.storeId) &&
    (boundary?.terminalId === undefined ||
      boundary.terminalId === null ||
      boundary.terminalId === candidate.terminalId);
  const latestAuthoritativeCloseAt =
    isScopedBoundary && typeof boundary?.latestAuthoritativeCloseAt === "number"
      ? boundary.latestAuthoritativeCloseAt
      : null;
  const hasAmbiguousCloseEvidence =
    isScopedBoundary && boundary?.hasAmbiguousCloseEvidence === true;

  if (latestAuthoritativeCloseAt === null && !hasAmbiguousCloseEvidence) {
    return { disposition: "fresh", reason: "no_authoritative_boundary" };
  }

  if (typeof candidate.occurredAt !== "number") {
    return { disposition: "unsafe", reason: "missing_occurrence_evidence" };
  }

  if (latestAuthoritativeCloseAt === null) {
    return { disposition: "unsafe", reason: "ambiguous_close_evidence" };
  }

  if (candidate.occurredAt <= latestAuthoritativeCloseAt) {
    return {
      candidateOccurredAt: candidate.occurredAt,
      disposition: "obsolete",
      latestAuthoritativeCloseAt,
      reason: "at_or_before_authoritative_boundary",
    };
  }

  return { disposition: "fresh", reason: "after_authoritative_boundary" };
}

function getRegisterSessionCloseOccurrenceAt(
  session: RegisterSessionLifecycleCloseEvidence,
) {
  const latestCloseoutRecordAt = (session.closeoutRecords ?? []).reduce<
    number | null
  >((latest, record) => {
    const occurredAt =
      typeof record === "object" &&
      record !== null &&
      "occurredAt" in record &&
      typeof (record as { occurredAt?: unknown }).occurredAt === "number"
        ? (record as { occurredAt: number }).occurredAt
        : null;
    if (occurredAt === null) return latest;
    return latest === null ? occurredAt : Math.max(latest, occurredAt);
  }, null);
  if (latestCloseoutRecordAt !== null) return latestCloseoutRecordAt;

  if (typeof session.closeoutOwnedAt === "number") {
    return session.closeoutOwnedAt;
  }

  return typeof session.closedAt === "number" ? session.closedAt : null;
}

export function canOpenReplacementDrawerForLocalBlock(input: {
  activeRegisterSession?: RegisterSessionLifecycleScopedSession | null;
  drawerAuthorityReason?: RegisterSessionLifecycleDrawerAuthorityReason | null;
  hasSettledCloseout: boolean;
  saleBlockReason?: string | null;
}) {
  if (!input.saleBlockReason) return true;
  if (
    input.saleBlockReason === "drawer_authority" &&
    (input.drawerAuthorityReason === "cloud_closed" ||
      input.drawerAuthorityReason === "cloud_session_missing")
  ) {
    return true;
  }
  if (
    input.saleBlockReason === "drawer_closed" &&
    (input.hasSettledCloseout ||
      input.activeRegisterSession?.status === "closing")
  ) {
    return true;
  }

  return false;
}

export function canInspectRuntimeCloudDrawerAuthority(
  session: Pick<RegisterSessionLifecycleScopedSession, "status"> | null | undefined,
) {
  return (
    session?.status === "open" ||
    session?.status === "active" ||
    session?.status === "closing"
  );
}

export function isRegisterCloseoutReviewConflict(
  input: RegisterSessionLifecycleReviewConflict,
) {
  const summary = input.summary?.trim() ?? "";
  const normalizedSummary = summary.toLowerCase();
  const details = input.details ?? {};
  const localEventId = input.localEventId?.toLowerCase() ?? "";

  return (
    summary === REGISTER_CLOSEOUT_VARIANCE_SYNC_REVIEW_SUMMARY ||
    normalizedSummary.includes("register closeout") ||
    localEventId.includes("register-closed") ||
    localEventId.includes("register-closeout") ||
    typeof details.countedCash === "number" ||
    typeof details.expectedCash === "number" ||
    typeof details.variance === "number"
  );
}

function isScopedRegisterSession(input: {
  registerSession?: RegisterSessionLifecycleScopedSession | null;
  storeId: string;
  terminalId: string;
}) {
  return (
    input.registerSession?.storeId === input.storeId &&
    input.registerSession.terminalId === input.terminalId
  );
}

function drawerAuthorityMatchesActiveRegisterSession(input: {
  activeRegisterSession?: RegisterSessionLifecycleScopedSession | null;
  drawerAuthority: RegisterSessionLifecycleDrawerAuthority;
}) {
  const activeIds = new Set(
    [
      input.activeRegisterSession?.localRegisterSessionId,
      input.activeRegisterSession?.cloudRegisterSessionId,
    ].filter((id): id is string => Boolean(id)),
  );
  if (activeIds.size === 0) return true;

  return [
    input.drawerAuthority.localRegisterSessionId,
    input.drawerAuthority.cloudRegisterSessionId,
  ].some((id) => id !== undefined && activeIds.has(id));
}
