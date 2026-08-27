import { useCallback, useEffect, useRef } from "react";
import { useMutation } from "convex/react";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { setPosErrorTelemetrySink } from "@/lib/pos/application/errorTelemetry";
import { getDefaultPosLocalStore } from "@/lib/pos/infrastructure/local/posLocalStorageRuntime";
import { readStoredTerminalFingerprintHash } from "@/lib/pos/infrastructure/terminal/fingerprint";
import {
  isPosClientEventFlow,
  isPosDiagnosticOperation,
} from "~/shared/posDiagnosticRedaction";
import {
  enqueuePosClientEvent,
  peekPosClientEventBatch,
  readPosTelemetryOccurrenceWitness,
  removePosClientEvents,
  type PosClientTelemetryV2Event,
  type PosTelemetryOccurrenceWitness,
} from "./telemetryBuffer";
import {
  incrementPosRuntimeCounter,
  setPosRuntimeCounter,
} from "./runtimeCounters";
import {
  POS_TERMINAL_IDENTITY_REFRESH_REQUEST_EVENT,
  readPosTerminalIdentityTransition,
} from "./telemetryContext";

const DRAIN_INTERVAL_MS = 30_000;
const DRAIN_BATCH_SIZE = 50;
const FAILURE_BACKOFF_MS = 120_000;
const BUFFER_SCAN_SIZE = 200;
export const POS_CLIENT_TELEMETRY_BACKOFF_STORAGE_KEY =
  "athena-pos-client-telemetry-backoff-v1";
const POS_CLIENT_TELEMETRY_SCOPE_BACKOFF_STORAGE_PREFIX = `${POS_CLIENT_TELEMETRY_BACKOFF_STORAGE_KEY}:scope:`;
let memoryScopeBackoff = new Map<string, number>();

export function resetPosClientTelemetryBackoffForTests(): void {
  memoryScopeBackoff = new Map();
}

type ScopedBatch = {
  scopeKey: string;
  events: PosClientTelemetryV2Event[];
};

export function selectOldestEligiblePosTelemetryScope(input: {
  events: ReturnType<typeof peekPosClientEventBatch>;
  backoffByScope: ReadonlyMap<string, number>;
  now: number;
}): ScopedBatch | undefined {
  const eligibleV2 = input.events.filter(
    (event): event is PosClientTelemetryV2Event =>
      event.version === 2 && typeof event.storeId === "string",
  );
  const orderedScopeKeys: string[] = [];
  for (const event of eligibleV2) {
    const scopeKey = getScopeKey(event);
    if (!orderedScopeKeys.includes(scopeKey)) orderedScopeKeys.push(scopeKey);
  }
  const scopeKey = orderedScopeKeys.find(
    (key) => (input.backoffByScope.get(key) ?? 0) <= input.now,
  );
  if (!scopeKey) return undefined;
  return {
    scopeKey,
    events: eligibleV2
      .filter((event) => getScopeKey(event) === scopeKey)
      .slice(0, DRAIN_BATCH_SIZE),
  };
}

function getScopeKey(event: PosClientTelemetryV2Event): string {
  return [
    event.storeId,
    event.reportedCloudTerminalId ?? "none",
    event.reportedTerminalFingerprint ?? "none",
    event.terminalIdentityGeneration ?? "none",
    event.telemetryIdentityEpoch ?? "none",
  ].join("|");
}

function hasExactPosTelemetryOccurrenceWitness(
  event: PosClientTelemetryV2Event,
  witness: PosTelemetryOccurrenceWitness | undefined,
): boolean {
  return (
    witness?.version === 2 &&
    typeof witness.telemetryIdentityEpoch === "string" &&
    typeof event.telemetryIdentityEpoch === "string" &&
    witness.clientEventId === event.clientEventId &&
    witness.storeId === event.storeId &&
    witness.occurrenceContextToken === event.occurrenceContextToken &&
    witness.terminalIdentityGeneration === event.terminalIdentityGeneration &&
    witness.telemetryIdentityEpoch === event.telemetryIdentityEpoch &&
    witness.reportedCloudTerminalId === event.reportedCloudTerminalId &&
    witness.reportedTerminalFingerprint === event.reportedTerminalFingerprint &&
    Number.isInteger(witness.transitionRevision) &&
    witness.transitionRevision >= 0 &&
    Number.isFinite(witness.transitionStartedAt) &&
    witness.transitionStartedAt >= 0
  );
}

function hasExactPosTelemetryOccurrenceWitnesses(
  events: readonly PosClientTelemetryV2Event[],
): boolean {
  return events.every((event) =>
    hasExactPosTelemetryOccurrenceWitness(
      event,
      readPosTelemetryOccurrenceWitness(event.clientEventId),
    ),
  );
}

export function isPosTelemetryBatchIdentityCurrent(input: {
  event: PosClientTelemetryV2Event;
  fingerprint: string | null;
  seed: {
    cloudTerminalId: string;
    storeId: string;
    telemetryIdentityEpoch?: string;
  } | null;
  transition: ReturnType<typeof readPosTerminalIdentityTransition>;
  witness?: PosTelemetryOccurrenceWitness;
}): boolean {
  const { event, fingerprint, seed, transition, witness } = input;
  if (!event.terminalIdentityGeneration) return false;

  // A completed older generation carries an immutable, one-way occurrence
  // binding. Current seed authority must not relabel or suppress that
  // historical evidence after reprovisioning.
  if (event.terminalIdentityGeneration !== transition.generation) {
    return hasExactPosTelemetryOccurrenceWitness(event, witness);
  }

  if (transition.phase !== "changed") return false;
  if (event.telemetryIdentityEpoch !== seed?.telemetryIdentityEpoch) {
    return false;
  }
  if (
    event.reportedCloudTerminalId &&
    (!seed ||
      seed.storeId !== event.storeId ||
      event.reportedCloudTerminalId !== seed.cloudTerminalId)
  ) {
    return false;
  }
  if (
    event.reportedTerminalFingerprint &&
    event.reportedTerminalFingerprint !== fingerprint
  ) {
    return false;
  }
  return true;
}

/** Drains at most one occurrence-time scope per wakeup. */
export function usePosClientTelemetryDrain(input?: {
  identityReady?: boolean;
}): void {
  const identityReady = input?.identityReady ?? true;
  const recordClientEvents = useMutation(
    api.pos.public.telemetry.recordClientEvents,
  );
  const backoffByScopeRef = useRef(readScopeBackoff());
  const drainInFlightRef = useRef(false);

  const drain = useCallback(async () => {
    if (!identityReady) return;
    if (drainInFlightRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    backoffByScopeRef.current = mergeScopeBackoff(
      backoffByScopeRef.current,
      readScopeBackoff(),
    );
    const batch = selectOldestEligiblePosTelemetryScope({
      events: peekPosClientEventBatch(BUFFER_SCAN_SIZE),
      backoffByScope: backoffByScopeRef.current,
      now: Date.now(),
    });
    if (!batch || batch.events.length === 0) return;

    drainInFlightRef.current = true;
    try {
      const [first] = batch.events;
      const seedResult =
        await getDefaultPosLocalStore().readProvisionedTerminalSeed({
          reportFailure: false,
        });
      let identityCurrent: boolean;
      if (!seedResult.ok) {
        incrementPosRuntimeCounter("telemetry.identityRefreshFailureCount");
        setPosRuntimeCounter(
          "telemetry.lastIdentityRefreshFailureAt",
          Date.now(),
        );
        // The occurrence binding is immutable and server validation still
        // verifies its store/terminal ownership. A failed authority read is
        // degradation evidence, not proof that the recorded occurrence was
        // relabeled; otherwise the IndexedDB failure cannot report itself.
        identityCurrent = hasExactPosTelemetryOccurrenceWitnesses(batch.events);
      } else {
        const transition = readPosTerminalIdentityTransition({
          forceSharedRead: true,
        });
        identityCurrent =
          first.terminalIdentityGeneration !== transition.generation
            ? hasExactPosTelemetryOccurrenceWitnesses(batch.events)
            : isPosTelemetryBatchIdentityCurrent({
                event: first,
                fingerprint: readStoredTerminalFingerprintHash(),
                seed: seedResult.value,
                transition,
              });
      }
      if (!identityCurrent) {
        deferScope(batch.scopeKey, backoffByScopeRef.current);
        window.dispatchEvent(
          new Event(POS_TERMINAL_IDENTITY_REFRESH_REQUEST_EVENT),
        );
        return;
      }
      const result = await recordClientEvents({
        storeId: first.storeId as Id<"store">,
        terminalId: first.reportedCloudTerminalId as
          Id<"posTerminal"> | undefined,
        terminalFingerprint: first.reportedTerminalFingerprint,
        events: batch.events.map((event) => ({
          version: 2 as const,
          clientEventId: event.clientEventId,
          level: event.level,
          flow: event.flow,
          classification: event.classification,
          occurredAt: event.occurredAt,
          routeId: event.routeId,
          online: event.online,
          localRegisterSessionId: event.localRegisterSessionId,
          operation: event.operation,
          errorName: event.errorName,
          source: event.source,
          appVersion: event.appVersion,
          buildSha: event.buildSha,
          metadata: event.metadata,
        })),
      });
      const acknowledged =
        result.kind === "ok" &&
        result.data.accepted + result.data.duplicates === batch.events.length;
      if (acknowledged) {
        removePosClientEvents(batch.events.map((event) => event.clientEventId));
        clearScopeBackoff(batch.scopeKey, backoffByScopeRef.current);
        setPosRuntimeCounter("telemetry.lastAcceptedAt", Date.now());
      } else {
        markScopeFailure(batch.scopeKey, backoffByScopeRef.current);
      }
    } catch {
      markScopeFailure(batch.scopeKey, backoffByScopeRef.current);
    } finally {
      drainInFlightRef.current = false;
    }
  }, [identityReady, recordClientEvents]);

  useEffect(() => {
    setPosErrorTelemetrySink((report) => {
      const flow = isPosClientEventFlow(report.flow) ? report.flow : "checkout";
      enqueuePosClientEvent({
        level: "error",
        flow,
        classification: report.classification ?? "unexpected_application_error",
        ...(report.operation && isPosDiagnosticOperation(report.operation)
          ? { operation: report.operation }
          : {}),
        error: report.error,
        metadata: report.metadata,
        localRegisterSessionId: report.localRegisterSessionId,
      });
    });
    return () => setPosErrorTelemetrySink(null);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => void drain(), DRAIN_INTERVAL_MS);
    const handleOnline = () => void drain();
    window.addEventListener("online", handleOnline);
    void drain();
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
    };
  }, [drain]);
}

function deferScope(scopeKey: string, backoff: Map<string, number>) {
  const deadline = Date.now() + FAILURE_BACKOFF_MS;
  backoff.set(scopeKey, deadline);
  persistScopeBackoff(scopeKey, deadline);
}

function markScopeFailure(scopeKey: string, backoff: Map<string, number>) {
  const now = Date.now();
  const deadline = now + FAILURE_BACKOFF_MS;
  backoff.set(scopeKey, deadline);
  persistScopeBackoff(scopeKey, deadline);
  incrementPosRuntimeCounter("telemetry.uploadFailureCount");
  setPosRuntimeCounter("telemetry.lastFailureAt", now);
}

function readScopeBackoff(): Map<string, number> {
  const merged = pruneScopeBackoff(memoryScopeBackoff);
  try {
    const now = Date.now();
    const storageKeys = Array.from(
      { length: window.localStorage.length },
      (_, index) => window.localStorage.key(index),
    );
    for (const key of storageKeys) {
      if (!key?.startsWith(POS_CLIENT_TELEMETRY_SCOPE_BACKOFF_STORAGE_PREFIX)) {
        continue;
      }
      try {
        const value: unknown = JSON.parse(
          window.localStorage.getItem(key) ?? "null",
        );
        if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          typeof (value as { scope?: unknown }).scope === "string" &&
          typeof (value as { deadline?: unknown }).deadline === "number" &&
          Number.isFinite((value as { deadline: number }).deadline) &&
          (value as { deadline: number }).deadline > now
        ) {
          const scope = (value as { scope: string }).scope.slice(0, 700);
          const deadline = (value as { deadline: number }).deadline;
          merged.set(scope, Math.max(merged.get(scope) ?? 0, deadline));
          continue;
        }
        removeScopeBackoffStorageKey(key);
      } catch {
        removeScopeBackoffStorageKey(key);
      }
    }
    return pruneScopeBackoff(merged);
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
    return merged;
  }
}

function removeScopeBackoffStorageKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
    if (window.localStorage.getItem(key) !== null) {
      incrementPosRuntimeCounter("telemetry.storageFallbackCount");
    }
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
  }
}

function scopeBackoffStorageKey(scopeKey: string): string {
  return `${POS_CLIENT_TELEMETRY_SCOPE_BACKOFF_STORAGE_PREFIX}${encodeURIComponent(scopeKey.slice(0, 700))}`;
}

function persistScopeBackoff(scopeKey: string, deadline: number): void {
  memoryScopeBackoff.set(scopeKey, deadline);
  try {
    window.localStorage.setItem(
      scopeBackoffStorageKey(scopeKey),
      JSON.stringify({ scope: scopeKey.slice(0, 700), deadline }),
    );
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
  }
}

function clearScopeBackoff(
  scopeKey: string,
  backoff: Map<string, number>,
): void {
  backoff.delete(scopeKey);
  memoryScopeBackoff.delete(scopeKey);
  try {
    window.localStorage.removeItem(scopeBackoffStorageKey(scopeKey));
  } catch {
    incrementPosRuntimeCounter("telemetry.storageFallbackCount");
  }
}

function pruneScopeBackoff(
  backoff: ReadonlyMap<string, number>,
): Map<string, number> {
  const now = Date.now();
  return new Map(
    [...backoff]
      .filter(([, deadline]) => Number.isFinite(deadline) && deadline > now)
      .slice(0, 200),
  );
}

function mergeScopeBackoff(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): Map<string, number> {
  const merged = new Map(left);
  for (const [scope, deadline] of right) {
    merged.set(scope, Math.max(merged.get(scope) ?? 0, deadline));
  }
  return merged;
}
