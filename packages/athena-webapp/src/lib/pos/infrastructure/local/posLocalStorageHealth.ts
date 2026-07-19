import { incrementPosRuntimeCounter } from "@/lib/pos/infrastructure/telemetry/runtimeCounters";

export type PosLocalStoragePersistence =
  "granted" | "denied" | "unsupported" | "unknown";

export type PosLocalStoragePressure =
  "normal" | "warning" | "critical" | "unknown";

export type PosLocalStorageEngineReadiness =
  "ready" | "unavailable" | "unknown";
export type PosLocalStorageMigrationState =
  "idle" | "running" | "failed" | "unknown";
export type PosLocalStorageMaintenanceState =
  "idle" | "active" | "blocked" | "unknown";
export type PosLocalStorageHealthFreshness = "fresh" | "stale" | "unknown";

export const POS_LOCAL_STORAGE_HEALTH_STALE_AFTER_MS = 2 * 60_000;
export const POS_LOCAL_LEDGER_WARNING_EVENT_COUNT = 10_000;
export const POS_LOCAL_LEDGER_CRITICAL_EVENT_COUNT = 50_000;
export const POS_LOCAL_LEDGER_WARNING_AGE_MS = 30 * 24 * 60 * 60_000;
export const POS_LOCAL_LEDGER_CRITICAL_AGE_MS = 90 * 24 * 60 * 60_000;

export type PosLocalStorageHealth = {
  engineReadiness: PosLocalStorageEngineReadiness;
  ledgerPressure: PosLocalStoragePressure;
  maintenance: PosLocalStorageMaintenanceState;
  migration: PosLocalStorageMigrationState;
  observedAt: number;
  persistence: PosLocalStoragePersistence;
  pressure: PosLocalStoragePressure;
  lastSuccessfulDurableCommitAt?: number;
  quotaBytes?: number;
  usageBytes?: number;
};

type BrowserStorageManager = {
  estimate?: () => Promise<StorageEstimate>;
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
};

function classifyPressure(
  usage: number,
  quota: number,
): PosLocalStoragePressure {
  if (
    !Number.isFinite(usage) ||
    !Number.isFinite(quota) ||
    usage < 0 ||
    quota <= 0
  ) {
    return "unknown";
  }
  const ratio = usage / quota;
  if (ratio >= 0.95) return "critical";
  if (ratio >= 0.8) return "warning";
  return "normal";
}

/** Classifies only bounded ledger metadata; event payloads never enter health diagnostics. */
export function classifyPosLocalLedgerPressure(input: {
  eventCount: number;
  now?: number;
  oldestEventAt?: number;
}): PosLocalStoragePressure {
  if (!Number.isSafeInteger(input.eventCount) || input.eventCount < 0) {
    return "unknown";
  }
  const now = input.now ?? Date.now();
  const age =
    input.oldestEventAt === undefined
      ? 0
      : Math.max(0, now - input.oldestEventAt);
  if (!Number.isFinite(age)) return "unknown";
  if (
    input.eventCount >= POS_LOCAL_LEDGER_CRITICAL_EVENT_COUNT ||
    age >= POS_LOCAL_LEDGER_CRITICAL_AGE_MS
  ) {
    return "critical";
  }
  if (
    input.eventCount >= POS_LOCAL_LEDGER_WARNING_EVENT_COUNT ||
    age >= POS_LOCAL_LEDGER_WARNING_AGE_MS
  ) {
    return "warning";
  }
  return "normal";
}

export async function observePosLocalStorageHealth(options: {
  clock?: () => number;
  storage: BrowserStorageManager | undefined;
}): Promise<PosLocalStorageHealth> {
  const base = unknownEngineHealth(options.clock?.() ?? Date.now());
  if (!options.storage) {
    return { ...base, persistence: "unsupported" };
  }
  if (!options.storage.estimate || !options.storage.persisted) {
    return { ...base, persistence: "unsupported" };
  }

  let persistence: PosLocalStoragePersistence = "unknown";
  let estimate: StorageEstimate | undefined;
  try {
    const [persisted, observedEstimate] = await Promise.all([
      options.storage.persisted(),
      options.storage.estimate(),
    ]);
    persistence = persisted ? "granted" : "denied";
    estimate = observedEstimate;
  } catch {
    incrementPosRuntimeCounter("storageHealth.probeFailed");
    return base;
  }

  const usage = estimate.usage;
  const quota = estimate.quota;
  const pressure = classifyPressure(usage ?? Number.NaN, quota ?? Number.NaN);
  if (pressure === "unknown") return { ...base, persistence };
  return {
    ...base,
    persistence,
    pressure,
    quotaBytes: quota,
    usageBytes: usage,
  };
}

export type SafePosLocalStorageHealthDiagnostic = PosLocalStorageHealth & {
  freshness: PosLocalStorageHealthFreshness;
};

export function toSafePosLocalStorageHealthDiagnostic(
  health: PosLocalStorageHealth,
  now = Date.now(),
): SafePosLocalStorageHealthDiagnostic {
  const observedAt = safeTimestamp(health.observedAt) ?? 0;
  return {
    engineReadiness: allowValue(
      health.engineReadiness,
      ["ready", "unavailable", "unknown"] as const,
      "unknown",
    ),
    freshness: storageHealthFreshness(observedAt, now),
    ledgerPressure: allowValue(
      health.ledgerPressure,
      ["normal", "warning", "critical", "unknown"] as const,
      "unknown",
    ),
    maintenance: allowValue(
      health.maintenance,
      ["idle", "active", "blocked", "unknown"] as const,
      "unknown",
    ),
    migration: allowValue(
      health.migration,
      ["idle", "running", "failed", "unknown"] as const,
      "unknown",
    ),
    observedAt,
    persistence: allowValue(
      health.persistence,
      ["granted", "denied", "unsupported", "unknown"] as const,
      "unknown",
    ),
    pressure: allowValue(
      health.pressure,
      ["normal", "warning", "critical", "unknown"] as const,
      "unknown",
    ),
    ...(safeTimestamp(health.lastSuccessfulDurableCommitAt) !== undefined
      ? {
          lastSuccessfulDurableCommitAt: safeTimestamp(
            health.lastSuccessfulDurableCommitAt,
          ),
        }
      : {}),
    ...(safeCapacity(health.quotaBytes) !== undefined
      ? { quotaBytes: safeCapacity(health.quotaBytes) }
      : {}),
    ...(safeCapacity(health.usageBytes) !== undefined
      ? { usageBytes: safeCapacity(health.usageBytes) }
      : {}),
  };
}

function unknownEngineHealth(observedAt: number): PosLocalStorageHealth {
  return {
    engineReadiness: "unknown",
    ledgerPressure: "unknown",
    maintenance: "unknown",
    migration: "unknown",
    observedAt,
    persistence: "unknown",
    pressure: "unknown",
  };
}

function storageHealthFreshness(
  observedAt: number,
  now: number,
): PosLocalStorageHealthFreshness {
  if (!observedAt || !Number.isFinite(now)) return "unknown";
  return Math.max(0, now - observedAt) <=
    POS_LOCAL_STORAGE_HEALTH_STALE_AFTER_MS
    ? "fresh"
    : "stale";
}

function allowValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && allowed.includes(value)
    ? (value as T[number])
    : fallback;
}

function safeTimestamp(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function safeCapacity(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

export async function requestPosLocalPersistentStorage(options: {
  storage: BrowserStorageManager | undefined;
}): Promise<PosLocalStoragePersistence> {
  if (!options.storage?.persist) return "unsupported";
  try {
    return (await options.storage.persist()) ? "granted" : "denied";
  } catch {
    return "unknown";
  }
}
