import { describe, expect, it } from "vitest";

import { createLocalCommandGateway } from "./localCommandGateway";
import {
  createMemoryPosLocalStorageAdapter,
  createPosLocalStore,
} from "./posLocalStore";

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
          payload: {
            localPosSessionId: "session-1",
            reason: "Cart cleared",
          },
        }),
      ],
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
