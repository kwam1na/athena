import { afterEach, describe, expect, it, vi } from "vitest";

import { setPosErrorTelemetrySink } from "@/lib/pos/application/errorTelemetry";
import {
  clearPosClientTelemetryBuffer,
  enqueuePosClientEvent,
  peekPosClientEventBatch,
} from "@/lib/pos/infrastructure/telemetry/telemetryBuffer";

import {
  createPosLocalStore,
  type PosLocalStorageAdapter,
} from "./posLocalStore";

function failingAdapter(error: Error): PosLocalStorageAdapter {
  return {
    diagnosticStorageEngine: "indexeddb",
    transaction: async () => {
      throw error;
    },
  } as PosLocalStorageAdapter;
}

describe("POS local store error taxonomy", () => {
  afterEach(() => {
    setPosErrorTelemetrySink(null);
    clearPosClientTelemetryBuffer();
  });

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

  it("reports an append AbortError once with finite drawer context", async () => {
    window.history.replaceState({}, "", "/org-1/store/store-1/pos/register");
    clearPosClientTelemetryBuffer();
    const sink = vi.fn((report) => {
      enqueuePosClientEvent({
        classification: report.classification ?? "unexpected_application_error",
        error: report.error,
        flow: report.flow,
        level: "error",
        localRegisterSessionId: report.localRegisterSessionId,
        metadata: report.metadata,
        operation: report.operation,
      });
    });
    setPosErrorTelemetrySink(sink);
    const native = new Error("customer-secret receipt-123");
    native.name = "AbortError";
    native.stack =
      "AbortError: customer-secret receipt-123\n    at openDrawer (https://athena.test/assets/register.js:42:7)";
    const store = createPosLocalStore({ adapter: failingAdapter(native) });

    const result = await store.appendEvent(
      {
        payload: { customerName: "customer-secret" },
        storeId: "store-1",
        terminalId: "terminal-1",
        type: "register.opened",
      },
      {
        flow: "register",
        localRegisterSessionId: "local-register-session-1",
        operation: "openDrawer",
      },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "contention" },
    });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith({
      classification: "local_storage_transaction_failed",
      error: native,
      flow: "register",
      localRegisterSessionId: "local-register-session-1",
      message: "POS local storage operation failed",
      metadata: {
        accessMode: "readwrite",
        storageCode: "contention",
        storageEngine: "indexeddb",
      },
      operation: "openDrawer",
    });
    expect(JSON.stringify(sink.mock.calls[0]?.[0]?.metadata)).not.toContain(
      "customer-secret",
    );
    const [buffered] = peekPosClientEventBatch(10);
    expect(buffered).toMatchObject({
      version: 2,
      classification: "local_storage_transaction_failed",
      errorName: "AbortError",
      flow: "register",
      localRegisterSessionId: "local-register-session-1",
      metadata: {
        accessMode: "readwrite",
        storageCode: "contention",
        storageEngine: "indexeddb",
      },
      operation: "openDrawer",
      routeId: "register",
      source: { asset: "register.js", column: 7, line: 42 },
    });
    expect(JSON.stringify(buffered)).not.toMatch(
      /customer-secret|receipt-123|customerName/,
    );
  });

  it("reports a non-append seed read with its fixed finite operation", async () => {
    const sink = vi.fn();
    setPosErrorTelemetrySink(sink);
    const native = new Error("private terminal seed detail");
    native.name = "InvalidStateError";
    const store = createPosLocalStore({ adapter: failingAdapter(native) });

    const result = await store.readProvisionedTerminalSeed();

    expect(result).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        classification: "local_storage_unknown",
        flow: "settings",
        operation: "readProvisionedTerminalSeed",
      }),
    );
  });

  it("supports repeated telemetry-only seed reads without recursively reporting", async () => {
    const sink = vi.fn();
    setPosErrorTelemetrySink(sink);
    const native = new Error("private terminal seed detail");
    native.name = "InvalidStateError";
    const store = createPosLocalStore({ adapter: failingAdapter(native) });

    await store.readProvisionedTerminalSeed({ reportFailure: false });
    await store.readProvisionedTerminalSeed({ reportFailure: false });
    await store.readProvisionedTerminalSeed({ reportFailure: false });

    expect(sink).not.toHaveBeenCalled();
  });

  it.each([
    ["QuotaExceededError", "local_storage_quota_exceeded"],
    ["DataCloneError", "local_storage_corrupt"],
    ["VersionError", "local_storage_schema_mismatch"],
    ["VendorSpecificFailure", "local_storage_unknown"],
  ] as const)(
    "maps %s to the finite %s diagnostic",
    async (name, classification) => {
      const sink = vi.fn();
      setPosErrorTelemetrySink(sink);
      const native = new Error("private native message");
      native.name = name;
      const store = createPosLocalStore({ adapter: failingAdapter(native) });

      await store.appendEvent(
        {
          payload: {},
          storeId: "store-1",
          terminalId: "terminal-1",
          type: "register.opened",
        },
        { flow: "register", operation: "openDrawer" },
      );

      expect(sink).toHaveBeenCalledTimes(1);
      expect(sink).toHaveBeenCalledWith(
        expect.objectContaining({ classification }),
      );
    },
  );
});
