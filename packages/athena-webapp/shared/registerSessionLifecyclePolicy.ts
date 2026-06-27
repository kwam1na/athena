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
  const hasFreshReplacement =
    input.allowUnknownCloseoutReviewBoundary === true ||
    (typeof input.closeoutReviewBoundaryAt === "number" &&
      input.replacementOpenedAt > input.closeoutReviewBoundaryAt);
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

export function canOpenReplacementDrawerForLocalBlock(input: {
  activeRegisterSession?: RegisterSessionLifecycleScopedSession | null;
  drawerAuthorityReason?: RegisterSessionLifecycleDrawerAuthorityReason | null;
  hasSettledCloseout: boolean;
  saleBlockReason?: string | null;
}) {
  if (!input.saleBlockReason) return true;
  if (
    input.saleBlockReason === "drawer_authority" &&
    input.drawerAuthorityReason === "cloud_closed"
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
