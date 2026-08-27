/** Durable, bounded, never-throw POS diagnostic buffer. */
import { getInitialRuntimeBuildMetadata } from "@/lib/runtimeBuildMetadata";
import {
  isPosDiagnosticClassification,
  isPosClientEventFlow,
  isPosClientEventLevel,
  isPosDiagnosticErrorName,
  isPosDiagnosticOperation,
  isPosDiagnosticRouteId,
  normalizePosDiagnosticBuildIdentifier,
  normalizePosDiagnosticErrorName,
  normalizePosDiagnosticIdentifier,
  normalizePosDiagnosticSource,
  sanitizePosDiagnosticMetadata,
  sourceFromPosDiagnosticError,
  type PosDiagnosticClassification,
  type PosDiagnosticErrorName,
  type PosDiagnosticMetadataValue,
  type PosDiagnosticOperation,
  type PosDiagnosticRouteId,
  type PosDiagnosticSource,
  type PosClientEventFlow,
  type PosClientEventLevel,
} from "~/shared/posDiagnosticRedaction";
import {
  capturePosTelemetryOccurrenceContext,
  readPosTerminalIdentityTransition,
  resolvePendingPosTelemetryContext,
  withPosTerminalIdentityWriteLock,
} from "./telemetryContext";
import {
  initializePosRuntimeCounter,
  incrementPosRuntimeCounter,
  setPosRuntimeCounter,
} from "./runtimeCounters";

export type { PosClientEventFlow, PosClientEventLevel };

export type PosClientTelemetryV2Event = {
  version: 2;
  clientEventId: string;
  level: PosClientEventLevel;
  flow: PosClientEventFlow;
  classification: PosDiagnosticClassification;
  occurredAt: number;
  orgUrlSlug: string;
  storeUrlSlug: string;
  routeId: PosDiagnosticRouteId;
  occurrenceContextToken?: string;
  terminalIdentityGeneration?: string;
  online: boolean;
  storeId?: string;
  telemetryIdentityEpoch?: string;
  reportedCloudTerminalId?: string;
  reportedTerminalFingerprint?: string;
  localRegisterSessionId?: string;
  operation?: PosDiagnosticOperation;
  errorName?: PosDiagnosticErrorName;
  source?: PosDiagnosticSource;
  appVersion?: string;
  buildSha?: string;
  metadata: Record<string, PosDiagnosticMetadataValue>;
};

export type PosClientTelemetryLegacyEvent = {
  version?: undefined;
  clientEventId: string;
  level: PosClientEventLevel;
  flow: PosClientEventFlow;
  message: string;
  occurredAt: number;
  localRegisterSessionId?: string;
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
  appVersion?: string;
  metadata: Record<string, string | number | boolean>;
};

export type PosClientTelemetryEvent =
  PosClientTelemetryV2Event | PosClientTelemetryLegacyEvent;

export type PosClientTelemetryEventInput = {
  level: PosClientEventLevel;
  flow?: PosClientEventFlow;
  classification: PosDiagnosticClassification;
  operation?: PosDiagnosticOperation;
  error?: unknown;
  localRegisterSessionId?: string;
  appVersion?: string;
  buildSha?: string;
  metadata?: Record<string, unknown>;
  pathname?: string;
  source?: { asset?: unknown; line?: unknown; column?: unknown };
};

export const POS_CLIENT_TELEMETRY_STORAGE_KEY =
  "athena-pos-client-telemetry-v1";
export const POS_CLIENT_TELEMETRY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const POS_CLIENT_TELEMETRY_MAX_REMOVAL_TOMBSTONES = 400;
const MAX_BUFFERED_EVENTS = 200;
const BUFFER_EVENT_KEY_PREFIX = `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:event:`;
const BUFFER_REMOVED_KEY_PREFIX = `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:removed:`;
const BUFFER_OCCURRENCE_BINDING_KEY_PREFIX = `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:occurrence:`;
const BUFFER_LEGACY_QUARANTINE_KEY_PREFIX = `${POS_CLIENT_TELEMETRY_STORAGE_KEY}:quarantine:`;
const WITNESS_UPGRADE_RETRY_COOLDOWN_MS = 30_000;

type PosTelemetryOccurrenceBindingV1 = {
  version: 1;
  storeId: string;
  occurrenceContextToken: string;
  terminalIdentityGeneration: string;
  telemetryIdentityEpoch?: string;
  reportedCloudTerminalId?: string;
  reportedTerminalFingerprint?: string;
};

export type PosTelemetryOccurrenceWitness = {
  version: 2;
  clientEventId: string;
  storeId: string;
  occurrenceContextToken: string;
  terminalIdentityGeneration: string;
  telemetryIdentityEpoch: string;
  reportedCloudTerminalId?: string;
  reportedTerminalFingerprint?: string;
  transitionRevision: number;
  transitionStartedAt: number;
};

type PosTelemetryOccurrenceBinding =
  PosTelemetryOccurrenceBindingV1 | PosTelemetryOccurrenceWitness;

let memoryFallback: PosClientTelemetryEvent[] = [];
let memoryRemovedAt = new Map<string, number>();
let pendingWitnessUpgrades = new Set<Promise<void>>();
let pendingWitnessUpgradeIds = new Set<string>();
let witnessUpgradeRetryAfter = new Map<string, number>();
let witnessUpgradeCursorEventId: string | undefined;

export function resetPosClientTelemetryBufferForTests(): void {
  memoryFallback = [];
  memoryRemovedAt = new Map();
  pendingWitnessUpgrades = new Set();
  pendingWitnessUpgradeIds = new Set();
  witnessUpgradeRetryAfter = new Map();
  witnessUpgradeCursorEventId = undefined;
  updateBufferGauges([]);
}

export async function flushPosTelemetryWitnessUpgradesForTests(): Promise<void> {
  await Promise.all([...pendingWitnessUpgrades]);
}

function mintClientEventId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID)
      return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readBuffer(normalizePersisted = true): PosClientTelemetryEvent[] {
  const now = Date.now();
  const byId = new Map(
    memoryFallback.map((event) => [event.clientEventId, event] as const),
  );
  pruneMemoryRemovalTombstones(now);
  const removedIds = new Set(memoryRemovedAt.keys());
  const removalTombstones: Array<{
    clientEventId: string;
    key: string;
    removedAt: number;
  }> = [];
  const staleStorageKeys: string[] = [];
  const occurrenceBindings = new Map<string, PosTelemetryOccurrenceBinding>();
  let legacyRawPresent = false;
  try {
    const storageKeys = Array.from(
      { length: window.localStorage.length },
      (_, index) => window.localStorage.key(index),
    );
    for (const key of storageKeys) {
      if (!key) continue;
      if (key.startsWith(BUFFER_REMOVED_KEY_PREFIX)) {
        const removedAt = Number(window.localStorage.getItem(key));
        if (
          Number.isFinite(removedAt) &&
          now - removedAt <= POS_CLIENT_TELEMETRY_RETENTION_MS
        ) {
          const clientEventId = key.slice(BUFFER_REMOVED_KEY_PREFIX.length);
          removalTombstones.push({
            clientEventId,
            key,
            removedAt: effectiveRemovalTimestamp(removedAt, now),
          });
          removedIds.add(clientEventId);
        } else if (normalizePersisted) {
          staleStorageKeys.push(key);
        }
        continue;
      }
      if (key.startsWith(BUFFER_OCCURRENCE_BINDING_KEY_PREFIX)) {
        const clientEventId = key.slice(
          BUFFER_OCCURRENCE_BINDING_KEY_PREFIX.length,
        );
        const binding = decodeOccurrenceBinding(
          window.localStorage.getItem(key),
        );
        if (binding && validId(clientEventId)) {
          occurrenceBindings.set(clientEventId, binding);
        } else if (normalizePersisted) {
          staleStorageKeys.push(key);
        }
        continue;
      }
      if (key.startsWith(BUFFER_LEGACY_QUARANTINE_KEY_PREFIX)) {
        const event = decodePersistedLegacyEvent(
          window.localStorage.getItem(key),
        );
        if (event && byId.get(event.clientEventId)?.version !== 2) {
          byId.set(event.clientEventId, event);
        } else if (!event && normalizePersisted) {
          staleStorageKeys.push(key);
        }
        continue;
      }
      if (!key.startsWith(BUFFER_EVENT_KEY_PREFIX)) continue;
      const event = decodePersistedEvent(window.localStorage.getItem(key));
      if (event?.version === 2) byId.set(event.clientEventId, event);
      else if (event) {
        incrementPosRuntimeCounter("telemetry.droppedCount");
        if (normalizePersisted) staleStorageKeys.push(key);
      } else if (normalizePersisted) staleStorageKeys.push(key);
    }
    // The original whole-array key is a non-promotable quarantine. Valid rows
    // participate in ordering, retention, and ring pressure, but never become
    // deliverable v2 shards.
    const raw = window.localStorage.getItem(POS_CLIENT_TELEMETRY_STORAGE_KEY);
    if (raw) {
      legacyRawPresent = true;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("invalid telemetry buffer");
      for (const row of parsed) {
        const event = isRecord(row) ? decodeLegacyEvent(row) : undefined;
        if (event && !byId.has(event.clientEventId)) {
          byId.set(event.clientEventId, event);
        } else if (!event) {
          incrementPosRuntimeCounter("telemetry.droppedCount");
        }
      }
    }
    removalTombstones.sort(
      (left, right) =>
        right.removedAt - left.removedAt ||
        compareStrings(right.clientEventId, left.clientEventId),
    );
    if (normalizePersisted && !legacyRawPresent) {
      for (const tombstone of removalTombstones.slice(
        POS_CLIENT_TELEMETRY_MAX_REMOVAL_TOMBSTONES,
      )) {
        if (clearPrunedRemovalArtifacts(tombstone.clientEventId)) {
          staleStorageKeys.push(tombstone.key);
        }
      }
    }
    for (const key of staleStorageKeys) window.localStorage.removeItem(key);
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
  }
  const unremoved = [...byId.values()]
    .filter(
      (event) =>
        !removedIds.has(event.clientEventId) &&
        !memoryRemovedAt.has(event.clientEventId),
    )
    .map((event) =>
      applyOccurrenceBinding(
        event,
        occurrenceBindings.get(event.clientEventId),
      ),
    );
  const expired = unremoved.filter(
    (event) => now - event.occurredAt > POS_CLIENT_TELEMETRY_RETENTION_MS,
  );
  const eligible = unremoved
    .filter(
      (event) => now - event.occurredAt <= POS_CLIENT_TELEMETRY_RETENTION_MS,
    )
    .sort(compareTelemetryEvents);
  const overflow = Math.max(0, eligible.length - MAX_BUFFERED_EVENTS);
  const dropped = eligible.slice(0, overflow);
  const retained = eligible.slice(overflow).map(resolvePendingEvent);
  if (normalizePersisted) {
    for (const event of expired) removePersistedEvent(event.clientEventId);
  }
  for (const event of dropped) {
    incrementPosRuntimeCounter("telemetry.droppedCount");
    if (normalizePersisted) removePersistedEvent(event.clientEventId);
  }
  memoryFallback = [...retained];
  const witnessUpgradeCandidates: PosClientTelemetryV2Event[] = [];
  for (const event of retained) {
    let binding = occurrenceBindings.get(event.clientEventId);
    if (event.version === 2 && event.telemetryIdentityEpoch) {
      try {
        binding = decodeOccurrenceBinding(
          window.localStorage.getItem(
            `${BUFFER_OCCURRENCE_BINDING_KEY_PREFIX}${event.clientEventId}`,
          ),
        );
      } catch {
        incrementPosRuntimeCounter("telemetry.storageFallbackCount");
      }
    }
    if (
      event.version === 2 &&
      binding?.version === 1 &&
      event.telemetryIdentityEpoch &&
      exactOccurrenceBindingTuple(binding, event)
    ) {
      witnessUpgradeCandidates.push(event);
    }
  }
  const cursorIndex = witnessUpgradeCandidates.findIndex(
    (event) => event.clientEventId === witnessUpgradeCursorEventId,
  );
  for (let offset = 0; offset < witnessUpgradeCandidates.length; offset += 1) {
    const index =
      (Math.max(cursorIndex, -1) + 1 + offset) %
      witnessUpgradeCandidates.length;
    const candidate = witnessUpgradeCandidates[index];
    if (scheduleOccurrenceWitnessUpgrade(candidate.clientEventId)) {
      witnessUpgradeCursorEventId = candidate.clientEventId;
      break;
    }
  }
  if (normalizePersisted) {
    if (legacyRawPresent) {
      normalizeLegacyQuarantineStorage(retained);
    }
    for (const [clientEventId] of occurrenceBindings) {
      if (removedIds.has(clientEventId) || !byId.has(clientEventId)) {
        removeOccurrenceBinding(clientEventId);
      }
    }
    for (const clientEventId of removedIds) {
      if (byId.has(clientEventId)) {
        deleteStorageKey(
          `${BUFFER_LEGACY_QUARANTINE_KEY_PREFIX}${clientEventId}`,
        );
      }
    }
  }
  updateBufferGauges(retained);
  return retained;
}

function decodePersistedEvent(raw: string | null) {
  if (!raw) return undefined;
  try {
    return decodeBufferedEvent(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function decodePersistedLegacyEvent(
  raw: string | null,
): PosClientTelemetryLegacyEvent | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? decodeLegacyEvent(value) : undefined;
  } catch {
    return undefined;
  }
}

function persistEvent(event: PosClientTelemetryEvent): boolean {
  try {
    const serialized = JSON.stringify(event);
    const key = `${BUFFER_EVENT_KEY_PREFIX}${event.clientEventId}`;
    window.localStorage.setItem(key, serialized);
    if (window.localStorage.getItem(key) === serialized) return true;
  } catch {
    // Fall through to the shared degradation signal.
  }
  incrementPosRuntimeCounter("telemetry.storageFallbackCount");
  return false;
}

function removePersistedEvent(clientEventId: string): void {
  const removedAt = Date.now();
  rememberMemoryRemovalTombstone(clientEventId, removedAt);
  witnessUpgradeRetryAfter.delete(clientEventId);
  const shardKey = `${BUFFER_EVENT_KEY_PREFIX}${clientEventId}`;
  const quarantineKey = `${BUFFER_LEGACY_QUARANTINE_KEY_PREFIX}${clientEventId}`;
  let removalFenced = writeRemovalTombstone(clientEventId, removedAt);
  deleteStorageKey(shardKey);
  removeOccurrenceBinding(clientEventId);
  deleteStorageKey(quarantineKey);
  if (!removalFenced) {
    // Deleting the row commonly frees enough quota for the durable fence.
    // Recheck deletion after the retry to close a stale writer interleaving.
    removalFenced = writeRemovalTombstone(clientEventId, removedAt);
    if (removalFenced) {
      deleteStorageKey(shardKey);
      deleteStorageKey(quarantineKey);
    }
  }
}

function writeRemovalTombstone(
  clientEventId: string,
  removedAt: number,
): boolean {
  const key = `${BUFFER_REMOVED_KEY_PREFIX}${clientEventId}`;
  try {
    const value = String(removedAt);
    window.localStorage.setItem(key, value);
    return window.localStorage.getItem(key) === value;
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
    return false;
  }
}

function rememberMemoryRemovalTombstone(
  clientEventId: string,
  removedAt: number,
): void {
  pruneMemoryRemovalTombstones(removedAt);
  memoryRemovedAt.delete(clientEventId);
  memoryRemovedAt.set(clientEventId, removedAt);
  pruneMemoryRemovalTombstones(removedAt);
}

function pruneMemoryRemovalTombstones(now: number): void {
  memoryRemovedAt = new Map(
    [...memoryRemovedAt]
      .filter(
        ([, removedAt]) =>
          Number.isFinite(removedAt) &&
          now - removedAt <= POS_CLIENT_TELEMETRY_RETENTION_MS,
      )
      .map(
        ([clientEventId, removedAt]) =>
          [
            clientEventId,
            effectiveRemovalTimestamp(removedAt, now),
          ] as const,
      )
      .sort(
        ([leftId, leftRemovedAt], [rightId, rightRemovedAt]) =>
          rightRemovedAt - leftRemovedAt || compareStrings(rightId, leftId),
      )
      .slice(0, POS_CLIENT_TELEMETRY_MAX_REMOVAL_TOMBSTONES),
  );
}

function effectiveRemovalTimestamp(removedAt: number, now: number): number {
  return removedAt > now ? Math.max(0, now - 1) : removedAt;
}

function clearPrunedRemovalArtifacts(clientEventId: string): boolean {
  const keys = [
    `${BUFFER_EVENT_KEY_PREFIX}${clientEventId}`,
    `${BUFFER_OCCURRENCE_BINDING_KEY_PREFIX}${clientEventId}`,
    `${BUFFER_LEGACY_QUARANTINE_KEY_PREFIX}${clientEventId}`,
  ];
  for (const key of keys) deleteStorageKey(key);
  try {
    return keys.every((key) => {
      const value = window.localStorage.getItem(key);
      return value === null || value === "";
    });
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
    return false;
  }
}

function deleteStorageKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
    if (window.localStorage.getItem(key) !== null) {
      window.localStorage.setItem(key, "");
    }
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
  }
}

function normalizeLegacyQuarantineStorage(
  retained: PosClientTelemetryEvent[],
): void {
  const safeRows = retained
    .filter(
      (event): event is PosClientTelemetryLegacyEvent => event.version !== 2,
    )
    .sort(compareTelemetryEvents);
  const persistenceResults = safeRows.map(persistLegacyQuarantineEvent);
  if (persistenceResults.every(Boolean)) {
    try {
      window.localStorage.removeItem(POS_CLIENT_TELEMETRY_STORAGE_KEY);
      if (
        window.localStorage.getItem(POS_CLIENT_TELEMETRY_STORAGE_KEY) === null
      )
        return;
    } catch {
      incrementPosRuntimeCounter("telemetry.storageFallbackCount");
    }
  }
  // A verified sanitized array is a retry container only. Current clients
  // never mutate it for ring operations; they promote each row solely into
  // the distinct, non-deliverable quarantine namespace above.
  try {
    const serialized = JSON.stringify(safeRows);
    window.localStorage.setItem(POS_CLIENT_TELEMETRY_STORAGE_KEY, serialized);
    if (
      window.localStorage.getItem(POS_CLIENT_TELEMETRY_STORAGE_KEY) ===
      serialized
    ) {
      return;
    }
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
  }
  // If a safe quarantine cannot be verified, remove the raw legacy payload.
  // It is never migrated into a deliverable event shard.
  try {
    window.localStorage.removeItem(POS_CLIENT_TELEMETRY_STORAGE_KEY);
    if (
      window.localStorage.getItem(POS_CLIENT_TELEMETRY_STORAGE_KEY) !== null
    ) {
      incrementPosRuntimeCounter("telemetry.storageFallbackCount");
    }
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
  }
}

function persistLegacyQuarantineEvent(
  event: PosClientTelemetryLegacyEvent,
): boolean {
  try {
    const key = `${BUFFER_LEGACY_QUARANTINE_KEY_PREFIX}${event.clientEventId}`;
    const tombstoneKey = `${BUFFER_REMOVED_KEY_PREFIX}${event.clientEventId}`;
    if (window.localStorage.getItem(tombstoneKey) !== null) return true;
    const serialized = JSON.stringify(event);
    window.localStorage.setItem(key, serialized);
    if (window.localStorage.getItem(tombstoneKey) !== null) {
      deleteStorageKey(key);
      return true;
    }
    return window.localStorage.getItem(key) === serialized;
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
    return false;
  }
}

function compareTelemetryEvents(
  left: PosClientTelemetryEvent,
  right: PosClientTelemetryEvent,
): number {
  return (
    left.occurredAt - right.occurredAt ||
    compareStrings(left.clientEventId, right.clientEventId)
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function resolvePendingEvent(
  event: PosClientTelemetryEvent,
): PosClientTelemetryEvent {
  if (event.version !== 2) return event;
  const context = resolvePendingPosTelemetryContext(event);
  if (!context || (event.storeId && event.storeId !== context.storeId)) {
    return event;
  }
  const resolved: PosClientTelemetryV2Event = {
    ...event,
    ...(!event.occurrenceContextToken
      ? optionalIdentifier(
          "occurrenceContextToken",
          context.occurrenceContextToken,
        )
      : {}),
    ...(!event.terminalIdentityGeneration
      ? optionalIdentifier(
          "terminalIdentityGeneration",
          context.terminalIdentityGeneration,
        )
      : {}),
    ...(!event.storeId ? { storeId: context.storeId } : {}),
    ...(!event.telemetryIdentityEpoch
      ? optionalIdentifier(
          "telemetryIdentityEpoch",
          context.telemetryIdentityEpoch,
        )
      : {}),
    ...(!event.reportedCloudTerminalId
      ? optionalIdentifier(
          "reportedCloudTerminalId",
          context.reportedCloudTerminalId,
        )
      : {}),
    ...(!event.reportedTerminalFingerprint
      ? optionalIdentifier(
          "reportedTerminalFingerprint",
          context.reportedTerminalFingerprint,
        )
      : {}),
  };
  if (
    resolved.occurrenceContextToken === event.occurrenceContextToken &&
    resolved.terminalIdentityGeneration === event.terminalIdentityGeneration &&
    resolved.storeId === event.storeId &&
    resolved.telemetryIdentityEpoch === event.telemetryIdentityEpoch &&
    resolved.reportedCloudTerminalId === event.reportedCloudTerminalId &&
    resolved.reportedTerminalFingerprint === event.reportedTerminalFingerprint
  ) {
    return event;
  }
  const binding = persistOccurrenceBinding(event.clientEventId, resolved);
  if (!binding && !event.occurrenceContextToken) {
    // A bootstrap event has no durable generation of its own. If its first
    // exact-route claim cannot be persisted, remove the shard rather than let
    // a later terminal generation claim the occurrence.
    removePersistedEvent(event.clientEventId);
  }
  return applyOccurrenceBinding(event, binding);
}

function applyOccurrenceBinding(
  event: PosClientTelemetryEvent,
  binding: PosTelemetryOccurrenceBinding | undefined,
): PosClientTelemetryEvent {
  if (event.version !== 2 || !binding) return event;
  if (event.storeId && event.storeId !== binding.storeId) return event;
  return {
    ...event,
    storeId: binding.storeId,
    occurrenceContextToken: binding.occurrenceContextToken,
    terminalIdentityGeneration: binding.terminalIdentityGeneration,
    ...optionalIdentifier(
      "telemetryIdentityEpoch",
      binding.telemetryIdentityEpoch,
    ),
    ...optionalIdentifier(
      "reportedCloudTerminalId",
      binding.reportedCloudTerminalId,
    ),
    ...optionalIdentifier(
      "reportedTerminalFingerprint",
      binding.reportedTerminalFingerprint,
    ),
  };
}

function persistOccurrenceBinding(
  clientEventId: string,
  resolved: PosClientTelemetryV2Event,
): PosTelemetryOccurrenceBinding | undefined {
  const key = `${BUFFER_OCCURRENCE_BINDING_KEY_PREFIX}${clientEventId}`;
  const candidate: PosTelemetryOccurrenceBindingV1 = {
    version: 1,
    storeId: resolved.storeId as string,
    occurrenceContextToken: resolved.occurrenceContextToken as string,
    terminalIdentityGeneration: resolved.terminalIdentityGeneration as string,
    ...optionalIdentifier(
      "telemetryIdentityEpoch",
      resolved.telemetryIdentityEpoch,
    ),
    ...optionalIdentifier(
      "reportedCloudTerminalId",
      resolved.reportedCloudTerminalId,
    ),
    ...optionalIdentifier(
      "reportedTerminalFingerprint",
      resolved.reportedTerminalFingerprint,
    ),
  };
  try {
    const existing = decodeOccurrenceBinding(window.localStorage.getItem(key));
    if (existing) {
      if (
        existing.version === 2 ||
        existing.storeId !== candidate.storeId ||
        existing.occurrenceContextToken !== candidate.occurrenceContextToken ||
        existing.terminalIdentityGeneration !==
          candidate.terminalIdentityGeneration
      ) {
        return existing;
      }
      const extended: PosTelemetryOccurrenceBindingV1 = {
        ...candidate,
        ...existing,
        ...(!existing.telemetryIdentityEpoch
          ? optionalIdentifier(
              "telemetryIdentityEpoch",
              candidate.telemetryIdentityEpoch,
            )
          : {}),
        ...(!existing.reportedCloudTerminalId
          ? optionalIdentifier(
              "reportedCloudTerminalId",
              candidate.reportedCloudTerminalId,
            )
          : {}),
        ...(!existing.reportedTerminalFingerprint
          ? optionalIdentifier(
              "reportedTerminalFingerprint",
              candidate.reportedTerminalFingerprint,
            )
          : {}),
      };
      const serialized = JSON.stringify(extended);
      if (serialized === JSON.stringify(existing)) return existing;
      window.localStorage.setItem(key, serialized);
      return decodeOccurrenceBinding(window.localStorage.getItem(key));
    }
    if (
      memoryRemovedAt.has(clientEventId) ||
      window.localStorage.getItem(
        `${BUFFER_REMOVED_KEY_PREFIX}${clientEventId}`,
      ) !== null
    ) {
      return undefined;
    }
    const serialized = JSON.stringify(candidate);
    window.localStorage.setItem(key, serialized);
    return decodeOccurrenceBinding(window.localStorage.getItem(key));
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
    return undefined;
  }
}

function exactOccurrenceTuple(
  left: PosClientTelemetryV2Event,
  right: PosClientTelemetryV2Event,
): boolean {
  return (
    left.clientEventId === right.clientEventId &&
    left.storeId === right.storeId &&
    left.occurrenceContextToken === right.occurrenceContextToken &&
    left.terminalIdentityGeneration === right.terminalIdentityGeneration &&
    left.telemetryIdentityEpoch === right.telemetryIdentityEpoch &&
    left.reportedCloudTerminalId === right.reportedCloudTerminalId &&
    left.reportedTerminalFingerprint === right.reportedTerminalFingerprint
  );
}

function exactOccurrenceBindingTuple(
  binding: PosTelemetryOccurrenceBindingV1,
  event: PosClientTelemetryV2Event,
): boolean {
  return (
    binding.storeId === event.storeId &&
    binding.occurrenceContextToken === event.occurrenceContextToken &&
    binding.terminalIdentityGeneration === event.terminalIdentityGeneration &&
    binding.telemetryIdentityEpoch === event.telemetryIdentityEpoch &&
    binding.reportedCloudTerminalId === event.reportedCloudTerminalId &&
    binding.reportedTerminalFingerprint === event.reportedTerminalFingerprint
  );
}

function readBoundOccurrence(
  clientEventId: string,
): PosClientTelemetryV2Event | undefined {
  try {
    if (
      memoryRemovedAt.has(clientEventId) ||
      window.localStorage.getItem(
        `${BUFFER_REMOVED_KEY_PREFIX}${clientEventId}`,
      ) !== null
    ) {
      return undefined;
    }
    const event = decodePersistedEvent(
      window.localStorage.getItem(`${BUFFER_EVENT_KEY_PREFIX}${clientEventId}`),
    );
    const binding = decodeOccurrenceBinding(
      window.localStorage.getItem(
        `${BUFFER_OCCURRENCE_BINDING_KEY_PREFIX}${clientEventId}`,
      ),
    );
    if (event?.version !== 2 || binding?.version !== 1) return undefined;
    if (
      (event.storeId !== undefined && event.storeId !== binding.storeId) ||
      (event.occurrenceContextToken !== undefined &&
        event.occurrenceContextToken !== binding.occurrenceContextToken) ||
      (event.terminalIdentityGeneration !== undefined &&
        event.terminalIdentityGeneration !==
          binding.terminalIdentityGeneration) ||
      (event.telemetryIdentityEpoch !== undefined &&
        event.telemetryIdentityEpoch !== binding.telemetryIdentityEpoch) ||
      (event.reportedCloudTerminalId !== undefined &&
        event.reportedCloudTerminalId !== binding.reportedCloudTerminalId) ||
      (event.reportedTerminalFingerprint !== undefined &&
        event.reportedTerminalFingerprint !==
          binding.reportedTerminalFingerprint)
    ) {
      return undefined;
    }
    const bound = applyOccurrenceBinding(event, binding);
    return bound.version === 2 ? bound : undefined;
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
    return undefined;
  }
}

async function upgradeOccurrenceBinding(
  clientEventId: string,
): Promise<boolean> {
  const locked = await withPosTerminalIdentityWriteLock(async () => {
    const resolved = readBoundOccurrence(clientEventId);
    if (!resolved?.storeId) return false;
    const [{ getDefaultPosLocalStore }, { readStoredTerminalFingerprintHash }] =
      await Promise.all([
        import("../local/posLocalStorageRuntime"),
        import("../terminal/fingerprint"),
      ]);
    const seedResult =
      await getDefaultPosLocalStore().readProvisionedTerminalSeed({
        reportFailure: false,
      });
    if (
      !seedResult.ok ||
      !seedResult.value ||
      seedResult.value.storeId !== resolved.storeId ||
      !resolved.telemetryIdentityEpoch ||
      seedResult.value.telemetryIdentityEpoch !==
        resolved.telemetryIdentityEpoch ||
      (resolved.reportedCloudTerminalId !== undefined &&
        seedResult.value.cloudTerminalId !==
          resolved.reportedCloudTerminalId) ||
      (resolved.reportedTerminalFingerprint !== undefined &&
        readStoredTerminalFingerprintHash() !==
          resolved.reportedTerminalFingerprint)
    ) {
      return false;
    }
    const transition = readPosTerminalIdentityTransition({
      forceSharedRead: true,
    });
    if (
      transition.phase !== "changed" ||
      transition.generation !== resolved.terminalIdentityGeneration
    ) {
      return false;
    }
    const reread = readBoundOccurrence(clientEventId);
    if (!reread || !exactOccurrenceTuple(reread, resolved)) return false;
    const key = `${BUFFER_OCCURRENCE_BINDING_KEY_PREFIX}${clientEventId}`;
    const current = decodeOccurrenceBinding(window.localStorage.getItem(key));
    if (
      current?.version !== 1 ||
      !exactOccurrenceBindingTuple(current, resolved)
    )
      return false;
    const witness: PosTelemetryOccurrenceWitness = {
      version: 2,
      clientEventId,
      storeId: resolved.storeId,
      occurrenceContextToken: resolved.occurrenceContextToken as string,
      terminalIdentityGeneration: resolved.terminalIdentityGeneration as string,
      telemetryIdentityEpoch: resolved.telemetryIdentityEpoch,
      transitionRevision: transition.revision,
      transitionStartedAt: transition.startedAt,
      ...optionalIdentifier(
        "reportedCloudTerminalId",
        resolved.reportedCloudTerminalId,
      ),
      ...optionalIdentifier(
        "reportedTerminalFingerprint",
        resolved.reportedTerminalFingerprint,
      ),
    };
    const serialized = JSON.stringify(witness);
    try {
      window.localStorage.setItem(key, serialized);
      if (window.localStorage.getItem(key) !== serialized) {
        incrementPosRuntimeCounter("telemetry.storageFallbackCount");
        return false;
      }
      return true;
    } catch {
      incrementPosRuntimeCounter("telemetry.storageFallbackCount");
      return false;
    }
  });
  return locked.acquired && locked.value;
}

function scheduleOccurrenceWitnessUpgrade(clientEventId: string): boolean {
  if (
    pendingWitnessUpgradeIds.has(clientEventId) ||
    (witnessUpgradeRetryAfter.get(clientEventId) ?? 0) > Date.now()
  ) {
    return false;
  }
  pendingWitnessUpgradeIds.add(clientEventId);
  const upgrade = upgradeOccurrenceBinding(clientEventId)
    .then((upgraded) => {
      if (upgraded) witnessUpgradeRetryAfter.delete(clientEventId);
      else {
        witnessUpgradeRetryAfter.set(
          clientEventId,
          Date.now() + WITNESS_UPGRADE_RETRY_COOLDOWN_MS,
        );
      }
    })
    .catch(() => {
      witnessUpgradeRetryAfter.set(
        clientEventId,
        Date.now() + WITNESS_UPGRADE_RETRY_COOLDOWN_MS,
      );
    });
  pendingWitnessUpgrades.add(upgrade);
  void upgrade.finally(() => {
    pendingWitnessUpgrades.delete(upgrade);
    pendingWitnessUpgradeIds.delete(clientEventId);
  });
  return true;
}

function decodeOccurrenceBinding(
  raw: string | null,
): PosTelemetryOccurrenceBinding | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      (value.version !== 1 && value.version !== 2) ||
      !validId(value.storeId) ||
      !validId(value.occurrenceContextToken) ||
      !validId(value.terminalIdentityGeneration)
    ) {
      return undefined;
    }
    if (value.version === 2) {
      if (
        !validId(value.clientEventId) ||
        !validId(value.telemetryIdentityEpoch) ||
        !isNonNegativeFiniteInteger(value.transitionRevision) ||
        !isNonNegativeFiniteInteger(value.transitionStartedAt)
      ) {
        return undefined;
      }
      return {
        version: 2,
        clientEventId: value.clientEventId,
        storeId: value.storeId,
        occurrenceContextToken: value.occurrenceContextToken,
        terminalIdentityGeneration: value.terminalIdentityGeneration,
        telemetryIdentityEpoch: value.telemetryIdentityEpoch,
        transitionRevision: value.transitionRevision,
        transitionStartedAt: value.transitionStartedAt,
        ...optionalIdentifier(
          "reportedCloudTerminalId",
          value.reportedCloudTerminalId,
        ),
        ...optionalIdentifier(
          "reportedTerminalFingerprint",
          value.reportedTerminalFingerprint,
        ),
      };
    }
    return {
      version: 1,
      storeId: value.storeId,
      occurrenceContextToken: value.occurrenceContextToken,
      terminalIdentityGeneration: value.terminalIdentityGeneration,
      ...optionalIdentifier(
        "telemetryIdentityEpoch",
        value.telemetryIdentityEpoch,
      ),
      ...optionalIdentifier(
        "reportedCloudTerminalId",
        value.reportedCloudTerminalId,
      ),
      ...optionalIdentifier(
        "reportedTerminalFingerprint",
        value.reportedTerminalFingerprint,
      ),
    };
  } catch {
    return undefined;
  }
}

export function readPosTelemetryOccurrenceWitness(
  clientEventId: string,
): PosTelemetryOccurrenceWitness | undefined {
  if (!validId(clientEventId)) return undefined;
  try {
    const binding = decodeOccurrenceBinding(
      window.localStorage.getItem(
        `${BUFFER_OCCURRENCE_BINDING_KEY_PREFIX}${clientEventId}`,
      ),
    );
    return binding?.version === 2 ? { ...binding } : undefined;
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
    return undefined;
  }
}

function removeOccurrenceBinding(clientEventId: string): void {
  const key = `${BUFFER_OCCURRENCE_BINDING_KEY_PREFIX}${clientEventId}`;
  try {
    window.localStorage.removeItem(key);
    if (window.localStorage.getItem(key) !== null) {
      window.localStorage.setItem(key, "");
    }
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
  }
}

function decodeBufferedEvent(
  value: unknown,
): PosClientTelemetryEvent | undefined {
  if (!isRecord(value)) return undefined;
  return value.version === 2 ? decodeV2Event(value) : decodeLegacyEvent(value);
}

function decodeV2Event(
  value: Record<string, unknown>,
): PosClientTelemetryV2Event | undefined {
  if (
    !validId(value.clientEventId) ||
    !isLevel(value.level) ||
    !isFlow(value.flow) ||
    !isPosDiagnosticClassification(value.classification) ||
    !finiteTimestamp(value.occurredAt) ||
    !validSlug(value.orgUrlSlug) ||
    !validSlug(value.storeUrlSlug) ||
    !isPosDiagnosticRouteId(value.routeId) ||
    typeof value.online !== "boolean"
  )
    return undefined;
  if (
    value.operation !== undefined &&
    !isPosDiagnosticOperation(value.operation)
  )
    return undefined;
  const source = isRecord(value.source)
    ? normalizePosDiagnosticSource(value.source)
    : undefined;
  return {
    version: 2,
    clientEventId: value.clientEventId,
    level: value.level,
    flow: value.flow,
    classification: value.classification,
    occurredAt: value.occurredAt,
    orgUrlSlug: value.orgUrlSlug,
    storeUrlSlug: value.storeUrlSlug,
    routeId: value.routeId,
    ...optionalIdentifier(
      "occurrenceContextToken",
      value.occurrenceContextToken,
    ),
    ...optionalIdentifier(
      "terminalIdentityGeneration",
      value.terminalIdentityGeneration,
    ),
    online: value.online,
    ...optionalIdentifier("storeId", value.storeId),
    ...optionalIdentifier(
      "telemetryIdentityEpoch",
      value.telemetryIdentityEpoch,
    ),
    ...optionalIdentifier(
      "reportedCloudTerminalId",
      value.reportedCloudTerminalId,
    ),
    ...optionalIdentifier(
      "reportedTerminalFingerprint",
      value.reportedTerminalFingerprint,
    ),
    ...optionalIdentifier(
      "localRegisterSessionId",
      value.localRegisterSessionId,
    ),
    ...(value.operation ? { operation: value.operation } : {}),
    ...(isPosDiagnosticErrorName(value.errorName)
      ? { errorName: value.errorName }
      : {}),
    ...(source ? { source } : {}),
    ...(normalizePosDiagnosticBuildIdentifier(value.appVersion)
      ? { appVersion: value.appVersion as string }
      : {}),
    ...(normalizePosDiagnosticBuildIdentifier(value.buildSha)
      ? { buildSha: value.buildSha as string }
      : {}),
    metadata: sanitizePosDiagnosticMetadata(value.metadata),
  };
}

function decodeLegacyEvent(
  value: Record<string, unknown>,
): PosClientTelemetryLegacyEvent | undefined {
  if (
    !validId(value.clientEventId) ||
    !isLevel(value.level) ||
    !isFlow(value.flow) ||
    typeof value.message !== "string" ||
    !finiteTimestamp(value.occurredAt) ||
    !isRecord(value.metadata)
  ) {
    return undefined;
  }
  return {
    clientEventId: value.clientEventId,
    level: value.level,
    flow: value.flow,
    message: "legacy_client_event",
    occurredAt: value.occurredAt,
    metadata: {},
  };
}

export function enqueuePosClientEvent(
  input: PosClientTelemetryEventInput,
): void {
  try {
    if (!isPosDiagnosticClassification(input.classification)) return;
    if (input.operation && !isPosDiagnosticOperation(input.operation)) return;
    const context = capturePosTelemetryOccurrenceContext(input.pathname);
    if (!context) return;
    const build = getInitialRuntimeBuildMetadata();
    const errorName = normalizePosDiagnosticErrorName(input.error);
    const source =
      normalizePosDiagnosticSource(input.source ?? {}) ??
      sourceFromPosDiagnosticError(input.error);
    const appVersion = normalizePosDiagnosticBuildIdentifier(
      input.appVersion ?? build.appVersion,
    );
    const buildSha = normalizePosDiagnosticBuildIdentifier(
      input.buildSha ?? build.buildSha,
    );
    const event: PosClientTelemetryV2Event = {
      version: 2,
      clientEventId: mintClientEventId(),
      level: input.level,
      flow: input.flow ?? "other",
      classification: input.classification,
      occurredAt: Date.now(),
      orgUrlSlug: context.orgUrlSlug,
      storeUrlSlug: context.storeUrlSlug,
      routeId: context.routeId,
      ...optionalIdentifier(
        "occurrenceContextToken",
        context.occurrenceContextToken,
      ),
      ...optionalIdentifier(
        "terminalIdentityGeneration",
        context.terminalIdentityGeneration,
      ),
      online:
        typeof navigator === "undefined" ? true : navigator.onLine !== false,
      ...optionalIdentifier("storeId", context.storeId),
      ...optionalIdentifier(
        "telemetryIdentityEpoch",
        context.telemetryIdentityEpoch,
      ),
      ...optionalIdentifier(
        "reportedCloudTerminalId",
        context.reportedCloudTerminalId,
      ),
      ...optionalIdentifier(
        "reportedTerminalFingerprint",
        context.reportedTerminalFingerprint,
      ),
      ...optionalIdentifier(
        "localRegisterSessionId",
        input.localRegisterSessionId,
      ),
      ...(input.operation ? { operation: input.operation } : {}),
      ...(errorName ? { errorName } : {}),
      ...(source ? { source } : {}),
      ...(appVersion ? { appVersion } : {}),
      ...(buildSha ? { buildSha } : {}),
      metadata: sanitizePosDiagnosticMetadata(input.metadata),
    };
    memoryFallback = [...memoryFallback, event];
    persistEvent(event);
    if (event.storeId) {
      persistOccurrenceBinding(event.clientEventId, event);
    }
    readBuffer();
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
  }
}

export function peekPosClientEventBatch(
  maxEvents: number,
): PosClientTelemetryEvent[] {
  return readBuffer().slice(0, Math.max(Math.floor(maxEvents), 0));
}

export function removePosClientEvents(clientEventIds: string[]): void {
  if (clientEventIds.length === 0) return;
  const drained = new Set(clientEventIds);
  memoryFallback = memoryFallback.filter(
    (event) => !drained.has(event.clientEventId),
  );
  for (const clientEventId of drained) removePersistedEvent(clientEventId);
  updateBufferGauges(memoryFallback);
}

export function posClientTelemetryBufferSize(): number {
  return readBuffer().length;
}
export function clearPosClientTelemetryBuffer(): void {
  const ids = readBuffer().map((event) => event.clientEventId);
  memoryFallback = [];
  for (const clientEventId of ids) removePersistedEvent(clientEventId);
  updateBufferGauges([]);
}

function updateBufferGauges(events: PosClientTelemetryEvent[]): void {
  initializePosRuntimeCounter("telemetry.railInitialized");
  setPosRuntimeCounter("telemetry.railInitialized", 1);
  initializePosRuntimeCounter("telemetry.storageFallbackCount");
  initializePosRuntimeCounter("telemetry.uploadFailureCount");
  initializePosRuntimeCounter("telemetry.identityRefreshFailureCount");
  initializePosRuntimeCounter("telemetry.droppedCount");
  setPosRuntimeCounter("telemetry.bufferDepth", events.length);
  setPosRuntimeCounter(
    "telemetry.pendingScopeCount",
    events.filter((event) => event.version === 2 && !event.storeId).length,
  );
  setPosRuntimeCounter(
    "telemetry.legacyQuarantineCount",
    events.filter((event) => event.version !== 2).length,
  );
}

function optionalIdentifier<K extends string>(key: K, value: unknown) {
  const normalized = normalizePosDiagnosticIdentifier(value);
  return normalized ? ({ [key]: normalized } as Record<K, string>) : {};
}
function validId(value: unknown): value is string {
  return normalizePosDiagnosticIdentifier(value) !== undefined;
}
function validSlug(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(value);
}
function finiteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function isNonNegativeFiniteInteger(value: unknown): value is number {
  return finiteTimestamp(value) && Number.isInteger(value);
}
const isLevel = isPosClientEventLevel;
const isFlow = isPosClientEventFlow;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
