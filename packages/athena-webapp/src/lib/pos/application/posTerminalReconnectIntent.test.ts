import { beforeEach, describe, expect, it } from "vitest";

import {
  POS_TERMINAL_RECONNECT_INTENT_STORAGE_KEY,
  clearPosTerminalReconnectIntent,
  readPosTerminalReconnectIntent,
  writePosTerminalReconnectIntent,
} from "./posTerminalReconnectIntent";

describe("POS terminal reconnect intent storage", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it("stores only the opaque token, expiry, and version", () => {
    expect(
      writePosTerminalReconnectIntent(
        { expiresAt: 10_000, reconnectIntentToken: "opaque-token-123456" },
        { now: 1_000, storage },
      ),
    ).toBe(true);
    expect(
      JSON.parse(
        storage.getItem(
          POS_TERMINAL_RECONNECT_INTENT_STORAGE_KEY,
        ) ?? "null",
      ),
    ).toEqual({
      expiresAt: 10_000,
      reconnectIntentToken: "opaque-token-123456",
      version: 1,
    });
  });

  it("fails closed and clears expired or structurally widened metadata", () => {
    storage.setItem(
      POS_TERMINAL_RECONNECT_INTENT_STORAGE_KEY,
      JSON.stringify({
        expiresAt: 1_000,
        reconnectIntentToken: "opaque-token-123456",
        storeId: "store-should-not-be-carried",
        version: 1,
      }),
    );
    expect(readPosTerminalReconnectIntent({ now: 2_000, storage })).toBeNull();
    expect(
      storage.getItem(POS_TERMINAL_RECONNECT_INTENT_STORAGE_KEY),
    ).toBeNull();
  });

  it("does not clear a newer intent while settling an older request", () => {
    const now = Date.now();
    writePosTerminalReconnectIntent(
      {
        expiresAt: now + 10_000,
        reconnectIntentToken: "newer-token-123456",
      },
      { now, storage },
    );
    clearPosTerminalReconnectIntent("older-token-123456", storage);
    expect(
      readPosTerminalReconnectIntent({ now: now + 2_000, storage }),
    ).toMatchObject({
      reconnectIntentToken: "newer-token-123456",
    });
  });
});

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
