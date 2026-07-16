import { afterEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import {
  POS_LOCAL_LOGICAL_RECORD_VERSION,
  POS_LOCAL_STORE_SCHEMA_VERSION,
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
} from "./posLocalStore";

const originalIndexedDb = globalThis.indexedDB;
const STORE_NAMES = [
  "authority",
  "meta",
  "terminalSeed",
  "events",
  "mappings",
  "readiness",
  "cashierPresence",
  "staffAuthority",
  "registerCatalog",
  "registerServiceCatalog",
  "registerAvailability",
] as const;

afterEach(() => {
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: originalIndexedDb,
  });
});

describe("IndexedDB POS layout upgrade", () => {
  it("settles a blocked upgrade and lets a fresh runtime attempt recover", async () => {
    const indexedDB = new IDBFactory();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: indexedDB,
    });
    const databaseName = "blocked-v9-upgrade";
    const legacy = await openDatabase(
      indexedDB,
      databaseName,
      9,
      (database) => {
        for (const storeName of STORE_NAMES)
          database.createObjectStore(storeName);
      },
    );
    // Keep the legacy connection open to exercise a real versionchange block.
    legacy.onversionchange = () => undefined;
    const store = createPosLocalStore({
      adapter: createIndexedDbPosLocalStorageAdapter({
        databaseName,
        openBlockedTimeoutMs: 100,
      }),
    });

    await expect(store.initializeStorage()).resolves.toEqual({
      ok: false,
      error: {
        code: "contention",
        message: "POS local storage is busy. Retry the operation.",
      },
    });

    legacy.close();
    await expect(store.initializeStorage()).resolves.toEqual({
      ok: true,
      value: { logicalRecordVersion: POS_LOCAL_LOGICAL_RECORD_VERSION },
    });
  });

  it("upgrades a keyed v9 database in place and preserves every logical section", async () => {
    const indexedDB = new IDBFactory();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: indexedDB,
    });
    const databaseName = "legacy-v9-upgrade";
    const fixtures = Object.fromEntries(
      STORE_NAMES.map((storeName) => [
        storeName,
        {
          key: storeName === "events" ? "1" : `${storeName}-key`,
          value:
            storeName === "events"
              ? {
                  activity: { status: "pending" },
                  localEventId: "event-v9",
                  schemaVersion: 9,
                  sequence: 1,
                  storeId: "store-1",
                  sync: { status: "pending" },
                  terminalId: "terminal-1",
                }
              : storeName === "mappings"
                ? {
                    cloudId: "cloud-drawer-1",
                    entity: "registerSession",
                    localId: "local-drawer-1",
                    mappedAt: 1,
                    registerCandidateState: "current",
                    registerNumber: "1",
                    storeId: "store-1",
                    terminalId: "terminal-1",
                  }
                : { marker: storeName, schemaVersion: 9 },
        },
      ]),
    ) as Record<(typeof STORE_NAMES)[number], { key: string; value: unknown }>;

    const legacy = await openDatabase(
      indexedDB,
      databaseName,
      9,
      (database) => {
        for (const storeName of STORE_NAMES)
          database.createObjectStore(storeName);
      },
    );
    const seed = legacy.transaction([...STORE_NAMES], "readwrite");
    for (const storeName of STORE_NAMES) {
      const fixture = fixtures[storeName];
      seed.objectStore(storeName).put(fixture.value, fixture.key);
    }
    await transactionComplete(seed);
    legacy.close();

    const adapter = createIndexedDbPosLocalStorageAdapter({ databaseName });
    const preserved = await adapter.transaction(
      "readonly",
      [...STORE_NAMES],
      async (transaction) =>
        Object.fromEntries(
          await Promise.all(
            STORE_NAMES.map(async (storeName) => [
              storeName,
              await transaction.get(storeName, fixtures[storeName].key),
            ]),
          ),
        ),
    );
    for (const storeName of STORE_NAMES) {
      expect(preserved[storeName]).toEqual(fixtures[storeName].value);
    }
    await expect(
      adapter.transaction("readonly", ["events"], (transaction) =>
        transaction.getFromIndex("events", "by_local_event_id", "event-v9"),
      ),
    ).resolves.toEqual(fixtures.events.value);

    const upgraded = await openDatabase(
      indexedDB,
      databaseName,
      POS_LOCAL_STORE_SCHEMA_VERSION,
    );
    const inspection = upgraded.transaction(["events", "mappings"], "readonly");
    expect(Array.from(inspection.objectStore("events").indexNames)).toEqual(
      expect.arrayContaining([
        "by_local_event_id",
        "by_terminal_sync_status_sequence",
        "by_terminal_activity_status_sequence",
      ]),
    );
    expect(Array.from(inspection.objectStore("mappings").indexNames)).toEqual(
      expect.arrayContaining([
        "by_register_scope_state",
        "by_register_full_scope_state",
      ]),
    );
    await transactionComplete(inspection);
    upgraded.close();
  });
});

function openDatabase(
  indexedDB: IDBFactory,
  name: string,
  version: number,
  upgrade?: (database: IDBDatabase) => void,
) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade?.(request.result);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
