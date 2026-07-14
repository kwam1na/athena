import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POS_LOCAL_STORE_SCHEMA_VERSION } from "./posLocalStore";
import {
  resolveLocalPosEntryContext,
  useLocalPosEntryContext,
} from "./localPosEntryContext";

const localStorageMocks = vi.hoisted(() => ({
  listener: undefined as (() => void) | undefined,
  readProvisionedTerminalSeed: vi.fn(),
}));

vi.mock("./posLocalStorageRuntime", () => ({
  getDefaultPosLocalStore: () => ({
    readProvisionedTerminalSeed: localStorageMocks.readProvisionedTerminalSeed,
  }),
  subscribeDefaultPosLocalStorageLifecycleHealth: () => () => undefined,
  subscribeDefaultPosTerminalSeedChanges: (listener: () => void) => {
    localStorageMocks.listener = listener;
    return () => {
      localStorageMocks.listener = undefined;
    };
  },
}));

const terminalSeed = {
  terminalId: "local-terminal-1",
  cloudTerminalId: "terminal-cloud-1",
  syncSecretHash: "secret-hash",
  storeId: "store-1",
  registerNumber: "1",
  displayName: "Front register",
  provisionedAt: 1_700,
  schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
};

describe("localPosEntryContext", () => {
  beforeEach(() => {
    localStorageMocks.listener = undefined;
    localStorageMocks.readProvisionedTerminalSeed.mockReset();
  });

  it("uses route slugs and a matching provisioned seed without live store reads", () => {
    expect(
      resolveLocalPosEntryContext({
        routeParams: { orgUrlSlug: "acme", storeUrlSlug: "downtown" },
        seedRead: { ok: true, value: terminalSeed },
      }),
    ).toEqual({
      status: "ready",
      orgUrlSlug: "acme",
      storeUrlSlug: "downtown",
      storeId: "store-1",
      terminalSeed,
      source: "local",
    });
  });

  it("lets live store and organization data enrich the context without replacing local authority", () => {
    expect(
      resolveLocalPosEntryContext({
        activeOrganization: { slug: "acme-live" },
        activeStore: { _id: "store-1", slug: "downtown-live" },
        routeParams: { orgUrlSlug: "acme", storeUrlSlug: "downtown" },
        seedRead: { ok: true, value: terminalSeed },
      }),
    ).toEqual({
      status: "ready",
      orgUrlSlug: "acme-live",
      storeUrlSlug: "downtown-live",
      storeId: "store-1",
      terminalSeed,
      source: "live",
    });
  });

  it("rejects a local seed for another known store", () => {
    expect(
      resolveLocalPosEntryContext({
        activeStore: { _id: "store-2", slug: "uptown" },
        routeParams: { orgUrlSlug: "acme", storeUrlSlug: "uptown" },
        seedRead: { ok: true, value: terminalSeed },
      }),
    ).toEqual({
      status: "mismatched_store",
      expectedStoreId: "store-2",
      seedStoreId: "store-1",
    });
  });

  it("returns missing seed when local authority is absent and live context is unavailable", () => {
    expect(
      resolveLocalPosEntryContext({
        routeParams: { orgUrlSlug: "acme", storeUrlSlug: "downtown" },
        seedRead: { ok: true, value: null },
      }),
    ).toEqual({ status: "missing_seed" });
  });

  it("surfaces unsupported local schema as an explicit blocked state", () => {
    expect(
      resolveLocalPosEntryContext({
        routeParams: { orgUrlSlug: "acme", storeUrlSlug: "downtown" },
        seedRead: {
          ok: false,
          error: {
            code: "unsupported_schema_version",
            message:
              "POS local store schema version 3 is newer than supported version 2.",
          },
        },
      }),
    ).toEqual({
      status: "unsupported_schema",
      message:
        "POS local store schema version 3 is newer than supported version 2.",
    });
  });

  it("refreshes when terminal provisioning commits after the first read", async () => {
    localStorageMocks.readProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: null,
    });
    const { result } = renderHook(() =>
      useLocalPosEntryContext({
        activeOrganization: { slug: "demo" },
        activeStore: { _id: "store-1", slug: "central" },
        routeParams: {
          orgUrlSlug: "demo",
          storeUrlSlug: "central",
        },
      }),
    );

    await waitFor(() =>
      expect(result.current).toMatchObject({
        status: "ready",
        terminalSeed: null,
      }),
    );

    localStorageMocks.readProvisionedTerminalSeed.mockResolvedValue({
      ok: true,
      value: terminalSeed,
    });
    act(() => localStorageMocks.listener?.());

    await waitFor(() =>
      expect(result.current).toMatchObject({
        status: "ready",
        terminalSeed,
      }),
    );
  });
});
