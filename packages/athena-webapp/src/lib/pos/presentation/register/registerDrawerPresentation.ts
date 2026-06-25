import type { Id } from "~/convex/_generated/dataModel";
import { isPosUsableRegisterSessionStatus } from "~/shared/registerSessionStatus";

import { toOperatorMessage } from "@/lib/errors/operatorMessages";
import type { PosLocalRegisterReadModel } from "@/lib/pos/infrastructure/local/registerReadModel";
import {
  buildPosSyncStatusPresentation,
  isRegisterCloseoutReviewItem,
  type PosReconciliationItem,
} from "@/lib/pos/presentation/syncStatusPresentation";
import { formatRegisterSessionCode } from "@/lib/pos/presentation/registerSessionCode";

export type LocalSyncStatusSource = {
  description?: string | null;
  label?: string | null;
  onRetrySync?: (() => void) | null;
  pendingEventCount?: number | null;
  reconciliationItems?: PosReconciliationItem[] | null;
  status?: string | null;
};

type LocalSyncRecord = {
  localSyncStatus?: LocalSyncStatusSource | null;
  syncStatus?: LocalSyncStatusSource | string | null;
};

export function getCloseoutLocalRegisterSessionId(
  session:
    | { _id?: Id<"registerSession"> | string; localRegisterSessionId?: string }
    | null
    | undefined,
  localRegisterReadModel?: PosLocalRegisterReadModel | null,
): string | undefined {
  const cloudRegisterSessionId = session?._id?.toString();
  const localActiveRegisterSession =
    localRegisterReadModel?.activeRegisterSession;
  if (
    cloudRegisterSessionId &&
    localActiveRegisterSession?.cloudRegisterSessionId ===
      cloudRegisterSessionId
  ) {
    return localActiveRegisterSession.localRegisterSessionId;
  }

  return session?.localRegisterSessionId ?? session?._id?.toString();
}

export function getCloseoutCloudRegisterSessionId(
  session:
    | { _id?: Id<"registerSession"> | string; localRegisterSessionId?: string }
    | null
    | undefined,
): Id<"registerSession"> | undefined {
  return session?.localRegisterSessionId
    ? undefined
    : (session?._id as Id<"registerSession"> | undefined);
}

export function getCloseoutCloudRegisterSessionCode(
  session:
    | {
        _id?: Id<"registerSession"> | string;
        cloudRegisterSessionId?: Id<"registerSession"> | string;
        localRegisterSessionId?: string;
      }
    | null
    | undefined,
  localRegisterReadModel?: PosLocalRegisterReadModel | null,
): string | undefined {
  if (session?.cloudRegisterSessionId) {
    return session.cloudRegisterSessionId.toString();
  }

  const localRegisterSessionId = session?.localRegisterSessionId;
  const localActiveRegisterSession =
    localRegisterReadModel?.activeRegisterSession;
  if (
    localRegisterSessionId &&
    localActiveRegisterSession?.localRegisterSessionId ===
      localRegisterSessionId &&
    localActiveRegisterSession.cloudRegisterSessionId
  ) {
    return localActiveRegisterSession.cloudRegisterSessionId;
  }

  return getCloseoutCloudRegisterSessionId(session)?.toString();
}

export function formatCloseoutCloudRegisterSessionCode(
  session:
    | {
        _id?: Id<"registerSession"> | string;
        cloudRegisterSessionId?: Id<"registerSession"> | string;
        localRegisterSessionId?: string;
      }
    | null
    | undefined,
  localRegisterReadModel?: PosLocalRegisterReadModel | null,
): string | undefined {
  return formatRegisterSessionCode(
    getCloseoutCloudRegisterSessionCode(session, localRegisterReadModel),
  );
}

export function isKnownCloudRegisterSessionBlockingLocalProjection(
  cloudRegisterSession:
    | { _id?: Id<"registerSession"> | string; status?: string }
    | null
    | undefined,
  localRegisterSession:
    | {
        cloudRegisterSessionId?: string;
        localRegisterSessionId?: string;
      }
    | null
    | undefined,
) {
  if (
    !cloudRegisterSession ||
    !localRegisterSession ||
    isPosUsableRegisterSessionStatus(cloudRegisterSession.status)
  ) {
    return false;
  }

  const cloudRegisterSessionId = cloudRegisterSession._id?.toString();
  if (!cloudRegisterSessionId) {
    return false;
  }

  return (
    localRegisterSession.cloudRegisterSessionId === cloudRegisterSessionId ||
    localRegisterSession.localRegisterSessionId === cloudRegisterSessionId
  );
}

export function readLocalSyncStatus(
  ...sources: Array<unknown>
): LocalSyncStatusSource | null {
  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    const record = source as LocalSyncRecord;
    if (record.localSyncStatus && typeof record.localSyncStatus === "object") {
      return record.localSyncStatus;
    }

    if (typeof record.syncStatus === "string") {
      return { status: record.syncStatus };
    }

    if (record.syncStatus && typeof record.syncStatus === "object") {
      return record.syncStatus;
    }
  }

  return null;
}

export function findRegisterCloseoutReviewItem(
  source: unknown,
): PosReconciliationItem | null {
  const localSyncStatus = readLocalSyncStatus(source);
  if (!localSyncStatus) {
    return null;
  }

  const syncStatus = buildPosSyncStatusPresentation(localSyncStatus);
  if (syncStatus.status !== "needs_review") {
    return null;
  }

  return (
    syncStatus.reconciliationItems.find(isRegisterCloseoutReviewItem) ?? null
  );
}

export function buildOpenDrawerFailureMessage(result: {
  data?: unknown;
  error?: { message?: string | null } | null;
  kind?: string | null;
}): string {
  if (result.kind && result.kind !== "ok") {
    const message = toOperatorMessage(
      result.error?.message ?? "Unable to open the drawer. Try again.",
    );
    if (/^POS local store could not /i.test(message)) {
      return "Unable to open the drawer. Try again.";
    }
    return message;
  }

  return "Unable to open the drawer. Try again.";
}

export function getLatestLocalRegisterLifecycleEvent(
  model: PosLocalRegisterReadModel | null,
) {
  const activeRegisterSession = model?.activeRegisterSession;
  if (!activeRegisterSession) return null;

  const sessionIds = new Set(
    [
      activeRegisterSession.localRegisterSessionId,
      activeRegisterSession.cloudRegisterSessionId,
    ].filter(Boolean),
  );

  return (
    [...model.sourceEvents]
      .sort((left, right) => left.sequence - right.sequence)
      .filter(
        (event) =>
          event.localRegisterSessionId &&
          sessionIds.has(event.localRegisterSessionId) &&
          (event.type === "register.closeout_started" ||
            event.type === "register.reopened"),
      )
      .at(-1) ?? null
  );
}

export function getPendingLocalCloseoutRegisterSession(
  model: PosLocalRegisterReadModel | null,
) {
  const activeRegisterSession = model?.activeRegisterSession;
  const latestLifecycleEvent = getLatestLocalRegisterLifecycleEvent(model);
  if (
    !activeRegisterSession ||
    activeRegisterSession.status !== "closing" ||
    latestLifecycleEvent?.type !== "register.closeout_started" ||
    latestLifecycleEvent.sync.status === "synced"
  ) {
    return null;
  }

  return {
    cloudRegisterSessionId: activeRegisterSession.cloudRegisterSessionId,
    localRegisterSessionId: activeRegisterSession.localRegisterSessionId,
    status: activeRegisterSession.status,
    terminalId: activeRegisterSession.terminalId,
    registerNumber: activeRegisterSession.registerNumber,
    openingFloat: activeRegisterSession.openingFloat,
    expectedCash: activeRegisterSession.expectedCash,
    countedCash: activeRegisterSession.countedCash,
    managerApprovalRequestId: undefined,
    openedAt: activeRegisterSession.openedAt,
    variance:
      activeRegisterSession.countedCash === undefined
        ? undefined
        : activeRegisterSession.countedCash - activeRegisterSession.expectedCash,
    localSyncStatus: {
      status: "pending_sync" as const,
      pendingEventCount: 1,
    },
  };
}
