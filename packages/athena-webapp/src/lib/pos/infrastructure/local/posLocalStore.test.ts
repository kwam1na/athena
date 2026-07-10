import { describe, expect, it, vi } from "vitest";

import type {
  PosRegisterCatalogAvailabilityRowDto,
  PosServiceCatalogRowDto,
} from "@/lib/pos/application/dto";
import {
  POS_LOCAL_STORE_SCHEMA_VERSION,
  clearIndexedDbPosLocalStore,
  createIndexedDbPosLocalStorageAdapter,
  createMemoryPosLocalStorageAdapter,
  createPosLocalStore,
  toSafePosLocalCashierPresenceDiagnostic,
} from "./posLocalStore";
import { readProjectedLocalRegisterModel } from "./localRegisterReader";

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

function buildCashierPresenceRecord(overrides = {}) {
  return {
    activeRoles: ["cashier" as const],
    credentialId: "credential-1",
    credentialVersion: 1,
    displayName: "Ama Mensah",
    expiresAt: 10_000,
    lastValidatedAt: 1_500,
    offlineFreshUntil: 5_000,
    operatingDate: "2026-06-04",
    organizationId: "org-1",
    signedInAt: 1_000,
    staffProfileId: "staff-1",
    storeId: "store-1",
    terminalId: "terminal-1",
    username: "FrontDesk",
    wrappedPosLocalStaffProof: {
      ciphertext: "wrapped-proof-token",
      expiresAt: 10_000,
      iv: "proof-iv",
    },
    ...overrides,
  };
}

function buildAvailabilityRow(
  overrides: Partial<PosRegisterCatalogAvailabilityRowDto> = {},
): PosRegisterCatalogAvailabilityRowDto {
  return {
    productSkuId: "sku-1" as never,
    skuId: "sku-1" as never,
    inStock: true,
    quantityAvailable: 5,
    ...overrides,
  };
}

function buildServiceCatalogRow(
  overrides: Partial<PosServiceCatalogRowDto> = {},
): PosServiceCatalogRowDto {
  return {
    serviceCatalogId: "service-1" as never,
    name: "Closure Repair",
    description: "Repair a closure install",
    serviceMode: "repair",
    pricingModel: "fixed",
    basePrice: 4_500,
    depositType: "flat",
    depositValue: 1_000,
    requiresManagerApproval: false,
    status: "active",
    updatedAt: 1_000,
    checkoutReadiness: {
      canCheckoutDirectly: true,
      message: "Ready for checkout.",
      minimumAmount: 1_000,
      reason: "fixed_price",
      status: "ready",
      suggestedAmount: 4_500,
    },
    ...overrides,
  };
}

function installClearableIndexedDbMock(
  stores: Partial<
    Record<"authority" | "cashierPresence" | "events", unknown[]>
  >,
  options?: { existingStoreNames?: string[] },
) {
  const existingStoreNames = options?.existingStoreNames ?? [
    "authority",
    "cashierPresence",
    "events",
  ];
  const deleteDatabaseMock = vi.fn(() => {
    const request = {
      error: null,
      onblocked: null,
      onerror: null,
      onsuccess: null,
    } as unknown as IDBOpenDBRequest;
    queueMicrotask(() => {
      request.onsuccess?.({} as Event);
    });
    return request;
  });
  const database = {
    close: vi.fn(),
    createObjectStore: vi.fn(),
    objectStoreNames: {
      contains: vi.fn((storeName: string) =>
        existingStoreNames.includes(storeName),
      ),
    },
    transaction: vi.fn(() => {
      const transaction = {
        objectStore: (
          storeName: "authority" | "cashierPresence" | "events",
        ) => ({
          getAll: () => createSuccessfulRequest(stores[storeName] ?? []),
        }),
        onabort: null,
        oncomplete: null,
        onerror: null,
      } as unknown as IDBTransaction;
      queueMicrotask(() => {
        transaction.oncomplete?.({} as Event);
      });
      return transaction;
    }),
  };
  const openMock = vi.fn(() => {
    const request = {
      error: null,
      result: database,
      onerror: null,
      onsuccess: null,
      onupgradeneeded: null,
    } as unknown as IDBOpenDBRequest;
    queueMicrotask(() => {
      request.onsuccess?.({} as Event);
    });
    return request;
  });

  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      deleteDatabase: deleteDatabaseMock,
      open: openMock,
    },
  });

  return {
    database,
    deleteDatabaseMock,
    openMock,
  };
}

describe("posLocalStore", () => {
  it("atomically clears only synced register operational state for the authority cutover", async () => {
    const adapter = createMemoryPosLocalStorageAdapter();
    const store = createPosLocalStore({
      adapter,
      clock: () => 9_000,
      createLocalId: (kind) => `${kind}-test`,
    });

    for (const type of [
      "register.opened",
      "session.started",
      "cart.item_added",
      "pending_checkout_item.defined",
      "transaction.completed",
      "register.closeout_started",
      "expense.completed",
      "cash.movement_recorded",
    ] as const) {
      await store.appendEvent({
        initialSyncStatus: "synced",
        localRegisterSessionId: "local-register-1",
        payload: {},
        storeId: "store-1",
        terminalId: "terminal-1",
        type,
      });
    }
    await store.appendEvent({
      initialSyncStatus: "synced",
      payload: {},
      storeId: "store-1",
      terminalId: "terminal-1",
      type: "terminal.seeded",
    });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-register-1",
      entity: "registerSession",
      localId: "local-register-1",
      mappedAt: 1_000,
    });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-pos-1",
      entity: "posSession",
      localId: "local-pos-1",
      mappedAt: 1_000,
    });
    await store.writeDrawerAuthorityState({
      localRegisterSessionId: "local-register-1",
      observedAt: 1_000,
      status: "healthy",
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    await store.writeTerminalIntegrityState({
      observedAt: 1_000,
      status: "healthy",
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    await adapter.transaction(
      "readwrite",
      ["authority"],
      (transaction) =>
        transaction.put("authority", "legacyDrawer:unparseable", {
          legacyDrawer: true,
        }),
    );
    await adapter.transaction(
      "readwrite",
      [
        "meta",
        "terminalSeed",
        "readiness",
        "cashierPresence",
        "staffAuthority",
        "registerCatalog",
        "registerServiceCatalog",
        "registerAvailability",
      ],
      async (transaction) => {
        await transaction.put(
          "meta",
          "uploadSequence:local-register-1",
          20,
        );
        await transaction.put("terminalSeed", "current", {
          marker: "terminal-seed",
        });
        await transaction.put("readiness", "store-1:2026-07-10", {
          marker: "readiness",
        });
        await transaction.put(
          "cashierPresence",
          "terminal-1",
          buildCashierPresenceRecord(),
        );
        await transaction.put(
          "staffAuthority",
          "staff-1",
          buildAuthorityRecord(),
        );
        await transaction.put("registerCatalog", "store-1", {
          marker: "preserved",
        });
        await transaction.put("registerServiceCatalog", "store-1", {
          marker: "service-catalog",
        });
        await transaction.put("registerAvailability", "store-1", {
          marker: "availability",
        });
      },
    );

    const reset =
      await store.resetRegisterOperationalStateForAuthorityCutover();
    expect(reset).toEqual({
      ok: true,
      value: {
        deletedAuthorityCount: 2,
        deletedEventCount: 8,
        deletedMappingCount: 1,
        resetAt: 9_000,
        status: "applied",
      },
    });

    const [events, mappings, authority, preserved] = await Promise.all([
      store.listEvents(),
      store.listLocalCloudMappings(),
      adapter.transaction("readonly", ["authority"], (transaction) =>
        transaction.getAll("authority"),
      ),
      adapter.transaction(
        "readonly",
        [
          "meta",
          "terminalSeed",
          "readiness",
          "cashierPresence",
          "staffAuthority",
          "registerCatalog",
          "registerServiceCatalog",
          "registerAvailability",
        ],
        async (transaction) => ({
          availability: await transaction.getAll("registerAvailability"),
          cashier: await transaction.getAll("cashierPresence"),
          catalog: await transaction.getAll("registerCatalog"),
          readiness: await transaction.getAll("readiness"),
          serviceCatalog: await transaction.getAll("registerServiceCatalog"),
          staff: await transaction.getAll("staffAuthority"),
          terminalSeed: await transaction.getAll("terminalSeed"),
          uploadSequence: await transaction.get<number>(
            "meta",
            "uploadSequence:local-register-1",
          ),
        }),
      ),
    ]);
    expect(events).toMatchObject({
      ok: true,
      value: [expect.objectContaining({ type: "terminal.seeded" })],
    });
    expect(mappings).toMatchObject({
      ok: true,
      value: [expect.objectContaining({ entity: "posSession" })],
    });
    expect(authority).toEqual([
      expect.objectContaining({ status: "healthy", terminalId: "terminal-1" }),
    ]);
    expect(preserved.cashier).toHaveLength(1);
    expect(preserved.staff).toHaveLength(1);
    expect(preserved.catalog).toEqual([{ marker: "preserved" }]);
    expect(preserved.serviceCatalog).toEqual([
      { marker: "service-catalog" },
    ]);
    expect(preserved.availability).toEqual([{ marker: "availability" }]);
    expect(preserved.readiness).toEqual([{ marker: "readiness" }]);
    expect(preserved.terminalSeed).toEqual([{ marker: "terminal-seed" }]);
    expect(preserved.uploadSequence).toBe(20);

    const newEvent = await store.appendEvent({
      localRegisterSessionId: "local-register-1",
      payload: {},
      storeId: "store-1",
      terminalId: "terminal-1",
      type: "register.opened",
    });
    expect(newEvent).toMatchObject({
      ok: true,
      value: { sequence: 10, uploadSequence: 21 },
    });
    expect(
      await store.resetRegisterOperationalStateForAuthorityCutover(),
    ).toEqual({
      ok: true,
      value: { resetAt: 9_000, status: "already_applied" },
    });
    expect(await store.listEvents()).toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({ type: "terminal.seeded" }),
        expect.objectContaining({ type: "register.opened" }),
      ],
    });
  });

  it("clears register operational state regardless of stale local sync status", async () => {
    const adapter = createMemoryPosLocalStorageAdapter();
    const store = createPosLocalStore({ adapter, clock: () => 9_000 });
    await store.appendEvent({
      payload: {},
      storeId: "store-1",
      terminalId: "terminal-1",
      type: "register.opened",
    });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-register-1",
      entity: "registerSession",
      localId: "local-register-1",
      mappedAt: 1_000,
    });
    await store.writeDrawerAuthorityState({
      localRegisterSessionId: "local-register-1",
      observedAt: 1_000,
      status: "healthy",
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    expect(
      await store.resetRegisterOperationalStateForAuthorityCutover(),
    ).toEqual({
      ok: true,
      value: {
        deletedAuthorityCount: 1,
        deletedEventCount: 1,
        deletedMappingCount: 1,
        resetAt: 9_000,
        status: "applied",
      },
    });
    expect(await store.listEvents()).toEqual({ ok: true, value: [] });
    expect(await store.listLocalCloudMappings()).toEqual({
      ok: true,
      value: [],
    });
    expect(
      await store.readDrawerAuthorityState({
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toEqual({ ok: true, value: null });
  });

  it("keeps exactly one current register-session mapping per scope", async () => {
    const adapter = createMemoryPosLocalStorageAdapter();
    const store = createPosLocalStore({ adapter });

    for (const [localId, cloudId, mappedAt] of [
      ["local-old", "cloud-old", 1_000],
      ["local-new", "cloud-new", 2_000],
    ] as const) {
      await store.writeLocalCloudMapping({
        cloudId,
        entity: "registerSession",
        localId,
        mappedAt,
        registerCandidateState: "current",
        registerNumber: "2",
        storeId: "store-1",
        terminalId: "terminal-1",
      });
    }
    await store.writeLocalCloudMapping({
      cloudId: "cloud-other-terminal",
      entity: "registerSession",
      localId: "local-other-terminal",
      mappedAt: 3_000,
      registerCandidateState: "current",
      registerNumber: "2",
      storeId: "store-1",
      terminalId: "terminal-2",
    });

    const mappings = await adapter.transaction(
      "readonly",
      ["mappings"],
      (transaction) => transaction.getAll("mappings"),
    );
    expect(mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localId: "local-old",
          registerCandidateState: "historical",
        }),
        expect.objectContaining({
          localId: "local-new",
          registerCandidateState: "current",
        }),
        expect.objectContaining({
          localId: "local-other-terminal",
          registerCandidateState: "current",
        }),
      ]),
    );
  });

  it("keeps exactly one current legacy mapping per store and terminal", async () => {
    const adapter = createMemoryPosLocalStorageAdapter();
    const store = createPosLocalStore({ adapter });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-legacy-old",
      entity: "registerSession",
      localId: "local-legacy-old",
      mappedAt: 1_000,
      registerCandidateState: "current",
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-legacy-new",
      entity: "registerSession",
      localId: "local-legacy-new",
      mappedAt: 2_000,
      registerCandidateState: "current",
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    const mappings = await adapter.transaction(
      "readonly",
      ["mappings"],
      (transaction) => transaction.getAll("mappings"),
    );
    expect(mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localId: "local-legacy-old",
          registerCandidateState: "historical",
        }),
        expect.objectContaining({
          localId: "local-legacy-new",
          registerCandidateState: "current",
        }),
      ]),
    );
  });

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

  it("persists terminal integrity state without storing secret material", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 2_000,
    });

    const write = await store.writeTerminalIntegrityState({
      cloudTerminalId: "terminal-cloud-1",
      message:
        "syncSecretHash stale-secret staffProofToken proof-token should not persist",
      observedAt: 1_900,
      reason: "authorization_failed",
      registerNumber: "1",
      status: "requires_reprovision",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });

    expect(write).toMatchObject({
      ok: true,
      value: {
        cloudTerminalId: "terminal-cloud-1",
        message: "Terminal authorization failed. Repair terminal setup.",
        observedAt: 1_900,
        reason: "authorization_failed",
        status: "requires_reprovision",
      },
    });
    await expect(
      store.readTerminalIntegrityState({
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: expect.objectContaining({
        terminalId: "local-terminal-1",
        cloudTerminalId: "terminal-cloud-1",
        status: "requires_reprovision",
      }),
    });
  });

  it("clears terminal integrity state without deleting local events", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });

    await store.appendEvent({
      type: "register.opened",
      terminalId: "local-terminal-1",
      storeId: "store-1",
      localRegisterSessionId: "local-register-1",
      payload: { openingFloat: 100 },
    });
    await store.writeTerminalIntegrityState({
      observedAt: 1_000,
      reason: "authorization_failed",
      status: "requires_reprovision",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });

    await expect(
      store.clearTerminalIntegrityState({
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
    await expect(
      store.readTerminalIntegrityState({
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [expect.objectContaining({ type: "register.opened" })],
    });
  });

  it("persists drawer authority blocks scoped to the active local drawer", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 3_000,
    });

    await store.writeDrawerAuthorityState({
      cloudRegisterSessionId: "cloud-register-1",
      localRegisterSessionId: "local-register-1",
      observedAt: 2_900,
      reason: "cloud_closed",
      registerNumber: "1",
      status: "blocked",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });

    await expect(
      store.readDrawerAuthorityState({
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: expect.objectContaining({
        cloudRegisterSessionId: "cloud-register-1",
        localRegisterSessionId: "local-register-1",
        reason: "cloud_closed",
        status: "blocked",
      }),
    });
    await expect(
      store.readDrawerAuthorityState({
        localRegisterSessionId: "local-register-other",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("projects drawer authority written under the cloud terminal id for a provisioned local terminal", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 3_000,
    });

    await store.writeProvisionedTerminalSeed({
      terminalId: "local-terminal-1",
      cloudTerminalId: "terminal-cloud-1",
      syncSecretHash: "sync-secret-1",
      storeId: "store-1",
      registerNumber: "1",
      displayName: "Front register",
      provisionedAt: 1_000,
      schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-cloud-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      payload: {
        localRegisterSessionId: "local-register-1",
        openingFloat: 100,
        expectedCash: 100,
        status: "open",
      },
    });
    await store.writeDrawerAuthorityState({
      cloudRegisterSessionId: "cloud-register-1",
      localRegisterSessionId: "local-register-1",
      observedAt: 2_900,
      reason: "cloud_closed",
      status: "blocked",
      storeId: "store-1",
      terminalId: "terminal-cloud-1",
    });

    await expect(
      readProjectedLocalRegisterModel({
        store,
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        canSell: false,
        saleBlockReason: "drawer_authority",
      },
    });
  });

  it("projects drawer authority written under the mapped cloud register id for the active local drawer", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 3_000,
    });

    await store.writeProvisionedTerminalSeed({
      terminalId: "local-terminal-1",
      cloudTerminalId: "terminal-cloud-1",
      syncSecretHash: "sync-secret-1",
      storeId: "store-1",
      registerNumber: "1",
      displayName: "Front register",
      provisionedAt: 1_000,
      schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
    });
    await store.writeLocalCloudMapping({
      entity: "registerSession",
      localId: "local-register-1",
      cloudId: "cloud-register-1",
      mappedAt: 1_500,
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "local-terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      payload: {
        localRegisterSessionId: "local-register-1",
        openingFloat: 100,
        expectedCash: 100,
        status: "open",
      },
      initialSyncStatus: "synced",
    });
    await store.writeDrawerAuthorityState({
      cloudRegisterSessionId: "cloud-register-1",
      localRegisterSessionId: "cloud-register-1",
      observedAt: 2_900,
      reason: "cloud_closed",
      status: "blocked",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });

    await expect(
      readProjectedLocalRegisterModel({
        store,
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        canSell: false,
        drawerAuthorityReason: "cloud_closed",
        saleBlockReason: "drawer_authority",
      },
    });
  });

  it("clears drawer authority by exact local drawer id without deleting cloud-id aliases", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });

    await store.writeDrawerAuthorityState({
      cloudRegisterSessionId: "cloud-register-1",
      localRegisterSessionId: "local-register-1",
      observedAt: 2_000,
      reason: "cloud_closed",
      status: "blocked",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });
    await store.writeDrawerAuthorityState({
      cloudRegisterSessionId: "cloud-register-1",
      localRegisterSessionId: "local-register-2",
      observedAt: 2_100,
      reason: "authority_unknown",
      status: "blocked",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });

    await expect(
      store.clearDrawerAuthorityState({
        cloudRegisterSessionId: "cloud-register-1",
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });

    await expect(
      store.readDrawerAuthorityState({
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
    await expect(
      store.readDrawerAuthorityState({
        localRegisterSessionId: "local-register-2",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        localRegisterSessionId: "local-register-2",
        reason: "authority_unknown",
      },
    });
  });

  it("atomically rejects authority when the local mapping changed after observation", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-register-2",
      entity: "registerSession",
      localId: "local-register-1",
      mappedAt: 2_000,
    });

    await expect(
      store.applyRegisterLifecycleAuthority({
        expectedMapping: {
          cloudRegisterSessionId: "cloud-register-1",
          mappedAt: 1_000,
        },
        observation: {
          classification: "sale_blocked",
          cloudRegisterSessionId: "cloud-register-1",
          cursor: {
            lifecycleRevision: 2,
            mappingAuthorityRevision: 4,
          },
          localRegisterSessionId: "local-register-1",
          observedAt: 3_000,
          reason: "cloud_closed",
          source: "dedicated_snapshot",
          status: "blocked",
        },
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toEqual({
      ok: true,
      value: { disposition: "rejected", reason: "mapping_invalidated" },
    });
    await expect(
      store.readDrawerAuthorityState({
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("atomically rejects authority when only mapping authority metadata changed", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-register-1",
      entity: "registerSession",
      localId: "local-register-1",
      mappedAt: 1_000,
      mappingAuthorityRevision: 4,
      registerCandidateState: "current",
      registerNumber: "2",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-register-1",
      entity: "registerSession",
      localId: "local-register-1",
      mappedAt: 1_000,
      mappingAuthorityRevision: 5,
      registerCandidateState: "historical",
      registerNumber: "2",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });

    await expect(
      store.applyRegisterLifecycleAuthority({
        expectedMapping: {
          cloudRegisterSessionId: "cloud-register-1",
          mappedAt: 1_000,
          mappingAuthorityRevision: 4,
          registerCandidateState: "current",
          registerNumber: "2",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
        observation: {
          classification: "sale_blocked",
          cloudRegisterSessionId: "cloud-register-1",
          cursor: {
            lifecycleRevision: 2,
            mappingAuthorityRevision: 4,
          },
          localRegisterSessionId: "local-register-1",
          observedAt: 3_000,
          reason: "cloud_closed",
          source: "dedicated_snapshot",
          status: "blocked",
        },
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toEqual({
      ok: true,
      value: { disposition: "rejected", reason: "mapping_invalidated" },
    });
    await expect(
      store.readDrawerAuthorityState({
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("accepts monotonic mapping enrichment when legacy metadata was not part of the expectation", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-register-1",
      entity: "registerSession",
      localId: "local-register-1",
      mappedAt: 1_000,
      mappingAuthorityRevision: 1,
      registerCandidateState: "current",
      registerNumber: "2",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });

    await expect(
      store.applyRegisterLifecycleAuthority({
        expectedMapping: {
          cloudRegisterSessionId: "cloud-register-1",
          mappedAt: 1_000,
        },
        observation: {
          classification: "sale_usable",
          cloudRegisterSessionId: "cloud-register-1",
          cursor: {
            lifecycleRevision: 1,
            mappingAuthorityRevision: 1,
          },
          localRegisterSessionId: "local-register-1",
          observedAt: 3_000,
          source: "dedicated_snapshot",
          status: "healthy",
        },
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { disposition: "applied" },
    });
  });

  it("does not expose an authority snapshot when its transaction write fails", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter({
        failNextPutForStore: "authority",
      }),
    });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-register-1",
      entity: "registerSession",
      localId: "local-register-1",
      mappedAt: 1_000,
    });

    await expect(
      store.applyRegisterLifecycleAuthority({
        expectedMapping: {
          cloudRegisterSessionId: "cloud-register-1",
          mappedAt: 1_000,
        },
        observation: {
          classification: "sale_blocked",
          cloudRegisterSessionId: "cloud-register-1",
          cursor: {
            lifecycleRevision: 2,
            mappingAuthorityRevision: 4,
          },
          localRegisterSessionId: "local-register-1",
          observedAt: 3_000,
          reason: "cloud_closed",
          source: "dedicated_snapshot",
          status: "blocked",
        },
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "write_failed" } });
    await expect(
      store.readDrawerAuthorityState({
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("preserves local review while applying dedicated healthy authority", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-register-1",
      entity: "registerSession",
      localId: "local-register-1",
      mappedAt: 1_000,
    });
    await store.writeDrawerAuthorityState({
      localRegisterSessionId: "local-register-1",
      observedAt: 1_500,
      reason: "lifecycle_rejected",
      status: "blocked",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });

    await expect(
      store.applyRegisterLifecycleAuthority({
        expectedMapping: {
          cloudRegisterSessionId: "cloud-register-1",
          mappedAt: 1_000,
        },
        observation: {
          classification: "sale_usable",
          cloudRegisterSessionId: "cloud-register-1",
          cursor: {
            lifecycleRevision: 2,
            mappingAuthorityRevision: 4,
          },
          localRegisterSessionId: "local-register-1",
          observedAt: 2_000,
          source: "dedicated_snapshot",
          status: "healthy",
        },
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { disposition: "applied" },
    });
    await expect(
      store.readDrawerAuthorityState({
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        localReviewAuthority: { reason: "lifecycle_rejected" },
        reason: "lifecycle_rejected",
        serverAuthority: { status: "healthy" },
        status: "blocked",
      },
    });

    await expect(
      store.clearLocalDrawerReviewAuthorityState({
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
    await expect(
      store.readDrawerAuthorityState({
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        serverAuthority: { source: "dedicated_snapshot", status: "healthy" },
        status: "healthy",
      },
    });
  });

  it("keeps mapping authority metadata when ordinary sync rewrites the same mapping", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-register-1",
      entity: "registerSession",
      localId: "local-register-1",
      mappedAt: 1_000,
      mappingAuthorityRevision: 7,
      registerCandidateState: "current",
      registerNumber: "2",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-register-1",
      entity: "registerSession",
      localId: "local-register-1",
      mappedAt: 2_000,
    });

    await expect(store.listLocalCloudMappings()).resolves.toMatchObject({
      ok: true,
      value: [
        {
          cloudId: "cloud-register-1",
          mappedAt: 2_000,
          mappingAuthorityRevision: 7,
          registerCandidateState: "current",
          registerNumber: "2",
        },
      ],
    });
  });

  it("rejects authority older than the durable mapping epoch even without an authority row", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-register-1",
      entity: "registerSession",
      localId: "local-register-1",
      mappedAt: 1_000,
      mappingAuthorityRevision: 7,
    });

    await expect(
      store.applyRegisterLifecycleAuthority({
        expectedMapping: {
          cloudRegisterSessionId: "cloud-register-1",
          mappedAt: 1_000,
        },
        observation: {
          classification: "sale_blocked",
          cloudRegisterSessionId: "cloud-register-1",
          cursor: {
            lifecycleRevision: 99,
            mappingAuthorityRevision: 6,
          },
          localRegisterSessionId: "local-register-1",
          observedAt: 3_000,
          reason: "cloud_closed",
          source: "dedicated_snapshot",
          status: "blocked",
        },
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toEqual({
      ok: true,
      value: { disposition: "noop", reason: "stale" },
    });
  });

  it("atomically writes repaired terminal seed and clears stale integrity state", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });

    await store.writeTerminalIntegrityState({
      cloudTerminalId: "terminal-cloud-1",
      observedAt: 1_000,
      reason: "authorization_failed",
      status: "requires_reprovision",
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });

    await expect(
      store.writeProvisionedTerminalSeedAndClearTerminalIntegrity({
        seed: {
          terminalId: "local-terminal-1",
          cloudTerminalId: "terminal-cloud-1",
          syncSecretHash: "sync-secret-2",
          storeId: "store-1",
          registerNumber: "1",
          displayName: "Front register",
          provisionedAt: 2_000,
          schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
        },
        terminalIntegrity: {
          storeId: "store-1",
          terminalId: "local-terminal-1",
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        syncSecretHash: "sync-secret-2",
      },
    });
    await expect(store.readProvisionedTerminalSeed()).resolves.toMatchObject({
      ok: true,
      value: {
        syncSecretHash: "sync-secret-2",
      },
    });
    await expect(
      store.readTerminalIntegrityState({
        storeId: "store-1",
        terminalId: "local-terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("persists terminal and drawer authority state through the IndexedDB authority store", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const fakeIndexedDb = createControlledIndexedDb();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: fakeIndexedDb.indexedDB,
    });

    try {
      const store = createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter({
          databaseName: "athena-pos-local-authority-test",
        }),
      });

      const terminalWrite = store.writeTerminalIntegrityState({
        cloudTerminalId: "terminal-cloud-1",
        observedAt: 1_000,
        reason: "authorization_failed",
        status: "requires_reprovision",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      });
      await fakeIndexedDb.waitForTransaction();
      fakeIndexedDb.completeLastTransaction();
      await expect(terminalWrite).resolves.toMatchObject({
        ok: true,
        value: {
          status: "requires_reprovision",
        },
      });

      const terminalRead = store.readTerminalIntegrityState({
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      });
      await fakeIndexedDb.waitForTransaction();
      fakeIndexedDb.completeLastTransaction();
      await expect(terminalRead).resolves.toMatchObject({
        ok: true,
        value: expect.objectContaining({
          terminalId: "local-terminal-1",
        }),
      });

      const drawerWrite = store.writeDrawerAuthorityState({
        cloudRegisterSessionId: "cloud-register-1",
        localRegisterSessionId: "local-register-1",
        observedAt: 2_000,
        reason: "authority_unknown",
        status: "blocked",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      });
      await fakeIndexedDb.waitForTransaction();
      fakeIndexedDb.completeLastTransaction();
      await expect(drawerWrite).resolves.toMatchObject({
        ok: true,
        value: {
          reason: "authority_unknown",
          status: "blocked",
        },
      });

      const drawerRead = store.readDrawerAuthorityState({
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      });
      await fakeIndexedDb.waitForTransaction();
      fakeIndexedDb.completeLastTransaction();
      await expect(drawerRead).resolves.toMatchObject({
        ok: true,
        value: expect.objectContaining({
          cloudRegisterSessionId: "cloud-register-1",
        }),
      });

      const drawerClear = store.clearDrawerAuthorityState({
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      });
      await fakeIndexedDb.waitForTransaction();
      fakeIndexedDb.completeLastTransaction();
      await expect(drawerClear).resolves.toEqual({ ok: true, value: null });

      const drawerReadAfterClear = store.readDrawerAuthorityState({
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "local-terminal-1",
      });
      await fakeIndexedDb.waitForTransaction();
      fakeIndexedDb.completeLastTransaction();
      await expect(drawerReadAfterClear).resolves.toEqual({
        ok: true,
        value: null,
      });

      expect(fakeIndexedDb.database.createObjectStore).toHaveBeenCalledWith(
        "authority",
      );
      expect(fakeIndexedDb.database.transaction).toHaveBeenCalledWith(
        ["meta", "authority"],
        "readwrite",
      );
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it("writes and reads a register catalog snapshot for offline lookup", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 1_700,
    });

    const write = await store.writeRegisterCatalogSnapshot({
      storeId: "store-1",
      rows: [
        {
          id: "sku-1" as never,
          productSkuId: "sku-1" as never,
          skuId: "sku-1" as never,
          productId: "product-1" as never,
          name: "Deep Wave",
          sku: "DW-18",
          barcode: "1234567890123",
          price: 10_000,
          category: "Hair",
          description: "Deep wave bundle",
          image: null,
          size: "18",
          length: 18,
          color: "natural",
          areProcessingFeesAbsorbed: false,
        },
      ],
    });

    expect(write).toEqual({
      ok: true,
      value: {
        refreshedAt: 1_700,
        rows: [
          expect.objectContaining({
            productSkuId: "sku-1",
            sku: "DW-18",
          }),
        ],
        schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
        storeId: "store-1",
      },
    });
    await expect(
      store.readRegisterCatalogSnapshot({ storeId: "store-1" }),
    ).resolves.toEqual(write);
  });

  it("writes and reads active service catalog snapshots for offline lookup", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 1_750,
    });

    const write = await store.writeRegisterServiceCatalogSnapshot({
      storeId: "store-1",
      rows: [
        buildServiceCatalogRow(),
        buildServiceCatalogRow({
          serviceCatalogId: "service-archived" as never,
          name: "Archived Repair",
          status: "archived" as never,
        }),
      ],
    });

    expect(write).toEqual({
      ok: true,
      value: {
        refreshedAt: 1_750,
        rows: [
          expect.objectContaining({
            serviceCatalogId: "service-1",
            status: "active",
          }),
        ],
        schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
        storeId: "store-1",
      },
    });
    await expect(
      store.readRegisterServiceCatalogSnapshot({ storeId: "store-1" }),
    ).resolves.toEqual(write);
  });

  it("writes and reads a full register availability snapshot separately from catalog metadata", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 1_800,
    });

    const write = await store.writeRegisterAvailabilitySnapshot({
      storeId: "store-1",
      rows: [
        buildAvailabilityRow(),
        buildAvailabilityRow({
          productSkuId: "sku-2" as never,
          skuId: "sku-2" as never,
          inStock: false,
          quantityAvailable: 0,
        }),
      ],
    });

    expect(write).toEqual({
      ok: true,
      value: {
        refreshedAt: 1_800,
        rows: [
          expect.objectContaining({
            productSkuId: "sku-1",
            quantityAvailable: 5,
          }),
          expect.objectContaining({
            productSkuId: "sku-2",
            quantityAvailable: 0,
          }),
        ],
        schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
        storeId: "store-1",
      },
    });
    await expect(
      store.readRegisterAvailabilitySnapshot({ storeId: "store-1" }),
    ).resolves.toEqual(write);
  });

  it("replaces register availability snapshots atomically without merging stale rows", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 1_900,
    });

    await store.writeRegisterAvailabilitySnapshot({
      storeId: "store-1",
      rows: [
        buildAvailabilityRow(),
        buildAvailabilityRow({
          productSkuId: "sku-stale" as never,
          skuId: "sku-stale" as never,
          quantityAvailable: 3,
        }),
      ],
    });
    await store.writeRegisterAvailabilitySnapshot({
      storeId: "store-1",
      rows: [
        buildAvailabilityRow({
          productSkuId: "sku-2" as never,
          skuId: "sku-2" as never,
          quantityAvailable: 8,
        }),
      ],
    });

    await expect(
      store.readRegisterAvailabilitySnapshot({ storeId: "store-1" }),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        rows: [
          expect.objectContaining({
            productSkuId: "sku-2",
            quantityAvailable: 8,
          }),
        ],
      }),
    });

    const failingStore = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter({
        failNextPutForStore: "registerAvailability",
      }),
    });
    await expect(
      failingStore.writeRegisterAvailabilitySnapshot({
        storeId: "store-1",
        rows: [buildAvailabilityRow()],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "write_failed" },
    });
    await expect(
      failingStore.readRegisterAvailabilitySnapshot({ storeId: "store-1" }),
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("keeps register availability snapshots isolated by store", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });

    await store.writeRegisterAvailabilitySnapshot({
      storeId: "store-1",
      rows: [buildAvailabilityRow()],
    });

    await expect(
      store.readRegisterAvailabilitySnapshot({ storeId: "store-2" }),
    ).resolves.toEqual({ ok: true, value: null });
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
      "pending_checkout_item.defined",
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
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(events.value.map((event) => event.type)).toEqual(eventTypes);
    expect(events.value.map((event) => event.sync.status)).toEqual([
      "pending",
      "synced",
      "synced",
      "pending",
      "pending",
      "pending",
      "synced",
    ]);
    expect(
      events.value.map(
        (event) => (event as { uploadSequence?: number }).uploadSequence,
      ),
    ).toEqual([1, undefined, undefined, 2, 3, 4, undefined]);
    expect(events.value.map((event) => event.activity?.status)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("tracks register-session activity state separately from core sync state", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 2_000,
      createLocalId: (kind) => `${kind}-1`,
    });

    await expect(
      store.appendEvent({
        type: "session.payments_updated",
        terminalId: "terminal-1",
        storeId: "store-1",
        localRegisterSessionId: "register-session-1",
        localPosSessionId: "sale-1",
        staffProfileId: "staff-1",
        payload: { payments: [{ method: "cash", amount: 100 }] },
      }),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        activity: { status: "pending" },
        sync: { status: "synced" },
      }),
    });

    await expect(
      store.markEventsActivityReported(["event-1"], {
        reportedAt: 2_500,
        status: "mapping_pending",
        reasonCode: "mapping_missing",
      }),
    ).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          activity: {
            reportedAt: 2_500,
            reasonCode: "mapping_missing",
            status: "mapping_pending",
          },
          sync: { status: "synced" },
        }),
      ],
    });

    await expect(store.listEvents()).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          activity: {
            reportedAt: 2_500,
            reasonCode: "mapping_missing",
            status: "mapping_pending",
          },
          sync: { status: "synced" },
        }),
      ],
    });
  });

  it("records sanitized local activity failure reasons without overwriting sync failure state", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 3_000,
      createLocalId: (kind) => `${kind}-1`,
    });

    await store.appendEvent({
      type: "transaction.completed",
      terminalId: "terminal-1",
      storeId: "store-1",
      localRegisterSessionId: "register-session-1",
      localPosSessionId: "sale-1",
      localTransactionId: "transaction-1",
      staffProfileId: "staff-1",
      initialSyncStatus: "failed",
      payload: { total: 40 },
    });

    await expect(
      store.markEventsActivityFailed(["event-1"], {
        attemptedAt: 3_500,
        reasonCode: "server_rejected",
      }),
    ).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          activity: {
            attemptedAt: 3_500,
            reasonCode: "server_rejected",
            status: "failed",
          },
          sync: expect.objectContaining({
            status: "failed",
          }),
        }),
      ],
    });
  });

  it("treats pending checkout item definitions as uploadable without storing unsafe local metadata", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 1_700,
      createLocalId: () => "local-event-1",
    });

    await expect(
      store.appendEvent({
        type: "pending_checkout_item.defined",
        terminalId: "terminal-1",
        storeId: "store-1",
        localRegisterSessionId: "register-session-1",
        localPosSessionId: "sale-1",
        staffProfileId: "staff-1",
        staffProofToken: "proof-token-1",
        payload: {
          localPendingCheckoutItemId: "local-pending-item-1",
          name: "Bundle Wig",
          lookupCode: "999888777666",
          searchContext: {
            query: "Bundle Wig",
            source: "manual",
          },
          price: 45,
          quantitySold: 2,
          localMetadata: {
            source: "offline_search",
            reusedExistingPendingItem: false,
            rawTerminalProof: "raw-terminal-proof",
          },
        },
      }),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        localEventId: "local-event-1",
        sequence: 1,
        uploadSequence: 1,
        sync: { status: "pending" },
        staffProofToken: "proof-token-1",
      }),
    });

    const listed = await store.listEventsForUpload();
    expect(listed).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          localEventId: "local-event-1",
          uploadSequence: 1,
          type: "pending_checkout_item.defined",
        }),
      ],
    });
    const serialized = JSON.stringify(listed.ok ? listed.value : []);
    expect(serialized).toContain("local-pending-item-1");
    expect(serialized).not.toContain("raw-terminal-proof");
  });

  it("allocates durable upload sequences per local register session without requiring staff proof", async () => {
    let nextLocalId = 1;
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: () => `local-event-${nextLocalId++}`,
    });

    await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-1",
      storeId: "store-1",
      localRegisterSessionId: "register-session-1",
      staffProfileId: "staff-1",
      payload: { openingFloat: 100 },
    });
    await store.appendEvent({
      type: "cart.item_added",
      terminalId: "terminal-1",
      storeId: "store-1",
      localRegisterSessionId: "register-session-1",
      localPosSessionId: "sale-1",
      staffProfileId: "staff-1",
      payload: { productSkuId: "sku-1" },
    });
    await store.appendEvent({
      type: "transaction.completed",
      terminalId: "terminal-1",
      storeId: "store-1",
      localRegisterSessionId: "register-session-1",
      localPosSessionId: "sale-1",
      localTransactionId: "txn-1",
      staffProfileId: "staff-1",
      payload: { total: 25 },
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-1",
      storeId: "store-1",
      localRegisterSessionId: "register-session-2",
      staffProfileId: "staff-1",
      payload: { openingFloat: 50 },
    });

    const events = await store.listEvents();

    expect(events.ok).toBe(true);
    if (!events.ok) return;
    expect(
      events.value.map((event) => ({
        localEventId: event.localEventId,
        uploadSequence: (event as { uploadSequence?: number }).uploadSequence,
      })),
    ).toEqual([
      { localEventId: "local-event-1", uploadSequence: 1 },
      { localEventId: "local-event-2", uploadSequence: undefined },
      { localEventId: "local-event-3", uploadSequence: 2 },
      { localEventId: "local-event-4", uploadSequence: 1 },
    ]);
  });

  it("allocates drawerless expense upload sequences by local expense session", async () => {
    let nextLocalId = 1;
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: () => `local-event-${nextLocalId++}`,
    });

    await store.appendEvent({
      type: "expense.completed",
      terminalId: "terminal-1",
      storeId: "store-1",
      localExpenseSessionId: "expense-session-1",
      staffProfileId: "staff-1",
      staffProofToken: "proof-token-1",
      payload: {
        localExpenseSessionId: "expense-session-1",
        localExpenseEventId: "expense-event-1",
        notes: "Damaged item",
      },
    });
    await store.appendEvent({
      type: "expense.completed",
      terminalId: "terminal-1",
      storeId: "store-1",
      localExpenseSessionId: "expense-session-2",
      staffProfileId: "staff-1",
      payload: {
        localExpenseSessionId: "expense-session-2",
        localExpenseEventId: "expense-event-2",
      },
    });

    const events = await store.listEvents();
    expect(events.ok).toBe(true);
    if (!events.ok) return;
    expect(
      events.value.map((event) => ({
        localEventId: event.localEventId,
        localExpenseSessionId: event.localExpenseSessionId,
        localRegisterSessionId: event.localRegisterSessionId,
        sync: event.sync.status,
        uploadSequence: event.uploadSequence,
      })),
    ).toEqual([
      {
        localEventId: "local-event-1",
        localExpenseSessionId: "expense-session-1",
        localRegisterSessionId: undefined,
        sync: "pending",
        uploadSequence: 1,
      },
      {
        localEventId: "local-event-2",
        localExpenseSessionId: "expense-session-2",
        localRegisterSessionId: undefined,
        sync: "pending",
        uploadSequence: 1,
      },
    ]);

    await expect(store.listEventsForUpload()).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          localEventId: "local-event-1",
          localExpenseSessionId: "expense-session-1",
          type: "expense.completed",
          uploadSequence: 1,
        }),
        expect.objectContaining({
          localEventId: "local-event-2",
          localExpenseSessionId: "expense-session-2",
          type: "expense.completed",
          uploadSequence: 1,
        }),
      ],
    });
  });

  it("persists drawerless expense lifecycle events without upload sequencing until completion", async () => {
    let nextLocalId = 1;
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: () => `local-event-${nextLocalId++}`,
    });

    await store.appendEvent({
      type: "expense.session_started",
      terminalId: "terminal-1",
      storeId: "store-1",
      localExpenseSessionId: "expense-session-1",
      staffProfileId: "staff-1",
      payload: { localExpenseSessionId: "expense-session-1" },
    });
    await store.appendEvent({
      type: "expense.item_added",
      terminalId: "terminal-1",
      storeId: "store-1",
      localExpenseSessionId: "expense-session-1",
      staffProfileId: "staff-1",
      payload: {
        localExpenseSessionId: "expense-session-1",
        localItemId: "item-1",
        productSkuId: "sku-1",
        price: 25,
        quantity: 1,
      },
    });
    await store.appendEvent({
      type: "expense.completed",
      terminalId: "terminal-1",
      storeId: "store-1",
      localExpenseSessionId: "expense-session-1",
      staffProfileId: "staff-1",
      payload: {
        localExpenseSessionId: "expense-session-1",
        localExpenseEventId: "expense-event-1",
      },
    });

    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({
          type: "expense.session_started",
          localExpenseSessionId: "expense-session-1",
          sync: { status: "synced" },
        }),
        expect.objectContaining({
          type: "expense.item_added",
          localExpenseSessionId: "expense-session-1",
          sync: { status: "synced" },
        }),
        expect.objectContaining({
          type: "expense.completed",
          localExpenseSessionId: "expense-session-1",
          sync: { status: "pending" },
          uploadSequence: 1,
        }),
      ],
    });
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

    const marked = await store.markEventsNeedsReview(["local-event-1"]);

    expect(marked).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          sync: expect.objectContaining({ status: "needs_review" }),
        }),
      ],
    });
    const listed = await store.listEvents();
    expect(listed.ok && listed.value[0]).not.toHaveProperty("staffProofToken");
  });

  it("persists app-session/cloud-validation uncertainty metadata through local review without storing unsafe details", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: () => "local-event-1",
    });

    await expect(
      store.appendEvent({
        type: "transaction.completed",
        terminalId: "local-terminal-1",
        storeId: "store_cloud_1",
        localRegisterSessionId: "local-register-session-1",
        localPosSessionId: "local-session-1",
        localTransactionId: "local-transaction-1",
        staffProfileId: "staff_cloud_1",
        staffProofToken: "proof-token-1",
        validationMetadata: {
          flags: ["app-session-unverified", "cloud-validation-uncertain"],
          observedAt: 2_000,
          uploadDeferredUntil: "app-session-validated",
        },
        payload: {
          customerEmail: "customer@example.com",
          payments: [{ method: "cash", amount: 25, timestamp: 2_000 }],
          rawRecoveryReason: "raw-terminal-proof should not be metadata",
        },
      }),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        validationMetadata: {
          flags: ["app-session-unverified", "cloud-validation-uncertain"],
          observedAt: 2_000,
          uploadDeferredUntil: "app-session-validated",
        },
      }),
    });

    await expect(
      store.markEventsNeedsReview(
        ["local-event-1"],
        "Cloud sync needs review before this local event can finish.",
        { uploaded: true },
      ),
    ).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          validationMetadata: {
            flags: ["app-session-unverified", "cloud-validation-uncertain"],
            observedAt: 2_000,
            uploadDeferredUntil: "app-session-validated",
          },
        }),
      ],
    });

    const listed = await store.listEvents();
    expect(listed).toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          validationMetadata: {
            flags: ["app-session-unverified", "cloud-validation-uncertain"],
            observedAt: 2_000,
            uploadDeferredUntil: "app-session-validated",
          },
        }),
      ],
    });
    const serializedMetadata = JSON.stringify(
      listed.ok ? listed.value[0]?.validationMetadata : null,
    );
    expect(serializedMetadata).not.toContain("proof-token-1");
    expect(serializedMetadata).not.toContain("customer@example.com");
    expect(serializedMetadata).not.toContain("payments");
    expect(serializedMetadata).not.toContain("raw-terminal-proof");
  });

  it("persists upload proof on pending uploadable events so offline sync survives reload", async () => {
    const adapter = createMemoryPosLocalStorageAdapter();
    const store = createPosLocalStore({
      adapter,
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
      value: expect.objectContaining({
        staffProofToken: "proof-token-1",
      }),
    });

    const reloadedStore = createPosLocalStore({
      adapter,
      createLocalId: () => "unused-local-event",
    });

    await expect(reloadedStore.listEvents()).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          staffProofToken: "proof-token-1",
        }),
      ],
    });
    await expect(reloadedStore.listEventsForUpload()).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          staffProofToken: "proof-token-1",
        }),
      ],
    });
  });

  it("does not attach upload proof to local-only session events", async () => {
    let nextLocalId = 1;
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: () => `local-event-${nextLocalId++}`,
    });

    await store.appendEvent({
      type: "session.started",
      terminalId: "local-terminal-1",
      storeId: "store_cloud_1",
      localRegisterSessionId: "local-register-session-1",
      localPosSessionId: "local-session-1",
      staffProfileId: "staff_cloud_1",
      staffProofToken: "proof-token-1",
      payload: { localPosSessionId: "local-session-1" },
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "local-terminal-1",
      storeId: "store_cloud_1",
      localRegisterSessionId: "local-register-session-1",
      staffProfileId: "staff_cloud_1",
      payload: { openingFloat: 100 },
    });

    await expect(
      store.attachStaffProofTokenToPendingEvents({
        staffProfileId: "staff_cloud_1",
        staffProofToken: "proof-token-1",
      }),
    ).resolves.toEqual({ ok: true, value: 1 });
    await expect(store.listEventsForUpload()).resolves.toEqual({
      ok: true,
      value: [
        expect.not.objectContaining({
          staffProofToken: expect.any(String),
        }),
        expect.objectContaining({
          localEventId: "local-event-2",
          staffProofToken: "proof-token-1",
        }),
      ],
    });
    await expect(store.listEvents()).resolves.toEqual({
      ok: true,
      value: [
        expect.not.objectContaining({
          staffProofToken: expect.any(String),
        }),
        expect.objectContaining({
          localEventId: "local-event-2",
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
    await store.markEventsNeedsReview(
      ["local-event-2"],
      "Cloud sync needs review before this local event can finish.",
      { uploaded: true },
    );

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
      expect(listed.value[1]?.sync.error).toBeUndefined();
    }
  });

  it("clears only requested local review events without retaining staff proof", async () => {
    let nextLocalId = 1;
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 4_000,
      createLocalId: () => `local-event-${nextLocalId++}`,
    });

    await store.appendEvent({
      initialSyncStatus: "needs_review",
      localRegisterSessionId: "local-register-session-1",
      payload: { total: 25 },
      staffProfileId: "staff_cloud_1",
      staffProofToken: "proof-token-1",
      storeId: "store_cloud_1",
      terminalId: "local-terminal-1",
      type: "transaction.completed",
    });
    await store.markEventsNeedsReview(["local-event-1"], undefined, {
      uploaded: true,
    });
    await store.appendEvent({
      localRegisterSessionId: "local-register-session-1",
      payload: { openingFloat: 100 },
      staffProfileId: "staff_cloud_1",
      staffProofToken: "proof-token-2",
      storeId: "store_cloud_1",
      terminalId: "local-terminal-1",
      type: "register.opened",
    });
    await store.appendEvent({
      initialSyncStatus: "needs_review",
      localRegisterSessionId: "local-register-session-1",
      payload: { total: 40 },
      staffProfileId: "staff_cloud_1",
      staffProofToken: "proof-token-3",
      storeId: "store_cloud_1",
      terminalId: "local-terminal-1",
      type: "transaction.completed",
    });

    await expect(
      store.clearLocalReviewEvents([
        "local-event-1",
        "local-event-2",
        "missing-event",
      ]),
    ).resolves.toEqual({
      ok: true,
      value: [
        expect.objectContaining({
          localEventId: "local-event-1",
          sync: expect.objectContaining({
            localResolution: {
              reason: "terminal_recovery_command",
              resolvedAt: 4_000,
              status: "local_review_cleared",
            },
            status: "locally_resolved",
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
          sync: expect.objectContaining({
            localResolution: expect.objectContaining({
              status: "local_review_cleared",
            }),
            status: "locally_resolved",
          }),
        }),
        expect.objectContaining({
          localEventId: "local-event-2",
          staffProofToken: "proof-token-2",
          sync: expect.objectContaining({ status: "pending" }),
        }),
        expect.objectContaining({
          localEventId: "local-event-3",
          staffProofToken: "proof-token-3",
          sync: expect.objectContaining({ status: "needs_review" }),
        }),
      ],
    });
    if (listed.ok) {
      expect(listed.value[0]).not.toHaveProperty("staffProofToken");
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
        message: `POS local store schema version ${
          POS_LOCAL_STORE_SCHEMA_VERSION + 1
        } is newer than supported version ${POS_LOCAL_STORE_SCHEMA_VERSION}.`,
      },
    });
  });

  it("returns an explicit failure when IndexedDB is missing required object stores", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const database = {
      close: vi.fn(),
      objectStoreNames: {
        contains: () => false,
      },
    };
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        open: vi.fn(() => {
          const request = {
            error: null,
            result: database,
            onerror: null,
            onsuccess: null,
            onupgradeneeded: null,
          } as unknown as IDBOpenDBRequest;
          queueMicrotask(() => {
            request.onsuccess?.({} as Event);
          });
          return request;
        }),
      },
    });

    try {
      const store = createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter({
          databaseName: "athena-pos-local-missing-store-test",
        }),
      });

      await expect(store.readProvisionedTerminalSeed()).resolves.toEqual({
        ok: false,
        error: {
          code: "missing_object_stores",
          message:
            "POS local store is missing required IndexedDB object stores: authority, meta, terminalSeed, events, mappings, readiness, cashierPresence, staffAuthority, registerCatalog, registerServiceCatalog, registerAvailability.",
        },
      });
      expect(database.close).toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it("clears the IndexedDB POS local database", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const { deleteDatabaseMock, openMock } = installClearableIndexedDbMock({});

    try {
      await expect(
        clearIndexedDbPosLocalStore({
          databaseName: "athena-pos-local-clear-test",
        }),
      ).resolves.toEqual({ ok: true, value: null });
      expect(openMock).toHaveBeenCalledWith(
        "athena-pos-local-clear-test",
        POS_LOCAL_STORE_SCHEMA_VERSION,
      );
      expect(deleteDatabaseMock).toHaveBeenCalledWith(
        "athena-pos-local-clear-test",
      );
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it("does not clear IndexedDB POS local state while local events remain", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const { deleteDatabaseMock } = installClearableIndexedDbMock({
      events: [
        {
          localEventId: "event-1",
          sequence: 1,
          sync: { status: "pending" },
          type: "transaction.completed",
        },
      ],
    });

    try {
      await expect(clearIndexedDbPosLocalStore()).resolves.toEqual({
        ok: false,
        error: {
          code: "write_failed",
          message:
            "POS local state has sale or register records that may not be synced. Use terminal health or support recovery before clearing this terminal.",
        },
      });
      expect(deleteDatabaseMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it("does not clear IndexedDB POS local state while authority records remain", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const { deleteDatabaseMock } = installClearableIndexedDbMock({
      authority: [
        {
          status: "ready",
          terminalId: "terminal-1",
        },
      ],
    });

    try {
      await expect(clearIndexedDbPosLocalStore()).resolves.toEqual({
        ok: false,
        error: {
          code: "write_failed",
          message:
            "POS local state has drawer or terminal authority records. Use terminal health or support recovery before clearing this terminal.",
        },
      });
      expect(deleteDatabaseMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it("does not clear IndexedDB POS local state while cashier presence remains", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const now = Date.now();
    const { deleteDatabaseMock } = installClearableIndexedDbMock({
      cashierPresence: [
        {
          activeRoles: ["cashier"],
          credentialId: "credential-1",
          credentialVersion: 1,
          expiresAt: now + 60_000,
          lastValidatedAt: now,
          offlineFreshUntil: now + 60_000,
          operatingDate: "2026-07-01",
          organizationId: "org-1",
          signedInAt: now,
          staffProfileId: "staff-1",
          storeId: "store-1",
          terminalId: "terminal-1",
          username: "ama",
          wrappedPosLocalStaffProof: {
            ciphertext: "ciphertext",
            expiresAt: now + 60_000,
            iv: "iv",
          },
        },
      ],
    });

    try {
      await expect(clearIndexedDbPosLocalStore()).resolves.toEqual({
        ok: false,
        error: {
          code: "write_failed",
          message:
            "POS local state has an active cashier sign-in. Sign out or use terminal health before clearing this terminal.",
        },
      });
      expect(deleteDatabaseMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it("does not clear IndexedDB POS local state when preflight inspection fails", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const deleteDatabaseMock = vi.fn();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        deleteDatabase: deleteDatabaseMock,
        open: vi.fn(() => {
          const request = {
            error: new Error("open failed"),
            onerror: null,
            onsuccess: null,
            onupgradeneeded: null,
          } as unknown as IDBOpenDBRequest;
          queueMicrotask(() => {
            request.onerror?.({} as Event);
          });
          return request;
        }),
      },
    });

    try {
      await expect(clearIndexedDbPosLocalStore()).resolves.toEqual({
        ok: false,
        error: {
          code: "write_failed",
          message:
            "POS local state could not be inspected. Use terminal health or support recovery before clearing this terminal.",
        },
      });
      expect(deleteDatabaseMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it("clears IndexedDB POS local state when record stores are missing", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const { deleteDatabaseMock } = installClearableIndexedDbMock(
      {},
      { existingStoreNames: ["meta", "terminalSeed"] },
    );

    try {
      await expect(clearIndexedDbPosLocalStore()).resolves.toEqual({
        ok: true,
        value: null,
      });
      expect(deleteDatabaseMock).toHaveBeenCalledWith("athena-pos-local");
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it("reports when clearing IndexedDB POS local state is blocked", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const { openMock } = installClearableIndexedDbMock({});
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: {
        open: openMock,
        deleteDatabase: vi.fn(() => {
          const request = {
            error: null,
            onblocked: null,
            onerror: null,
            onsuccess: null,
          } as unknown as IDBOpenDBRequest;
          queueMicrotask(() => {
            request.onblocked?.({} as IDBVersionChangeEvent);
          });
          return request;
        }),
      },
    });

    try {
      await expect(clearIndexedDbPosLocalStore()).resolves.toEqual({
        ok: false,
        error: {
          code: "write_failed",
          message:
            "POS local state is open in another tab. Close other Athena POS tabs and try again.",
        },
      });
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
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

  it("writes and restores terminal store-day cashier presence across store instances", async () => {
    const adapter = createMemoryPosLocalStorageAdapter();
    const store = createPosLocalStore({
      adapter,
      clock: () => 2_000,
    });

    await expect(
      store.writeCashierPresence(buildCashierPresenceRecord()),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        organizationId: "org-1",
        operatingDate: "2026-06-04",
        storeId: "store-1",
        terminalId: "terminal-1",
        username: "frontdesk",
        wrappedPosLocalStaffProof: {
          ciphertext: "wrapped-proof-token",
          expiresAt: 10_000,
          iv: "proof-iv",
        },
      }),
    });

    const reloadedStore = createPosLocalStore({
      adapter,
      clock: () => 2_500,
    });

    await expect(
      reloadedStore.readCashierPresence({
        organizationId: "org-1",
        operatingDate: "2026-06-04",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        staffProfileId: "staff-1",
        username: "frontdesk",
        wrappedPosLocalStaffProof: expect.objectContaining({
          ciphertext: "wrapped-proof-token",
        }),
      }),
    });
  });

  it("restores active cashier presence for a terminal without live organization metadata", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 2_000,
    });

    await store.writeCashierPresence(
      buildCashierPresenceRecord({
        organizationId: "org-1",
        signedInAt: 1_000,
      }),
    );
    await store.writeCashierPresence(
      buildCashierPresenceRecord({
        organizationId: "org-2",
        signedInAt: 1_500,
      }),
    );

    await expect(
      store.readActiveCashierPresence({
        operatingDate: "2026-06-04",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        organizationId: "org-2",
        signedInAt: 1_500,
        staffProfileId: "staff-1",
        username: "frontdesk",
      }),
    });
    await expect(
      store.readActiveCashierPresence({
        operatingDate: "2026-06-04",
        organizationId: "org-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        organizationId: "org-1",
        signedInAt: 1_000,
      }),
    });
  });

  it("keeps cashier presence isolated by terminal store organization and operating date", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 2_000,
    });

    await store.writeCashierPresence(buildCashierPresenceRecord());

    for (const input of [
      {
        organizationId: "org-2",
        operatingDate: "2026-06-04",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      {
        organizationId: "org-1",
        operatingDate: "2026-06-04",
        storeId: "store-2",
        terminalId: "terminal-1",
      },
      {
        organizationId: "org-1",
        operatingDate: "2026-06-04",
        storeId: "store-1",
        terminalId: "terminal-2",
      },
      {
        organizationId: "org-1",
        operatingDate: "2026-06-05",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    ]) {
      await expect(store.readCashierPresence(input)).resolves.toEqual({
        ok: true,
        value: null,
      });
    }
  });

  it("drops expired cashier presence proof material before returning it", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 6_000,
    });

    await store.writeCashierPresence(
      buildCashierPresenceRecord({
        expiresAt: 10_000,
        offlineFreshUntil: 5_000,
        wrappedPosLocalStaffProof: {
          ciphertext: "wrapped-proof-token",
          expiresAt: 10_000,
          iv: "proof-iv",
        },
      }),
    );

    await expect(
      store.readCashierPresence({
        organizationId: "org-1",
        operatingDate: "2026-06-04",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
    await expect(
      store.readCashierPresence({
        organizationId: "org-1",
        operatingDate: "2026-06-04",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("clears cashier presence without deleting staff authority", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 2_000,
    });

    await store.replaceStaffAuthoritySnapshot({
      storeId: "store-1",
      terminalId: "terminal-1",
      records: [buildAuthorityRecord({ expiresAt: 10_000 })],
    });
    await store.writeCashierPresence(buildCashierPresenceRecord());

    await expect(
      store.clearCashierPresence({
        organizationId: "org-1",
        operatingDate: "2026-06-04",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
    await expect(
      store.readCashierPresence({
        organizationId: "org-1",
        operatingDate: "2026-06-04",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
    await expect(
      store.readStaffAuthorityForUsername({
        storeId: "store-1",
        terminalId: "terminal-1",
        username: "frontdesk",
      }),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        credentialId: "credential-1",
      }),
    });
  });

  it("invalidates cashier presence for one terminal without clearing another terminal", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 2_000,
    });

    await store.writeCashierPresence(buildCashierPresenceRecord());
    await store.writeCashierPresence(
      buildCashierPresenceRecord({
        terminalId: "terminal-2",
      }),
    );

    await expect(
      store.invalidateCashierPresenceForTerminal({
        organizationId: "org-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: 1 });
    await expect(
      store.readCashierPresence({
        organizationId: "org-1",
        operatingDate: "2026-06-04",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
    await expect(
      store.readCashierPresence({
        organizationId: "org-1",
        operatingDate: "2026-06-04",
        storeId: "store-1",
        terminalId: "terminal-2",
      }),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        terminalId: "terminal-2",
      }),
    });
  });

  it("redacts cashier presence diagnostics without exposing wrapped proof material", () => {
    const diagnostic = toSafePosLocalCashierPresenceDiagnostic(
      buildCashierPresenceRecord({
        wrappedPosLocalStaffProof: {
          ciphertext: "wrapped-proof-token-secret",
          expiresAt: 10_000,
          iv: "proof-iv-secret",
        },
      }),
    );
    const serialized = JSON.stringify(diagnostic);

    expect(diagnostic).toMatchObject({
      proof: {
        expiresAt: 10_000,
        status: "present",
      },
      staffProfileId: "staff-1",
      username: "frontdesk",
    });
    expect(serialized).not.toContain("wrapped-proof-token-secret");
    expect(serialized).not.toContain("proof-iv-secret");
    expect(serialized).not.toContain("staffProofToken");
    expect(serialized).not.toContain("verifier");
    expect(serialized).not.toContain("syncSecret");
  });

  it("persists cashier presence through the IndexedDB cashier presence store", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const fakeIndexedDb = createControlledIndexedDb();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: fakeIndexedDb.indexedDB,
    });

    try {
      const store = createPosLocalStore({
        adapter: createIndexedDbPosLocalStorageAdapter({
          databaseName: "athena-pos-local-cashier-presence-test",
        }),
        clock: () => 2_000,
      });

      const write = store.writeCashierPresence(buildCashierPresenceRecord());
      await fakeIndexedDb.waitForTransaction();
      fakeIndexedDb.completeLastTransaction();
      await expect(write).resolves.toMatchObject({
        ok: true,
        value: {
          staffProfileId: "staff-1",
          username: "frontdesk",
        },
      });

      const read = store.readCashierPresence({
        organizationId: "org-1",
        operatingDate: "2026-06-04",
        storeId: "store-1",
        terminalId: "terminal-1",
      });
      await fakeIndexedDb.waitForTransaction();
      fakeIndexedDb.completeLastTransaction();
      await expect(read).resolves.toMatchObject({
        ok: true,
        value: expect.objectContaining({
          staffProfileId: "staff-1",
        }),
      });

      expect(fakeIndexedDb.database.createObjectStore).toHaveBeenCalledWith(
        "cashierPresence",
      );
      expect(fakeIndexedDb.database.transaction).toHaveBeenCalledWith(
        ["meta", "cashierPresence"],
        "readwrite",
      );
    } finally {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it("requires an unexpired wrapped proof before staff authority is offline ready", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 1_500,
    });

    await store.replaceStaffAuthoritySnapshot({
      storeId: "store-1",
      terminalId: "terminal-1",
      records: [
        buildAuthorityRecord({
          expiresAt: 3_000,
          wrappedPosLocalStaffProof: undefined,
        }),
      ],
    });

    await expect(
      store.getStaffAuthorityReadiness({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: "expired" });

    await store.upsertStaffAuthorityRecord({
      storeId: "store-1",
      terminalId: "terminal-1",
      record: buildAuthorityRecord({
        expiresAt: 3_000,
        wrappedPosLocalStaffProof: {
          ciphertext: "wrapped-proof-token",
          expiresAt: 3_000,
          iv: "proof-iv",
        },
      }),
    });

    await expect(
      store.getStaffAuthorityReadiness({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: "ready" });
  });

  it("upserts one staff authority record without clearing the terminal snapshot", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 1_500,
    });

    await store.replaceStaffAuthoritySnapshot({
      storeId: "store-1",
      terminalId: "terminal-1",
      records: [
        buildAuthorityRecord({ username: "frontdesk" }),
        buildAuthorityRecord({
          credentialId: "credential-2",
          staffProfileId: "staff-2",
          username: "manager",
        }),
      ],
    });

    await expect(
      store.upsertStaffAuthorityRecord({
        storeId: "store-1",
        terminalId: "terminal-1",
        record: buildAuthorityRecord({
          displayName: "Ama Updated",
          expiresAt: 4_000,
          username: "frontdesk",
        }),
      }),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        displayName: "Ama Updated",
        username: "frontdesk",
      }),
    });

    await expect(
      store.readStaffAuthorityForUsername({
        storeId: "store-1",
        terminalId: "terminal-1",
        username: "manager",
      }),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        credentialId: "credential-2",
        username: "manager",
      }),
    });
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

      const read = adapter.transaction(
        "readonly",
        ["events"],
        async (transaction) => ({
          event: await transaction.get("events", "1"),
          events: await transaction.getAll("events"),
        }),
      );
      await fakeIndexedDb.waitForTransaction();
      fakeIndexedDb.completeLastTransaction();

      await expect(read).resolves.toEqual({
        event: { localEventId: "event-1" },
        events: [{ localEventId: "event-1" }],
      });
      expect(fakeIndexedDb.database.close).toHaveBeenCalled();
      expect(fakeIndexedDb.database.createObjectStore).toHaveBeenCalledWith(
        "events",
      );
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
  let lastTransaction: { complete(): void; fail(error: Error): void } | null =
    null;
  const transactionWaiters: Array<() => void> = [];
  const database = {
    close: vi.fn(),
    createObjectStore: vi.fn((storeName: string) => {
      storeNames.add(storeName);
    }),
    objectStoreNames: {
      contains: (storeName: string) => storeNames.has(storeName),
    },
    transaction: vi.fn(
      (requestedStoreNames: string[], mode: IDBTransactionMode) => {
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
              delete: (key: string) => {
                store.delete(key);
                return createSuccessfulRequest(undefined);
              },
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
      },
    ),
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
    delete(key: string): IDBRequest<undefined>;
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
