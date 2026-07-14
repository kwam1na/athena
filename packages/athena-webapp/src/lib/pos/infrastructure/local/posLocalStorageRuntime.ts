import {
  clearCurrentPosLocalStorageEngine,
  getCurrentPosLocalStorageEngineLifecycleHealth,
  openCurrentPosLocalStorageEngine,
  runCurrentPosLocalStorageEngineOperation,
} from "./indexedDbPosLocalStorageEngine";
import type { PosLocalStorePort } from "@/lib/pos/application/posLocalStorePort";
import type { PosLocalStoreResult } from "@/lib/pos/application/posLocalStoreTypes";
import type { PosLocalStoreErrorCode } from "@/lib/pos/application/posLocalStoreTypes";
import { requestPosLocalPersistentStorage } from "./posLocalStorageHealth";

export type PosLocalStorageDurability = "durable" | "ephemeral";

export type PosLocalStorageRuntimeErrorCode =
  "ephemeral_engine_rejected" | "initialization_cancelled" | "unavailable";

export interface PosLocalStorageRuntimeError {
  code: PosLocalStorageRuntimeErrorCode;
  message: string;
}

export interface PosLocalStorageEngine<TStore> {
  clear?: () => Promise<PosLocalStoreResult<null>>;
  close?: (store: TStore) => Promise<void> | void;
  durability: PosLocalStorageDurability;
  execute?: <T>(operation: () => Promise<T>) => Promise<T>;
  id: string;
  open: () => Promise<TStore>;
}

export type PosLocalStorageRuntimeStatus =
  "idle" | "initializing" | "ready" | "failed" | "disposed";

export interface PosLocalStorageRuntimeSnapshot<TStore> {
  error?: PosLocalStorageRuntimeError;
  generation: number;
  status: PosLocalStorageRuntimeStatus;
  store: TStore | null;
}

export interface PosLocalStorageRuntime<TStore> {
  clear(): Promise<PosLocalStoreResult<null>>;
  dispose(): Promise<void>;
  execute<T>(operation: (store: TStore) => Promise<T>): Promise<T>;
  getSnapshot(): PosLocalStorageRuntimeSnapshot<TStore>;
  retry(): Promise<TStore>;
  start(): Promise<TStore>;
  subscribe(listener: () => void): () => void;
}

let defaultPort: PosLocalStorePort | undefined;
let defaultRuntime: PosLocalStorageRuntime<PosLocalStorePort> | undefined;
let defaultLastSuccessfulDurableCommitAt: number | undefined;
let defaultLastDurableFailure:
  { code: PosLocalStoreErrorCode; observedAt: number } | undefined;
const defaultLifecycleListeners = new Set<() => void>();
const defaultTerminalSeedListeners = new Set<() => void>();

export function getDefaultPosLocalStorageRuntime(): PosLocalStorageRuntime<PosLocalStorePort> {
  if (!defaultRuntime) {
    defaultRuntime = createPosLocalStorageRuntime({
      engine: {
        clear: clearCurrentPosLocalStorageEngine,
        durability: "durable",
        execute: runCurrentPosLocalStorageEngineOperation,
        id: "indexed-db",
        open: openCurrentPosLocalStorageEngine,
      },
    });
  }
  return defaultRuntime;
}

/**
 * A stable semantic facade. Every operation resolves the runtime-selected ready
 * generation before dispatching, so consumers never receive the engine store.
 */
export function getDefaultPosLocalStore(): PosLocalStorePort {
  defaultPort ??= createPosLocalStoreRuntimePort(
    getDefaultPosLocalStorageRuntime(),
    {
      onDurableResult(result, operation) {
        if (result.ok) {
          defaultLastSuccessfulDurableCommitAt = Date.now();
          defaultLastDurableFailure = undefined;
        } else {
          defaultLastDurableFailure = {
            code: result.error.code,
            observedAt: Date.now(),
          };
        }
        notifyDefaultLifecycleListeners();
        if (result.ok && isTerminalSeedChangeOperation(operation)) {
          notifyDefaultTerminalSeedListeners();
        }
      },
    },
  );
  return defaultPort;
}

/** Recovery-only lifecycle entrypoint; engine-specific clear mechanics stay in composition. */
export async function clearDefaultPosLocalStore() {
  const result = await getDefaultPosLocalStorageRuntime().clear();
  if (result.ok) {
    await defaultRuntime?.dispose();
    defaultRuntime = undefined;
    defaultPort = undefined;
    defaultLastSuccessfulDurableCommitAt = undefined;
    defaultLastDurableFailure = undefined;
    notifyDefaultLifecycleListeners();
    notifyDefaultTerminalSeedListeners();
  }
  return result;
}

export function createPosLocalStoreRuntimePort(
  runtime: PosLocalStorageRuntime<PosLocalStorePort>,
  options?: {
    onDurableResult?: (
      result: PosLocalStoreResult<unknown>,
      operation: PropertyKey,
    ) => void;
  },
): PosLocalStorePort {
  return new Proxy({} as PosLocalStorePort, {
    get(_target, property) {
      // A dynamic method facade must never be mistaken for a Promise.
      if (property === "then") return undefined;
      return async (...args: unknown[]) =>
        runtime.execute(async (store) => {
          const operation = Reflect.get(store, property);
          if (typeof operation !== "function") {
            throw runtimeError(
              "unavailable",
              "POS local storage operation is unavailable.",
            );
          }
          const result = await Reflect.apply(operation, store, args);
          if (isDurableCommitOperation(property) && isStoreResult(result)) {
            options?.onDurableResult?.(result, property);
          }
          return result;
        });
    },
  });
}

export function getDefaultPosLocalStorageLifecycleHealth() {
  const engineHealth = getCurrentPosLocalStorageEngineLifecycleHealth();
  const runtimeStatus = defaultRuntime?.getSnapshot().status ?? "idle";
  const engineReadiness = defaultLastDurableFailure
    ? ("unavailable" as const)
    : runtimeStatus === "ready"
      ? ("ready" as const)
      : runtimeStatus === "failed" || runtimeStatus === "disposed"
        ? ("unavailable" as const)
        : ("unknown" as const);
  return {
    lastSuccessfulDurableCommitAt: defaultLastSuccessfulDurableCommitAt,
    engineReadiness,
    lastDurableFailure: defaultLastDurableFailure,
    maintenance: engineHealth.maintenance,
    migration: engineHealth.migration,
  };
}

export function subscribeDefaultPosLocalStorageLifecycleHealth(
  listener: () => void,
) {
  defaultLifecycleListeners.add(listener);
  return () => defaultLifecycleListeners.delete(listener);
}

export function subscribeDefaultPosTerminalSeedChanges(listener: () => void) {
  defaultTerminalSeedListeners.add(listener);
  return () => defaultTerminalSeedListeners.delete(listener);
}

/** Explicit user-gesture lifecycle capability; persistence denial remains advisory. */
export function requestDefaultPosLocalPersistentStorage() {
  return requestPosLocalPersistentStorage({
    storage: globalThis.navigator?.storage,
  });
}

function notifyDefaultLifecycleListeners() {
  for (const listener of defaultLifecycleListeners) listener();
}

function notifyDefaultTerminalSeedListeners() {
  for (const listener of defaultTerminalSeedListeners) listener();
}

function isStoreResult(value: unknown): value is PosLocalStoreResult<unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    "ok" in value &&
    typeof value.ok === "boolean",
  );
}

const DURABLE_COMMIT_OPERATIONS = new Set<PropertyKey>([
  "appendEvent",
  "applyRegisterLifecycleAuthority",
  "clearCashierPresence",
  "clearDrawerAuthorityState",
  "clearLocalDrawerReviewAuthorityState",
  "clearLocalReviewEvents",
  "clearTerminalIntegrityState",
  "initializeStorage",
  "invalidateCashierPresenceForTerminal",
  "markEventsActivityFailed",
  "markEventsActivityReported",
  "markEventsNeedsReview",
  "markEventsSynced",
  "replaceStaffAuthoritySnapshot",
  "resetRegisterOperationalStateForAuthorityCutover",
  "resetSharedDemoFirstVisitState",
  "resetSharedDemoLocalState",
  "upsertStaffAuthorityRecord",
  "writeCashierPresence",
  "writeDrawerAuthorityState",
  "writeLocalCloudMapping",
  "writeProvisionedTerminalSeed",
  "writeProvisionedTerminalSeedAndClearTerminalIntegrity",
  "writeRegisterAvailabilitySnapshot",
  "writeRegisterCatalogSnapshot",
  "writeRegisterServiceCatalogSnapshot",
  "writeStoreDayReadiness",
  "writeTerminalIntegrityState",
]);

function isDurableCommitOperation(property: PropertyKey) {
  return DURABLE_COMMIT_OPERATIONS.has(property);
}

const TERMINAL_SEED_CHANGE_OPERATIONS = new Set<PropertyKey>([
  "resetSharedDemoFirstVisitState",
  "writeProvisionedTerminalSeed",
  "writeProvisionedTerminalSeedAndClearTerminalIntegrity",
]);

function isTerminalSeedChangeOperation(property: PropertyKey) {
  return TERMINAL_SEED_CHANGE_OPERATIONS.has(property);
}

export function createPosLocalStorageRuntime<TStore>({
  allowEphemeral = false,
  engine,
}: {
  allowEphemeral?: boolean;
  engine: PosLocalStorageEngine<TStore>;
}): PosLocalStorageRuntime<TStore> {
  const listeners = new Set<() => void>();
  let generation = 0;
  let initialization: Promise<TStore> | null = null;
  let snapshot: PosLocalStorageRuntimeSnapshot<TStore> = {
    generation,
    status: "idle",
    store: null,
  };

  function publish(next: PosLocalStorageRuntimeSnapshot<TStore>) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function start(): Promise<TStore> {
    if (snapshot.status === "disposed") {
      return Promise.reject(
        runtimeError(
          "initialization_cancelled",
          "POS local storage initialization was cancelled.",
        ),
      );
    }
    if (snapshot.status === "ready" && snapshot.store !== null) {
      return Promise.resolve(snapshot.store);
    }
    if (initialization) return initialization;

    const attemptGeneration = ++generation;
    publish({
      generation: attemptGeneration,
      status: "initializing",
      store: null,
    });

    initialization = initialize(attemptGeneration).finally(() => {
      if (generation === attemptGeneration) initialization = null;
    });
    return initialization;
  }

  async function initialize(attemptGeneration: number): Promise<TStore> {
    if (engine.durability === "ephemeral" && !allowEphemeral) {
      const error = runtimeError(
        "ephemeral_engine_rejected",
        "Ephemeral POS local storage is not allowed in production composition.",
      );
      if (generation === attemptGeneration) {
        publish({
          error,
          generation: attemptGeneration,
          status: "failed",
          store: null,
        });
      }
      throw error;
    }

    let store: TStore;
    try {
      store = await engine.open();
    } catch {
      const error = runtimeError(
        "unavailable",
        "POS local storage is unavailable.",
      );
      if (generation === attemptGeneration) {
        publish({
          error,
          generation: attemptGeneration,
          status: "failed",
          store: null,
        });
      }
      throw error;
    }

    if (generation !== attemptGeneration || snapshot.status === "disposed") {
      await engine.close?.(store);
      throw runtimeError(
        "initialization_cancelled",
        "POS local storage initialization was cancelled.",
      );
    }

    publish({ generation: attemptGeneration, status: "ready", store });
    return store;
  }

  async function retry(): Promise<TStore> {
    if (snapshot.status === "disposed") {
      throw runtimeError(
        "initialization_cancelled",
        "POS local storage initialization was cancelled.",
      );
    }
    if (snapshot.status === "ready" && snapshot.store !== null) {
      return snapshot.store;
    }
    return start();
  }

  async function execute<T>(operation: (store: TStore) => Promise<T>) {
    const invoke = async () => operation(await start());
    return engine.execute ? engine.execute(invoke) : invoke();
  }

  async function clear(): Promise<PosLocalStoreResult<null>> {
    if (!engine.clear) {
      return {
        ok: false,
        error: {
          code: "maintenance",
          message: "POS local storage maintenance is unavailable.",
        },
      };
    }
    const result = await engine.clear();
    if (result.ok) await dispose();
    return result;
  }

  async function dispose(): Promise<void> {
    if (snapshot.status === "disposed") return;
    const selectedStore = snapshot.store;
    generation += 1;
    initialization = null;
    publish({ generation, status: "disposed", store: null });
    if (selectedStore) await engine.close?.(selectedStore);
  }

  return {
    clear,
    dispose,
    execute,
    getSnapshot: () => snapshot,
    retry,
    start,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function runtimeError(
  code: PosLocalStorageRuntimeErrorCode,
  message: string,
): PosLocalStorageRuntimeError {
  return { code, message };
}
