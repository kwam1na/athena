import type { PosTerminalRuntimeStatusPayload } from "./terminalRuntimeStatus";
import { projectTerminalRuntimeMaterial } from "~/shared/pos/terminalRuntimeMaterial";
import { incrementPosRuntimeCounter } from "@/lib/pos/infrastructure/telemetry/runtimeCounters";

export const RUNTIME_STATUS_FRESHNESS_WAKEUP_INTERVAL_MS = 30_000;
// Keep below the 2 minute terminal-health freshness boundary.
export const RUNTIME_STATUS_FRESHNESS_PUBLISH_INTERVAL_MS = 110_000;
export const RUNTIME_STATUS_TRANSIENT_SYNCING_PUBLISH_DELAY_MS = 1_500;
export const RUNTIME_STATUS_LEADER_LEASE_MS = 45_000;
const RUNTIME_STATUS_LEADER_RENEW_MS = 15_000;

type RuntimeStatusLeaderLeaseRecord = {
  epoch: number;
  expiresAt: number;
  ownerId: string;
};

// Some browser shells and test environments expose Storage but deny or drop
// writes. Keep same-runtime ownership functional while localStorage remains the
// cross-context coordination rail when it is available.
const volatileRuntimeStatusLeases = new Map<
  string,
  RuntimeStatusLeaderLeaseRecord
>();

type RuntimeStatusMaterialMessage = {
  materialSignature: string;
  ownerId: string;
  runtimeStatus?: unknown;
  sentAt: number;
};

type RuntimeStatusLockManager = {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => T | PromiseLike<T>,
  ): Promise<T>;
};

type RuntimeStatusMaterialChannel = {
  close(): void;
  onmessage: ((event: MessageEvent<RuntimeStatusMaterialMessage>) => void) | null;
  postMessage(message: RuntimeStatusMaterialMessage): void;
};

export type RuntimeStatusLeaderLease = {
  announceMaterial(materialSignature: string, runtimeStatus?: unknown): void;
  isLeader(now?: number): boolean;
  renew(): Promise<boolean>;
  stop(): void;
};

export function startRuntimeStatusLeaderLease(
  input: {
    onLeadershipChange: () => void;
    onMaterial: (materialSignature: string, runtimeStatus?: unknown) => void;
    ownerId: string;
    storeId: string;
    terminalId: string;
  },
  environment: {
    addStorageListener?: (listener: (event: StorageEvent) => void) => () => void;
    createChannel?: (name: string) => RuntimeStatusMaterialChannel | null;
    lockManager?: RuntimeStatusLockManager | null;
    now?: () => number;
    setIntervalFn?: typeof setInterval;
    clearIntervalFn?: typeof clearInterval;
    storage?: Storage | null;
  } = {},
): RuntimeStatusLeaderLease {
  const now = environment.now ?? Date.now;
  const storage =
    environment.storage === undefined
      ? getRuntimeStatusPublishStorage()
      : environment.storage;
  const lockManager =
    environment.lockManager === undefined
      ? getRuntimeStatusLockManager()
      : environment.lockManager;
  const setIntervalFn = environment.setIntervalFn ?? setInterval;
  const clearIntervalFn = environment.clearIntervalFn ?? clearInterval;
  const scopeKey = `${input.storeId}:${input.terminalId}`;
  const leaseKey = `athena-pos-runtime-status-leader:${scopeKey}`;
  const materialKey = `athena-pos-runtime-status-material:${scopeKey}`;
  const lockName = `athena-pos-runtime-status-leader:${scopeKey}`;
  let currentEpoch: number | null = null;
  let lastForwardedMaterialAt: number | null = null;
  let stopped = false;

  const readLease = () => readRuntimeStatusLeaderLease(storage, leaseKey);
  const transition = () => {
    const timestamp = now();
    const existing = readLease();
    if (
      existing &&
      existing.ownerId !== input.ownerId &&
      existing.expiresAt > timestamp
    ) {
      const changed = currentEpoch !== null;
      currentEpoch = null;
      if (changed) input.onLeadershipChange();
      return false;
    }

    const epoch =
      existing?.ownerId === input.ownerId
        ? existing.epoch
        : Math.max(existing?.epoch ?? 0, currentEpoch ?? 0) + 1;
    writeRuntimeStatusLeaderLease(storage, leaseKey, {
      epoch,
      expiresAt: timestamp + RUNTIME_STATUS_LEADER_LEASE_MS,
      ownerId: input.ownerId,
    });
    const changed = currentEpoch !== epoch;
    currentEpoch = epoch;
    if (changed) input.onLeadershipChange();
    return true;
  };

  const renew = async () => {
    if (stopped) return false;
    if (!lockManager) return transition();
    return lockManager.request(lockName, { mode: "exclusive" }, transition);
  };

  const handleMaterial = (message: RuntimeStatusMaterialMessage) => {
    if (
      message.ownerId !== input.ownerId &&
      typeof message.materialSignature === "string" &&
      (lastForwardedMaterialAt === null ||
        message.sentAt > lastForwardedMaterialAt) &&
      isLeader(now())
    ) {
      lastForwardedMaterialAt = message.sentAt;
      input.onMaterial(message.materialSignature, message.runtimeStatus);
    }
  };
  const createChannel = environment.createChannel ?? createRuntimeStatusChannel;
  const channel = createChannel(materialKey);
  if (channel) {
    channel.onmessage = (event) => handleMaterial(event.data);
  }
  const removeStorageListener = (
    environment.addStorageListener ?? addRuntimeStatusStorageListener
  )((event) => {
    if (event.key !== materialKey || !event.newValue) return;
    const message = parseRuntimeStatusMaterialMessage(event.newValue);
    if (message) handleMaterial(message);
  });

  const isLeader = (timestamp = now()) => {
    if (stopped || currentEpoch === null) return false;
    const lease = readLease();
    return Boolean(
      lease &&
        lease.ownerId === input.ownerId &&
        lease.epoch === currentEpoch &&
        lease.expiresAt > timestamp,
    );
  };

  const renewalTimer = setIntervalFn(() => {
    void renew();
  }, RUNTIME_STATUS_LEADER_RENEW_MS);
  void renew();

  return {
    announceMaterial(materialSignature, runtimeStatus) {
      const message = {
        materialSignature,
        ownerId: input.ownerId,
        runtimeStatus,
        sentAt: now(),
      };
      channel?.postMessage(message);
      try {
        storage?.setItem(materialKey, JSON.stringify(message));
      } catch {
        // Broadcast/storage are duplicate-suppression transports only.
        incrementPosRuntimeCounter("runtimeStatus.materialWriteFailed");
      }
    },
    isLeader,
    renew,
    stop() {
      if (stopped) return;
      stopped = true;
      clearIntervalFn(renewalTimer);
      channel?.close();
      removeStorageListener();
      const release = () => {
        const lease = readLease();
        if (
          lease?.ownerId === input.ownerId &&
          lease.epoch === currentEpoch
        ) {
          writeRuntimeStatusLeaderLease(storage, leaseKey, {
            ...lease,
            expiresAt: 0,
          });
        }
        currentEpoch = null;
      };
      if (lockManager) {
        void lockManager.request(lockName, { mode: "exclusive" }, release);
      } else {
        release();
      }
    },
  };
}

function readRuntimeStatusLeaderLease(
  storage: Storage | null,
  key: string,
): RuntimeStatusLeaderLeaseRecord | null {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return volatileRuntimeStatusLeases.get(key) ?? null;
    const parsed = JSON.parse(raw) as Partial<RuntimeStatusLeaderLeaseRecord>;
    return typeof parsed.epoch === "number" &&
      typeof parsed.expiresAt === "number" &&
      typeof parsed.ownerId === "string"
      ? (parsed as RuntimeStatusLeaderLeaseRecord)
      : null;
  } catch {
    return volatileRuntimeStatusLeases.get(key) ?? null;
  }
}

function writeRuntimeStatusLeaderLease(
  storage: Storage | null,
  key: string,
  lease: RuntimeStatusLeaderLeaseRecord,
) {
  volatileRuntimeStatusLeases.set(key, lease);
  try {
    storage?.setItem(key, JSON.stringify(lease));
  } catch {
    // Without durable storage this remains best-effort duplicate suppression.
    incrementPosRuntimeCounter("runtimeStatus.leaseWriteFailed");
  }
}

function parseRuntimeStatusMaterialMessage(
  raw: string,
): RuntimeStatusMaterialMessage | null {
  try {
    const parsed = JSON.parse(raw) as Partial<RuntimeStatusMaterialMessage>;
    return typeof parsed.materialSignature === "string" &&
      typeof parsed.ownerId === "string" &&
      typeof parsed.sentAt === "number"
      ? (parsed as RuntimeStatusMaterialMessage)
      : null;
  } catch {
    return null;
  }
}

function getRuntimeStatusLockManager(): RuntimeStatusLockManager | null {
  const locks = globalThis.navigator?.locks;
  return locks && typeof locks.request === "function"
    ? (locks as RuntimeStatusLockManager)
    : null;
}

function createRuntimeStatusChannel(
  name: string,
): RuntimeStatusMaterialChannel | null {
  const browserGlobal = globalThis as typeof globalThis & { window?: unknown };
  if (browserGlobal.window !== globalThis) return null;

  const BroadcastChannelConstructor = globalThis.BroadcastChannel;
  const EventTargetConstructor = globalThis.EventTarget;
  if (
    typeof BroadcastChannelConstructor !== "function" ||
    typeof EventTargetConstructor !== "function" ||
    !(BroadcastChannelConstructor.prototype instanceof EventTargetConstructor)
  ) {
    return null;
  }

  return new BroadcastChannelConstructor(name);
}

function addRuntimeStatusStorageListener(
  listener: (event: StorageEvent) => void,
) {
  globalThis.window?.addEventListener?.("storage", listener);
  return () => globalThis.window?.removeEventListener?.("storage", listener);
}

function getRuntimeStatusPublishStorage(): Storage | null {
  try {
    if (typeof globalThis.localStorage !== "undefined") {
      return globalThis.localStorage;
    }
    if (
      typeof window !== "undefined" &&
      typeof window.localStorage !== "undefined"
    ) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

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
    RUNTIME_STATUS_FRESHNESS_WAKEUP_INTERVAL_MS,
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
    | "disabled"
    | "not_ready"
    | "rejected"
    | "unavailable";
  checkInPublishStatus?:
    | "accepted"
    | "failed"
    | "disabled"
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

export function shouldDelayTransientSyncingRuntimeStatusPublish(input: {
  forcePublish: boolean;
  materialSignature: string;
  readyMaterialSignature: string | null;
  syncStatus: PosTerminalRuntimeStatusPayload["sync"]["status"];
}) {
  return (
    input.syncStatus === "syncing" &&
    !input.forcePublish &&
    input.readyMaterialSignature !== input.materialSignature
  );
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
  return projectTerminalRuntimeMaterial(runtimeStatus);
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
