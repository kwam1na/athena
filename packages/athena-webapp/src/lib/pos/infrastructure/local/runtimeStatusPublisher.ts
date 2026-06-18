import type { PosTerminalRuntimeStatusPayload } from "./terminalRuntimeStatus";

export type RuntimeCheckInNotReadyReason =
  | "missing_store"
  | "missing_sync_secret"
  | "missing_terminal";

export type RuntimeCheckInPublishDebugPatch = {
  checkInPublishAttemptedAt?: number;
  checkInPublishCompletedAt?: number;
  checkInPublishMessage?: string;
  checkInPublishReason?:
    | RuntimeCheckInNotReadyReason
    | "authorization_failed"
    | "not_ready"
    | "rejected"
    | "unavailable";
  checkInPublishStatus?:
    | "accepted"
    | "failed"
    | "not_ready"
    | "pending"
    | "rejected";
};

export function getRuntimeStatusSignature(input: {
  runtimeStatus: PosTerminalRuntimeStatusPayload;
  storeId: string;
  terminalId: string;
}) {
  return JSON.stringify({
    runtimeStatus: normalizeRuntimeStatusSignature(input.runtimeStatus),
    storeId: input.storeId,
    terminalId: input.terminalId,
  });
}

export function getRuntimeStatusPublishSignature(input: {
  observationToken: number;
  runtimeStatus: PosTerminalRuntimeStatusPayload;
  storeId: string;
  terminalId: string;
}) {
  const stableStatus: Partial<PosTerminalRuntimeStatusPayload> = {
    ...normalizeRuntimeStatusSignature(input.runtimeStatus),
  };
  delete stableStatus.reportedAt;
  delete stableStatus.snapshots;

  return JSON.stringify({
    observationToken: input.observationToken,
    runtimeStatus: stableStatus,
    storeId: input.storeId,
    terminalId: input.terminalId,
  });
}

function normalizeRuntimeStatusSignature(
  runtimeStatus: PosTerminalRuntimeStatusPayload,
): PosTerminalRuntimeStatusPayload {
  if (!runtimeStatus.appUpdate) return runtimeStatus;

  return {
    ...runtimeStatus,
    appUpdate: {
      ...runtimeStatus.appUpdate,
      observedAt: 0,
    },
  };
}

export function getRuntimeCheckInNotReadyReason(input: {
  storeId?: string | null;
  syncSecretHash?: string | null;
  terminalId?: string | null;
}): RuntimeCheckInNotReadyReason | null {
  if (!input.storeId) return "missing_store";
  if (!input.terminalId) return "missing_terminal";
  if (!input.syncSecretHash) return "missing_sync_secret";
  return null;
}

export function withRuntimeCheckInPublishDebug<
  T extends RuntimeCheckInPublishDebugPatch,
>(current: T, patch: RuntimeCheckInPublishDebugPatch): T {
  const next = {
    ...current,
    ...patch,
  };

  if (
    current.checkInPublishAttemptedAt === next.checkInPublishAttemptedAt &&
    current.checkInPublishCompletedAt === next.checkInPublishCompletedAt &&
    current.checkInPublishMessage === next.checkInPublishMessage &&
    current.checkInPublishReason === next.checkInPublishReason &&
    current.checkInPublishStatus === next.checkInPublishStatus
  ) {
    return current;
  }

  return next;
}

export function getRuntimeBrowserInfo(isOnline: boolean) {
  const navigatorRef = globalThis.navigator;
  return {
    language: navigatorRef?.language,
    online: isOnline,
    platform: navigatorRef?.platform,
    userAgent: navigatorRef?.userAgent,
  };
}
