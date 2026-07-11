import type { PosLocalStorePort } from "@/lib/pos/application/posLocalStorePort";

import {
  clearIndexedDbPosLocalStore,
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
} from "./posLocalStore";
import { requestPosLocalPersistentStorage } from "./posLocalStorageHealth";

type BrowserLockManager = {
  request<T>(
    name: string,
    options: { ifAvailable: true; mode: "exclusive" | "shared" },
    callback: (lock: unknown | null) => Promise<T>,
  ): Promise<T>;
};

const STORAGE_LOCK_NAME = "athena-pos-local-storage";
let maintenance: "active" | "blocked" | "idle" = "idle";
let migration: "failed" | "idle" | "running" | "unknown" = "unknown";
let activeOperations = 0;
const idleWaiters = new Set<() => void>();

/** Current production engine composition. IndexedDB mechanics do not escape this module. */
export function createCurrentPosLocalStorageEngineStore(): PosLocalStorePort {
  return createPosLocalStore({
    adapter: createIndexedDbPosLocalStorageAdapter(),
  });
}

export async function openCurrentPosLocalStorageEngine() {
  await requestPosLocalPersistentStorage({
    storage: globalThis.navigator?.storage,
  });
  migration = "running";
  try {
    const store = createCurrentPosLocalStorageEngineStore();
    const initialized = await store.initializeStorage();
    if (!initialized.ok)
      throw new Error("POS local storage initialization failed.");
    migration = "idle";
    return store;
  } catch (error) {
    migration = "failed";
    throw error;
  }
}

export async function runCurrentPosLocalStorageEngineOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (maintenance === "active") return maintenanceResult() as T;
  const run = async () => {
    if (maintenance === "active") return maintenanceResult() as T;
    activeOperations += 1;
    try {
      return await operation();
    } finally {
      activeOperations -= 1;
      if (activeOperations === 0) {
        for (const resolve of idleWaiters) resolve();
        idleWaiters.clear();
      }
    }
  };
  const locks = browserLocks();
  if (!locks) return run();
  return locks.request(
    STORAGE_LOCK_NAME,
    { ifAvailable: true, mode: "shared" },
    (lock) => (lock ? run() : Promise.resolve(maintenanceResult() as T)),
  );
}

export async function clearCurrentPosLocalStorageEngine() {
  const locks = browserLocks();
  if (!locks) {
    maintenance = "blocked";
    return maintenanceUnavailableResult();
  }
  return locks.request(
    STORAGE_LOCK_NAME,
    { ifAvailable: true, mode: "exclusive" },
    async (lock) => {
      if (!lock || maintenance === "active") {
        maintenance = "blocked";
        return maintenanceResult();
      }
      maintenance = "active";
      try {
        if (activeOperations > 0) {
          await new Promise<void>((resolve) => idleWaiters.add(resolve));
        }
        const result = await clearIndexedDbPosLocalStore();
        maintenance = result.ok ? "idle" : "blocked";
        return result;
      } catch (error) {
        maintenance = "blocked";
        throw error;
      }
    },
  );
}

export function getCurrentPosLocalStorageEngineLifecycleHealth() {
  return {
    maintenance,
    migration,
  };
}

function browserLocks(): BrowserLockManager | undefined {
  return (globalThis.navigator as Navigator & { locks?: BrowserLockManager })
    ?.locks;
}

function maintenanceResult() {
  return {
    ok: false as const,
    error: {
      code: "maintenance" as const,
      message: "POS local storage maintenance is in progress.",
    },
  };
}

function maintenanceUnavailableResult() {
  return {
    ok: false as const,
    error: {
      code: "maintenance" as const,
      message: "Exclusive POS local storage maintenance is unavailable.",
    },
  };
}
