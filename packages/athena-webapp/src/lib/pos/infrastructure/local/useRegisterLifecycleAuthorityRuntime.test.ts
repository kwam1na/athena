import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "~/convex/_generated/dataModel";
import type { createPosLocalStore } from "./posLocalStore";

import { useRegisterLifecycleAuthorityRuntime } from "./useRegisterLifecycleAuthorityRuntime";

const mocks = vi.hoisted(() => ({
  acknowledge: vi.fn(async (args: Record<string, unknown>) => {
    void args;
    return { accepted: true, coalesced: false };
  }),
  returnFreshSnapshot: false,
  snapshot: undefined as unknown,
  useRegisterLifecycleAuthorityAcknowledgement: vi.fn(() => mocks.acknowledge),
  useRegisterLifecycleAuthoritySnapshot: vi.fn(() =>
    mocks.returnFreshSnapshot && mocks.snapshot
      ? structuredClone(mocks.snapshot)
      : mocks.snapshot,
  ),
}));

vi.mock(
  "@/lib/pos/infrastructure/convex/registerLifecycleAuthorityGateway",
  () => ({
    useRegisterLifecycleAuthorityAcknowledgement:
      mocks.useRegisterLifecycleAuthorityAcknowledgement,
    useRegisterLifecycleAuthoritySnapshot:
      mocks.useRegisterLifecycleAuthoritySnapshot,
  }),
);

const seed = {
  cloudTerminalId: "cloud-terminal-1",
  displayName: "Register 2",
  provisionedAt: 1,
  schemaVersion: 1,
  storeId: "store-1",
  syncSecretHash: "sync-secret-1",
  terminalId: "local-terminal-1",
};

const projection = {
  activeRegisterSession: {
    cloudRegisterSessionId: "cloud-register-1",
    localRegisterSessionId: "local-register-1",
  },
  mappings: [],
  sourceEvents: [],
};

function snapshot(
  classification: "sale_blocked" | "sale_usable" = "sale_blocked",
) {
  return {
    candidateCount: 1,
    maximumDocumentReads: 3,
    results: [
      {
        authorityCursor: {
          lifecycleRevision: 4,
          mappingAuthorityRevision: 2,
        },
        classification,
        cloudRegisterSessionId: "cloud-register-1",
        cloudStatus: classification === "sale_blocked" ? "closed" : "active",
        lifecycleRevision: 4,
        localRegisterSessionId: "local-register-1",
        mappingAuthorityRevision: 2,
      },
    ],
  };
}

function createStore() {
  type ApplyResult = Awaited<
    ReturnType<
      ReturnType<typeof createPosLocalStore>["applyRegisterLifecycleAuthority"]
    >
  >;
  return {
    applyRegisterLifecycleAuthority: vi.fn(async (): Promise<ApplyResult> => ({
      ok: true,
      value: appliedAuthorityValue(),
    })),
    readProvisionedTerminalSeed: vi.fn(async () => ({
      ok: true,
      value: seed,
    })),
  };
}

function appliedAuthorityValue() {
  return {
    disposition: "applied" as const,
    reason: "committed" as const,
    value: {
      localRegisterSessionId: "local-register-1",
      observedAt: 1,
      status: "blocked" as const,
      storeId: "store-1",
      terminalId: "local-terminal-1",
    },
  };
}

function renderRuntime(overrides: Record<string, unknown> = {}) {
  const store = createStore();
  const refreshLocalRegisterReadModel = vi.fn(async () => undefined);
  const onAdvisoryOutcome = vi.fn();
  const rendered = renderHook((props: Record<string, unknown>) =>
    useRegisterLifecycleAuthorityRuntime({
      isOnline: true,
      localRegisterReadModel: projection as never,
      refreshLocalRegisterReadModel,
      store: store as never,
      storeId: "store-1" as Id<"store">,
      terminal: {
        _id: "cloud-terminal-1" as Id<"posTerminal">,
        registerNumber: "2",
      },
      onAdvisoryOutcome,
      ...overrides,
      ...props,
    }),
  );
  return {
    ...rendered,
    onAdvisoryOutcome,
    refreshLocalRegisterReadModel,
    store,
  };
}

describe("useRegisterLifecycleAuthorityRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acknowledge.mockResolvedValue({ accepted: true, coalesced: false });
    mocks.snapshot = undefined;
    mocks.returnFreshSnapshot = false;
  });

  it("subscribes and durably applies closure authority without heartbeat or cashier input", async () => {
    mocks.snapshot = snapshot();
    const { result, store, refreshLocalRegisterReadModel } = renderRuntime();

    await waitFor(() => {
      expect(result.current.persistence.status).toBe("ready");
    });
    expect(
      mocks.useRegisterLifecycleAuthoritySnapshot,
    ).toHaveBeenLastCalledWith({
      candidates: [
        {
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
        },
      ],
      storeId: "store-1",
      syncSecretHash: "sync-secret-1",
      terminalId: "cloud-terminal-1",
    });
    expect(store.applyRegisterLifecycleAuthority).toHaveBeenCalledWith({
      expectedMapping: undefined,
      observation: expect.objectContaining({
        classification: "sale_blocked",
        cloudRegisterSessionId: "cloud-register-1",
        cursor: { lifecycleRevision: 4, mappingAuthorityRevision: 2 },
        localRegisterSessionId: "local-register-1",
        reason: "cloud_closed",
        source: "dedicated_snapshot",
        status: "blocked",
      }),
      storeId: "store-1",
      terminalId: "local-terminal-1",
    });
    expect(refreshLocalRegisterReadModel).toHaveBeenCalledTimes(1);
    expect(result.current.authorization.status).toBe("authorized");
    expect(mocks.acknowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudRegisterSessionId: "cloud-register-1",
        lifecycleRevision: 4,
        localRegisterSessionId: "local-register-1",
        mappingAuthorityRevision: 2,
        outcome: "applied",
        storeId: "store-1",
        syncSecretHash: "sync-secret-1",
        terminalId: "cloud-terminal-1",
      }),
    );
  });

  it("does not reapply a semantically unchanged snapshot with fresh object identity", async () => {
    mocks.snapshot = snapshot();
    mocks.returnFreshSnapshot = true;
    const { result, store, refreshLocalRegisterReadModel } = renderRuntime();

    await waitFor(() =>
      expect(result.current.persistence.status).toBe("ready"),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.applyRegisterLifecycleAuthority).toHaveBeenCalledTimes(1);
    expect(refreshLocalRegisterReadModel).toHaveBeenCalledTimes(1);
  });

  it("does not reapply when refresh recreates an equivalent local projection", async () => {
    mocks.snapshot = snapshot();
    const store = createStore();
    let rerenderProjection: () => void = () => undefined;
    const refreshLocalRegisterReadModel = vi.fn(async () => {
      rerenderProjection();
    });
    const rendered = renderHook(
      (props: { localRegisterReadModel: typeof projection }) =>
        useRegisterLifecycleAuthorityRuntime({
          isOnline: true,
          localRegisterReadModel: props.localRegisterReadModel as never,
          refreshLocalRegisterReadModel,
          store: store as never,
          storeId: "store-1" as Id<"store">,
          terminal: {
            _id: "cloud-terminal-1" as Id<"posTerminal">,
            registerNumber: "2",
          },
        }),
      {
        initialProps: {
          localRegisterReadModel: structuredClone(projection),
        },
      },
    );
    rerenderProjection = () => {
      rendered.rerender({
        localRegisterReadModel: structuredClone(projection),
      });
    };

    await waitFor(() =>
      expect(rendered.result.current.persistence.status).toBe("ready"),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.applyRegisterLifecycleAuthority).toHaveBeenCalledTimes(1);
    expect(refreshLocalRegisterReadModel).toHaveBeenCalledTimes(1);
  });

  it("does not reapply when a refresh changes only projection metadata and callback identity", async () => {
    mocks.snapshot = snapshot();
    const store = createStore();
    const initialRefresh = vi.fn(async () => undefined);
    const nextRefresh = vi.fn(async () => undefined);
    const rendered = renderHook(
      (props: {
        localRegisterReadModel: typeof projection & { projectedAt: number };
        refreshLocalRegisterReadModel: () => Promise<void>;
      }) =>
        useRegisterLifecycleAuthorityRuntime({
          isOnline: true,
          localRegisterReadModel: props.localRegisterReadModel as never,
          refreshLocalRegisterReadModel: props.refreshLocalRegisterReadModel,
          store: store as never,
          storeId: "store-1" as Id<"store">,
          terminal: {
            _id: "cloud-terminal-1" as Id<"posTerminal">,
            registerNumber: "2",
          },
        }),
      {
        initialProps: {
          localRegisterReadModel: {
            ...structuredClone(projection),
            projectedAt: 1,
          },
          refreshLocalRegisterReadModel: initialRefresh,
        },
      },
    );

    await waitFor(() =>
      expect(rendered.result.current.persistence.status).toBe("ready"),
    );

    rendered.rerender({
      localRegisterReadModel: {
        ...structuredClone(projection),
        projectedAt: 2,
      },
      refreshLocalRegisterReadModel: nextRefresh,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.applyRegisterLifecycleAuthority).toHaveBeenCalledTimes(1);
    expect(initialRefresh).toHaveBeenCalledTimes(1);
    expect(nextRefresh).not.toHaveBeenCalled();
  });

  it("reaches and applies closure authority after restart from an exact legacy mapping", async () => {
    mocks.snapshot = snapshot();
    const { result, store } = renderRuntime({
      localRegisterReadModel: {
        activeRegisterSession: null,
        mappings: [
          {
            cloudId: "cloud-register-1",
            entity: "registerSession",
            localId: "local-register-1",
            mappedAt: 1,
            registerCandidateState: "current",
            storeId: "store-1",
            terminalId: "local-terminal-1",
          },
        ],
        sourceEvents: [],
      },
      terminal: { _id: "cloud-terminal-1" as Id<"posTerminal"> },
    });

    await waitFor(() =>
      expect(result.current.persistence.status).toBe("ready"),
    );
    expect(
      mocks.useRegisterLifecycleAuthoritySnapshot,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        candidates: [
          {
            cloudRegisterSessionId: "cloud-register-1",
            localRegisterSessionId: "local-register-1",
          },
        ],
      }),
    );
    expect(store.applyRegisterLifecycleAuthority).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedMapping: expect.objectContaining({
          cloudRegisterSessionId: "cloud-register-1",
          registerCandidateState: "current",
          storeId: "store-1",
          terminalId: "local-terminal-1",
        }),
        observation: expect.objectContaining({
          localRegisterSessionId: "local-register-1",
          reason: "cloud_closed",
        }),
      }),
    );
  });

  it("uses the active legacy mapping as the authority expectation when the mapping lacks scope metadata", async () => {
    mocks.snapshot = snapshot();
    const { result, store } = renderRuntime({
      localRegisterReadModel: {
        activeRegisterSession: {
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
        },
        mappings: [
          {
            cloudId: "cloud-register-1",
            entity: "registerSession",
            localId: "local-register-1",
            mappedAt: 1,
            registerCandidateState: undefined,
            registerNumber: undefined,
            storeId: undefined,
            terminalId: undefined,
          },
        ],
        sourceEvents: [],
      },
    });

    await waitFor(() =>
      expect(result.current.persistence.status).toBe("ready"),
    );
    expect(store.applyRegisterLifecycleAuthority).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedMapping: expect.objectContaining({
          cloudRegisterSessionId: "cloud-register-1",
          mappedAt: 1,
        }),
        observation: expect.objectContaining({
          localRegisterSessionId: "local-register-1",
          source: "dedicated_snapshot",
        }),
      }),
    );
  });

  it("observes and acknowledges shadow authority without applying or refreshing", async () => {
    mocks.snapshot = snapshot();
    const policy = {
      canaryTerminalIds: new Set<string>(),
      mode: "shadow" as const,
    };
    const { result, store, refreshLocalRegisterReadModel, onAdvisoryOutcome } =
      renderRuntime({ rolloutPolicy: policy });

    await waitFor(() =>
      expect(result.current.persistence.status).toBe("ready"),
    );
    expect(
      mocks.useRegisterLifecycleAuthoritySnapshot,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({ terminalId: "cloud-terminal-1" }),
    );
    expect(store.applyRegisterLifecycleAuthority).not.toHaveBeenCalled();
    expect(refreshLocalRegisterReadModel).not.toHaveBeenCalled();
    expect(mocks.acknowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "shadow_observed",
        rolloutCohort: "shadow",
        rolloutMode: "shadow",
      }),
    );
    expect(onAdvisoryOutcome).toHaveBeenCalledWith({
      appliedCount: 0,
      candidateCount: 1,
      outcome: "shadow_observed",
    });
  });

  it("disables new subscriptions and applies without clearing local authority", async () => {
    mocks.snapshot = snapshot();
    const { result, store } = renderRuntime({
      localRegisterReadModel: {
        activeRegisterSession: null,
        mappings: [],
        sourceEvents: Array.from({ length: 17 }, (_, index) => ({
          localRegisterSessionId: `local-${index}`,
          sync: { status: "pending" },
          type: "register.opened",
        })),
      },
      rolloutPolicy: {
        canaryTerminalIds: new Set<string>(),
        mode: "disabled",
      },
    });

    await waitFor(() =>
      expect(
        mocks.useRegisterLifecycleAuthoritySnapshot,
      ).toHaveBeenLastCalledWith("skip"),
    );
    expect(store.applyRegisterLifecycleAuthority).not.toHaveBeenCalled();
    expect(result.current.persistence.status).not.toBe("failed");
  });

  it("applies only exact configured canary terminals", async () => {
    mocks.snapshot = snapshot();
    const { result, store } = renderRuntime({
      rolloutPolicy: {
        canaryTerminalIds: new Set(["cloud-terminal-1"]),
        mode: "canary",
      },
    });
    await waitFor(() =>
      expect(result.current.persistence.status).toBe("ready"),
    );
    expect(store.applyRegisterLifecycleAuthority).toHaveBeenCalledTimes(1);
  });

  it("applies results sequentially and refreshes only after durable commits", async () => {
    let releaseFirst: () => void = () => undefined;
    const firstApply = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const store = createStore();
    store.applyRegisterLifecycleAuthority
      .mockImplementationOnce(async () => {
        await firstApply;
        return {
          ok: true,
          value: appliedAuthorityValue(),
        };
      })
      .mockResolvedValueOnce({
        ok: true,
        value: appliedAuthorityValue(),
      });
    mocks.snapshot = {
      ...snapshot(),
      candidateCount: 2,
      results: [
        ...snapshot().results,
        {
          ...snapshot("sale_usable").results[0],
          cloudRegisterSessionId: "cloud-register-2",
          localRegisterSessionId: "local-register-2",
        },
      ],
    };
    const refreshLocalRegisterReadModel = vi.fn(async () => undefined);
    const localRegisterReadModel = {
      ...projection,
      mappings: [],
      sourceEvents: [
        {
          localRegisterSessionId: "local-register-2",
          sync: { status: "pending" },
          type: "register.opened",
        },
      ],
    };
    renderHook(() =>
      useRegisterLifecycleAuthorityRuntime({
        isOnline: true,
        localRegisterReadModel: localRegisterReadModel as never,
        refreshLocalRegisterReadModel,
        store: store as never,
        storeId: "store-1" as Id<"store">,
        terminal: {
          _id: "cloud-terminal-1" as Id<"posTerminal">,
          registerNumber: "2",
        },
      }),
    );

    await waitFor(() => {
      expect(store.applyRegisterLifecycleAuthority).toHaveBeenCalledTimes(1);
    });
    expect(refreshLocalRegisterReadModel).not.toHaveBeenCalled();
    releaseFirst();
    await waitFor(() => {
      expect(store.applyRegisterLifecycleAuthority).toHaveBeenCalledTimes(2);
      expect(refreshLocalRegisterReadModel).toHaveBeenCalledTimes(1);
    });
  });

  it("preserves last-known authority while loading or offline", async () => {
    const loading = renderRuntime();
    await waitFor(() => {
      expect(loading.result.current.authorization.status).toBe("loading");
    });
    expect(
      loading.store.applyRegisterLifecycleAuthority,
    ).not.toHaveBeenCalled();
    expect(loading.refreshLocalRegisterReadModel).not.toHaveBeenCalled();

    const offline = renderRuntime({ isOnline: false });
    await waitFor(() => {
      expect(offline.result.current.authorization.status).toBe("offline");
    });
    expect(
      mocks.useRegisterLifecycleAuthoritySnapshot,
    ).toHaveBeenLastCalledWith("skip");
    expect(
      offline.store.applyRegisterLifecycleAuthority,
    ).not.toHaveBeenCalled();
  });

  it("fails closed on candidate overflow without subscribing", async () => {
    const mappings = Array.from({ length: 17 }, (_, index) => ({
      cloudId: `cloud-${index}`,
      entity: "registerSession" as const,
      localId: `local-${index}`,
      mappedAt: index,
      registerCandidateState: "current" as const,
    }));
    const { result, store } = renderRuntime({
      localRegisterReadModel: {
        ...projection,
        activeRegisterSession: null,
        mappings,
      },
    });

    await waitFor(() => {
      expect(result.current.candidates).toEqual({
        reason: "overflow",
        status: "invalid",
      });
    });
    expect(
      mocks.useRegisterLifecycleAuthoritySnapshot,
    ).toHaveBeenLastCalledWith("skip");
    expect(store.applyRegisterLifecycleAuthority).not.toHaveBeenCalled();
  });

  it("rejects non-bijective snapshots before any local apply", async () => {
    const exact = snapshot();
    const cases = [
      {
        ...exact,
        candidateCount: 0,
      },
      {
        ...exact,
        candidateCount: 1,
        results: [],
      },
      {
        ...exact,
        candidateCount: 2,
        results: [exact.results[0], exact.results[0]],
      },
      {
        ...exact,
        results: [
          {
            ...exact.results[0],
            localRegisterSessionId: "foreign-local-register",
          },
        ],
      },
    ];

    for (const invalidSnapshot of cases) {
      mocks.snapshot = invalidSnapshot;
      const { result, store, unmount } = renderRuntime();
      await waitFor(() => {
        expect(result.current.persistence).toEqual({
          reason: "snapshot_invalid",
          status: "failed",
        });
      });
      expect(store.applyRegisterLifecycleAuthority).not.toHaveBeenCalled();
      unmount();
    }

    const partialProjection = {
      ...projection,
      sourceEvents: [
        {
          localRegisterSessionId: "local-register-2",
          sync: { status: "pending" },
          type: "register.opened",
        },
      ],
    };
    mocks.snapshot = exact;
    const partial = renderRuntime({
      localRegisterReadModel: partialProjection,
    });
    await waitFor(() => {
      expect(partial.result.current.persistence).toEqual({
        reason: "snapshot_invalid",
        status: "failed",
      });
    });
    expect(
      partial.store.applyRegisterLifecycleAuthority,
    ).not.toHaveBeenCalled();
  });

  it("activates persistence failure until a stable retry durably succeeds", async () => {
    mocks.snapshot = snapshot();
    const { result, store, refreshLocalRegisterReadModel } = renderRuntime();
    store.applyRegisterLifecycleAuthority
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "write_failed", message: "secret raw failure" },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: appliedAuthorityValue(),
      });

    await waitFor(() => {
      expect(result.current.persistence.status).toBe("failed");
    });
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: "persistence_failed" }),
    );
    expect(result.current.persistence).not.toHaveProperty("message");
    expect(refreshLocalRegisterReadModel).not.toHaveBeenCalled();
    const retry = result.current.retry;
    await act(async () => retry());
    expect(result.current.retry).toBe(retry);
    await waitFor(() => {
      expect(result.current.persistence.status).toBe("ready");
    });
    expect(mocks.acknowledge).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: "applied" }),
    );
    expect(refreshLocalRegisterReadModel).toHaveBeenCalledTimes(1);
  });

  it("does not let an older in-flight result refresh after a newer snapshot wins", async () => {
    let releaseOlder: () => void = () => undefined;
    const olderApply = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    const store = createStore();
    store.applyRegisterLifecycleAuthority
      .mockImplementationOnce(async () => {
        await olderApply;
        return {
          ok: true,
          value: appliedAuthorityValue(),
        };
      })
      .mockResolvedValueOnce({
        ok: true,
        value: appliedAuthorityValue(),
      });
    mocks.snapshot = snapshot();
    const refreshLocalRegisterReadModel = vi.fn(async () => undefined);
    const terminal = {
      _id: "cloud-terminal-1" as Id<"posTerminal">,
      registerNumber: "2",
    };
    const { result, rerender } = renderHook(() =>
      useRegisterLifecycleAuthorityRuntime({
        isOnline: true,
        localRegisterReadModel: projection as never,
        refreshLocalRegisterReadModel,
        store: store as never,
        storeId: "store-1" as Id<"store">,
        terminal,
      }),
    );
    await waitFor(() => {
      expect(store.applyRegisterLifecycleAuthority).toHaveBeenCalledTimes(1);
    });

    const newer = snapshot("sale_usable");
    newer.results[0].authorityCursor.lifecycleRevision = 5;
    newer.results[0].lifecycleRevision = 5;
    mocks.snapshot = newer;
    rerender();
    await waitFor(() => {
      expect(store.applyRegisterLifecycleAuthority).toHaveBeenCalledTimes(2);
      expect(refreshLocalRegisterReadModel).toHaveBeenCalledTimes(1);
      expect(result.current.persistence.status).toBe("ready");
    });

    releaseOlder();
    await act(async () => olderApply);
    expect(refreshLocalRegisterReadModel).toHaveBeenCalledTimes(1);
  });

  it("treats a null terminal result as authorization failure", async () => {
    mocks.snapshot = null;
    const { result, store } = renderRuntime();

    await waitFor(() => {
      expect(result.current.authorization.status).toBe("unauthorized");
    });
    expect(store.applyRegisterLifecycleAuthority).not.toHaveBeenCalled();
  });

  it("does not let acknowledgement transport failure block durable refresh", async () => {
    mocks.snapshot = snapshot();
    mocks.acknowledge.mockRejectedValueOnce(new Error("offline"));
    const { result, refreshLocalRegisterReadModel } = renderRuntime();

    await waitFor(() => {
      expect(result.current.persistence.status).toBe("ready");
    });
    expect(refreshLocalRegisterReadModel).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a validated local-only repair subject without a cloud id", async () => {
    mocks.snapshot = {
      candidateCount: 1,
      maximumDocumentReads: 3,
      results: [
        {
          authorityCursor: {
            lifecycleRevision: 0,
            mappingAuthorityRevision: 8,
          },
          classification: "repair_required",
          lifecycleRevision: 0,
          localRegisterSessionId: "local-register-1",
          mappingAuthorityRevision: 8,
        },
      ],
    };
    const localRegisterReadModel = {
      ...projection,
      activeRegisterSession: null,
      mappings: [
        {
          cloudId: "cloud-register-1",
          entity: "registerSession",
          localId: "local-register-1",
          mappedAt: 1_000,
          registerCandidateState: "current",
        },
      ],
    };
    const { result } = renderRuntime({ localRegisterReadModel });

    await waitFor(() => {
      expect(result.current.persistence.status).toBe("ready");
    });
    expect(mocks.acknowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycleRevision: 0,
        localRegisterSessionId: "local-register-1",
        mappingAuthorityRevision: 8,
        outcome: "repair_required",
      }),
    );
    expect(mocks.acknowledge.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "cloudRegisterSessionId",
    );
  });
});
