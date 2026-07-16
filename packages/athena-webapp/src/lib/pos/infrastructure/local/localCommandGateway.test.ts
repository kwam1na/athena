import { describe, expect, it, vi } from "vitest";

import { createLocalCommandGateway } from "./localCommandGateway";
import {
  createMemoryPosLocalStorageAdapter,
  createPosLocalStore,
  type PosLocalEventValidationMetadata,
} from "./posLocalStore";
import type { PosRegisterCatalogRowDto } from "@/lib/pos/application/dto";

function saleCommandInput() {
  return {
    terminalId: "terminal-1",
    storeId: "store-1",
    registerNumber: "1",
    localRegisterSessionId: "drawer-1",
    localPosSessionId: "session-1",
    staffProfileId: "staff-1",
  };
}

async function appendOpenDrawer(store: ReturnType<typeof createPosLocalStore>) {
  await store.appendEvent({
    type: "register.opened",
    terminalId: "terminal-1",
    storeId: "store-1",
    registerNumber: "1",
    localRegisterSessionId: "drawer-1",
    staffProfileId: "staff-1",
    payload: { localRegisterSessionId: "drawer-1", openingFloat: 100 },
  });
}

async function blockDrawerAuthority(
  store: ReturnType<typeof createPosLocalStore>,
) {
  await store.writeDrawerAuthorityState({
    cloudRegisterSessionId: "cloud-register-1",
    localRegisterSessionId: "drawer-1",
    observedAt: 10_010,
    reason: "cloud_closed",
    status: "blocked",
    storeId: "store-1",
    terminalId: "terminal-1",
  });
}

async function createBlockedSaleGateway() {
  const store = createPosLocalStore({
    adapter: createMemoryPosLocalStorageAdapter(),
  });
  await appendOpenDrawer(store);
  await store.appendEvent({
    type: "session.started",
    terminalId: "terminal-1",
    storeId: "store-1",
    registerNumber: "1",
    localRegisterSessionId: "drawer-1",
    localPosSessionId: "session-1",
    staffProfileId: "staff-1",
    payload: { localPosSessionId: "session-1" },
  });
  await store.appendEvent({
    type: "cart.item_added",
    terminalId: "terminal-1",
    storeId: "store-1",
    registerNumber: "1",
    localRegisterSessionId: "drawer-1",
    localPosSessionId: "session-1",
    staffProfileId: "staff-1",
    payload: {
      localItemId: "item-1",
      productId: "product-1",
      productName: "Body Wave",
      productSkuId: "sku-1",
      quantity: 1,
      price: 100,
    },
  });
  await blockDrawerAuthority(store);

  return {
    gateway: createLocalCommandGateway({ store }),
    store,
  };
}

describe("createLocalCommandGateway", () => {
  it("records store-day start without a drawer and updates readiness before cloud projection", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 10_000,
    });
    const gateway = createLocalCommandGateway({
      store,
      staffProofToken: "staff-proof-1",
    });

    const result = await gateway.startStoreDay({
      activeRoles: ["manager"],
      endAt: 86_400_000,
      operatingDate: "2026-07-13",
      staffProfileId: "staff-1",
      startAt: 0,
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        localEventId: expect.any(String),
        operatingDate: "2026-07-13",
        status: "started",
      },
    });
    await expect(store.readStoreDayReadiness({
      operatingDate: "2026-07-13",
      storeId: "store-1",
    })).resolves.toEqual({
      ok: true,
      value: {
        operatingDate: "2026-07-13",
        source: "local",
        status: "started",
        storeId: "store-1",
        updatedAt: 10_000,
      },
    });
    await expect(store.listEvents()).resolves.toEqual({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({
          localRegisterSessionId: "store-day:2026-07-13",
          staffProfileId: "staff-1",
          staffProofToken: "staff-proof-1",
          sync: { status: "pending" },
          type: "store_day.started",
          payload: {
            endAt: 86_400_000,
            operatingDate: "2026-07-13",
            startAt: 0,
          },
        }),
      ]),
    });
  });

  it("allows a cashier to start the store day locally", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const gateway = createLocalCommandGateway({ store });

    const result = await gateway.startStoreDay({
      activeRoles: ["cashier"],
      endAt: 200,
      operatingDate: "2026-07-13",
      staffProfileId: "staff-1",
      startAt: 100,
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    expect(result).toMatchObject({ kind: "ok" });
    await expect(store.listEvents()).resolves.toEqual({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({ type: "store_day.started" }),
      ]),
    });
  });

  it("rejects a local store-day start without a POS role", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const gateway = createLocalCommandGateway({ store });

    const result = await gateway.startStoreDay({
      activeRoles: [],
      endAt: 200,
      operatingDate: "2026-07-13",
      staffProfileId: "staff-1",
      startAt: 100,
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    expect(result).toMatchObject({
      kind: "user_error",
      error: { code: "authorization_failed" },
    });
  });

  it("commits the captured catalog pin with the first durable sale event", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 10_000,
    });
    await appendOpenDrawer(store);
    const rows: PosRegisterCatalogRowDto[] = [
      {
        id: "sku-1" as never,
        productSkuId: "sku-1" as never,
        skuId: "sku-1" as never,
        productId: "product-1" as never,
        name: "Body Wave",
        sku: "BW-18",
        barcode: "",
        price: 100,
        category: "Hair",
        description: "Body wave bundle",
        image: null,
        size: "18",
        length: 18,
        color: "natural",
        areProcessingFeesAbsorbed: false,
      },
    ];
    await store.stageRegisterCatalogVersion({
      revision: 1,
      rows,
      storeId: "store-1",
    });
    await store.promoteRegisterCatalogVersion({
      revision: 1,
      storeId: "store-1",
    });
    const gateway = createLocalCommandGateway({
      captureRegisterCatalogPin: () => ({ revision: 1, rows }),
      store,
    });

    await expect(
      gateway.appendCartItem({
        ...saleCommandInput(),
        payload: {
          localItemId: "item-1",
          productId: "product-1",
          productName: "Body Wave",
          productSkuId: "sku-1",
          productSku: "BW-18",
          quantity: 1,
          price: 100,
          areProcessingFeesAbsorbed: false,
        },
      }),
    ).resolves.toBe(true);

    await store.stageRegisterCatalogVersion({
      revision: 2,
      rows: [{ ...rows[0], name: "New catalog" }],
      storeId: "store-1",
    });
    await store.promoteRegisterCatalogVersion({
      revision: 2,
      storeId: "store-1",
    });

    expect(
      await store.readRegisterCatalogSelection({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toEqual({
      ok: true,
      value: expect.objectContaining({ revision: 1, rows }),
    });
    const eventResult = await store.listEvents();
    expect(eventResult.ok).toBe(true);
    expect(eventResult.ok ? eventResult.value.at(-1) : undefined).toEqual(
      expect.objectContaining({ catalogRevision: 1, type: "cart.item_added" }),
    );
  });

  it("keeps the action-start catalog pin through asynchronous command validation", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 10_000,
    });
    await appendOpenDrawer(store);
    const revisionOneRows: PosRegisterCatalogRowDto[] = [
      {
        id: "sku-1" as never,
        productSkuId: "sku-1" as never,
        skuId: "sku-1" as never,
        productId: "product-1" as never,
        name: "Body Wave",
        sku: "BW-18",
        barcode: "",
        price: 100,
        category: "Hair",
        description: "Body wave bundle",
        image: null,
        size: "18",
        length: 18,
        color: "natural",
        areProcessingFeesAbsorbed: false,
      },
    ];
    let selectedRevision = 1;
    const gateway = createLocalCommandGateway({
      captureRegisterCatalogPin: () => ({
        revision: selectedRevision,
        rows:
          selectedRevision === 1
            ? revisionOneRows
            : [{ ...revisionOneRows[0], name: "Promoted during validation" }],
      }),
      store,
    });

    const command = gateway.appendCartItem({
      ...saleCommandInput(),
      payload: {
        localItemId: "item-1",
        productId: "product-1",
        productName: "Body Wave",
        productSkuId: "sku-1",
        productSku: "BW-18",
        quantity: 1,
        price: 100,
        areProcessingFeesAbsorbed: false,
      },
    });
    selectedRevision = 2;

    await expect(command).resolves.toBe(true);
    const events = await store.listEvents();
    expect(events.ok && events.value.at(-1)).toEqual(
      expect.objectContaining({ catalogRevision: 1, type: "cart.item_added" }),
    );
    expect(
      await store.readRegisterCatalogSelection({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).toEqual({
      ok: true,
      value: expect.objectContaining({ revision: 1, rows: revisionOneRows }),
    });
  });

  it("blocks mutating drawer and sale commands while authority persistence failed", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await appendOpenDrawer(store);
    const authorityPersistenceFailed = vi.fn(() => true);
    const gateway = createLocalCommandGateway({
      authorityPersistenceFailed,
      store,
    });

    await expect(
      gateway.appendCartItem({
        ...saleCommandInput(),
        payload: { productId: "product-1" },
      }),
    ).resolves.toBe(false);
    await expect(
      gateway.openDrawer({
        openingFloat: 100,
        registerNumber: "1",
        staffProfileId: "staff-1" as never,
        storeId: "store-1" as never,
        terminalId: "terminal-1" as never,
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: { code: "unavailable", retryable: true },
    });
    await expect(
      gateway.startSession({
        ...saleCommandInput(),
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: { code: "unavailable", retryable: true },
    });
    expect(authorityPersistenceFailed).toHaveBeenCalled();
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [expect.objectContaining({ type: "register.opened" })],
    });
  });

  it("settles the action-start catalog guard when validation rejects the command", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const settleActionGuard = vi.fn();
    const gateway = createLocalCommandGateway({
      authorityPersistenceFailed: true,
      captureRegisterCatalogPin: () => ({
        revision: 1,
        rows: [],
        settleActionGuard,
      }),
      store,
    });

    await expect(
      gateway.appendCartItem({
        ...saleCommandInput(),
        payload: {
          localItemId: "item-1",
          productId: "product-1",
          productName: "Body Wave",
          productSkuId: "sku-1",
          productSku: "BW-18",
          quantity: 1,
          price: 100,
          areProcessingFeesAbsorbed: false,
        },
      }),
    ).resolves.toBe(false);

    expect(settleActionGuard).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit clear-cart available during authority persistence failure", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await appendOpenDrawer(store);
    await store.appendEvent({
      type: "session.started",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "drawer-1",
      localPosSessionId: "session-1",
      staffProfileId: "staff-1",
      payload: { localPosSessionId: "session-1" },
    });
    const gateway = createLocalCommandGateway({
      authorityPersistenceFailed: true,
      store,
    });

    await expect(
      gateway.clearCart({
        ...saleCommandInput(),
        reason: "Clear before retry",
      }),
    ).resolves.toBe(true);
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({ type: "cart.cleared" }),
      ]),
    });
  });

  it("opens the drawer and starts a sale locally without Convex", async () => {
    let nextId = 1;
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 10_000 + nextId,
      createLocalId: (kind) => `local-event-${kind}-${nextId++}`,
    });
    const gateway = createLocalCommandGateway({
      store,
      clock: () => 20_000 + nextId,
      createLocalId: (kind) => `${kind}-${nextId++}`,
      staffProofToken: "proof-1",
    });

    const opened = await gateway.openDrawer({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      openingFloat: 100,
      notes: "Morning drawer",
    });
    expect(opened).toMatchObject({
      kind: "ok",
      data: {
        localRegisterSessionId: "local-register-session-1",
        status: "open",
        openingFloat: 100,
      },
    });

    const started = await gateway.startSession({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
    });
    expect(started).toMatchObject({
      kind: "ok",
      data: { localPosSessionId: "local-pos-session-3" },
    });

    const events = await store.listEvents();
    expect(events).toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({ type: "register.opened" }),
        expect.objectContaining({ type: "session.started" }),
      ],
    });
  });

  it("notifies after a local event is durably appended", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const onEventAppended = vi.fn();
    const gateway = createLocalCommandGateway({
      store,
      onEventAppended,
    });

    await gateway.openDrawer({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      openingFloat: 100,
    });

    expect(onEventAppended).toHaveBeenCalledTimes(1);
  });

  it("opens the next drawer after a local closeout has synced", async () => {
    let nextId = 1;
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: (kind) => `local-event-${kind}-${nextId++}`,
    });
    const opened = await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "drawer-1",
      staffProfileId: "staff-1",
      payload: { localRegisterSessionId: "drawer-1", openingFloat: 100 },
    });
    await store.writeLocalCloudMapping({
      entity: "registerSession",
      localId: "drawer-1",
      cloudId: "cloud-drawer-1",
      mappedAt: 10_001,
    });
    const closeout = await store.appendEvent({
      type: "register.closeout_started",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "cloud-drawer-1",
      staffProfileId: "staff-1",
      payload: { countedCash: 100 },
    });
    expect(opened.ok).toBe(true);
    expect(closeout.ok).toBe(true);
    if (!opened.ok || !closeout.ok) return;
    await store.markEventsSynced(
      [opened.value.localEventId, closeout.value.localEventId],
      { uploaded: true },
    );

    const gateway = createLocalCommandGateway({
      store,
      createLocalId: (kind) => `${kind}-next`,
    });
    const nextDrawer = await gateway.openDrawer({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      openingFloat: 250,
    });

    expect(nextDrawer).toMatchObject({
      kind: "ok",
      data: {
        localRegisterSessionId: "local-register-session-next",
        openingFloat: 250,
      },
    });
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({
          localRegisterSessionId: "local-register-session-next",
          type: "register.opened",
        }),
      ]),
    });
  });

  it("persists app-session validation metadata on sale-affecting commands", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await appendOpenDrawer(store);
    const gateway = createLocalCommandGateway({
      store,
      staffProofToken: "proof-1",
    });

    await expect(
      gateway.completeTransaction({
        ...saleCommandInput(),
        localTransactionId: "transaction-1",
        validationMetadata: {
          flags: ["app-session-unverified", "cloud-validation-uncertain"],
          observedAt: 2_000,
          uploadDeferredUntil: "app-session-validated",
        },
        payload: {
          localTransactionId: "transaction-1",
          receiptNumber: "LOCAL-1",
          subtotal: 100,
          tax: 0,
          total: 100,
          payments: [{ method: "cash", amount: 100, timestamp: 1 }],
        },
      }),
    ).resolves.toBe(true);

    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({
          type: "transaction.completed",
          validationMetadata: {
            flags: ["app-session-unverified", "cloud-validation-uncertain"],
            observedAt: 2_000,
            uploadDeferredUntil: "app-session-validated",
          },
        }),
      ]),
    });
  });

  it("defines pending checkout items locally before upload", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await appendOpenDrawer(store);
    await store.appendEvent({
      type: "session.started",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "drawer-1",
      localPosSessionId: "session-1",
      staffProfileId: "staff-1",
      payload: { localPosSessionId: "session-1" },
    });
    const gateway = createLocalCommandGateway({
      store,
      staffProofToken: "proof-1",
    });

    await expect(
      gateway.definePendingCheckoutItem({
        ...saleCommandInput(),
        payload: {
          localPendingCheckoutItemId: "local-pending-1",
          name: "Unknown gel",
          lookupCode: "999999999999",
          price: 2500,
          quantitySold: 2,
          localMetadata: {
            schema: "pos_pending_checkout_item_local_metadata_v1",
            createdOffline: true,
            cloudValidation: "uncertain",
          },
        },
      }),
    ).resolves.toBe(true);

    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({
          type: "pending_checkout_item.defined",
          staffProofToken: "proof-1",
          payload: expect.objectContaining({
            localPendingCheckoutItemId: "local-pending-1",
            quantitySold: 2,
          }),
        }),
      ]),
    });
  });

  it("persists app-session validation metadata on drawer lifecycle commands", async () => {
    const validationMetadata: PosLocalEventValidationMetadata = {
      flags: ["app-session-unverified", "cloud-validation-uncertain"],
      observedAt: 2_000,
      uploadDeferredUntil: "app-session-validated",
    };
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const gateway = createLocalCommandGateway({
      store,
      staffProofToken: "proof-1",
    });

    const opened = await gateway.openDrawer({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      validationMetadata,
      openingFloat: 100,
    });
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") {
      throw new Error("Expected drawer to open locally");
    }

    await store.appendEvent({
      type: "register.closeout_started",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: opened.data.localRegisterSessionId,
      staffProfileId: "staff-1",
      payload: { countedCash: 100 },
    });

    await expect(
      gateway.reopenRegister({
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: opened.data.localRegisterSessionId,
        staffProfileId: "staff-1",
        validationMetadata,
        reason: "Manager correction",
      }),
    ).resolves.toBe(true);

    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({
          type: "register.opened",
          validationMetadata,
        }),
        expect.objectContaining({
          type: "register.reopened",
          validationMetadata,
        }),
      ]),
    });

    const seedStore = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const seedGateway = createLocalCommandGateway({
      allowExplicitRegisterSessionWithoutProjection: true,
      store: seedStore,
      staffProofToken: "proof-1",
    });
    await expect(
      seedGateway.seedRegisterSession({
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "drawer-seed-1",
        staffProfileId: "staff-1",
        validationMetadata,
        openingFloat: 100,
        expectedCash: 100,
        status: "open",
      }),
    ).resolves.toBe(true);
    await expect(seedStore.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({
          type: "register.opened",
          validationMetadata,
        }),
      ],
    });
  });

  it("refuses to open a drawer when staff identity is missing", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const gateway = createLocalCommandGateway({ store });

    const result = await gateway.openDrawer({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "" as never,
      registerNumber: "1",
      openingFloat: 100,
    });

    expect(result).toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        message: "Staff sign-in required before selling can continue.",
      }),
    });
    await expect(store.listEvents()).resolves.toEqual({ ok: true, value: [] });
  });

  it("reuses an active mapped local drawer instead of appending a duplicate register open", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 10_000,
      createLocalId: (kind) => `local-event-${kind}`,
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      staffProfileId: "staff-1",
      payload: {
        localRegisterSessionId: "local-register-1",
        openingFloat: 100,
        expectedCash: 100,
        notes: "Morning drawer",
      },
    });
    await store.writeLocalCloudMapping({
      entity: "registerSession",
      localId: "local-register-1",
      cloudId: "cloud-register-1",
      mappedAt: 10_001,
    });
    const onEventAppended = vi.fn();
    const gateway = createLocalCommandGateway({
      store,
      createLocalId: (kind) => `${kind}-new`,
      onEventAppended,
    });

    const reopened = await gateway.openDrawer({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      openingFloat: 500,
      notes: "Duplicate open attempt",
    });

    expect(reopened).toMatchObject({
      kind: "ok",
      data: {
        localRegisterSessionId: "local-register-1",
        openingFloat: 100,
        expectedCash: 100,
        notes: "Morning drawer",
      },
    });
    expect(onEventAppended).not.toHaveBeenCalled();
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [expect.objectContaining({ type: "register.opened" })],
    });
  });

  it("reuses the active local drawer when lifecycle review is still pending", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 10_000,
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      staffProfileId: "staff-1",
      payload: {
        localRegisterSessionId: "local-register-1",
        openingFloat: 100,
      },
    });
    await store.writeDrawerAuthorityState({
      cloudRegisterSessionId: "cloud-register-1",
      localRegisterSessionId: "local-register-1",
      observedAt: 10_010,
      reason: "lifecycle_rejected",
      status: "blocked",
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    const onEventAppended = vi.fn();
    const gateway = createLocalCommandGateway({
      store,
      clock: () => 20_000,
      createLocalId: (kind) => `${kind}-2`,
      onEventAppended,
    });

    const result = await gateway.openDrawer({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      openingFloat: 500,
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        localRegisterSessionId: "local-register-1",
        openingFloat: 100,
      },
    });
    const started = await gateway.startSession({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
    });

    expect(started).toMatchObject({
      kind: "ok",
      data: { localPosSessionId: "local-pos-session-2" },
    });
    expect(onEventAppended).toHaveBeenCalledTimes(1);
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({
          localRegisterSessionId: "local-register-1",
          type: "register.opened",
        }),
        expect.objectContaining({
          localRegisterSessionId: "local-register-1",
          type: "session.started",
        }),
      ],
    });
  });

  it("opens a replacement drawer when the mapped local drawer is cloud-closed", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 10_000,
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      staffProfileId: "staff-1",
      payload: {
        localRegisterSessionId: "local-register-1",
        openingFloat: 100,
      },
    });
    await store.writeLocalCloudMapping({
      entity: "registerSession",
      localId: "local-register-1",
      cloudId: "cloud-register-1",
      mappedAt: 10_001,
    });
    await store.writeDrawerAuthorityState({
      cloudRegisterSessionId: "cloud-register-1",
      localRegisterSessionId: "local-register-1",
      observedAt: 10_010,
      reason: "cloud_closed",
      status: "blocked",
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    const gateway = createLocalCommandGateway({
      store,
      clock: () => 20_000,
      createLocalId: (kind) => `${kind}-2`,
    });

    const result = await gateway.openDrawer({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      openingFloat: 500,
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        localRegisterSessionId: "local-register-session-2",
        openingFloat: 500,
      },
    });
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({
          localRegisterSessionId: "local-register-1",
          type: "register.opened",
        }),
        expect.objectContaining({
          localRegisterSessionId: "local-register-session-2",
          type: "register.opened",
        }),
      ],
    });
  });

  it("opens a replacement drawer when a submitted closeout is under lifecycle review", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 10_000,
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      staffProfileId: "staff-1",
      payload: {
        localRegisterSessionId: "local-register-1",
        openingFloat: 100,
      },
    });
    await store.appendEvent({
      type: "register.closeout_started",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      staffProfileId: "staff-1",
      payload: { countedCash: 100 },
    });
    await store.writeDrawerAuthorityState({
      localRegisterSessionId: "local-register-1",
      observedAt: 10_010,
      reason: "lifecycle_rejected",
      status: "blocked",
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    const gateway = createLocalCommandGateway({
      store,
      clock: () => 20_000,
      createLocalId: (kind) => `${kind}-2`,
    });

    const result = await gateway.openDrawer({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      openingFloat: 500,
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        localRegisterSessionId: "local-register-session-2",
        openingFloat: 500,
      },
    });
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({
          localRegisterSessionId: "local-register-1",
          type: "register.opened",
        }),
        expect.objectContaining({
          localRegisterSessionId: "local-register-1",
          type: "register.closeout_started",
        }),
        expect.objectContaining({
          localRegisterSessionId: "local-register-session-2",
          type: "register.opened",
        }),
      ],
    });
  });

  it("refuses to start a sale from another store's local drawer", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 10_000,
      createLocalId: (kind) => `local-event-${kind}`,
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-other",
      storeId: "store-other",
      registerNumber: "9",
      localRegisterSessionId: "local-register-other",
      staffProfileId: "staff-1",
      payload: {
        localRegisterSessionId: "local-register-other",
        openingFloat: 100,
      },
    });

    const gateway = createLocalCommandGateway({ store });
    const result = await gateway.startSession({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        message: "Open the drawer before starting a sale.",
      }),
    });
  });

  it("starts a sale from an open local drawer while terminal support repair is pending", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 10_000,
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      staffProfileId: "staff-1",
      payload: {
        localRegisterSessionId: "local-register-1",
        openingFloat: 100,
      },
    });
    await store.writeTerminalIntegrityState({
      observedAt: 10_010,
      reason: "authorization_failed",
      status: "requires_reprovision",
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    const gateway = createLocalCommandGateway({ store });
    const result = await gateway.startSession({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        localPosSessionId: expect.any(String),
      },
    });
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({ type: "register.opened" }),
        expect.objectContaining({ type: "session.started" }),
      ],
    });
  });

  it("refuses to start a sale when staff identity is missing", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 10_000,
    });
    await appendOpenDrawer(store);

    const gateway = createLocalCommandGateway({ store });
    const result = await gateway.startSession({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      registerNumber: "1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        message: "Staff sign-in required before selling can continue.",
      }),
    });
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [expect.objectContaining({ type: "register.opened" })],
    });
  });

  it("does not open a new drawer when terminal integrity is blocked", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 10_000,
    });
    await store.writeTerminalIntegrityState({
      observedAt: 10_010,
      reason: "authorization_failed",
      status: "requires_reprovision",
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    const gateway = createLocalCommandGateway({ store });

    const result = await gateway.openDrawer({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      openingFloat: 100,
    });

    expect(result).toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        message: "Terminal setup needs repair before selling can continue.",
      }),
    });
    await expect(store.listEvents()).resolves.toEqual({ ok: true, value: [] });
  });

  it("starts a sale against an explicit usable local register session", async () => {
    let nextId = 1;
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 10_000 + nextId,
      createLocalId: (kind) => `local-event-${kind}-${nextId++}`,
    });
    const gateway = createLocalCommandGateway({
      store,
      clock: () => 20_000 + nextId,
      createLocalId: (kind) => `${kind}-${nextId++}`,
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      staffProfileId: "staff-1",
      payload: {
        localRegisterSessionId: "local-register-1",
        openingFloat: 100,
      },
    });

    const started = await gateway.startSession({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
    });

    expect(started).toMatchObject({
      kind: "ok",
      data: { localPosSessionId: "local-pos-session-2" },
    });
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({ type: "register.opened" }),
        expect.objectContaining({
          type: "session.started",
          localRegisterSessionId: "local-register-1",
        }),
      ],
    });
  });

  it("reuses an active local sale instead of appending a duplicate session", async () => {
    let nextId = 1;
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 10_000 + nextId,
      createLocalId: (kind) => `local-event-${kind}-${nextId++}`,
    });
    const gateway = createLocalCommandGateway({
      store,
      clock: () => 20_000 + nextId,
      createLocalId: (kind) => `${kind}-${nextId++}`,
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      staffProfileId: "staff-1",
      payload: {
        localRegisterSessionId: "local-register-1",
        openingFloat: 100,
      },
    });
    const first = await gateway.startSession({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
    });
    const second = await gateway.startSession({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
    });

    expect(first).toMatchObject({
      kind: "ok",
      data: { localPosSessionId: "local-pos-session-2" },
    });
    expect(second).toMatchObject({
      kind: "ok",
      data: { localPosSessionId: "local-pos-session-2" },
    });
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({ type: "register.opened" }),
        expect.objectContaining({ type: "session.started" }),
      ],
    });
  });

  it("starts a separate active local sale when the signed-in staff changes", async () => {
    let nextId = 1;
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      clock: () => 10_000 + nextId,
      createLocalId: (kind) => `local-event-${kind}-${nextId++}`,
    });
    const gateway = createLocalCommandGateway({
      store,
      clock: () => 20_000 + nextId,
      createLocalId: (kind) => `${kind}-${nextId++}`,
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      staffProfileId: "staff-1",
      payload: {
        localRegisterSessionId: "local-register-1",
        openingFloat: 100,
      },
    });
    const first = await gateway.startSession({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
    });
    const second = await gateway.startSession({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-2" as never,
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
    });

    expect(first).toMatchObject({
      kind: "ok",
      data: { localPosSessionId: "local-pos-session-2" },
    });
    expect(second).toMatchObject({
      kind: "ok",
      data: { localPosSessionId: "local-pos-session-4" },
    });
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({ type: "register.opened" }),
        expect.objectContaining({
          type: "session.started",
          staffProfileId: "staff-1",
        }),
        expect.objectContaining({
          type: "session.started",
          staffProfileId: "staff-2",
        }),
      ],
    });
  });

  it("uses the provisioned local terminal id when commands arrive with the cloud terminal id", async () => {
    let nextId = 1;
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: (kind) => `local-event-${kind}-${nextId++}`,
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "local-terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      staffProfileId: "staff-1",
      payload: {
        localRegisterSessionId: "local-register-1",
        openingFloat: 100,
      },
    });

    const gateway = createLocalCommandGateway({
      store: {
        ...store,
        readProvisionedTerminalSeed: async () => ({
          ok: true as const,
          value: {
            cloudTerminalId: "terminal-cloud-1",
            displayName: "Front",
            provisionedAt: 1,
            schemaVersion: 1 as const,
            syncSecretHash: "sync-secret-1",
            storeId: "store-1",
            terminalId: "local-terminal-1",
          },
        }),
      },
      createLocalId: (kind) => `${kind}-${nextId++}`,
    });

    const started = await gateway.startSession({
      storeId: "store-1" as never,
      terminalId: "terminal-cloud-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
    });

    expect(started).toMatchObject({
      kind: "ok",
      data: { localPosSessionId: "local-pos-session-2" },
    });
  });

  it("rejects explicit register sessions that are already closed locally", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      staffProfileId: "staff-1",
      payload: {
        localRegisterSessionId: "local-register-1",
        openingFloat: 100,
      },
    });
    await store.appendEvent({
      type: "register.closeout_started",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      staffProfileId: "staff-1",
      payload: { countedCash: 100 },
    });

    const gateway = createLocalCommandGateway({ store });
    const started = await gateway.startSession({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
    });

    expect(started).toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        message: "Open the drawer before starting a sale.",
      }),
    });
  });

  it("allows a locally closed register session to be reopened when authority is healthy", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      staffProfileId: "staff-1",
      payload: {
        localRegisterSessionId: "local-register-1",
        openingFloat: 100,
      },
    });
    await store.appendEvent({
      type: "register.closeout_started",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "local-register-1",
      staffProfileId: "staff-1",
      payload: { countedCash: 100 },
    });

    const gateway = createLocalCommandGateway({ store });

    await expect(
      gateway.reopenRegister({
        storeId: "store-1",
        terminalId: "terminal-1",
        registerNumber: "1",
        localRegisterSessionId: "local-register-1",
        staffProfileId: "staff-1",
        reason: "Manager correction",
      }),
    ).resolves.toBe(true);

    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({ type: "register.reopened" }),
      ]),
    });
  });

  it("fails closed when the local projection cannot be read for a sale command", async () => {
    const appendEvent = vi.fn();
    const gateway = createLocalCommandGateway({
      store: {
        appendEvent,
        listEvents: async () => ({
          ok: false as const,
          error: {
            code: "write_failed" as const,
            message: "IndexedDB read failed.",
          },
        }),
      },
    });

    await expect(
      gateway.appendCartItem({
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "local-register-1",
        localPosSessionId: "local-pos-session-1",
        staffProfileId: "staff-1",
        payload: {
          localItemId: "item-1",
          productId: "product-1",
          productName: "Body Wave",
          productSkuId: "sku-1",
          quantity: 1,
          price: 120,
        },
      }),
    ).resolves.toBe(false);
    expect(appendEvent).not.toHaveBeenCalled();
  });

  it.each([
    [
      "cart item",
      async (gateway: ReturnType<typeof createLocalCommandGateway>) =>
        gateway.appendCartItem({
          ...saleCommandInput(),
          payload: {
            localItemId: "item-1",
            productId: "product-1",
            productName: "Body Wave",
            productSkuId: "sku-1",
            quantity: 1,
            price: 120,
          },
        }),
    ],
    [
      "service line",
      async (gateway: ReturnType<typeof createLocalCommandGateway>) =>
        gateway.appendServiceLine({
          ...saleCommandInput(),
          payload: {
            localServiceLineId: "service-line-1",
            serviceCatalogId: "service-1",
            name: "Install",
            amount: 100,
          },
        }),
    ],
    [
      "payment state",
      async (gateway: ReturnType<typeof createLocalCommandGateway>) =>
        gateway.appendPaymentState({
          ...saleCommandInput(),
          checkoutStateVersion: 1,
          payments: [
            { id: "payment-1", method: "cash", amount: 100, timestamp: 1 },
          ],
          stage: "paymentAdded",
        }),
    ],
    [
      "transaction completion",
      async (gateway: ReturnType<typeof createLocalCommandGateway>) =>
        gateway.completeTransaction({
          ...saleCommandInput(),
          localTransactionId: "transaction-1",
          payload: {
            localTransactionId: "transaction-1",
            receiptNumber: "LOCAL-1",
            subtotal: 100,
            tax: 0,
            total: 100,
            payments: [{ method: "cash", amount: 100, timestamp: 1 }],
          },
        }),
    ],
    [
      "clear cart with prior sale activity",
      async (gateway: ReturnType<typeof createLocalCommandGateway>) =>
        gateway.clearCart({
          ...saleCommandInput(),
          reason: "Cart cleared",
        }),
    ],
  ])(
    "blocks %s when the command points at a stale drawer",
    async (_label, runCommand) => {
      const store = createPosLocalStore({
        adapter: createMemoryPosLocalStorageAdapter(),
      });
      await appendOpenDrawer(store);
      await store.appendEvent({
        type: "session.started",
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
        staffProfileId: "staff-1",
        payload: { localPosSessionId: "session-1" },
      });
      await store.appendEvent({
        type: "cart.item_added",
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
        staffProfileId: "staff-1",
        payload: {
          localItemId: "existing-item-1",
          productId: "product-1",
          productName: "Body Wave",
          productSkuId: "sku-1",
          quantity: 1,
          price: 100,
        },
      });
      await store.appendEvent({
        type: "register.opened",
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "drawer-2",
        staffProfileId: "staff-1",
        payload: { localRegisterSessionId: "drawer-2", openingFloat: 200 },
      });
      const gateway = createLocalCommandGateway({ store });

      await expect(runCommand(gateway)).resolves.toBe(false);
      await expect(store.listEvents()).resolves.toMatchObject({
        ok: true,
        value: [
          expect.objectContaining({ type: "register.opened" }),
          expect.objectContaining({ type: "session.started" }),
          expect.objectContaining({ type: "cart.item_added" }),
          expect.objectContaining({ type: "register.opened" }),
        ],
      });
    },
  );

  it.each([
    [
      "service line",
      async (gateway: ReturnType<typeof createLocalCommandGateway>) =>
        gateway.appendServiceLine({
          ...saleCommandInput(),
          payload: {
            localServiceLineId: "service-line-1",
            serviceCatalogId: "service-1",
            name: "Install",
            amount: 100,
          },
        }),
    ],
    [
      "payment state",
      async (gateway: ReturnType<typeof createLocalCommandGateway>) =>
        gateway.appendPaymentState({
          ...saleCommandInput(),
          checkoutStateVersion: 1,
          payments: [
            { id: "payment-1", method: "cash", amount: 100, timestamp: 1 },
          ],
          stage: "paymentAdded",
        }),
    ],
    [
      "transaction completion",
      async (gateway: ReturnType<typeof createLocalCommandGateway>) =>
        gateway.completeTransaction({
          ...saleCommandInput(),
          localTransactionId: "transaction-1",
          payload: {
            localTransactionId: "transaction-1",
            receiptNumber: "LOCAL-1",
            subtotal: 100,
            tax: 0,
            total: 100,
            payments: [{ method: "cash", amount: 100, timestamp: 1 }],
          },
        }),
    ],
  ])(
    "blocks %s when drawer authority is blocked",
    async (_label, runCommand) => {
      const { gateway, store } = await createBlockedSaleGateway();

      await expect(runCommand(gateway)).resolves.toBe(false);
      await expect(store.listEvents()).resolves.toMatchObject({
        ok: true,
        value: [
          expect.objectContaining({ type: "register.opened" }),
          expect.objectContaining({ type: "session.started" }),
          expect.objectContaining({ type: "cart.item_added" }),
        ],
      });
    },
  );

  it("allows only cart clear for the exact old drawer when cloud authority closed it", async () => {
    const { gateway, store } = await createBlockedSaleGateway();

    await expect(
      gateway.clearCart({
        ...saleCommandInput(),
        reason: "Clear old drawer sale",
      }),
    ).resolves.toBe(true);
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({
          localPosSessionId: "session-1",
          localRegisterSessionId: "drawer-1",
          type: "cart.cleared",
        }),
      ]),
    });
  });

  it("blocks closeout when drawer authority is blocked", async () => {
    const { gateway, store } = await createBlockedSaleGateway();

    await expect(
      gateway.startCloseout({
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "drawer-1",
        staffProfileId: "staff-1",
        countedCash: 100,
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        message: "Drawer setup needs repair before closeout can continue.",
      }),
    });
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: expect.not.arrayContaining([
        expect.objectContaining({ type: "register.closeout_started" }),
      ]),
    });
  });

  it("blocks register reopen when drawer authority is blocked", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await appendOpenDrawer(store);
    await store.appendEvent({
      type: "register.closeout_started",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "drawer-1",
      staffProfileId: "staff-1",
      payload: { countedCash: 100 },
    });
    await blockDrawerAuthority(store);
    const gateway = createLocalCommandGateway({ store });

    await expect(
      gateway.reopenRegister({
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "drawer-1",
        staffProfileId: "staff-1",
        reason: "Manager correction",
      }),
    ).resolves.toBe(false);
  });

  it("blocks explicit register seeding when drawer authority is blocked before projection", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await blockDrawerAuthority(store);
    const gateway = createLocalCommandGateway({
      allowExplicitRegisterSessionWithoutProjection: true,
      store,
    });

    await expect(
      gateway.seedRegisterSession({
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "drawer-1",
        staffProfileId: "staff-1",
        openingFloat: 100,
        expectedCash: 100,
        status: "open",
      }),
    ).resolves.toBe(false);
    await expect(store.listEvents()).resolves.toEqual({ ok: true, value: [] });
  });

  it("allows runtime directive register seeding over stale closeout history", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await appendOpenDrawer(store);
    await store.appendEvent({
      type: "register.closeout_started",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "drawer-1",
      staffProfileId: "staff-1",
      payload: { countedCash: 100 },
    });
    const gateway = createLocalCommandGateway({
      allowExplicitRegisterSessionWithoutProjection: true,
      allowRegisterSessionSeedFromRuntimeDirective: true,
      store,
    });

    await expect(
      gateway.seedRegisterSession({
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        cloudRegisterSessionId: "cloud-drawer-1",
        localRegisterSessionId: "cloud-drawer-1",
        staffProfileId: "staff-1",
        openingFloat: 100,
        expectedCash: 100,
        runtimeDirectiveRepair: true,
        status: "active",
      }),
    ).resolves.toBe(true);

    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({
          localRegisterSessionId: "cloud-drawer-1",
          sync: { status: "synced" },
          type: "register.opened",
        }),
      ]),
    });
    const events = await store.listEvents();
    expect(events.ok).toBe(true);
    if (events.ok) {
      const seededEvent = events.value.find(
        (event) => event.localRegisterSessionId === "cloud-drawer-1",
      );
      expect(seededEvent).not.toHaveProperty("uploadSequence");
    }
  });

  it("does not duplicate runtime directive register seeding once the drawer is active", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const gateway = createLocalCommandGateway({
      allowExplicitRegisterSessionWithoutProjection: true,
      allowRegisterSessionSeedFromRuntimeDirective: true,
      store,
    });
    const seedInput = {
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      cloudRegisterSessionId: "cloud-drawer-1",
      localRegisterSessionId: "cloud-drawer-1",
      staffProfileId: "staff-1",
      openingFloat: 100,
      expectedCash: 100,
      runtimeDirectiveRepair: true,
      status: "active" as const,
    };

    await expect(gateway.seedRegisterSession(seedInput)).resolves.toBe(true);
    await expect(gateway.seedRegisterSession(seedInput)).resolves.toBe(true);

    const events = await store.listEvents();
    expect(events).toMatchObject({ ok: true });
    if (!events.ok) throw new Error(events.error.message);
    expect(
      events.value.filter(
        (event) =>
          event.type === "register.opened" &&
          event.localRegisterSessionId === "cloud-drawer-1",
      ),
    ).toHaveLength(1);
    expect(events.value[0]).toMatchObject({
      sync: { status: "synced" },
    });
    expect(events.value[0]).not.toHaveProperty("uploadSequence");
    await expect(
      store.readLocalCloudMapping({
        entity: "registerSession",
        localId: "cloud-drawer-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        cloudId: "cloud-drawer-1",
        localId: "cloud-drawer-1",
      },
    });
  });

  it("writes a missing cloud mapping when runtime directive seeding is already active", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await appendOpenDrawer(store);
    const gateway = createLocalCommandGateway({
      allowExplicitRegisterSessionWithoutProjection: true,
      allowRegisterSessionSeedFromRuntimeDirective: true,
      store,
    });

    await expect(
      gateway.seedRegisterSession({
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        cloudRegisterSessionId: "cloud-drawer-1",
        localRegisterSessionId: "drawer-1",
        staffProfileId: "staff-1",
        openingFloat: 100,
        expectedCash: 100,
        runtimeDirectiveRepair: true,
        status: "active",
      }),
    ).resolves.toBe(true);

    await expect(
      store.readLocalCloudMapping({
        entity: "registerSession",
        localId: "drawer-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        cloudId: "cloud-drawer-1",
        localId: "drawer-1",
      },
    });
    const events = await store.listEvents();
    expect(events).toMatchObject({ ok: true });
    if (!events.ok) throw new Error(events.error.message);
    expect(
      events.value.filter(
        (event) =>
          event.type === "register.opened" &&
          event.localRegisterSessionId === "drawer-1",
      ),
    ).toHaveLength(1);
  });

  it("rejects runtime directive register seeding when a different local drawer is already operable", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await appendOpenDrawer(store);
    const gateway = createLocalCommandGateway({
      allowExplicitRegisterSessionWithoutProjection: true,
      allowRegisterSessionSeedFromRuntimeDirective: true,
      store,
    });

    await expect(
      gateway.seedRegisterSession({
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "cloud-drawer-1",
        staffProfileId: "staff-1",
        openingFloat: 100,
        expectedCash: 100,
        runtimeDirectiveRepair: true,
        status: "active",
      }),
    ).resolves.toBe(false);
  });

  it("blocks explicit sale start when drawer authority is blocked before projection", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await blockDrawerAuthority(store);
    const gateway = createLocalCommandGateway({
      allowExplicitRegisterSessionWithoutProjection: true,
      store,
    });

    await expect(
      gateway.startSession({
        terminalId: "terminal-1" as never,
        storeId: "store-1" as never,
        registerNumber: "1",
        localRegisterSessionId: "drawer-1",
        staffProfileId: "staff-1" as never,
      }),
    ).resolves.toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        message: "Drawer setup needs repair before selling can continue.",
      }),
    });
    await expect(store.listEvents()).resolves.toEqual({ ok: true, value: [] });
  });

  it("allows register reopen while drawer lifecycle review is pending", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    await appendOpenDrawer(store);
    const closeout = await store.appendEvent({
      type: "register.closeout_started",
      terminalId: "terminal-1",
      storeId: "store-1",
      registerNumber: "1",
      localRegisterSessionId: "drawer-1",
      staffProfileId: "staff-1",
      payload: { countedCash: 100 },
    });
    if (!closeout.ok) throw new Error("Failed to seed closeout event");
    await store.markEventsNeedsReview(
      [closeout.value.localEventId],
      "Cloud sync needs review before this local event can finish.",
      { uploaded: true },
    );
    const gateway = createLocalCommandGateway({ store });

    await expect(
      gateway.reopenRegister({
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "drawer-1",
        staffProfileId: "staff-1",
        reason: "Manager correction",
      }),
    ).resolves.toBe(true);
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({ type: "register.reopened" }),
      ]),
    });
  });

  it("allows an explicit register session before projection when explicitly trusted", async () => {
    let nextId = 1;
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: (kind) => `local-event-${kind}-${nextId++}`,
    });
    const gateway = createLocalCommandGateway({
      allowExplicitRegisterSessionWithoutProjection: true,
      store,
      createLocalId: (kind) => `${kind}-${nextId++}`,
    });

    const result = await gateway.startSession({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      localRegisterSessionId: "drawer-1",
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: { localPosSessionId: "local-pos-session-1" },
    });
  });

  it("rejects an explicit register session before projection by default", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const gateway = createLocalCommandGateway({ store });

    const result = await gateway.startSession({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      localRegisterSessionId: "drawer-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        message: "Open the drawer before starting a sale.",
      }),
    });
  });

  it("clears a cart with one scoped local event", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
    });
    const gateway = createLocalCommandGateway({ store });

    await expect(
      gateway.clearCart({
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
        staffProfileId: "staff-1",
        reason: "Cart cleared",
      }),
    ).resolves.toBe(true);

    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({
          type: "cart.cleared",
          terminalId: "terminal-1",
          storeId: "store-1",
          registerNumber: "1",
          localRegisterSessionId: "drawer-1",
          localPosSessionId: "session-1",
          staffProfileId: "staff-1",
          sync: { status: "synced" },
          payload: {
            localPosSessionId: "session-1",
            reason: "Cart cleared",
          },
        }),
      ],
    });
    const events = await store.listEvents();
    expect(events.ok).toBe(true);
    if (events.ok) {
      expect(events.value[0]).not.toHaveProperty("uploadSequence");
    }
  });

  it("keeps clear events uploadable when the local sale had cart activity", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: (kind) => `${kind}-1`,
    });
    const gateway = createLocalCommandGateway({
      store,
      staffProofToken: "proof-token-1",
    });

    await store.appendEvent({
      type: "register.opened",
      terminalId: "terminal-1",
      storeId: "store-1",
      localRegisterSessionId: "drawer-1",
      staffProfileId: "staff-1",
      payload: { openingFloat: 100 },
    });
    await store.appendEvent({
      type: "session.started",
      terminalId: "terminal-1",
      storeId: "store-1",
      localRegisterSessionId: "drawer-1",
      localPosSessionId: "session-1",
      staffProfileId: "staff-1",
      payload: { localPosSessionId: "session-1" },
    });
    await store.appendEvent({
      type: "cart.item_added",
      terminalId: "terminal-1",
      storeId: "store-1",
      localRegisterSessionId: "drawer-1",
      localPosSessionId: "session-1",
      staffProfileId: "staff-1",
      payload: {
        localItemId: "item-1",
        productId: "product-1",
        productName: "Body Wave",
        productSkuId: "sku-1",
        quantity: 1,
        price: 120,
      },
    });

    await expect(
      gateway.clearCart({
        terminalId: "terminal-1",
        storeId: "store-1",
        registerNumber: "1",
        localRegisterSessionId: "drawer-1",
        localPosSessionId: "session-1",
        staffProfileId: "staff-1",
        reason: "Cart cleared",
      }),
    ).resolves.toBe(true);

    await expect(store.listEventsForUpload()).resolves.toMatchObject({
      ok: true,
      value: expect.arrayContaining([
        expect.objectContaining({
          type: "cart.cleared",
          uploadSequence: 2,
          staffProofToken: "proof-token-1",
          sync: { status: "pending" },
        }),
      ]),
    });
  });

  it("returns a local user error when the event append fails", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter({
        failNextPutForStore: "events",
      }),
    });
    const gateway = createLocalCommandGateway({
      store,
      createLocalId: () => "local-register-session-1",
    });

    const result = await gateway.openDrawer({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      openingFloat: 100,
    });

    expect(result).toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        code: "unavailable",
        message: "POS local storage could not save this operation.",
        retryable: true,
      }),
    });
    await expect(store.listEvents()).resolves.toEqual({ ok: true, value: [] });
  });
});
