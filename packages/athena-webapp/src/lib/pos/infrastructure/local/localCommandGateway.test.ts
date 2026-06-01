import { describe, expect, it, vi } from "vitest";

import { createLocalCommandGateway } from "./localCommandGateway";
import {
  createMemoryPosLocalStorageAdapter,
  createPosLocalStore,
} from "./posLocalStore";

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

async function blockDrawerAuthority(store: ReturnType<typeof createPosLocalStore>) {
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

  it("opens a replacement drawer when the active drawer is blocked by lifecycle review", async () => {
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
        localRegisterSessionId: "local-register-session-2",
        openingFloat: 500,
      },
    });
    const started = await gateway.startSession({
      storeId: "store-1" as never,
      terminalId: "terminal-1" as never,
      staffProfileId: "staff-1" as never,
      registerNumber: "1",
      localRegisterSessionId: "local-register-session-2",
    });

    expect(started).toMatchObject({
      kind: "ok",
      data: { localPosSessionId: "local-pos-session-2" },
    });
    expect(onEventAppended).toHaveBeenCalledTimes(2);
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
        expect.objectContaining({
          localRegisterSessionId: "local-register-session-2",
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

  it("refuses to start a sale when terminal integrity is blocked", async () => {
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

    expect(result).toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        message: "Terminal setup needs repair before selling can continue.",
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
          payments: [{ id: "payment-1", method: "cash", amount: 100, timestamp: 1 }],
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
  ])("blocks %s when the command points at a stale drawer", async (_label, runCommand) => {
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
  });

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
          payments: [{ id: "payment-1", method: "cash", amount: 100, timestamp: 1 }],
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
  ])("blocks %s when drawer authority is blocked", async (_label, runCommand) => {
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

  it("blocks register reopen while drawer lifecycle needs review", async () => {
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
    ).resolves.toBe(false);
    await expect(store.listEvents()).resolves.toMatchObject({
      ok: true,
      value: expect.not.arrayContaining([
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
        message: "POS local store could not write the local event.",
        retryable: true,
      }),
    });
    await expect(store.listEvents()).resolves.toEqual({ ok: true, value: [] });
  });
});
