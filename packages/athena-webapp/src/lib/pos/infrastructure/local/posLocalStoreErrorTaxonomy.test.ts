import { describe, expect, it } from "vitest";

import {
  createPosLocalStore,
  type PosLocalStorageAdapter,
} from "./posLocalStore";

function failingAdapter(error: Error): PosLocalStorageAdapter {
  return {
    transaction: async () => {
      throw error;
    },
  };
}

describe("POS local store error taxonomy", () => {
  it.each([
    ["QuotaExceededError", "quota_exceeded"],
    ["AbortError", "contention"],
    ["DataCloneError", "corruption"],
    ["InvalidStateError", "unavailable"],
    ["VersionError", "unsupported_schema_version"],
  ] as const)(
    "normalizes %s without exposing native detail",
    async (name, code) => {
      const native = new Error("sensitive native detail");
      native.name = name;
      const store = createPosLocalStore({ adapter: failingAdapter(native) });

      const result = await store.appendEvent({
        payload: {},
        storeId: "store-1",
        terminalId: "terminal-1",
        type: "session.started",
      });

      expect(result).toMatchObject({ ok: false, error: { code } });
      if (!result.ok) expect(result.error.message).not.toContain("sensitive");
    },
  );
});
