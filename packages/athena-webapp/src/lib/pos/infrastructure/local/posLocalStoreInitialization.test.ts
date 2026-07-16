import { describe, expect, it } from "vitest";

import { POS_LOCAL_LOGICAL_RECORD_VERSION } from "@/lib/pos/application/posLocalStoreTypes";
import {
  createMemoryPosLocalStorageAdapter,
  createPosLocalStore,
  type PosLocalStorageAdapter,
} from "./posLocalStore";

describe("POS local store initialization", () => {
  it("persists the current logical record version independently of engine layout", async () => {
    const adapter = createMemoryPosLocalStorageAdapter({ schemaVersion: 9 });
    await adapter.transaction("readwrite", ["events"], (transaction) =>
      transaction.put("events", "1", {
        localEventId: "legacy-event",
        schemaVersion: 9,
      }),
    );
    const store = createPosLocalStore({ adapter });

    await expect(store.initializeStorage()).resolves.toEqual({
      ok: true,
      value: { logicalRecordVersion: POS_LOCAL_LOGICAL_RECORD_VERSION },
    });
    await expect(
      adapter.transaction(
        "readonly",
        ["events", "meta"],
        async (transaction) => ({
          event: await transaction.get<Record<string, unknown>>("events", "1"),
          logicalVersion: await transaction.get<number>(
            "meta",
            "logicalRecordVersion",
          ),
        }),
      ),
    ).resolves.toEqual({
      event: {
        localEventId: "legacy-event",
        logicalRecordVersion: POS_LOCAL_LOGICAL_RECORD_VERSION,
        schemaVersion: POS_LOCAL_LOGICAL_RECORD_VERSION,
      },
      logicalVersion: POS_LOCAL_LOGICAL_RECORD_VERSION,
    });
  });

  it("refuses a future logical record version non-destructively", async () => {
    const store = createPosLocalStore({
      adapter: createMemoryPosLocalStorageAdapter({
        logicalRecordVersion: POS_LOCAL_LOGICAL_RECORD_VERSION + 1,
      }),
    });

    await expect(store.initializeStorage()).resolves.toMatchObject({
      ok: false,
      error: { code: "unsupported_logical_record_version" },
    });
  });

  it("widens v1 terminal seeds without synthesizing offline authority", async () => {
    const adapter = createMemoryPosLocalStorageAdapter({
      logicalRecordVersion: 1,
      schemaVersion: 9,
    });
    await adapter.transaction("readwrite", ["terminalSeed"], (transaction) =>
      transaction.put("terminalSeed", "current", {
        cloudTerminalId: "terminal-1",
        displayName: "Front",
        provisionedAt: 1,
        schemaVersion: 1,
        storeId: "store-1",
        syncSecretHash: "legacy-proof",
        terminalId: "fingerprint-1",
      }),
    );
    const store = createPosLocalStore({ adapter });

    await expect(store.initializeStorage()).resolves.toEqual({
      ok: true,
      value: { logicalRecordVersion: POS_LOCAL_LOGICAL_RECORD_VERSION },
    });
    const seed = await store.readProvisionedTerminalSeed();
    expect(seed).toMatchObject({
      ok: true,
      value: {
        cloudTerminalId: "terminal-1",
        schemaVersion: POS_LOCAL_LOGICAL_RECORD_VERSION,
      },
    });
    expect(seed.ok ? seed.value : null).not.toHaveProperty(
      "offlineAuthorityReceipt",
    );
  });

  it("rolls back the legacy transform and marker when migration fails", async () => {
    const base = createMemoryPosLocalStorageAdapter({ schemaVersion: 9 });
    await base.transaction("readwrite", ["events"], (transaction) =>
      transaction.put("events", "1", {
        localEventId: "legacy-event",
        schemaVersion: 9,
      }),
    );
    let failMigration = true;
    const adapter: PosLocalStorageAdapter = {
      transaction: (mode, stores, callback) =>
        base.transaction(mode, stores, (transaction) =>
          callback({
            ...transaction,
            put: async (storeName, key, value) => {
              if (failMigration && storeName === "events") {
                failMigration = false;
                throw new Error("migration failed");
              }
              return transaction.put(storeName, key, value);
            },
          }),
        ),
    };
    const store = createPosLocalStore({ adapter });

    await expect(store.initializeStorage()).resolves.toMatchObject({
      ok: false,
      error: { code: "write_failed" },
    });
    await expect(
      base.transaction("readonly", ["events", "meta"], async (transaction) => ({
        event: await transaction.get("events", "1"),
        logicalVersion: await transaction.get("meta", "logicalRecordVersion"),
      })),
    ).resolves.toEqual({
      event: { localEventId: "legacy-event", schemaVersion: 9 },
      logicalVersion: undefined,
    });
  });
});
