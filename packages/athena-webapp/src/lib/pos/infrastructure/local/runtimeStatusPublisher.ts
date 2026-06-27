import type { PosTerminalRuntimeStatusPayload } from "./terminalRuntimeStatus";

export const RUNTIME_STATUS_FRESHNESS_PUBLISH_INTERVAL_MS = 30_000;

export function startRuntimeStatusFreshnessHeartbeat(
  onHeartbeat: () => void,
  timers: {
    clearIntervalFn?: typeof clearInterval;
    setIntervalFn?: typeof setInterval;
  } = {},
) {
  const setIntervalFn = timers.setIntervalFn ?? setInterval;
  const clearIntervalFn = timers.clearIntervalFn ?? clearInterval;
  const heartbeatTimer = setIntervalFn(
    onHeartbeat,
    RUNTIME_STATUS_FRESHNESS_PUBLISH_INTERVAL_MS,
  );

  return () => clearIntervalFn(heartbeatTimer);
}

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
  return JSON.stringify({
    observationToken: input.observationToken,
    runtimeStatus: normalizeRuntimeStatusPublishMaterial(input.runtimeStatus),
    storeId: input.storeId,
    terminalId: input.terminalId,
  });
}

export function getRuntimeStatusPublishMaterialSignature(input: {
  runtimeStatus: PosTerminalRuntimeStatusPayload;
  storeId: string;
  terminalId: string;
}) {
  return JSON.stringify({
    runtimeStatus: normalizeRuntimeStatusPublishMaterial(input.runtimeStatus),
    storeId: input.storeId,
    terminalId: input.terminalId,
  });
}

export function shouldPublishRuntimeStatus(input: {
  lastMaterialSignature: string | null;
  lastPublishedAt: number | null;
  lastPublishSignature: string | null;
  materialSignature: string;
  now: number;
  publishSignature: string;
  freshnessIntervalMs?: number;
}) {
  if (input.publishSignature === input.lastPublishSignature) return false;
  if (input.materialSignature !== input.lastMaterialSignature) return true;
  if (input.lastPublishedAt === null) return true;

  const freshnessIntervalMs =
    input.freshnessIntervalMs ?? RUNTIME_STATUS_FRESHNESS_PUBLISH_INTERVAL_MS;
  return input.now - input.lastPublishedAt >= freshnessIntervalMs;
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

function normalizeRuntimeStatusPublishMaterial(
  runtimeStatus: PosTerminalRuntimeStatusPayload,
) {
  const stableStatus: Partial<PosTerminalRuntimeStatusPayload> = {
    ...normalizeRuntimeStatusSignature(runtimeStatus),
  };
  delete stableStatus.reportedAt;
  delete stableStatus.snapshots;

  if (stableStatus.appShell) {
    stableStatus.appShell = {
      ...stableStatus.appShell,
      observedAt: 0,
    };
  }
  if (stableStatus.activeRegisterSession) {
    stableStatus.activeRegisterSession = {
      ...stableStatus.activeRegisterSession,
      observedAt: 0,
    };
  }
  if (stableStatus.appUpdate) {
    stableStatus.appUpdate = {
      ...stableStatus.appUpdate,
      observedAt: 0,
    };
  }
  if (stableStatus.saleAuthority) {
    stableStatus.saleAuthority = {
      ...stableStatus.saleAuthority,
      observedAt: 0,
    };
  }
  if (stableStatus.drawerAuthority) {
    stableStatus.drawerAuthority = {
      ...stableStatus.drawerAuthority,
      observedAt: 0,
    };
  }
  if (stableStatus.terminalIntegrity) {
    stableStatus.terminalIntegrity = {
      ...stableStatus.terminalIntegrity,
      observedAt: 0,
    };
  }
  if (stableStatus.sync) {
    stableStatus.sync = { ...stableStatus.sync };
    delete (stableStatus.sync as Partial<PosTerminalRuntimeStatusPayload["sync"]>)
      .lastTrigger;
    delete (stableStatus.sync as Partial<PosTerminalRuntimeStatusPayload["sync"]>)
      .status;
  }

  return stableStatus;
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
