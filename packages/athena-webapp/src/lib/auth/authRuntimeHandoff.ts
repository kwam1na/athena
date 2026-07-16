import type { TokenStorage } from "@convex-dev/auth/react";

export const AUTH_RUNTIME_HANDOFF_JOURNAL_KEY = "athena.authRuntimeHandoff.v1";
const OWNER_TOKEN_KEY = "athena.authRuntimeHandoff.owner.v1";
const MANIFEST_PREFIX = "athena.authRuntimeHandoff.keys.v1.";
const JOURNAL_VERSION = 1;
const DEFAULT_LEASE_MS = 30_000;

type HandoffPhase =
  "idle" | "prepared" | "auth_issued" | "activated" | "promoted";
type BlockReason = "corrupt_journal" | "foreign_owner" | "stale_handoff";

type HandoffJournal = {
  version: 1;
  revision: number;
  activeNamespace: string | null;
  previousActiveNamespace: string | null;
  pendingNamespace: string | null;
  phase: HandoffPhase;
  correlationKey: string | null;
  ownerToken: string | null;
  leaseExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type AuthRuntimeHandoffHandle = Readonly<{
  correlationKey: string;
  ownerToken: string;
  pendingNamespace: string;
}>;

export type AuthRuntimeHandoffSnapshot = Readonly<{
  activeNamespace: string | null;
  blockReason: BlockReason | null;
  handoffPhase: HandoffPhase | "unknown";
  pendingNamespace: string | null;
  providerRemountKey: string;
  status: "ready" | "blocked";
}>;

export type AuthRuntimeHandoffCoordinator = ReturnType<
  typeof createAuthRuntimeHandoffCoordinator
>;

type CoordinatorOptions = {
  storage: Storage;
  ownerToken: string;
  now?: () => number;
  randomId?: () => string;
};

export function createAuthRuntimeHandoffCoordinator({
  storage,
  ownerToken,
  now = () => Date.now(),
  randomId = defaultRandomId,
}: CoordinatorOptions) {
  const listeners = new Set<() => void>();
  const tokenStorages = new Map<string, TokenStorage>();
  let snapshot = readSnapshot();

  function readJournal(): HandoffJournal | null | "corrupt" {
    const encoded = storage.getItem(AUTH_RUNTIME_HANDOFF_JOURNAL_KEY);
    if (encoded === null) return null;
    try {
      const value: unknown = JSON.parse(encoded);
      return isJournal(value) ? value : "corrupt";
    } catch {
      return "corrupt";
    }
  }

  function readSnapshot(): AuthRuntimeHandoffSnapshot {
    const journal = readJournal();
    if (journal === "corrupt") return blocked("corrupt_journal");
    if (journal === null) return ready(null, "idle", null);
    if (journal.phase !== "idle") {
      if ((journal.leaseExpiresAt ?? 0) <= now()) {
        return blocked("stale_handoff");
      }
      if (journal.ownerToken !== ownerToken) return blocked("foreign_owner");
    }
    return ready(
      journal.activeNamespace,
      journal.phase,
      journal.pendingNamespace,
    );
  }

  function blocked(blockReason: BlockReason): AuthRuntimeHandoffSnapshot {
    return Object.freeze({
      activeNamespace: null,
      blockReason,
      handoffPhase: "unknown",
      pendingNamespace: null,
      providerRemountKey: "auth:blocked",
      status: "blocked",
    });
  }

  function ready(
    activeNamespace: string | null,
    handoffPhase: HandoffPhase,
    pendingNamespace: string | null,
  ): AuthRuntimeHandoffSnapshot {
    return Object.freeze({
      activeNamespace,
      blockReason: null,
      handoffPhase,
      pendingNamespace,
      providerRemountKey: `auth:${activeNamespace ?? "default"}`,
      status: "ready",
    });
  }

  function emit() {
    snapshot = readSnapshot();
    for (const listener of listeners) listener();
  }

  function writeJournal(journal: HandoffJournal) {
    storage.setItem(AUTH_RUNTIME_HANDOFF_JOURNAL_KEY, JSON.stringify(journal));
    emit();
  }

  function requireJournal(handle: AuthRuntimeHandoffHandle) {
    const journal = readJournal();
    if (journal === null || journal === "corrupt")
      throw handoffError("handoff_unavailable");
    if (
      journal.ownerToken !== handle.ownerToken ||
      journal.ownerToken !== ownerToken ||
      journal.pendingNamespace !== handle.pendingNamespace ||
      journal.correlationKey !== handle.correlationKey
    ) {
      throw handoffError("handoff_owner_mismatch");
    }
    if ((journal.leaseExpiresAt ?? 0) <= now())
      throw handoffError("handoff_lease_expired");
    return journal;
  }

  function transition(
    handle: AuthRuntimeHandoffHandle,
    expected: HandoffPhase,
    next: HandoffPhase,
    patch: Partial<HandoffJournal> = {},
  ) {
    const journal = requireJournal(handle);
    if (journal.phase !== expected)
      throw handoffError("invalid_handoff_transition");
    writeJournal({
      ...journal,
      ...patch,
      phase: next,
      revision: journal.revision + 1,
      updatedAt: now(),
    });
  }

  function prepareHandoff(options: { leaseDurationMs?: number } = {}) {
    const current = readJournal();
    if (current === "corrupt") throw handoffError("handoff_unavailable");
    if (current !== null && current.phase !== "idle") {
      throw handoffError("handoff_in_progress");
    }
    const timestamp = now();
    const pendingNamespace = `athena-auth-${randomId()}`;
    const correlationKey = randomId();
    const handle = Object.freeze({
      correlationKey,
      ownerToken,
      pendingNamespace,
    });
    writeJournal({
      version: JOURNAL_VERSION,
      revision: (current?.revision ?? 0) + 1,
      activeNamespace: current?.activeNamespace ?? null,
      previousActiveNamespace: current?.activeNamespace ?? null,
      pendingNamespace,
      phase: "prepared",
      correlationKey,
      ownerToken,
      leaseExpiresAt: timestamp + (options.leaseDurationMs ?? DEFAULT_LEASE_MS),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return handle;
  }

  function takeOverStaleHandoff(options: { leaseDurationMs?: number } = {}) {
    const journal = readJournal();
    if (
      journal === null ||
      journal === "corrupt" ||
      journal.phase === "idle" ||
      (journal.leaseExpiresAt ?? 0) > now() ||
      !journal.pendingNamespace ||
      !journal.correlationKey
    ) {
      throw handoffError("handoff_not_stale");
    }
    const handle = Object.freeze({
      correlationKey: journal.correlationKey,
      ownerToken,
      pendingNamespace: journal.pendingNamespace,
    });
    writeJournal({
      ...journal,
      ownerToken,
      leaseExpiresAt: now() + (options.leaseDurationMs ?? DEFAULT_LEASE_MS),
      revision: journal.revision + 1,
      updatedAt: now(),
    });
    return handle;
  }

  function renewLease(
    handle: AuthRuntimeHandoffHandle,
    options: { leaseDurationMs?: number } = {},
  ) {
    const journal = requireJournal(handle);
    writeJournal({
      ...journal,
      leaseExpiresAt: now() + (options.leaseDurationMs ?? DEFAULT_LEASE_MS),
      revision: journal.revision + 1,
      updatedAt: now(),
    });
  }

  function completeVerifiedPromotion(handle: AuthRuntimeHandoffHandle) {
    const journal = requireJournal(handle);
    if (journal.phase !== "promoted")
      throw handoffError("invalid_handoff_transition");
    clearTrackedNamespace(journal.previousActiveNamespace);
    writeJournal({
      ...journal,
      previousActiveNamespace: null,
      pendingNamespace: null,
      phase: "idle",
      correlationKey: null,
      ownerToken: null,
      leaseExpiresAt: null,
      revision: journal.revision + 1,
      updatedAt: now(),
    });
  }

  function clearAfterConfirmedAbort(handle: AuthRuntimeHandoffHandle) {
    const journal = requireJournal(handle);
    if (journal.phase === "activated" || journal.phase === "promoted") {
      throw handoffError("invalid_handoff_transition");
    }
    clearTrackedNamespace(journal.pendingNamespace);
    writeJournal({
      ...journal,
      previousActiveNamespace: null,
      pendingNamespace: null,
      phase: "idle",
      correlationKey: null,
      ownerToken: null,
      leaseExpiresAt: null,
      revision: journal.revision + 1,
      updatedAt: now(),
    });
  }

  function getTokenStorage(namespace: string | null): TokenStorage {
    const label = namespace ?? "default";
    const cached = tokenStorages.get(label);
    if (cached) return cached;
    const manifestKey = `${MANIFEST_PREFIX}${label}`;
    const tracked: TokenStorage = {
      getItem(key) {
        trackKey(manifestKey, key);
        return storage.getItem(key);
      },
      setItem(key, value) {
        trackKey(manifestKey, key);
        storage.setItem(key, value);
      },
      removeItem(key) {
        storage.removeItem(key);
      },
    };
    tokenStorages.set(label, tracked);
    return tracked;
  }

  function getPendingTokenStorage(handle: AuthRuntimeHandoffHandle) {
    requireJournal(handle);
    return getTokenStorage(handle.pendingNamespace);
  }

  function trackKey(manifestKey: string, key: string) {
    const keys = readManifest(manifestKey);
    if (!keys.includes(key))
      storage.setItem(manifestKey, JSON.stringify([...keys, key]));
  }

  function readManifest(manifestKey: string): string[] {
    try {
      const value: unknown = JSON.parse(storage.getItem(manifestKey) ?? "[]");
      return Array.isArray(value) &&
        value.every((item) => typeof item === "string")
        ? value
        : [];
    } catch {
      return [];
    }
  }

  function clearTrackedNamespace(namespace: string | null) {
    const manifestKey = `${MANIFEST_PREFIX}${namespace ?? "default"}`;
    for (const key of readManifest(manifestKey)) storage.removeItem(key);
    storage.removeItem(manifestKey);
    tokenStorages.delete(namespace ?? "default");
  }

  return {
    clearAfterConfirmedAbort,
    completeVerifiedPromotion,
    getPendingTokenStorage,
    getSnapshot: () => snapshot,
    getTokenStorage,
    markActivated: (handle: AuthRuntimeHandoffHandle) =>
      transition(handle, "auth_issued", "activated"),
    markAuthIssued: (handle: AuthRuntimeHandoffHandle) =>
      transition(handle, "prepared", "auth_issued"),
    prepareHandoff,
    promoteActivated: (handle: AuthRuntimeHandoffHandle) =>
      transition(handle, "activated", "promoted", {
        activeNamespace: handle.pendingNamespace,
      }),
    refresh: emit,
    renewLease,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    takeOverStaleHandoff,
  };
}

let defaultCoordinator: AuthRuntimeHandoffCoordinator | null = null;

export function getDefaultAuthRuntimeHandoffCoordinator() {
  if (defaultCoordinator) return defaultCoordinator;
  if (typeof window === "undefined") throw handoffError("storage_unavailable");
  const ownerToken = getOrCreateOwnerToken(window.sessionStorage);
  defaultCoordinator = createAuthRuntimeHandoffCoordinator({
    ownerToken,
    storage: window.localStorage,
  });
  window.addEventListener("storage", (event) => {
    if (event.key === AUTH_RUNTIME_HANDOFF_JOURNAL_KEY)
      defaultCoordinator?.refresh();
  });
  return defaultCoordinator;
}

function getOrCreateOwnerToken(storage: Storage) {
  const existing = storage.getItem(OWNER_TOKEN_KEY);
  if (existing) return existing;
  const ownerToken = defaultRandomId();
  storage.setItem(OWNER_TOKEN_KEY, ownerToken);
  return ownerToken;
}

function defaultRandomId() {
  return globalThis.crypto.randomUUID();
}

function handoffError(code: string) {
  return new Error(code);
}

function isJournal(value: unknown): value is HandoffJournal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const journal = value as Record<string, unknown>;
  const allowed = new Set([
    "version",
    "revision",
    "activeNamespace",
    "previousActiveNamespace",
    "pendingNamespace",
    "phase",
    "correlationKey",
    "ownerToken",
    "leaseExpiresAt",
    "createdAt",
    "updatedAt",
  ]);
  if (Object.keys(journal).some((key) => !allowed.has(key))) return false;
  if (
    journal.version !== JOURNAL_VERSION ||
    !isPositiveInteger(journal.revision) ||
    !isNullableString(journal.activeNamespace) ||
    !isNullableString(journal.previousActiveNamespace) ||
    !isNullableString(journal.pendingNamespace) ||
    !["idle", "prepared", "auth_issued", "activated", "promoted"].includes(
      String(journal.phase),
    ) ||
    !isNullableString(journal.correlationKey) ||
    !isNullableString(journal.ownerToken) ||
    !(
      journal.leaseExpiresAt === null ||
      typeof journal.leaseExpiresAt === "number"
    ) ||
    typeof journal.createdAt !== "number" ||
    typeof journal.updatedAt !== "number"
  )
    return false;
  if (journal.phase === "idle") {
    return (
      journal.previousActiveNamespace === null &&
      journal.pendingNamespace === null &&
      journal.correlationKey === null &&
      journal.ownerToken === null &&
      journal.leaseExpiresAt === null
    );
  }
  const hasHandoffFields = Boolean(
    journal.pendingNamespace &&
      journal.correlationKey &&
      journal.ownerToken &&
      typeof journal.leaseExpiresAt === "number",
  );
  if (!hasHandoffFields) return false;
  return journal.phase === "promoted"
    ? journal.activeNamespace === journal.pendingNamespace
    : journal.activeNamespace === journal.previousActiveNamespace;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length >= 8);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
