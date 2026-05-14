import { describe, expect, it, vi } from "vitest";

import {
  POS_LOCAL_STORE_SCHEMA_VERSION,
  createIndexedDbPosLocalStorageAdapter,
  createMemoryPosLocalStorageAdapter,
  createPosLocalStore,
} from "./posLocalStore";

function buildAuthorityRecord(overrides = {}) {
  return {
    activeRoles: ["cashier" as const],
    credentialId: "credential-1",
    credentialVersion: 1,
    displayName: "Ama Mensah",
    expiresAt: 2_000,
    issuedAt: 1_000,
    organizationId: "org-1",
    wrappedPosLocalStaffProof: {
      ciphertext: "wrapped-proof-token",
      expiresAt: 2_000,
      iv: "proof-iv",
    },
    refreshedAt: 1_000,
    staffProfileId: "staff-1",
    status: "active" as const,
    storeId: "store-1",
    terminalId: "terminal-1",
    username: "FrontDesk",
    verifier: {
      algorithm: "PBKDF2-SHA256" as const,
      hash: "hash",
      iterations: 120000,
      salt: "salt",
      version: 1 as const,
    },
    ...overrides,
  };
}

describe("posLocalStore", () => {
  it("writes and reads a provisioned terminal seed before any network call", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: () => "local-event-1",
    });

    const write = await store.writeProvisionedTerminalSeed({
      terminalId: "local-terminal-1",
      cloudTerminalId: "terminal_cloud_1",
      syncSecretHash: "sync-secret-1",
      storeId: "store_cloud_1",
      registerNumber: "1",
      displayName: "Front register",
      provisionedAt: 1_000,
      schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
    });

    expect(write.ok).toBe(true);
    await expect(store.readProvisionedTerminalSeed()).resolves.toEqual({
      ok: true,
      value: {
        terminalId: "local-terminal-1",
        cloudTerminalId: "terminal_cloud_1",
        syncSecretHash: "sync-secret-1",
        storeId: "store_cloud_1",
        registerNumber: "1",
        displayName: "Front register",
        provisionedAt: 1_000,
        schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
      },
    });
  });

  it("appends local register, sale, payment, receipt, closeout, and reopen events in stable sequence order", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 1_700,
    });

    const eventTypes = [
      "register.opened",
      "session.started",
      "cart.item_added",
      "transaction.completed",
      "register.closeout_started",
      "register.reopened",
    ] as const;

    for (const type of eventTypes) {
      const append = await store.appendEvent({
        type,
        terminalId: "local-terminal-1",
        storeId: "store_cloud_1",
        localRegisterSessionId: "local-register-session-1",
        localPosSessionId: "local-pos-session-1",
        staffProfileId: "staff_cloud_1",
        payload: { type },
      });

      expect(append.ok).toBe(true);
    }

    const events = await store.listEvents();

    expect(events.ok).toBe(true);
    if (!events.ok) return;
    expect(events.value.map((event) => event.sequence)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(events.value.map((event) => event.type)).toEqual(eventTypes);
    expect(events.value.every((event) => event.sync.status === "pending")).toBe(
      true,
    );
  });

  it("does not advance the local sequence cursor when an event write fails", async () => {
    const adapter = createMemoryPosLocalStorageAdapter({
      failNextPutForStore: "events",
    });
    const store = createPosLocalStore({ adapter, clock: () => 2_000 });

    const failedAppend = await store.appendEvent({
      type: "register.opened",
      terminalId: "local-terminal-1",
      storeId: "store_cloud_1",
      localRegisterSessionId: "local-register-session-1",
      staffProfileId: "staff_cloud_1",
      payload: { openingFloat: 100 },
    });

    expect(failedAppend).toMatchObject({
      ok: false,
      error: { code: "write_failed" },
    });

    const successfulAppend = await store.appendEvent({
      type: "register.opened",
      terminalId: "local-terminal-1",
      storeId: "store_cloud_1",
      localRegisterSessionId: "local-register-session-1",
      staffProfileId: "staff_cloud_1",
      payload: { openingFloat: 100 },
    });

    expect(successfulAppend).toMatchObject({
      ok: true,
      value: expect.objectContaining({ sequence: 1 }),
    });
  });

  it("marks server-acknowledged conflict events as needing review", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: () => "local-event-1",
    });
    const append = await store.appendEvent({
      type: "transaction.completed",
      terminalId: "local-terminal-1",
      storeId: "store_cloud_1",
      localRegisterSessionId: "local-register-session-1",
      localPosSessionId: "local-session-1",
      localTransactionId: "local-transaction-1",
      staffProfileId: "staff_cloud_1",
      staffProofToken: "proof-token-1",
      payload: { total: 25 },
    });
    expect(append.ok).toBe(true);

    const marked = await store.markEventsNeedsReview([
      "local-event-1",
    ]);

    expect(marked).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          sync: expect.objectContaining({ status: "needs_review" }),
        }),
      ],
    });
    const listed = await store.listEvents();
    expect(listed.ok && listed.value[0]).not.toHaveProperty(
      "staffProofToken",
    );
  });

  it("keeps staff proof tokens transient for upload without storing them in events", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: () => "local-event-1",
    });

    await expect(
      store.appendEvent({
        type: "register.opened",
        terminalId: "local-terminal-1",
        storeId: "store_cloud_1",
        localRegisterSessionId: "local-register-session-1",
        staffProfileId: "staff_cloud_1",
        staffProofToken: "proof-token-1",
        payload: { openingFloat: 100 },
      }),
    ).resolves.toEqual({
      ok: true,
      value: expect.not.objectContaining({
        staffProofToken: expect.any(String),
      }),
    });

    await expect(store.listEvents()).resolves.toEqual({
      ok: true,
      value: [
        expect.not.objectContaining({
          staffProofToken: expect.any(String),
        }),
      ],
    });
    await expect(store.listEventsForUpload()).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          staffProofToken: "proof-token-1",
        }),
      ],
    });
  });

  it("marks uploaded events as synced without changing unrelated pending events", async () => {
    let nextLocalId = 1;
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: () => `local-event-${nextLocalId++}`,
    });

    await store.appendEvent({
      type: "register.opened",
      terminalId: "local-terminal-1",
      storeId: "store_cloud_1",
      localRegisterSessionId: "local-register-session-1",
      staffProfileId: "staff_cloud_1",
      payload: { openingFloat: 100 },
    });
    await store.appendEvent({
      type: "transaction.completed",
      terminalId: "local-terminal-1",
      storeId: "store_cloud_1",
      localRegisterSessionId: "local-register-session-1",
      localPosSessionId: "local-session-1",
      staffProfileId: "staff_cloud_1",
      staffProofToken: "proof-token-1",
      payload: { total: 25 },
    });

    await expect(
      store.markEventsSynced(["local-event-2"], { uploaded: true }),
    ).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          localEventId: "local-event-2",
          sync: expect.objectContaining({
            status: "synced",
            uploaded: true,
          }),
        }),
      ],
    });

    const listed = await store.listEvents();

    expect(listed).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          localEventId: "local-event-1",
          sequence: 1,
          sync: expect.objectContaining({ status: "pending" }),
        }),
        expect.objectContaining({
          localEventId: "local-event-2",
          sequence: 2,
          sync: expect.objectContaining({
            status: "synced",
            uploaded: true,
          }),
        }),
      ],
    });
    if (listed.ok) {
      expect(listed.value[1]).not.toHaveProperty("staffProofToken");
    }
  });

  it("returns an explicit failure for unsupported local schema versions", async () => {
    const adapter = createMemoryPosLocalStorageAdapter({
      schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION + 1,
    });
    const store = createPosLocalStore({ adapter });

    await expect(store.readProvisionedTerminalSeed()).resolves.toEqual({
      ok: false,
      error: {
        code: "unsupported_schema_version",
        message:
          "POS local store schema version 4 is newer than supported version 3.",
      },
    });
  });

  it("stores POS store-day readiness separately from register events", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 2_000,
    });

    await expect(
      store.writeStoreDayReadiness({
        storeId: "store-1",
        operatingDate: "2026-05-14",
        status: "started",
        source: "daily_opening",
        updatedAt: 2_000,
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        storeId: "store-1",
        operatingDate: "2026-05-14",
        status: "started",
        source: "daily_opening",
        updatedAt: 2_000,
      },
    });

    await expect(
      store.readStoreDayReadiness({
        storeId: "store-1",
        operatingDate: "2026-05-14",
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        storeId: "store-1",
        operatingDate: "2026-05-14",
        status: "started",
        source: "daily_opening",
        updatedAt: 2_000,
      },
    });
    await expect(store.listEvents()).resolves.toEqual({
      ok: true,
      value: [],
    });
  });

  it("replaces and reads terminal-scoped staff authority without store bleed", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 1_500,
    });

    await expect(
      store.replaceStaffAuthoritySnapshot({
        storeId: "store-1",
        terminalId: "terminal-1",
        records: [
          buildAuthorityRecord(),
          buildAuthorityRecord({
            credentialId: "credential-2",
            staffProfileId: "staff-2",
            storeId: "store-2",
            username: "other",
          }),
        ],
      }),
    ).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          storeId: "store-1",
          terminalId: "terminal-1",
          username: "frontdesk",
        }),
      ],
    });

    await expect(
      store.readStaffAuthorityForUsername({
        storeId: "store-1",
        terminalId: "terminal-1",
        username: " FRONTDESK ",
      }),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        credentialId: "credential-1",
        username: "frontdesk",
      }),
    });
    await expect(
      store.readStaffAuthorityForUsername({
        storeId: "store-2",
        terminalId: "terminal-1",
        username: "frontdesk",
      }),
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("ignores expired and malformed local staff authority records", async () => {
    const adapter = createMemoryPosLocalStorageAdapter();
    const store = createPosLocalStore({
      adapter,
      clock: () => 3_000,
    });

    await store.replaceStaffAuthoritySnapshot({
      storeId: "store-1",
      terminalId: "terminal-1",
      records: [buildAuthorityRecord()],
    });
    await expect(
      store.getStaffAuthorityReadiness({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: "expired" });
    await expect(
      store.readStaffAuthorityForUsername({
        storeId: "store-1",
        terminalId: "terminal-1",
        username: "frontdesk",
      }),
    ).resolves.toEqual({ ok: true, value: null });

    await adapter.transaction(
      "readwrite",
      ["staffAuthority"],
      async (transaction) => {
        await transaction.put("staffAuthority", "store-1:terminal-1:broken", {
          username: "broken",
        });
      },
    );
    await expect(
      store.readStaffAuthorityForUsername({
        storeId: "store-1",
        terminalId: "terminal-1",
        username: "broken",
      }),
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("reads local-to-cloud mappings for later events on the same local entity", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });

    await store.writeLocalCloudMapping({
      entity: "posSession",
      localId: "local-pos-session-1",
      cloudId: "pos_session_cloud_1",
      mappedAt: 2_000,
    });

    const mapping = await store.readLocalCloudMapping({
      entity: "posSession",
      localId: "local-pos-session-1",
    });

    expect(mapping).toEqual({
      ok: true,
      value: {
        entity: "posSession",
        localId: "local-pos-session-1",
        cloudId: "pos_session_cloud_1",
        mappedAt: 2_000,
      },
    });
  });

  it("waits for the IndexedDB transaction to complete before resolving writes", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const fakeIndexedDb = createControlledIndexedDb();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: fakeIndexedDb.indexedDB,
    });

    try {
      const adapter = createIndexedDbPosLocalStorageAdapter({
        databaseName: "athena-pos-local-test",
      });
      let resolved = false;
      const write = adapter
        .transaction("readwrite", ["events"], async (transaction) => {
          await transaction.put("events", "1", { localEventId: "event-1" });
          return "committed";
        })
        .then((value) => {
          resolved = true;
          return value;
        });

      await fakeIndexedDb.waitForTransaction();
      await Promise.resolve();
      await Promise.resolve();
      expect(resolved).toBe(false);

      fakeIndexedDb.completeLastTransaction();

      await expect(write).resolves.toBe("committed");
      expect(resolved).toBe(true);

      const read = adapter.transaction("readonly", ["events"], async (transaction) => ({
        event: await transaction.get("events", "1"),
        events: await transaction.getAll("events"),
      }));
      await fakeIndexedDb.waitForTransaction();
      fakeIndexedDb.completeLastTransaction();

      await expect(read).resolves.toEqual({
        event: { localEventId: "event-1" },
        events: [{ localEventId: "event-1" }],
      });
    expect(fakeIndexedDb.database.close).toHaveBeenCalled();
    expect(fakeIndexedDb.database.createObjectStore).toHaveBeenCalledWith("events");
  } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it("returns a write failure when an IndexedDB transaction errors", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const fakeIndexedDb = createControlledIndexedDb();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: fakeIndexedDb.indexedDB,
    });

    try {
      const store = createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter({
          databaseName: "athena-pos-local-test",
        }),
      });

      const write = store.appendEvent({
        type: "register.opened",
        terminalId: "terminal-1",
        storeId: "store-1",
        localRegisterSessionId: "local-register-1",
        staffProfileId: "staff-1",
        payload: { openingFloat: 100 },
      });
      await fakeIndexedDb.waitForTransaction();
      fakeIndexedDb.failLastTransaction(new Error("transaction failed"));

      await expect(write).resolves.toMatchObject({
        ok: false,
        error: { code: "write_failed" },
      });
      expect(fakeIndexedDb.database.close).toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });
});

function createControlledIndexedDb() {
  const storeNames = new Set<string>();
  const data = new Map<string, Map<string, unknown>>();
  let lastTransaction: { complete(): void; fail(error: Error): void } | null = null;
  const transactionWaiters: Array<() => void> = [];
  const database = {
    close: vi.fn(),
    createObjectStore: vi.fn((storeName: string) => {
      storeNames.add(storeName);
    }),
    objectStoreNames: {
      contains: (storeName: string) => storeNames.has(storeName),
    },
    transaction: vi.fn((requestedStoreNames: string[], mode: IDBTransactionMode) => {
      void mode;
      const transaction: ControlledIndexedDbTransaction = {
        abort: vi.fn(),
        complete() {
          this.oncomplete?.({} as Event);
        },
        error: null,
        fail(error: Error) {
          this.error = error as never;
          this.onerror?.({} as Event);
        },
        objectStore: (storeName: string) => {
          const store = data.get(storeName) ?? new Map<string, unknown>();
          data.set(storeName, store);

          return {
            get: (key: string) => createSuccessfulRequest(store.get(key)),
            getAll: () => createSuccessfulRequest(Array.from(store.values())),
            put: (value: unknown, key: string) => {
              store.set(key, value);
              return createSuccessfulRequest(undefined);
            },
          };
        },
        onabort: null,
        oncomplete: null,
        onerror: null,
      };
      for (const storeName of requestedStoreNames) {
        storeNames.add(storeName);
      }
      lastTransaction = transaction;
      transactionWaiters.shift()?.();
      return transaction;
    }),
  };
  const indexedDB = {
    open: vi.fn(() => {
      const request = {
        error: null,
        result: database,
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => {
        request.onupgradeneeded?.({} as IDBVersionChangeEvent);
        request.onsuccess?.({} as Event);
      });
      return request;
    }),
  } as unknown as IDBFactory;

  return {
    database,
    indexedDB,
    waitForTransaction: () =>
      new Promise<void>((resolve) => {
        if (lastTransaction) {
          resolve();
          return;
        }
        transactionWaiters.push(resolve);
      }),
    completeLastTransaction() {
      const transaction = lastTransaction;
      lastTransaction = null;
      transaction?.complete();
    },
    failLastTransaction(error: Error) {
      const transaction = lastTransaction;
      lastTransaction = null;
      transaction?.fail(error);
    },
  };
}

type ControlledIndexedDbTransaction = {
  abort: ReturnType<typeof vi.fn>;
  complete(): void;
  error: Error | null;
  fail(error: Error): void;
  objectStore(storeName: string): {
    get(key: string): IDBRequest<unknown>;
    getAll(): IDBRequest<unknown[]>;
    put(value: unknown, key: string): IDBRequest<undefined>;
  };
  onabort: ((event: Event) => void) | null;
  oncomplete: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
};

function createSuccessfulRequest<T>(result: T): IDBRequest<T> {
  const request = {
    error: null,
    result,
    onerror: null,
    onsuccess: null,
  } as unknown as IDBRequest<T>;
  queueMicrotask(() => request.onsuccess?.({} as Event));
  return request;
}
