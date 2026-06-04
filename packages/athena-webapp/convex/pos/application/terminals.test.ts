import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "../../_generated/dataModel";
import { userError } from "../../../shared/commandResult";
import {
  registerTerminal,
  submitTerminalRuntimeStatus,
  updateTerminal,
} from "./commands/terminals";
import {
  getTerminalHealthSummary,
  listTerminalHealthSummaries,
} from "./queries/terminals";
import {
  getLatestRuntimeStatusForTerminal,
  getTerminalByFingerprint,
  getTerminalById,
  getTerminalByStoreIdAndRegisterNumber,
  getTerminalSyncEvidence,
  listTerminalsForStore,
  patchTerminalRecord,
  registerTerminalRecord,
  resolveTerminalRegisterSessionActionTarget,
  upsertLatestRuntimeStatus,
} from "../infrastructure/repositories/terminalRepository";

const browserInfo = {
  userAgent: "tests/terminal-settings",
};

const existingTerminal = {
  _id: "terminal-1" as Id<"posTerminal">,
  _creationTime: 111,
  storeId: "store-1" as Id<"store">,
  fingerprintHash: "fingerprint-1",
  syncSecretHash: "sync-secret-1",
  displayName: "Old Terminal",
  registerNumber: "A1",
  registeredByUserId: "user-1" as Id<"athenaUser">,
  browserInfo,
  registeredAt: 111,
  status: "active" as const,
};

const newTerminal = {
  _id: "terminal-2" as Id<"posTerminal">,
  _creationTime: 222,
  storeId: "store-1" as Id<"store">,
  fingerprintHash: "fingerprint-2",
  syncSecretHash: "sync-secret-2",
  displayName: "New Terminal",
  registerNumber: "B2",
  registeredByUserId: "user-1" as Id<"athenaUser">,
  browserInfo,
  registeredAt: 222,
  status: "active" as const,
};

vi.mock("../infrastructure/repositories/terminalRepository", () => ({
  getTerminalByFingerprint: vi.fn(),
  getTerminalById: vi.fn(),
  getTerminalByStoreIdAndRegisterNumber: vi.fn(),
  getLatestRuntimeStatusForTerminal: vi.fn(),
  getTerminalSyncEvidence: vi.fn(),
  listTerminalsForStore: vi.fn(),
  mapTerminalRecord: (terminal: typeof existingTerminal) => terminal,
  patchTerminalRecord: vi.fn(),
  registerTerminalRecord: vi.fn(),
  resolveTerminalRegisterSessionActionTarget: vi.fn(),
  upsertLatestRuntimeStatus: vi.fn(),
  deleteTerminalRecord: vi.fn(),
}));

describe("registerTerminal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers a new terminal and returns ok", async () => {
    vi.mocked(getTerminalByFingerprint).mockResolvedValue(null);
    vi.mocked(getTerminalByStoreIdAndRegisterNumber).mockResolvedValue(null);
    vi.mocked(registerTerminalRecord).mockResolvedValue(
      "terminal-2" as Id<"posTerminal">,
    );
    vi.mocked(getTerminalById).mockResolvedValue(newTerminal);

    const result = await registerTerminal({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      fingerprintHash: "fingerprint-2",
      syncSecretHash: "sync-secret-2",
      displayName: "New Terminal",
      registerNumber: "B2",
      registeredByUserId: "user-1" as Id<"athenaUser">,
      browserInfo,
    });

    expect(vi.mocked(registerTerminalRecord)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        storeId: "store-1",
        fingerprintHash: "fingerprint-2",
        syncSecretHash: "sync-secret-2",
        displayName: "New Terminal",
        registerNumber: "B2",
      }),
    );
    expect(result).toEqual({
      kind: "ok",
      data: newTerminal,
    });
  });

  it("updates an existing terminal and returns ok", async () => {
    vi.mocked(getTerminalByFingerprint).mockResolvedValue(existingTerminal);
    vi.mocked(getTerminalByStoreIdAndRegisterNumber).mockResolvedValue(null);
    vi.mocked(getTerminalById).mockResolvedValue({
      ...existingTerminal,
      displayName: "Updated Terminal",
      registerNumber: "A1",
    });

    const result = await registerTerminal({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-rotated",
      displayName: "Updated Terminal",
      registerNumber: "A1",
      registeredByUserId: "user-1" as Id<"athenaUser">,
      browserInfo,
    });

    expect(vi.mocked(patchTerminalRecord)).toHaveBeenCalledWith(
      expect.anything(),
      existingTerminal._id,
      expect.objectContaining({
        displayName: "Updated Terminal",
        registeredByUserId: "user-1",
        browserInfo,
        syncSecretHash: "sync-secret-rotated",
        status: "active",
        registerNumber: "A1",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        kind: "ok",
        data: expect.objectContaining({
          syncSecretHash: "sync-secret-rotated",
        }),
      }),
    );
  });

  it("rebinds an existing terminal to a different signed-in full-admin user", async () => {
    vi.mocked(getTerminalByFingerprint).mockResolvedValue(existingTerminal);
    vi.mocked(getTerminalByStoreIdAndRegisterNumber).mockResolvedValue(null);

    const result = await registerTerminal({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-rotated",
      displayName: "Updated Terminal",
      registerNumber: "A1",
      registeredByUserId: "user-2" as Id<"athenaUser">,
      browserInfo,
    });

    expect(vi.mocked(patchTerminalRecord)).toHaveBeenCalledWith(
      expect.anything(),
      existingTerminal._id,
      expect.objectContaining({
        browserInfo,
        displayName: "Updated Terminal",
        registeredByUserId: "user-2",
        registerNumber: "A1",
        status: "active",
        syncSecretHash: "sync-secret-rotated",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        kind: "ok",
        data: expect.objectContaining({
          registeredByUserId: "user-2",
          syncSecretHash: "sync-secret-rotated",
        }),
      }),
    );
  });

  it("does not reassign an existing terminal to another register number", async () => {
    vi.mocked(getTerminalByFingerprint).mockResolvedValue(existingTerminal);
    vi.mocked(getTerminalByStoreIdAndRegisterNumber).mockResolvedValue(null);

    const result = await registerTerminal({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-1",
      displayName: "Updated Terminal",
      registerNumber: "B2",
      registeredByUserId: "user-1" as Id<"athenaUser">,
      browserInfo,
    });

    expect(result).toEqual(
      userError({
        code: "validation_failed",
        message:
          "This terminal is already assigned to another register number.",
      }),
    );
    expect(vi.mocked(patchTerminalRecord)).not.toHaveBeenCalled();
  });

  it("does not reactivate a revoked terminal through normal registration", async () => {
    vi.mocked(getTerminalByFingerprint).mockResolvedValue({
      ...existingTerminal,
      status: "revoked",
    });
    vi.mocked(getTerminalByStoreIdAndRegisterNumber).mockResolvedValue(null);

    const result = await registerTerminal({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-1",
      displayName: "Updated Terminal",
      registerNumber: "A1",
      registeredByUserId: "user-1" as Id<"athenaUser">,
      browserInfo,
    });

    expect(result).toEqual(
      userError({
        code: "authorization_failed",
        message: "This terminal must be reactivated by an administrator.",
      }),
    );
    expect(vi.mocked(patchTerminalRecord)).not.toHaveBeenCalled();
  });

  it("returns validation failure when register number is missing", async () => {
    vi.mocked(getTerminalByFingerprint).mockResolvedValue(null);
    vi.mocked(getTerminalByStoreIdAndRegisterNumber).mockResolvedValue(null);

    const result = await registerTerminal({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      fingerprintHash: "fingerprint-2",
      syncSecretHash: "sync-secret-2",
      displayName: "New Terminal",
      registerNumber: " ",
      registeredByUserId: "user-1" as Id<"athenaUser">,
      browserInfo,
    });

    expect(result).toEqual(
      userError({
        code: "validation_failed",
        message: "A register number is required to identify the terminal.",
      }),
    );
  });

  it("returns validation failure when register number is duplicated in store", async () => {
    vi.mocked(getTerminalByFingerprint).mockResolvedValue(null);
    vi.mocked(getTerminalByStoreIdAndRegisterNumber).mockResolvedValue({
      ...existingTerminal,
      _id: "terminal-2" as Id<"posTerminal">,
      registerNumber: "A1",
    });

    const result = await registerTerminal({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      fingerprintHash: "fingerprint-2",
      syncSecretHash: "sync-secret-2",
      displayName: "New Terminal",
      registerNumber: "A1",
      registeredByUserId: "user-1" as Id<"athenaUser">,
      browserInfo,
    });

    expect(result).toEqual(
      userError({
        code: "validation_failed",
        message:
          "A terminal with this register number already exists in this store.",
      }),
    );
  });
});

describe("updateTerminal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not reactivate a non-active terminal with its old sync secret", async () => {
    vi.mocked(getTerminalById).mockResolvedValue({
      ...existingTerminal,
      status: "lost",
    });

    await expect(
      updateTerminal({ db: null as never } as never, {
        terminalId: "terminal-1" as Id<"posTerminal">,
        status: "active",
      }),
    ).rejects.toThrow("Re-provision this terminal before returning it to service.");
    expect(vi.mocked(patchTerminalRecord)).not.toHaveBeenCalled();
  });
});

describe("submitTerminalRuntimeStatus", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(200);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("upserts one redacted latest runtime status record per terminal", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatus).mockResolvedValue(
      "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    );

    const result = await submitTerminalRuntimeStatus(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        status: {
          ...buildRuntimeStatus(),
          drawerAuthority: {
            cloudRegisterSessionId: "cloud-register-1",
            localRegisterSessionId: "local-register-1",
            observedAt: 112,
            reason: "cloud_closed",
            status: "blocked",
          },
          staffProofToken: "proof-token",
          terminalIntegrity: {
            observedAt: 111,
            reason: "authorization_failed",
            status: "requires_reprovision",
          },
          verifierMetadata: { salt: "never" },
          rawLocalEvents: [
            {
              payload: {
                payments: [{ amount: 100 }],
                customerInfo: { phone: "never" },
              },
            },
          ],
        } as never,
      },
    );

    expect(result).toEqual({
      kind: "ok",
      data: {
        terminalId: "terminal-1",
        reportedAt: 100,
        receivedAt: 200,
      },
    });
    expect(vi.mocked(upsertLatestRuntimeStatus)).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({
        staffProofToken: expect.anything(),
        verifierMetadata: expect.anything(),
        rawLocalEvents: expect.anything(),
        payments: expect.anything(),
        customerInfo: expect.anything(),
      }),
    );
    expect(vi.mocked(upsertLatestRuntimeStatus)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        storeId: "store-1",
        terminalId: "terminal-1",
        reportedAt: 100,
        receivedAt: 200,
        source: "sync-runtime",
        localStore: expect.objectContaining({
          failureMessage: "IndexedDB failed with [redacted]",
        }),
        sync: expect.objectContaining({
          pendingEventCount: 2,
          lastFailureMessage: "[redacted] and [redacted]",
        }),
        terminalIntegrity: {
          observedAt: 111,
          reason: "authorization_failed",
          status: "requires_reprovision",
        },
        drawerAuthority: {
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
          observedAt: 112,
          reason: "cloud_closed",
          status: "blocked",
        },
      }),
    );
  });

  it("persists support-safe app-session recovery status in runtime status", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatus).mockResolvedValue(
      "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    );

    await submitTerminalRuntimeStatus(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        status: {
          ...buildRuntimeStatus(),
          appSessionRecovery: {
            status: "retry_exhausted",
          },
        },
      },
    );

    expect(vi.mocked(upsertLatestRuntimeStatus)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appSessionRecovery: {
          status: "retry_exhausted",
        },
      }),
    );
  });

  it("clears stale app-session recovery status when runtime check-ins omit it", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatus).mockResolvedValue(
      "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    );

    await submitTerminalRuntimeStatus(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        status: buildRuntimeStatus(),
      },
    );

    expect(vi.mocked(upsertLatestRuntimeStatus)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appSessionRecovery: undefined,
      }),
    );
  });

  it("does not write for inactive or wrong-store terminals", async () => {
    vi.mocked(getTerminalById).mockResolvedValue({
      ...existingTerminal,
      status: "lost",
    });

    const result = await submitTerminalRuntimeStatus(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        status: buildRuntimeStatus(),
      },
    );

    expect(result).toEqual(
      userError({
        code: "precondition_failed",
        message: "This terminal is not active for this store.",
      }),
    );
    expect(vi.mocked(upsertLatestRuntimeStatus)).not.toHaveBeenCalled();
  });
});

describe("terminal health summaries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveTerminalRegisterSessionActionTarget).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("joins registration metadata and latest runtime status without sampling sync evidence in the roster", async () => {
    vi.mocked(listTerminalsForStore).mockResolvedValue([existingTerminal]);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(
      buildPersistedRuntimeStatus(),
    );
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: {
        localEventId: "local-event-1",
        localRegisterSessionId: "local-register-1",
        sequence: 7,
        eventType: "sale_completed",
        status: "projected",
        occurredAt: 120,
        submittedAt: 130,
        acceptedAt: 140,
        projectedAt: 150,
      },
      sampledEventCount: 3,
      acceptedCount: 0,
      projectedCount: 2,
      conflictedCount: 1,
      heldCount: 0,
      rejectedCount: 0,
      acceptedThroughSequence: 7,
      cursorUpdatedAt: 160,
    });

    const result = await listTerminalHealthSummaries(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        now: 220,
      },
    );

    expect(result).toEqual([
      expect.objectContaining({
        terminal: expect.objectContaining({
          _id: "terminal-1",
          displayName: "Old Terminal",
          registerNumber: "A1",
          status: "active",
        }),
        health: "needs_attention",
        runtimeAgeMs: 20,
        runtimeStatus: expect.objectContaining({
          source: "sync-runtime",
        }),
        syncEvidence: {
          latestEvent: null,
          latestReviewEvent: null,
          latestReviewEventsByStatus: {
            conflicted: null,
            held: null,
            rejected: null,
          },
          sampledEventCount: 0,
          acceptedCount: 0,
          projectedCount: 0,
          conflictedCount: 0,
          heldCount: 0,
          rejectedCount: 0,
        },
      }),
    ]);
    expect(vi.mocked(getTerminalSyncEvidence)).not.toHaveBeenCalled();
  });

  it("carries support-safe app-session recovery status through terminal health", async () => {
    vi.mocked(listTerminalsForStore).mockResolvedValue([existingTerminal]);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(
      buildPersistedRuntimeStatus({
        appSessionRecovery: {
          status: "blocked_app_account",
        },
      }),
    );

    const result = await listTerminalHealthSummaries(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        now: 300,
      },
    );

    expect(result[0]?.runtimeStatus?.appSessionRecovery).toEqual({
      status: "blocked_app_account",
    });
  });

  it("loads sampled sync evidence only for terminal detail", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(
      buildPersistedRuntimeStatus(),
    );
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: null,
      sampledEventCount: 1,
      acceptedCount: 1,
      projectedCount: 0,
      conflictedCount: 0,
      heldCount: 0,
      rejectedCount: 0,
      acceptedThroughSequence: 9,
      cursorUpdatedAt: 180,
    });

    const result = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );

    expect(vi.mocked(getTerminalSyncEvidence)).toHaveBeenCalledWith(
      expect.anything(),
      {
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    );
    expect(result?.syncEvidence).toEqual(
      expect.objectContaining({
        acceptedThroughSequence: 9,
        sampledEventCount: 1,
      }),
    );
  });

  it("returns a local runtime review reason when runtime review is the attention source", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(
      buildPersistedRuntimeStatus({
        sync: {
          ...buildRuntimeStatus().sync,
          failedEventCount: 0,
          lastFailureMessage:
            "Bearer raw.token.value and Authorization: ApiKey custom-secret",
          reviewEventCount: 1,
          status: "needs_review" as never,
        },
      }),
    );
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: null,
      sampledEventCount: 75,
      acceptedCount: 0,
      projectedCount: 75,
      conflictedCount: 0,
      heldCount: 0,
      rejectedCount: 0,
      acceptedThroughSequence: 22,
      cursorUpdatedAt: 180,
    });

    const result = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );

    expect(result?.health).toBe("needs_attention");
    expect(result?.attentionReasons).toEqual([
      expect.objectContaining({
        count: 1,
        nextPendingUploadSequence: 4,
        source: "local_runtime",
        summary: "1 local review item is still on this terminal.",
        type: "local_review",
      }),
    ]);
    expect(JSON.stringify(result?.attentionReasons)).not.toContain("Bearer");
    expect(JSON.stringify(result?.attentionReasons)).not.toContain(
      "custom-secret",
    );
  });

  it("returns runtime failure, availability, and setup reasons when terminal check-in reports them", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(
      buildPersistedRuntimeStatus({
        localStore: {
          ...buildRuntimeStatus().localStore,
          available: false,
          terminalSeedReady: false,
        },
        sync: {
          ...buildRuntimeStatus().sync,
          failedEventCount: 2,
          pendingEventCount: 0,
          reviewEventCount: 0,
          status: "unavailable" as never,
          uploadableEventCount: 0,
        },
      }),
    );
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: null,
      sampledEventCount: 0,
      acceptedCount: 0,
      projectedCount: 0,
      conflictedCount: 0,
      heldCount: 0,
      rejectedCount: 0,
    });

    const result = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );

    expect(result?.health).toBe("needs_attention");
    expect(result?.attentionReasons).toEqual([
      expect.objectContaining({
        count: 2,
        source: "local_runtime",
        summary: "2 local sync items have failed on this terminal.",
        type: "sync_failed",
      }),
      expect.objectContaining({
        source: "local_runtime",
        summary: "Local sync runtime is unavailable on this terminal.",
        type: "sync_unavailable",
      }),
      expect.objectContaining({
        source: "terminal_runtime",
        summary: "Local terminal storage is not available.",
        type: "local_store_unavailable",
      }),
      expect.objectContaining({
        source: "terminal_runtime",
        summary: "Terminal setup data is not ready on this checkout station.",
        type: "terminal_seed_missing",
      }),
    ]);
  });

  it("returns cloud evidence reasons when server sync evidence needs review", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(
      buildPersistedRuntimeStatus({
        sync: {
          ...buildRuntimeStatus().sync,
          failedEventCount: 0,
          pendingEventCount: 0,
          reviewEventCount: 0,
          status: "idle" as never,
          uploadableEventCount: 0,
        },
      }),
    );
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: {
        localEventId: "local-event-1",
        localRegisterSessionId: "local-register-1",
        sequence: 9,
        eventType: "register_closed",
        status: "conflicted",
        occurredAt: 120,
        submittedAt: 130,
      },
      sampledEventCount: 3,
      acceptedCount: 0,
      projectedCount: 2,
      conflictedCount: 1,
      heldCount: 1,
      rejectedCount: 1,
      acceptedThroughSequence: 8,
      cursorUpdatedAt: 180,
    });

    const result = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );

    expect(result?.health).toBe("needs_attention");
    expect(result?.attentionReasons).toEqual([
      expect.objectContaining({
        actionTarget: { type: "open_work" },
        count: 1,
        source: "cloud_sync",
        summary: "1 cloud sync conflict needs review.",
        type: "cloud_conflict",
      }),
      expect.objectContaining({
        actionTarget: { type: "open_work" },
        count: 1,
        source: "cloud_sync",
        summary: "1 synced item is held before projection.",
        type: "cloud_held",
      }),
      expect.objectContaining({
        actionTarget: { type: "open_work" },
        count: 1,
        source: "cloud_sync",
        summary: "1 synced item was rejected by the server.",
        type: "cloud_rejected",
      }),
    ]);
  });

  it("resolves cloud review reasons to a cash-control register session when sync mapping exists", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(null);
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: {
        localEventId: "local-event-1",
        localRegisterSessionId: "local-register-1",
        sequence: 9,
        eventType: "register_closed",
        status: "conflicted",
        occurredAt: 120,
        submittedAt: 130,
      },
      latestReviewEvent: {
        localEventId: "local-event-1",
        localRegisterSessionId: "local-register-1",
        sequence: 9,
        eventType: "register_closed",
        status: "conflicted",
      },
      sampledEventCount: 1,
      acceptedCount: 0,
      projectedCount: 0,
      conflictedCount: 1,
      heldCount: 0,
      rejectedCount: 0,
    });
    vi.mocked(resolveTerminalRegisterSessionActionTarget).mockResolvedValue(
      "register-session-1" as Id<"registerSession">,
    );

    const result = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );

    expect(resolveTerminalRegisterSessionActionTarget).toHaveBeenCalledWith(
      expect.anything(),
      {
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    );
    expect(result?.attentionReasons).toEqual([
      expect.objectContaining({
        actionTarget: {
          registerSessionId: "register-session-1",
          type: "cash_control_register_session",
        },
        type: "cloud_conflict",
      }),
    ]);
  });

  it("resolves each cloud review reason from its own register session evidence", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(null);
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: {
        localEventId: "event-rejected",
        localRegisterSessionId: "local-rejected-register",
        sequence: 12,
        eventType: "sale_cleared",
        status: "rejected",
        occurredAt: 120,
        submittedAt: 130,
      },
      latestReviewEvent: {
        localEventId: "event-rejected",
        localRegisterSessionId: "local-rejected-register",
        sequence: 12,
        eventType: "sale_cleared",
        status: "rejected",
      },
      latestReviewEventsByStatus: {
        conflicted: {
          localEventId: "event-conflicted",
          localRegisterSessionId: "local-conflicted-register",
          sequence: 10,
          eventType: "register_opened",
          status: "conflicted",
        },
        held: null,
        rejected: {
          localEventId: "event-rejected",
          localRegisterSessionId: "local-rejected-register",
          sequence: 12,
          eventType: "sale_cleared",
          status: "rejected",
        },
      },
      sampledEventCount: 2,
      acceptedCount: 0,
      projectedCount: 0,
      conflictedCount: 1,
      heldCount: 0,
      rejectedCount: 1,
    });
    vi.mocked(resolveTerminalRegisterSessionActionTarget).mockImplementation(
      async (_ctx, args) => {
        if (args.localRegisterSessionId === "local-conflicted-register") {
          return "conflicted-session" as Id<"registerSession">;
        }
        if (args.localRegisterSessionId === "local-rejected-register") {
          return "rejected-session" as Id<"registerSession">;
        }
        return null;
      },
    );

    const result = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );

    expect(resolveTerminalRegisterSessionActionTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        localRegisterSessionId: "local-conflicted-register",
      }),
    );
    expect(resolveTerminalRegisterSessionActionTarget).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        localRegisterSessionId: "local-rejected-register",
      }),
    );
    expect(result?.attentionReasons).toEqual([
      expect.objectContaining({
        actionTarget: {
          registerSessionId: "conflicted-session",
          type: "cash_control_register_session",
        },
        type: "cloud_conflict",
      }),
      expect.objectContaining({
        actionTarget: {
          registerSessionId: "rejected-session",
          type: "cash_control_register_session",
        },
        type: "cloud_rejected",
      }),
    ]);
  });

  it("treats cloud review evidence as needing attention even without runtime status", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(null);
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: {
        localEventId: "local-event-1",
        localRegisterSessionId: "local-register-1",
        sequence: 9,
        eventType: "register_closed",
        status: "conflicted",
        occurredAt: 120,
        submittedAt: 130,
      },
      sampledEventCount: 1,
      acceptedCount: 0,
      projectedCount: 0,
      conflictedCount: 1,
      heldCount: 0,
      rejectedCount: 0,
    });

    const result = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );

    expect(result?.health).toBe("needs_attention");
    expect(result?.runtimeStatus).toBeNull();
    expect(result?.attentionReasons).toEqual([
      expect.objectContaining({
        count: 1,
        source: "cloud_sync",
        summary: "1 cloud sync conflict needs review.",
        type: "cloud_conflict",
      }),
    ]);
  });

  it("surfaces terminal and drawer authority blocks from runtime status", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(
      buildPersistedRuntimeStatus({
        drawerAuthority: {
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
          observedAt: 112,
          reason: "cloud_closed",
          status: "blocked",
        },
        terminalIntegrity: {
          observedAt: 111,
          reason: "authorization_failed",
          status: "requires_reprovision",
        },
        sync: {
          ...buildRuntimeStatus().sync,
          failedEventCount: 0,
          pendingEventCount: 0,
          status: "idle" as never,
          uploadableEventCount: 0,
        },
      }),
    );
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: null,
      sampledEventCount: 0,
      acceptedCount: 0,
      projectedCount: 0,
      conflictedCount: 0,
      heldCount: 0,
      rejectedCount: 0,
    });

    const result = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );

    expect(result?.health).toBe("needs_attention");
    expect(result?.attentionReasons).toEqual([
      expect.objectContaining({
        actionTarget: { type: "pos_settings" },
        source: "terminal_runtime",
        type: "terminal_authorization_failed",
      }),
      expect.objectContaining({
        actionTarget: { type: "pos_register" },
        source: "terminal_runtime",
        type: "drawer_authority_blocked",
      }),
    ]);
  });

  it.each([
    {
      expectedHealth: "offline",
      name: "inactive terminal",
      runtimeStatus: buildPersistedRuntimeStatus(),
      terminal: { ...existingTerminal, status: "lost" as const },
    },
    {
      expectedHealth: "unknown",
      name: "missing runtime status",
      runtimeStatus: null,
      terminal: existingTerminal,
    },
    {
      expectedHealth: "online",
      name: "fresh online runtime",
      runtimeStatus: buildPersistedRuntimeStatus({
        browserInfo: {
          language: "en",
          online: true,
          platform: "darwin",
          userAgent: "tests",
        },
        receivedAt: 220,
        sync: {
          ...buildRuntimeStatus().sync,
          failedEventCount: 0,
          pendingEventCount: 0,
          status: "idle" as never,
          uploadableEventCount: 0,
        },
      }),
      terminal: existingTerminal,
    },
    {
      expectedHealth: "stale",
      name: "fresh browser-offline runtime",
      runtimeStatus: buildPersistedRuntimeStatus({
        browserInfo: {
          language: "en",
          online: false,
          platform: "darwin",
          userAgent: "tests",
        },
        receivedAt: 220,
        sync: {
          ...buildRuntimeStatus().sync,
          failedEventCount: 0,
          pendingEventCount: 0,
          status: "idle" as never,
          uploadableEventCount: 0,
        },
      }),
      terminal: existingTerminal,
    },
    {
      expectedHealth: "stale",
      name: "stale runtime",
      runtimeStatus: buildPersistedRuntimeStatus({
        receivedAt: 220 - 10 * 60 * 1000,
        sync: {
          ...buildRuntimeStatus().sync,
          failedEventCount: 0,
          pendingEventCount: 0,
          status: "idle" as never,
          uploadableEventCount: 0,
        },
      }),
      terminal: existingTerminal,
    },
    {
      expectedHealth: "offline",
      name: "offline-age runtime",
      runtimeStatus: buildPersistedRuntimeStatus({
        receivedAt: 220 - 20 * 60 * 1000,
        sync: {
          ...buildRuntimeStatus().sync,
          failedEventCount: 0,
          pendingEventCount: 0,
          status: "idle" as never,
          uploadableEventCount: 0,
        },
      }),
      terminal: existingTerminal,
    },
  ])("classifies $name as $expectedHealth", async (scenario) => {
    vi.mocked(listTerminalsForStore).mockResolvedValue([scenario.terminal]);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(
      scenario.runtimeStatus,
    );
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: null,
      sampledEventCount: 0,
      acceptedCount: 0,
      projectedCount: 0,
      conflictedCount: 0,
      heldCount: 0,
      rejectedCount: 0,
    });

    const result = await listTerminalHealthSummaries(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        now: 220,
      },
    );

    expect(result[0]?.health).toBe(scenario.expectedHealth);
    expect(result[0]?.attentionReasons).toEqual([]);
  });

  it("returns null for detail when the terminal is outside the requested store", async () => {
    vi.mocked(getTerminalById).mockResolvedValue({
      ...existingTerminal,
      storeId: "store-2" as Id<"store">,
    });

    const result = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );

    expect(result).toBeNull();
    expect(vi.mocked(getLatestRuntimeStatusForTerminal)).not.toHaveBeenCalled();
  });
});

function buildRuntimeStatus() {
  return {
    reportedAt: 100,
    source: "sync-runtime" as const,
    appVersion: "1.2.3",
    buildSha: "abc123",
    browserInfo: {
      userAgent: "tests",
      platform: "darwin",
      language: "en",
      online: true,
    },
    localStore: {
      available: true,
      schemaVersion: 3,
      terminalSeedReady: true,
      failureMessage:
        "IndexedDB failed with Authorization: Basic dXNlcjpwYXNz and phone +233 55 123 4567",
    },
    sync: {
      status: "pending" as const,
      pendingEventCount: 2,
      uploadableEventCount: 2,
      failedEventCount: 1,
      reviewEventCount: 0,
      localOnlyEventCount: 0,
      oldestPendingEventAt: 90,
      nextPendingUploadSequence: 4,
      lastSyncedSequence: 3,
      lastTrigger: "event-append",
      lastFailureMessage:
        "Bearer raw.token.value and Authorization: ApiKey custom-secret and phone +233 55 987 6543",
    },
    staffAuthority: {
      status: "ready" as const,
      staffProfileId: "staff-1" as Id<"staffProfile">,
      expiresAt: 1000,
    },
    snapshots: {
      catalogAgeMs: 10,
      serviceCatalogAgeMs: 15,
      availabilityAgeMs: 20,
      registerReadModelAgeMs: 30,
    },
  };
}

function buildPersistedRuntimeStatus(
  overrides: Partial<ReturnType<typeof buildRuntimeStatus>> & {
    appSessionRecovery?: {
      status:
        | "ready"
        | "recovering"
        | "retrying"
        | "waiting_for_network"
        | "blocked_terminal"
        | "blocked_app_account"
        | "blocked_store_mismatch"
        | "retry_exhausted"
        | "stale_assertion";
    };
    drawerAuthority?: Doc<"posTerminalRuntimeStatus">["drawerAuthority"];
    receivedAt?: number;
    terminalIntegrity?: Doc<"posTerminalRuntimeStatus">["terminalIntegrity"];
  } = {},
) {
  return {
    _id: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    _creationTime: 190,
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    receivedAt: 200,
    ...buildRuntimeStatus(),
    ...overrides,
  };
}
