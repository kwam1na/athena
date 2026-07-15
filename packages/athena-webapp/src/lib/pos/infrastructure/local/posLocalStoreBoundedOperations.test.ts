import { describe, expect, it, vi } from "vitest";

import {
  createMemoryPosLocalStorageAdapter,
  createPosLocalStore,
  type PosLocalStorageAdapter,
} from "./posLocalStore";
import type { PosLocalOpaqueContinuation } from "@/lib/pos/application/posLocalStoreTypes";
import {
  readProjectedLocalRegisterModel,
  readScopedPosLocalEvents,
} from "./localRegisterReader";

function poisonWholeStoreReads(): {
  adapter: PosLocalStorageAdapter;
  getAll: ReturnType<typeof vi.fn>;
} {
  const base = createMemoryPosLocalStorageAdapter();
  const getAll = vi.fn(async () => {
    throw new Error("whole-store read is forbidden on this path");
  });
  return {
    getAll,
    adapter: {
      transaction: (mode, stores, callback) =>
        base.transaction(mode, stores, (transaction) =>
          callback({ ...transaction, getAll }),
        ),
    },
  };
}

describe("POS local store bounded operations", () => {
  it("summarizes a scoped ledger without materializing event records", async () => {
    const { adapter, getAll } = poisonWholeStoreReads();
    const store = createPosLocalStore({ adapter, clock: () => 123 });
    await store.appendEvent({
      payload: {},
      storeId: "store-1",
      terminalId: "terminal-1",
      type: "session.started",
    });
    await store.appendEvent({
      payload: {},
      storeId: "store-1",
      terminalId: "terminal-2",
      type: "session.started",
    });

    await expect(
      store.readLedgerSummary({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({
      ok: true,
      value: { eventCount: 1, oldestEventAt: 123 },
    });
    expect(getAll).not.toHaveBeenCalled();
  });

  it("reads scoped upload candidates without whole-ledger enumeration", async () => {
    const { adapter, getAll } = poisonWholeStoreReads();
    const store = createPosLocalStore({ adapter });
    await store.appendEvent({
      payload: {},
      storeId: "store-1",
      terminalId: "terminal-1",
      type: "session.started",
    });
    await store.appendEvent({
      payload: {},
      storeId: "store-1",
      terminalId: "terminal-2",
      type: "session.started",
    });

    const result = await store.listEventsForUpload({
      limit: 1,
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    expect(result).toMatchObject({
      ok: true,
      value: [{ storeId: "store-1", terminalId: "terminal-1" }],
    });
    expect(getAll).not.toHaveBeenCalled();
  });

  it("updates exact event ids without scanning unrelated events", async () => {
    const { adapter, getAll } = poisonWholeStoreReads();
    const store = createPosLocalStore({
      adapter,
      createLocalId: () => "event-1",
    });
    await store.appendEvent({
      payload: {},
      storeId: "store-1",
      terminalId: "terminal-1",
      type: "session.started",
    });

    const result = await store.markEventsSynced(["event-1"], {
      uploaded: true,
    });

    expect(result).toMatchObject({
      ok: true,
      value: [{ localEventId: "event-1", sync: { status: "synced" } }],
    });
    expect(getAll).not.toHaveBeenCalled();
  });

  it("replaces the current register mapping through a scoped engine query", async () => {
    const { adapter, getAll } = poisonWholeStoreReads();
    const store = createPosLocalStore({ adapter });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-1",
      entity: "registerSession",
      localId: "local-1",
      mappedAt: 1,
      registerCandidateState: "current",
      registerNumber: "1",
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-2",
      entity: "registerSession",
      localId: "local-2",
      mappedAt: 2,
      registerCandidateState: "current",
      registerNumber: "1",
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    await expect(
      store.readLocalCloudMapping({
        entity: "registerSession",
        localId: "local-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { registerCandidateState: "historical" },
    });
    expect(getAll).not.toHaveBeenCalled();
  });

  it("continues scoped upload pages without gaps or duplicate events", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: (() => {
        let id = 0;
        return () => `event-${++id}`;
      })(),
    });
    for (let index = 0; index < 3; index += 1) {
      await store.appendEvent({
        payload: { index },
        storeId: "store-1",
        terminalId: "terminal-1",
        type: "session.started",
      });
    }

    const first = await store.readUploadCandidatePage({
      limit: 2,
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    expect(first).toMatchObject({
      ok: true,
      value: { items: [{ sequence: 1 }, { sequence: 2 }] },
    });
    if (!first.ok || !first.value.continuation)
      throw new Error("missing continuation");
    const second = await store.readUploadCandidatePage({
      continuation: first.value.continuation,
      limit: 2,
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    expect(second).toMatchObject({
      ok: true,
      value: { items: [{ sequence: 3 }] },
    });

    await expect(
      store.readUploadCandidatePage({
        continuation: "application-made" as PosLocalOpaqueContinuation,
        limit: 2,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "read_failed" } });
  });

  it("replaces an exact register mapping beyond 100 terminal mappings", async () => {
    const { adapter, getAll } = poisonWholeStoreReads();
    const store = createPosLocalStore({ adapter });
    for (let register = 0; register < 125; register += 1) {
      await store.writeLocalCloudMapping({
        cloudId: `cloud-${register}`,
        entity: "registerSession",
        localId: `local-${register}`,
        mappedAt: register,
        registerCandidateState: "current",
        registerNumber: String(register),
        storeId: "store-1",
        terminalId: "terminal-1",
      });
    }
    await store.writeLocalCloudMapping({
      cloudId: "cloud-replacement",
      entity: "registerSession",
      localId: "local-replacement",
      mappedAt: 200,
      registerCandidateState: "current",
      registerNumber: "1",
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    await expect(
      store.readLocalCloudMapping({
        entity: "registerSession",
        localId: "local-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { registerCandidateState: "historical" },
    });
    expect(getAll).not.toHaveBeenCalled();
  });

  it("builds projections from scoped pages without whole-ledger fallbacks", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter(),
      createLocalId: (() => {
        let id = 0;
        return () => `event-${++id}`;
      })(),
    });
    for (let index = 0; index < 251; index += 1) {
      await store.appendEvent({
        payload: { index },
        storeId: "store-1",
        terminalId: "terminal-1",
        type: "session.started",
      });
      await store.writeLocalCloudMapping({
        cloudId: `cloud-${index}`,
        entity: "posTransaction",
        localId: `sale-${index}`,
        mappedAt: index,
        storeId: "store-1",
        terminalId: "terminal-1",
      });
    }
    const readerStore = {
      ...store,
      listEvents: vi.fn(async () => {
        throw new Error("whole-ledger event fallback is forbidden");
      }),
      listLocalCloudMappings: vi.fn(async () => {
        throw new Error("whole-ledger mapping fallback is forbidden");
      }),
      readEventHistoryPage: vi.fn(store.readEventHistoryPage),
      readMappingPage: vi.fn(store.readMappingPage),
    };

    await expect(
      readScopedPosLocalEvents({
        store: readerStore,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toMatchObject({ ok: true, value: { events: { length: 251 } } });
    await expect(
      readProjectedLocalRegisterModel({
        store: readerStore,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(readerStore.readEventHistoryPage).toHaveBeenCalledTimes(4);
    expect(readerStore.readMappingPage).toHaveBeenCalledTimes(2);
    expect(readerStore.listEvents).not.toHaveBeenCalled();
    expect(readerStore.listLocalCloudMappings).not.toHaveBeenCalled();
  });
});

describe("evidence-gated ledger purge (U4)", () => {
  type Store = ReturnType<typeof createPosLocalStore>;

  async function appendSettledEvent(
    store: Store,
    input: {
      session: string;
      status?: "synced" | "locally_resolved" | "pending";
      reportActivity?: boolean;
    },
  ): Promise<string> {
    const appended = await store.appendEvent({
      payload: {},
      storeId: "store-1",
      terminalId: "terminal-1",
      localRegisterSessionId: input.session,
      initialSyncStatus: input.status ?? "synced",
      type: "session.started",
    });
    if (!appended.ok) throw new Error("Expected append to succeed");
    if (input.reportActivity ?? true) {
      await store.markEventsActivityReported([appended.value.localEventId]);
    }
    return appended.value.localEventId;
  }

  async function countEvents(adapter: PosLocalStorageAdapter): Promise<number> {
    return adapter.transaction("readonly", ["events"], async (transaction) => {
      const events = await transaction.getAll("events");
      return events.length;
    });
  }

  it("purges settled, unreferenced events from a prior session past the boundary", async () => {
    const adapter = createMemoryPosLocalStorageAdapter();
    const store = createPosLocalStore({ adapter, clock: () => 1_000 });
    await appendSettledEvent(store, { session: "prior-session" });
    await appendSettledEvent(store, { session: "prior-session" });
    await appendSettledEvent(store, { session: "active-session" });

    const result = await store.purgeSettledLedgerEvents({
      activeLocalRegisterSessionId: "active-session",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected purge to succeed");
    expect(result.value).toMatchObject({
      status: "completed",
      purgedCount: 2,
      retainedCount: 1,
    });
    // The active session's event survives; the ledger shrank.
    await expect(countEvents(adapter)).resolves.toBe(1);
  });

  it("never purges an unsynced event even past the boundary", async () => {
    const adapter = createMemoryPosLocalStorageAdapter();
    const store = createPosLocalStore({ adapter, clock: () => 1_000 });
    await appendSettledEvent(store, {
      session: "prior-session",
      status: "pending",
    });

    const result = await store.purgeSettledLedgerEvents({
      activeLocalRegisterSessionId: "active-session",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected purge to succeed");
    expect(result.value).toMatchObject({
      status: "completed",
      purgedCount: 0,
      retainedCount: 1,
    });
    await expect(countEvents(adapter)).resolves.toBe(1);
  });

  it("never purges a synced event whose session still holds drawer authority", async () => {
    const adapter = createMemoryPosLocalStorageAdapter();
    const store = createPosLocalStore({ adapter, clock: () => 1_000 });
    await appendSettledEvent(store, { session: "prior-session" });
    await store.writeDrawerAuthorityState({
      localRegisterSessionId: "prior-session",
      observedAt: 1_000,
      status: "healthy",
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    const result = await store.purgeSettledLedgerEvents({
      activeLocalRegisterSessionId: "active-session",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected purge to succeed");
    expect(result.value).toMatchObject({ status: "completed", purgedCount: 0 });
    await expect(countEvents(adapter)).resolves.toBe(1);
  });

  it("refuses to purge while a cashier is actively signed in", async () => {
    const adapter = createMemoryPosLocalStorageAdapter();
    const store = createPosLocalStore({ adapter, clock: () => 1_000 });
    await appendSettledEvent(store, { session: "prior-session" });
    await adapter.transaction(
      "readwrite",
      ["cashierPresence"],
      async (transaction) => {
        await transaction.put("cashierPresence", "terminal-1", {
          activeRoles: ["cashier"],
          credentialId: "credential-1",
          credentialVersion: 1,
          displayName: "Ama Mensah",
          expiresAt: 10_000,
          lastValidatedAt: 1_500,
          offlineFreshUntil: 5_000,
          operatingDate: "2026-07-15",
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
        });
      },
    );

    const result = await store.purgeSettledLedgerEvents({
      activeLocalRegisterSessionId: "active-session",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected purge to succeed");
    expect(result.value).toEqual({ status: "blocked", reason: "active_presence" });
    // Nothing was deleted.
    await expect(countEvents(adapter)).resolves.toBe(1);
  });

  it("never purges events of a session still mapped as current, even with no active id", async () => {
    const adapter = createMemoryPosLocalStorageAdapter();
    const store = createPosLocalStore({ adapter, clock: () => 1_000 });
    await appendSettledEvent(store, { session: "current-session" });
    await store.writeLocalCloudMapping({
      cloudId: "cloud-register-1",
      entity: "registerSession",
      localId: "current-session",
      mappedAt: 1_000,
      registerCandidateState: "current",
      registerNumber: "1",
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    const result = await store.purgeSettledLedgerEvents({});

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected purge to succeed");
    expect(result.value).toMatchObject({ status: "completed", purgedCount: 0 });
    await expect(countEvents(adapter)).resolves.toBe(1);
  });

  it("is a no-op when nothing is purgeable and surfaces the counts", async () => {
    const adapter = createMemoryPosLocalStorageAdapter();
    const store = createPosLocalStore({ adapter, clock: () => 1_000 });
    await appendSettledEvent(store, { session: "active-session" });

    const result = await store.purgeSettledLedgerEvents({
      activeLocalRegisterSessionId: "active-session",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected purge to succeed");
    expect(result.value).toEqual({
      status: "completed",
      purgedCount: 0,
      purgedSequences: [],
      retainedCount: 1,
    });
  });
});
