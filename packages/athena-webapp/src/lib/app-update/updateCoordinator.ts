export const UPDATE_COORDINATOR_MESSAGE_TYPE =
  "athena:update-coordinator:v1" as const;

export type UpdateCoordinatorStatus =
  | "current"
  | "checking"
  | "ready"
  | "ready-unstaged"
  | "blocked"
  | "applying"
  | "detector-failed";

export type UpdateApplyBlockerPriority =
  | "critical-workflow"
  | "active-command"
  | "resume-required";

export type UpdateStagingStatus = "staged" | "unstaged";
export type UpdateStagingReason =
  | "asset-staging-failed"
  | "no-entry-html"
  | "no-static-assets"
  | "cache-storage-unavailable"
  | "service-worker-unavailable"
  | "service-worker-timeout"
  | "service-worker-error";

export type UpdateStagingDiagnostics = {
  status: UpdateStagingStatus;
  reason?: UpdateStagingReason;
  assetCount?: number;
  failedAssetCount?: number;
  rejectedAssetCount?: number;
};

export type UpdateApplyBlockerInput = {
  surfaceId: string;
  priority: UpdateApplyBlockerPriority;
  label: string;
  guidance: string;
};

export type UpdateApplyBlocker = UpdateApplyBlockerInput & {
  ownerTabId: string;
  generation: number;
  updatedAt: number;
  expiresAt?: number;
};

export type UpdateCoordinatorSnapshot = {
  status: UpdateCoordinatorStatus;
  currentBuildId?: string;
  pendingBuildId?: string;
  canApply: boolean;
  staging?: UpdateStagingDiagnostics;
  blockers: UpdateApplyBlocker[];
  selectedBlocker?: UpdateApplyBlocker;
};

export type UpdateDetectedInput = {
  currentBuildId?: string;
  pendingBuildId: string;
  stagingStatus: UpdateStagingStatus;
  stagingReason?: UpdateStagingReason;
  assetCount?: number;
  failedAssetCount?: number;
  rejectedAssetCount?: number;
};

export type UpdateCoordinatorMessageBlocker = UpdateApplyBlockerInput & {
  generation: number;
};

export type UpdateCoordinatorMessage = {
  type: typeof UPDATE_COORDINATOR_MESSAGE_TYPE;
  sourceTabId: string;
  pendingBuildId: string;
  sentAt: number;
  blockers: UpdateCoordinatorMessageBlocker[];
};

export type UpdateApplyOptions = {
  bypassUnloadPrompt?: boolean;
};

export type UpdateCoordinatorStore = {
  getSnapshot: () => UpdateCoordinatorSnapshot;
  getMessage: () => UpdateCoordinatorMessage | null;
  subscribe: (listener: () => void) => () => void;
  reportChecking: () => void;
  reportUpdateDetected: (input: UpdateDetectedInput) => void;
  reportDetectorFailed: () => void;
  syncApplyBlockers: (blockers: UpdateApplyBlockerInput[]) => void;
  registerApplyBlocker: (blocker: UpdateApplyBlockerInput) => void;
  clearApplyBlocker: (surfaceId: string) => void;
  receiveMessage: (message: UpdateCoordinatorMessage) => void;
  applyUpdate: (options?: UpdateApplyOptions) => boolean;
};

const DEFAULT_REMOTE_BLOCKER_LEASE_MS = 30_000;

const priorityRank: Record<UpdateApplyBlockerPriority, number> = {
  "critical-workflow": 0,
  "active-command": 1,
  "resume-required": 2,
};

export function createUpdateCoordinatorStore({
  reload,
  now = () => Date.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timerId) =>
    clearTimeout(timerId as ReturnType<typeof setTimeout>),
  tabId = createTabId(),
  remoteBlockerLeaseMs = DEFAULT_REMOTE_BLOCKER_LEASE_MS,
}: {
  reload: (options?: UpdateApplyOptions) => void;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => unknown;
  clearTimer?: (timerId: unknown) => void;
  tabId?: string;
  remoteBlockerLeaseMs?: number;
}): UpdateCoordinatorStore {
  let currentBuildId: string | undefined;
  let pendingBuildId: string | undefined;
  let baseStatus: UpdateCoordinatorStatus = "current";
  let stagingDiagnostics: UpdateStagingDiagnostics = { status: "staged" };
  let applying = false;
  const localBlockers = new Map<string, UpdateApplyBlocker>();
  const compatibilityBlockers = new Map<string, UpdateApplyBlocker>();
  const remoteBlockers = new Map<string, UpdateApplyBlocker>();
  const generations = new Map<string, number>();
  const listeners = new Set<() => void>();
  let snapshotVersion = 0;
  let cachedSnapshot:
    | { version: number; value: UpdateCoordinatorSnapshot }
    | null = null;
  let remoteExpiryTimer: unknown;

  function emit() {
    snapshotVersion += 1;
    cachedSnapshot = null;
    for (const listener of listeners) {
      listener();
    }
  }

  function clearRemoteExpiryTimer() {
    if (remoteExpiryTimer !== undefined) {
      clearTimer(remoteExpiryTimer);
      remoteExpiryTimer = undefined;
    }
  }

  function pruneExpiredRemoteBlockers() {
    const timestamp = now();
    let didPrune = false;
    for (const [key, blocker] of remoteBlockers.entries()) {
      if (blocker.expiresAt && blocker.expiresAt <= timestamp) {
        remoteBlockers.delete(key);
        didPrune = true;
      }
    }
    return didPrune;
  }

  function scheduleRemoteExpiry() {
    clearRemoteExpiryTimer();

    const nextExpiry = Array.from(remoteBlockers.values()).reduce<
      number | undefined
    >((nearestExpiry, blocker) => {
      if (!blocker.expiresAt) {
        return nearestExpiry;
      }
      return nearestExpiry === undefined
        ? blocker.expiresAt
        : Math.min(nearestExpiry, blocker.expiresAt);
    }, undefined);

    if (nextExpiry === undefined) {
      return;
    }

    remoteExpiryTimer = setTimer(() => {
      remoteExpiryTimer = undefined;
      if (pruneExpiredRemoteBlockers()) {
        emit();
      }
      scheduleRemoteExpiry();
    }, Math.max(0, nextExpiry - now()));
  }

  function getActiveBlockers() {
    return [
      ...localBlockers.values(),
      ...getCompatibilityOnlyBlockers(),
      ...remoteBlockers.values(),
    ].sort(compareBlockers);
  }

  function getLocalMessageBlockers() {
    return [
      ...localBlockers.values(),
      ...getCompatibilityOnlyBlockers(),
    ];
  }

  function getCompatibilityOnlyBlockers() {
    return Array.from(compatibilityBlockers.values()).filter(
      (blocker) => !localBlockers.has(blocker.surfaceId),
    );
  }

  function getSnapshot(): UpdateCoordinatorSnapshot {
    if (cachedSnapshot?.version === snapshotVersion) {
      return cachedSnapshot.value;
    }
    const blockers = getActiveBlockers();
    const hasUpdate = baseStatus === "ready" || baseStatus === "ready-unstaged";
    const status =
      applying ? "applying" : hasUpdate && blockers.length > 0 ? "blocked" : baseStatus;

    const snapshot = {
      status,
      ...(currentBuildId ? { currentBuildId } : {}),
      ...(pendingBuildId ? { pendingBuildId } : {}),
      canApply: hasUpdate && blockers.length === 0 && !applying,
      staging: stagingDiagnostics,
      blockers,
      ...(blockers[0] ? { selectedBlocker: blockers[0] } : {}),
    };
    cachedSnapshot = { version: snapshotVersion, value: snapshot };
    return snapshot;
  }

  function reportChecking() {
    if (baseStatus === "current" || baseStatus === "detector-failed") {
      baseStatus = "checking";
      emit();
    }
  }

  function reportUpdateDetected(input: UpdateDetectedInput) {
    currentBuildId = input.currentBuildId;
    pendingBuildId = input.pendingBuildId;
    stagingDiagnostics = {
      status: input.stagingStatus,
      ...(input.stagingReason ? { reason: input.stagingReason } : {}),
      ...(typeof input.assetCount === "number"
        ? { assetCount: input.assetCount }
        : {}),
      ...(typeof input.failedAssetCount === "number"
        ? { failedAssetCount: input.failedAssetCount }
        : {}),
      ...(typeof input.rejectedAssetCount === "number"
        ? { rejectedAssetCount: input.rejectedAssetCount }
        : {}),
    };
    baseStatus = input.stagingStatus === "staged" ? "ready" : "ready-unstaged";
    emit();
  }

  function reportDetectorFailed() {
    if (!pendingBuildId) {
      baseStatus = "detector-failed";
      emit();
    }
  }

  function registerApplyBlocker(blocker: UpdateApplyBlockerInput) {
    setCompatibilityBlocker(blocker);
  }

  function clearApplyBlocker(surfaceId: string) {
    if (compatibilityBlockers.delete(surfaceId)) {
      generations.set(surfaceId, (generations.get(surfaceId) ?? 0) + 1);
      emit();
    }
  }

  function syncApplyBlockers(blockers: UpdateApplyBlockerInput[]) {
    const nextSurfaceIds = new Set<string>();
    let didChange = false;

    for (const blocker of blockers) {
      if (!isValidUpdateApplyBlockerInput(blocker)) {
        continue;
      }
      nextSurfaceIds.add(blocker.surfaceId);
      if (setLocalBlocker(blocker, { emitChange: false })) {
        didChange = true;
      }
    }

    for (const surfaceId of Array.from(localBlockers.keys())) {
      if (!nextSurfaceIds.has(surfaceId)) {
        localBlockers.delete(surfaceId);
        generations.set(surfaceId, (generations.get(surfaceId) ?? 0) + 1);
        didChange = true;
      }
    }

    if (didChange) {
      emit();
    }
  }

  function setCompatibilityBlocker(blocker: UpdateApplyBlockerInput) {
    if (!blocker.surfaceId || !blocker.label || !blocker.guidance) {
      return;
    }
    if (
      setBlockerForMap(compatibilityBlockers, blocker, { emitChange: false })
    ) {
      emit();
    }
  }

  function setLocalBlocker(
    blocker: UpdateApplyBlockerInput,
    { emitChange }: { emitChange: boolean },
  ) {
    return setBlockerForMap(localBlockers, blocker, { emitChange });
  }

  function setBlockerForMap(
    target: Map<string, UpdateApplyBlocker>,
    blocker: UpdateApplyBlockerInput,
    { emitChange }: { emitChange: boolean },
  ) {
    if (!isValidUpdateApplyBlockerInput(blocker)) {
      return false;
    }
    const existing = target.get(blocker.surfaceId);
    if (existing && areBlockersEqual(existing, blocker)) {
      return false;
    }
    const generation = (generations.get(blocker.surfaceId) ?? 0) + 1;
    generations.set(blocker.surfaceId, generation);
    target.set(blocker.surfaceId, {
      ...blocker,
      ownerTabId: tabId,
      generation,
      updatedAt: now(),
    });
    if (emitChange) {
      emit();
    }
    return true;
  }

  function receiveMessage(message: UpdateCoordinatorMessage) {
    if (!isValidUpdateCoordinatorMessage(message)) {
      return;
    }
    if (!pendingBuildId || message.pendingBuildId !== pendingBuildId) {
      return;
    }
    if (message.sourceTabId === tabId) {
      return;
    }

    for (const key of Array.from(remoteBlockers.keys())) {
      if (key.startsWith(`${message.sourceTabId}:`)) {
        remoteBlockers.delete(key);
      }
    }

    for (const blocker of message.blockers) {
      remoteBlockers.set(`${message.sourceTabId}:${blocker.surfaceId}`, {
        ...blocker,
        ownerTabId: message.sourceTabId,
        updatedAt: message.sentAt,
        expiresAt: message.sentAt + remoteBlockerLeaseMs,
      });
    }
    scheduleRemoteExpiry();
    emit();
  }

  function applyUpdate(options?: UpdateApplyOptions) {
    const snapshot = getSnapshot();
    if (!snapshot.canApply) {
      return false;
    }
    applying = true;
    emit();
    reload(options);
    return true;
  }

  return {
    getSnapshot,
    getMessage() {
      if (!pendingBuildId) {
        return null;
      }
      return {
        type: UPDATE_COORDINATOR_MESSAGE_TYPE,
        sourceTabId: tabId,
        pendingBuildId,
        sentAt: now(),
        blockers: getLocalMessageBlockers().map((blocker) => ({
          surfaceId: blocker.surfaceId,
          priority: blocker.priority,
          label: blocker.label,
          guidance: blocker.guidance,
          generation: blocker.generation,
        })),
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reportChecking,
    reportUpdateDetected,
    reportDetectorFailed,
    syncApplyBlockers,
    registerApplyBlocker,
    clearApplyBlocker,
    receiveMessage,
    applyUpdate,
  };
}

export function isValidUpdateCoordinatorMessage(
  message: unknown,
): message is UpdateCoordinatorMessage {
  if (!message || typeof message !== "object") {
    return false;
  }
  const candidate = message as Partial<UpdateCoordinatorMessage>;
  return (
    candidate.type === UPDATE_COORDINATOR_MESSAGE_TYPE &&
    typeof candidate.sourceTabId === "string" &&
    candidate.sourceTabId.length > 0 &&
    typeof candidate.pendingBuildId === "string" &&
    candidate.pendingBuildId.length > 0 &&
    typeof candidate.sentAt === "number" &&
    Number.isFinite(candidate.sentAt) &&
    Array.isArray(candidate.blockers) &&
    candidate.blockers.every(isValidMessageBlocker)
  );
}

function isValidMessageBlocker(
  blocker: unknown,
): blocker is UpdateCoordinatorMessageBlocker {
  if (!blocker || typeof blocker !== "object") {
    return false;
  }
  const candidate = blocker as Partial<UpdateCoordinatorMessageBlocker>;
  return (
    typeof candidate.surfaceId === "string" &&
    candidate.surfaceId.length > 0 &&
    isValidPriority(candidate.priority) &&
    typeof candidate.label === "string" &&
    candidate.label.length > 0 &&
    typeof candidate.guidance === "string" &&
    candidate.guidance.length > 0 &&
    typeof candidate.generation === "number" &&
    Number.isFinite(candidate.generation)
  );
}

function isValidUpdateApplyBlockerInput(
  blocker: UpdateApplyBlockerInput,
) {
  return Boolean(blocker.surfaceId && blocker.label && blocker.guidance);
}

function isValidPriority(
  priority: unknown,
): priority is UpdateApplyBlockerPriority {
  return (
    priority === "critical-workflow" ||
    priority === "active-command" ||
    priority === "resume-required"
  );
}

function areBlockersEqual(
  left: UpdateApplyBlocker,
  right: UpdateApplyBlockerInput,
) {
  return (
    left.surfaceId === right.surfaceId &&
    left.priority === right.priority &&
    left.label === right.label &&
    left.guidance === right.guidance
  );
}

function compareBlockers(
  left: UpdateApplyBlocker,
  right: UpdateApplyBlocker,
) {
  return (
    priorityRank[left.priority] - priorityRank[right.priority] ||
    left.label.localeCompare(right.label) ||
    left.surfaceId.localeCompare(right.surfaceId)
  );
}

function createTabId() {
  return `tab-${Math.random().toString(36).slice(2)}`;
}
