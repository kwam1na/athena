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
  type TerminalRecoveryCommandReadRepository,
  type TerminalRecoveryCommandRepository,
} from "./terminalRecovery/terminalCommandService";
import {
  getActiveRegisterSessionForTerminal,
  getDrawerAuthorityRegisterSession,
  getLatestRegisterSessionForTerminal,
  getLatestRuntimeStatusForTerminal,
  getTerminalByFingerprint,
  getTerminalById,
  getTerminalByStoreIdAndRegisterNumber,
  getTerminalSyncEvidence,
  getTerminalSyncReviewSummaryEvidence,
  hasActiveRegisterSessionForTerminal,
  listTerminalsForStore,
  patchTerminalRecord,
  registerTerminalRecord,
  resolveTerminalRegisterSessionActionTarget,
  upsertLatestRuntimeStatusWithOutcome,
} from "../infrastructure/repositories/terminalRepository";
import {
  createTerminalRecoveryCommandReadRepository,
  createTerminalRecoveryCommandRepository,
  getTerminalRecoverySourceEvent,
  listTerminalRecoveryConflictsForRepair,
} from "../infrastructure/repositories/terminalRecoveryRepository";

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
  getActiveRegisterSessionForTerminal: vi.fn(),
  getDrawerAuthorityRegisterSession: vi.fn(),
  getLatestRegisterSessionForTerminal: vi.fn(),
  getLatestRuntimeStatusForTerminal: vi.fn(),
  getTerminalSyncEvidence: vi.fn(),
  getTerminalSyncReviewSummaryEvidence: vi.fn(),
  hasActiveRegisterSessionForTerminal: vi.fn(),
  listTerminalsForStore: vi.fn(),
  mapTerminalRecord: (terminal: typeof existingTerminal) => terminal,
  patchTerminalRecord: vi.fn(),
  registerTerminalRecord: vi.fn(),
  resolveTerminalRegisterSessionActionTarget: vi.fn(),
  upsertLatestRuntimeStatusWithOutcome: vi.fn(),
  deleteTerminalRecord: vi.fn(),
}));

vi.mock("../infrastructure/repositories/terminalRecoveryRepository", () => ({
  createTerminalRecoveryCommandReadRepository: vi.fn(),
  createTerminalRecoveryCommandRepository: vi.fn(),
  getTerminalRecoverySourceEvent: vi.fn(),
  listTerminalRecoveryConflictsForRepair: vi.fn(),
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

  it("preserves existing capability and login settings when reprovision args omit them", async () => {
    const configuredTerminal = {
      ...existingTerminal,
      loginMode: "pos_only" as const,
      transactionCapability: "services_only" as const,
    };
    vi.mocked(getTerminalByFingerprint).mockResolvedValue(configuredTerminal);
    vi.mocked(getTerminalByStoreIdAndRegisterNumber).mockResolvedValue(null);
    vi.mocked(getTerminalById).mockResolvedValue({
      ...configuredTerminal,
      displayName: "Updated Terminal",
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
      configuredTerminal._id,
      expect.objectContaining({
        loginMode: "pos_only",
        transactionCapability: "services_only",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        kind: "ok",
        data: expect.objectContaining({
          loginMode: "pos_only",
          transactionCapability: "services_only",
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
    ).rejects.toThrow(
      "Re-provision this terminal before returning it to service.",
    );
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
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });

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
        acceptedForSideEffects: true,
      },
    });
    expect(
      vi.mocked(upsertLatestRuntimeStatusWithOutcome),
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({
        staffProofToken: expect.anything(),
        verifierMetadata: expect.anything(),
        rawLocalEvents: expect.anything(),
        payments: expect.anything(),
        customerInfo: expect.anything(),
      }),
    );
    expect(
      vi.mocked(upsertLatestRuntimeStatusWithOutcome),
    ).toHaveBeenCalledWith(
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

  it("preserves closeout-rejected active register status in runtime status", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });

    await submitTerminalRuntimeStatus({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: {
        ...buildRuntimeStatus(),
        activeRegisterSession: {
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
          observedAt: 112,
          status: "closeout_rejected",
        },
      } as never,
    });

    expect(
      vi.mocked(upsertLatestRuntimeStatusWithOutcome),
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        activeRegisterSession: expect.objectContaining({
          localRegisterSessionId: "local-register-1",
          status: "closeout_rejected",
        }),
      }),
    );
  });

  it("persists support-safe app-session recovery status in runtime status", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });

    await submitTerminalRuntimeStatus({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: {
        ...buildRuntimeStatus(),
        appSessionRecovery: {
          status: "retry_exhausted",
        },
      },
    });

    expect(
      vi.mocked(upsertLatestRuntimeStatusWithOutcome),
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appSessionRecovery: {
          status: "retry_exhausted",
        },
      }),
    );
  });

  it("uses a trusted terminal proof without re-reading the terminal", async () => {
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });

    const result = await submitTerminalRuntimeStatus(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        trustedTerminal: existingTerminal,
        status: buildRuntimeStatus(),
      },
    );

    expect(result.kind).toBe("ok");
    expect(vi.mocked(getTerminalById)).not.toHaveBeenCalled();
  });

  it("rejects a trusted terminal proof for a different terminal id", async () => {
    const result = await submitTerminalRuntimeStatus(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-2" as Id<"posTerminal">,
        trustedTerminal: existingTerminal,
        status: buildRuntimeStatus(),
      },
    );

    expect(result).toEqual(
      userError({
        code: "precondition_failed",
        message: "This terminal is not active for this store.",
      }),
    );
    expect(vi.mocked(getTerminalById)).not.toHaveBeenCalled();
    expect(
      vi.mocked(upsertLatestRuntimeStatusWithOutcome),
    ).not.toHaveBeenCalled();
  });

  it("returns a cloud-closed drawer authority directive when the mapped cloud register is no longer usable", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });
    const db = {
      normalizeId: vi.fn(() => "cloud-register-1"),
      get: vi.fn(async () => ({
        _id: "cloud-register-1",
        status: "closed",
        storeId: "store-1",
        terminalId: "terminal-1",
      })),
    };

    const result = await submitTerminalRuntimeStatus({ db } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: {
        ...buildRuntimeStatus(),
        activeRegisterSession: {
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
          observedAt: 120,
          openedAt: 100,
          registerNumber: "8",
          status: "active",
        },
      },
    });

    expect(db.get).toHaveBeenCalledWith("registerSession", "cloud-register-1");
    expect(result).toEqual({
      kind: "ok",
      data: expect.objectContaining({
        drawerAuthorityDirective: {
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
          message:
            "The mapped cloud register is closed. Open a register before selling.",
          observedAt: 200,
          reason: "cloud_closed",
          registerNumber: "8",
          status: "blocked",
        },
      }),
    });
  });

  it("skips broad register-session scans when runtime cloud drawer is already usable", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });
    const db = {
      get: vi.fn(async () => ({
        _id: "cloud-register-1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      })),
      normalizeId: vi.fn(() => "cloud-register-1"),
      query: vi.fn(),
    };

    const result = await submitTerminalRuntimeStatus({ db } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: {
        ...buildRuntimeStatus(),
        activeRegisterSession: {
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
          observedAt: 120,
          openedAt: 100,
          registerNumber: "A1",
          status: "active",
        },
      },
    });

    expect(result).toEqual({
      kind: "ok",
      data: expect.not.objectContaining({
        activeRegisterSessionDirective: expect.anything(),
      }),
    });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("skips directive reads for coalesced runtime status duplicates", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: false,
      materialChanged: false,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });
    const db = {
      get: vi.fn(),
      normalizeId: vi.fn(() => "cloud-register-1"),
      query: vi.fn(),
    };

    const result = await submitTerminalRuntimeStatus({ db } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: {
        ...buildRuntimeStatus(),
        activeRegisterSession: {
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
          observedAt: 120,
          openedAt: 100,
          registerNumber: "A1",
          status: "active",
        },
      },
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        acceptedForSideEffects: false,
        terminalId: "terminal-1",
        reportedAt: 100,
        receivedAt: 200,
      },
    });
    expect(db.get).not.toHaveBeenCalled();
    expect(db.normalizeId).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it("preserves runtime directives for freshness-only runtime status writes", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: false,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });
    const registerSessions = [
      {
        _creationTime: 200,
        _id: "cloud-register-1",
        expectedCash: 13_000,
        openedAt: 100,
        openingFloat: 13_000,
        openedByStaffProfileId: "staff-1",
        registerNumber: "A1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    ];
    const indexNames: string[] = [];
    const db = {
      query: vi.fn(() =>
        buildTerminalHealthQuery(registerSessions, indexNames),
      ),
    };

    const result = await submitTerminalRuntimeStatus({ db } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: {
        ...buildRuntimeStatus(),
        activeRegisterSession: undefined,
        localStore: {
          available: true,
          schemaVersion: 1,
          terminalSeedReady: true,
        },
      },
    });

    expect(result).toEqual({
      kind: "ok",
      data: expect.objectContaining({
        acceptedForSideEffects: true,
        activeRegisterSessionDirective: expect.objectContaining({
          cloudRegisterSessionId: "cloud-register-1",
          status: "active",
        }),
      }),
    });
    expect(db.query).toHaveBeenCalledWith("registerSession");
  });

  it("returns an active register session directive when cloud has a usable drawer but runtime does not", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });
    const registerSessions = [
      {
        _creationTime: 300,
        _id: "cloud-register-closed",
        expectedCash: 0,
        openedAt: 300,
        openingFloat: 0,
        registerNumber: "A1",
        status: "closed",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      {
        _creationTime: 200,
        _id: "cloud-register-1",
        expectedCash: 13_000,
        openedAt: 100,
        openingFloat: 13_000,
        openedByStaffProfileId: "staff-1",
        registerNumber: "A1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    ];
    const indexNames: string[] = [];
    const db = {
      query: vi.fn(() =>
        buildTerminalHealthQuery(registerSessions, indexNames),
      ),
    };

    const result = await submitTerminalRuntimeStatus({ db } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: {
        ...buildRuntimeStatus(),
        activeRegisterSession: undefined,
        localStore: {
          available: true,
          schemaVersion: 1,
          terminalSeedReady: true,
        },
      },
    });

    expect(db.query).toHaveBeenCalledWith("registerSession");
    expect(indexNames).toEqual([
      "by_storeId_status_terminalId",
      "by_storeId_status_terminalId",
    ]);
    expect(result).toEqual({
      kind: "ok",
      data: expect.objectContaining({
        activeRegisterSessionDirective: {
          cloudRegisterSessionId: "cloud-register-1",
          expectedCash: 13_000,
          localRegisterSessionId: "cloud-register-1",
          observedAt: 200,
          openedAt: 100,
          openingFloat: 13_000,
          registerNumber: "A1",
          staffProfileId: "staff-1",
          status: "active",
        },
      }),
    });
  });

  it("does not direct a terminal to a usable drawer for another register number", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });
    const registerSessions = [
      {
        _creationTime: 300,
        _id: "cloud-register-renumbered",
        expectedCash: 10_000,
        openedAt: 180,
        openingFloat: 10_000,
        openedByStaffProfileId: "staff-2",
        registerNumber: "B2",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    ];
    const indexNames: string[] = [];
    const db = {
      query: vi.fn(() =>
        buildTerminalHealthQuery(registerSessions, indexNames),
      ),
    };

    const result = await submitTerminalRuntimeStatus({ db } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: {
        ...buildRuntimeStatus(),
        activeRegisterSession: undefined,
        localStore: {
          available: true,
          schemaVersion: 1,
          terminalSeedReady: true,
        },
      },
    });

    expect(indexNames).toEqual([
      "by_storeId_status_terminalId",
      "by_storeId_status_terminalId",
    ]);
    expect(result).toEqual({
      kind: "ok",
      data: expect.not.objectContaining({
        activeRegisterSessionDirective: expect.anything(),
      }),
    });
  });

  it("skips newer incompatible register sessions when an older compatible session exists", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });
    const registerSessions = [
      {
        _creationTime: 300,
        _id: "cloud-register-renumbered",
        expectedCash: 10_000,
        openedAt: 180,
        openingFloat: 10_000,
        openedByStaffProfileId: "staff-2",
        registerNumber: "B2",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      {
        _creationTime: 200,
        _id: "cloud-register-compatible",
        expectedCash: 13_000,
        openedAt: 100,
        openingFloat: 13_000,
        openedByStaffProfileId: "staff-1",
        registerNumber: "A1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    ];
    const db = {
      query: vi.fn(() => buildTerminalHealthQuery(registerSessions)),
    };

    const result = await submitTerminalRuntimeStatus({ db } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: {
        ...buildRuntimeStatus(),
        activeRegisterSession: undefined,
        localStore: {
          available: true,
          schemaVersion: 1,
          terminalSeedReady: true,
        },
      },
    });

    expect(result).toEqual({
      kind: "ok",
      data: expect.objectContaining({
        activeRegisterSessionDirective: expect.objectContaining({
          cloudRegisterSessionId: "cloud-register-compatible",
          expectedCash: 13_000,
          registerNumber: "A1",
          staffProfileId: "staff-1",
        }),
      }),
    });
  });

  it("can direct a terminal to a compatible legacy drawer without a register number", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });
    const registerSessions = [
      {
        _creationTime: 300,
        _id: "cloud-register-legacy",
        expectedCash: 11_000,
        openedAt: 180,
        openingFloat: 11_000,
        openedByStaffProfileId: "staff-3",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      {
        _creationTime: 200,
        _id: "cloud-register-other",
        expectedCash: 10_000,
        openedAt: 160,
        openingFloat: 10_000,
        openedByStaffProfileId: "staff-2",
        registerNumber: "Z9",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    ];
    const db = {
      query: vi.fn(() => buildTerminalHealthQuery(registerSessions)),
    };

    const result = await submitTerminalRuntimeStatus({ db } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: {
        ...buildRuntimeStatus(),
        activeRegisterSession: undefined,
        localStore: {
          available: true,
          schemaVersion: 1,
          terminalSeedReady: true,
        },
      },
    });

    expect(result).toEqual({
      kind: "ok",
      data: expect.objectContaining({
        activeRegisterSessionDirective: expect.objectContaining({
          cloudRegisterSessionId: "cloud-register-legacy",
          expectedCash: 11_000,
          staffProfileId: "staff-3",
        }),
      }),
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.data).toEqual(
      expect.objectContaining({
        activeRegisterSessionDirective: expect.not.objectContaining({
          registerNumber: "Z9",
        }),
      }),
    );
  });

  it("returns an active register session directive when runtime is stuck on a closed cloud drawer", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });
    const registerSessions = [
      {
        _creationTime: 300,
        _id: "cloud-register-active",
        expectedCash: 10_000,
        openedAt: 180,
        openingFloat: 10_000,
        openedByStaffProfileId: "staff-2",
        registerNumber: "A1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
      {
        _creationTime: 200,
        _id: "cloud-register-closed",
        expectedCash: 9_000,
        openedAt: 100,
        openingFloat: 9_000,
        registerNumber: "A1",
        status: "closed",
        storeId: "store-1",
        terminalId: "terminal-1",
      },
    ];
    const indexNames: string[] = [];
    const db = {
      get: vi.fn(async (tableName: string, id: string) =>
        tableName === "registerSession"
          ? (registerSessions.find((session) => session._id === id) ?? null)
          : null,
      ),
      normalizeId: vi.fn((tableName: string, value: string) =>
        tableName === "registerSession" &&
        registerSessions.some((session) => session._id === value)
          ? value
          : null,
      ),
      query: vi.fn(() =>
        buildTerminalHealthQuery(registerSessions, indexNames),
      ),
    };

    const result = await submitTerminalRuntimeStatus({ db } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: {
        ...buildRuntimeStatus(),
        activeRegisterSession: {
          localRegisterSessionId: "cloud-register-closed",
          observedAt: 190,
          openedAt: 100,
          registerNumber: "A1",
          status: "active",
        },
        localStore: {
          available: true,
          schemaVersion: 1,
          terminalSeedReady: true,
        },
      },
    });

    expect(db.get).toHaveBeenCalledWith(
      "registerSession",
      "cloud-register-closed",
    );
    expect(indexNames).toEqual([
      "by_storeId_status_terminalId",
      "by_storeId_status_terminalId",
    ]);
    expect(result).toEqual({
      kind: "ok",
      data: expect.objectContaining({
        activeRegisterSessionDirective: {
          cloudRegisterSessionId: "cloud-register-active",
          expectedCash: 10_000,
          localRegisterSessionId: "cloud-register-active",
          observedAt: 200,
          openedAt: 180,
          openingFloat: 10_000,
          registerNumber: "A1",
          staffProfileId: "staff-2",
          status: "active",
        },
      }),
    });
  });

  it("returns a cloud-closed drawer authority directive for closing local runtime evidence", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });
    const db = {
      normalizeId: vi.fn(() => "cloud-register-1"),
      get: vi.fn(async () => ({
        _id: "cloud-register-1",
        status: "closed",
        storeId: "store-1",
        terminalId: "terminal-1",
      })),
    };

    const result = await submitTerminalRuntimeStatus({ db } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: {
        ...buildRuntimeStatus(),
        activeRegisterSession: {
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
          observedAt: 120,
          openedAt: 100,
          registerNumber: "8",
          status: "closing",
        },
      },
    });

    expect(db.get).toHaveBeenCalledWith("registerSession", "cloud-register-1");
    expect(result).toEqual({
      kind: "ok",
      data: expect.objectContaining({
        drawerAuthorityDirective: expect.objectContaining({
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
          reason: "cloud_closed",
          status: "blocked",
        }),
      }),
    });
  });

  it("ignores malformed cloud register ids in runtime drawer authority evidence", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });
    const db = {
      normalizeId: vi.fn(() => null),
      get: vi.fn(),
    };

    const result = await submitTerminalRuntimeStatus({ db } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: {
        ...buildRuntimeStatus(),
        activeRegisterSession: {
          cloudRegisterSessionId: "not-a-register-id",
          localRegisterSessionId: "local-register-1",
          observedAt: 120,
          openedAt: 100,
          registerNumber: "8",
          status: "active",
        },
      },
    });

    expect(result).toEqual({
      kind: "ok",
      data: expect.not.objectContaining({
        drawerAuthorityDirective: expect.anything(),
      }),
    });
    expect(db.normalizeId).toHaveBeenCalledWith(
      "registerSession",
      "not-a-register-id",
    );
    expect(db.get).not.toHaveBeenCalled();
  });

  it("persists sanitized app-update runtime evidence", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });

    await submitTerminalRuntimeStatus({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: {
        ...buildRuntimeStatus(),
        appUpdate: {
          blockerSummary: "active_sale",
          canApply: false,
          commandExecutionId: "exec-123",
          commandIssuedAt: 90,
          commandNonce: "nonce-abc",
          currentBuildId: " build-current ",
          detectorStatus: "ok",
          observedAt: 100,
          pendingBuildId: "build-next",
          selectedBlockerCode: "active_sale",
          stagingAssetCount: 12.8,
          stagingFailedAssetCount: -2,
          stagingReason: "service-worker-error",
          stagingRejectedAssetCount: 3.2,
          stagingStatus: "staged",
          status: "blocked",
        },
      },
    });

    expect(
      vi.mocked(upsertLatestRuntimeStatusWithOutcome),
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appUpdate: {
          blockerSummary: "active_sale",
          canApply: false,
          commandExecutionId: "exec-123",
          commandIssuedAt: 90,
          commandNonce: "nonce-abc",
          currentBuildId: "build-current",
          detectorStatus: "ok",
          observedAt: 100,
          pendingBuildId: "build-next",
          selectedBlockerCode: "active_sale",
          stagingAssetCount: 12,
          stagingReason: "service-worker-error",
          stagingRejectedAssetCount: 3,
          stagingStatus: "staged",
          status: "blocked",
        },
      }),
    );
  });

  it("clears stale app-update evidence when older clients omit it", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });

    await submitTerminalRuntimeStatus({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: buildRuntimeStatus(),
    });

    expect(
      vi.mocked(upsertLatestRuntimeStatusWithOutcome),
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appUpdate: undefined,
      }),
    );
  });

  it("clears stale app-session recovery status when runtime check-ins omit it", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });

    await submitTerminalRuntimeStatus({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: buildRuntimeStatus(),
    });

    expect(
      vi.mocked(upsertLatestRuntimeStatusWithOutcome),
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        appSessionRecovery: undefined,
      }),
    );
  });

  it("clears stale terminal diagnostics when runtime check-ins omit them", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(upsertLatestRuntimeStatusWithOutcome).mockResolvedValue({
      didWrite: true,
      materialChanged: true,
      runtimeStatusId: "runtime-status-1" as Id<"posTerminalRuntimeStatus">,
    });

    await submitTerminalRuntimeStatus({ db: null as never } as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      status: buildRuntimeStatus(),
    });

    expect(
      vi.mocked(upsertLatestRuntimeStatusWithOutcome),
    ).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        drawerAuthority: undefined,
        terminalIntegrity: undefined,
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
    expect(
      vi.mocked(upsertLatestRuntimeStatusWithOutcome),
    ).not.toHaveBeenCalled();
  });
});

describe("terminal health summaries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveTerminalRegisterSessionActionTarget).mockResolvedValue(
      null,
    );
    vi.mocked(getActiveRegisterSessionForTerminal).mockResolvedValue(null);
    vi.mocked(getDrawerAuthorityRegisterSession).mockResolvedValue(null);
    vi.mocked(getLatestRegisterSessionForTerminal).mockResolvedValue(null);
    vi.mocked(getTerminalSyncReviewSummaryEvidence).mockResolvedValue({
      latestEvent: null,
      sampledEventCount: 0,
      acceptedCount: 0,
      projectedCount: 0,
      conflictedCount: 0,
      heldCount: 0,
      rejectedCount: 0,
      unresolvedConflictCount: 0,
      unresolvedConflicts: [],
      reviewSummary: {
        groups: [],
        meta: {
          sampledCount: 0,
          cap: 20,
          hasMore: false,
          targetResolutionIncomplete: false,
        },
      },
    });
    vi.mocked(hasActiveRegisterSessionForTerminal).mockResolvedValue(false);
    vi.mocked(listTerminalRecoveryConflictsForRepair).mockResolvedValue([]);
    vi.mocked(getTerminalRecoverySourceEvent).mockResolvedValue(null);
    const readRepository = {
      getCommand: vi.fn().mockResolvedValue(null),
      listCommandsForTerminal: vi.fn().mockResolvedValue([]),
    } satisfies TerminalRecoveryCommandReadRepository;
    const writeRepository = {
      ...readRepository,
      insertCommand: vi.fn(),
      patchCommand: vi.fn(),
      listCommandsForTerminal: vi.fn().mockResolvedValue([]),
    } satisfies TerminalRecoveryCommandRepository;
    vi.mocked(createTerminalRecoveryCommandReadRepository).mockReturnValue(
      readRepository,
    );
    vi.mocked(createTerminalRecoveryCommandRepository).mockReturnValue(
      writeRepository,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("joins registration metadata, latest runtime status, and sync evidence in the roster", async () => {
    vi.mocked(listTerminalsForStore).mockResolvedValue([existingTerminal]);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(
      buildPersistedRuntimeStatus(),
    );
    vi.mocked(getTerminalSyncReviewSummaryEvidence).mockResolvedValue({
      latestEvent: null,
      sampledEventCount: 3,
      acceptedCount: 0,
      projectedCount: 2,
      conflictedCount: 1,
      heldCount: 0,
      rejectedCount: 0,
      unresolvedConflictCount: 1,
      unresolvedConflicts: [],
      reviewSummary: {
        groups: [
          {
            actionability: "manual_review",
            conflictType: "inventory",
            count: 1,
            latestCreatedAt: 160,
            latestSequence: 7,
            owner: "manual_review",
          },
        ],
        meta: {
          sampledCount: 1,
          cap: 20,
          hasMore: false,
          targetResolutionIncomplete: false,
        },
      },
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
        syncEvidence: expect.objectContaining({
          conflictedCount: 1,
          projectedCount: 2,
          sampledEventCount: 3,
          unresolvedConflictCount: 1,
          reviewSummary: expect.objectContaining({
            groups: [
              expect.objectContaining({
                conflictType: "inventory",
                count: 1,
              }),
            ],
          }),
        }),
      }),
    ]);
    expect(vi.mocked(getTerminalSyncEvidence)).not.toHaveBeenCalled();
    expect(
      vi.mocked(getTerminalSyncReviewSummaryEvidence),
    ).toHaveBeenCalledWith(expect.anything(), {
      storeId: "store-1",
      terminalId: "terminal-1",
    });
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
        now: 300,
      },
    );

    expect(result[0]?.runtimeStatus?.appSessionRecovery).toEqual({
      status: "blocked_app_account",
    });
  });

  it("ages preserved app-update evidence independently from fresh runtime check-ins", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(
      buildPersistedRuntimeStatus({
        appUpdate: {
          canApply: true,
          currentBuildId: "build-current",
          detectorStatus: "ok",
          observedAt: 100,
          pendingBuildId: "build-next",
          stagingStatus: "unstaged",
          status: "update_ready_unstaged",
        },
        receivedAt: 130_000,
        reportedAt: 130_000,
      } as never),
    );
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: null,
      sampledEventCount: 0,
      acceptedCount: 0,
      projectedCount: 0,
      conflictedCount: 0,
      heldCount: 0,
      rejectedCount: 0,
      unresolvedConflictCount: 0,
      unresolvedConflicts: [],
    });

    const result = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 130_010,
      },
    );

    expect(result?.runtimeAgeMs).toBe(10);
    expect(result?.recoveryPreview?.runtimeFresh).toBe(true);
    expect(result?.recoveryPreview?.appUpdate).toEqual(
      expect.objectContaining({
        evidenceFresh: false,
        observedAt: 100,
        status: "stale",
      }),
    );
  });

  it("loads sampled sync evidence for terminal detail", async () => {
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

  it("keeps local runtime review reasons on terminal-side guidance even when review evidence has a register session", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(
      buildPersistedRuntimeStatus({
        sync: {
          ...buildRuntimeStatus().sync,
          failedEventCount: 0,
          reviewEventCount: 14,
          status: "needs_review" as never,
        },
      }),
    );
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: null,
      latestReviewEvent: {
        eventType: "register_opened",
        localEventId: "local-review-1",
        localRegisterSessionId: "local-register-1",
        sequence: 1,
        status: "conflicted",
      },
      sampledEventCount: 14,
      acceptedCount: 0,
      projectedCount: 0,
      conflictedCount: 0,
      heldCount: 0,
      rejectedCount: 0,
      acceptedThroughSequence: 0,
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

    expect(resolveTerminalRegisterSessionActionTarget).not.toHaveBeenCalled();
    expect(result?.attentionReasons).toEqual([
      expect.objectContaining({
        actionTarget: { type: "pos_register" },
        count: 14,
        source: "local_runtime",
        type: "local_review",
      }),
    ]);
    expect(result?.recoveryPreview?.terminalActions).toEqual([
      expect.objectContaining({
        commandContext: expect.objectContaining({
          expectedBlockerType: "local_review",
        }),
        commandType: "collect_local_review",
        expectedEvidence: { localReviewDetailsCollected: true },
        reason: "Local review items need terminal-local evidence collection.",
      }),
    ]);
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
        count: 1,
        source: "cloud_sync",
        summary: "1 cloud sync conflict needs review.",
        type: "cloud_conflict",
      }),
      expect.objectContaining({
        count: 1,
        source: "cloud_sync",
        summary: "1 synced item is held before projection.",
        type: "cloud_held",
      }),
      expect.objectContaining({
        count: 1,
        source: "cloud_sync",
        summary: "1 synced item was rejected by the server.",
        type: "cloud_rejected",
      }),
    ]);
    expect(result?.attentionReasons.some((reason) => reason.actionTarget)).toBe(
      false,
    );
  });

  it("does not link manual-only cloud review counts to open work", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(null);
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: {
        localEventId: "local-event-44",
        localRegisterSessionId: "local-register-1",
        sequence: 44,
        eventType: "register_closed",
        status: "rejected",
        occurredAt: 120,
        submittedAt: 130,
      },
      sampledEventCount: 100,
      acceptedCount: 0,
      projectedCount: 96,
      conflictedCount: 50,
      heldCount: 0,
      rejectedCount: 0,
      acceptedThroughSequence: 26,
      cursorUpdatedAt: 180,
      reviewSummary: {
        groups: [
          {
            actionability: "open_work_review",
            conflictType: "permission",
            count: 28,
            latestCreatedAt: 160,
            latestSequence: 44,
            owner: "operations_open_work",
            reviewTarget: {
              type: "open_work",
              workItemId: "work-item-1" as Id<"operationalWorkItem">,
              workItemType: "synced_sale_inventory_review",
            },
          },
          {
            actionability: "manual_review",
            conflictType: "permission",
            count: 22,
            latestCreatedAt: 150,
            latestSequence: 43,
            owner: "manual_review",
          },
        ],
        meta: {
          cap: 50,
          hasMore: false,
          sampledCount: 50,
          targetResolutionIncomplete: false,
        },
      },
      unresolvedConflictCount: 50,
    });

    const result = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );

    const openWorkReason = result?.attentionReasons.find(
      (reason) => reason.count === 28,
    );
    const manualReason = result?.attentionReasons.find(
      (reason) => reason.count === 22,
    );

    expect(openWorkReason).toMatchObject({
      actionTarget: {
        label: "Review open work",
        type: "open_work",
      },
      summary: "28 cloud sync conflicts need review.",
      type: "cloud_conflict",
    });
    expect(manualReason).toMatchObject({
      summary:
        "22 cloud sync conflicts require manager review before support can repair this terminal.",
      type: "cloud_conflict",
    });
    expect(manualReason?.actionTarget).toBeUndefined();
  });

  it("does not apply cash-control fallback targets to manual review summary groups", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(null);
    vi.mocked(resolveTerminalRegisterSessionActionTarget).mockResolvedValue(
      "register-session-fallback" as Id<"registerSession">,
    );
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: {
        localEventId: "local-event-44",
        localRegisterSessionId: "local-register-1",
        sequence: 44,
        eventType: "register_closed",
        status: "conflicted",
        occurredAt: 120,
        submittedAt: 130,
      },
      sampledEventCount: 100,
      acceptedCount: 0,
      projectedCount: 96,
      conflictedCount: 50,
      heldCount: 0,
      rejectedCount: 0,
      reviewSummary: {
        groups: [
          {
            actionability: "manual_review",
            conflictType: "permission",
            count: 22,
            latestCreatedAt: 150,
            latestSequence: 43,
            owner: "manual_review",
          },
          {
            actionTarget: {
              registerSessionId:
                "register-session-cash" as Id<"registerSession">,
              type: "register_session",
            },
            actionability: "cash_controls_review",
            conflictType: "permission",
            count: 1,
            latestCreatedAt: 160,
            latestSequence: 44,
            owner: "cash_controls",
          },
        ],
        meta: {
          cap: 50,
          hasMore: false,
          sampledCount: 23,
          targetResolutionIncomplete: false,
        },
      },
      unresolvedConflictCount: 23,
    });

    const result = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );

    expect(resolveTerminalRegisterSessionActionTarget).not.toHaveBeenCalled();
    const manualReason = result?.attentionReasons.find(
      (reason) => reason.count === 22,
    );
    const cashControlReason = result?.attentionReasons.find(
      (reason) => reason.count === 1,
    );
    expect(manualReason).toMatchObject({
      summary:
        "22 cloud sync conflicts require manager review before support can repair this terminal.",
      type: "cloud_conflict",
    });
    expect(manualReason?.actionTarget).toBeUndefined();
    expect(cashControlReason).toMatchObject({
      actionTarget: {
        registerSessionId: "register-session-cash",
        type: "cash_control_register_session",
      },
      summary: "1 cash control review item needs attention.",
      type: "cloud_conflict",
    });
  });

  it("does not synthesize inventory open-work links without a resolved target", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(null);
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: null,
      latestReviewEvent: null,
      latestReviewEventsByStatus: {
        conflicted: null,
        held: null,
        rejected: null,
      },
      sampledEventCount: 2,
      acceptedCount: 0,
      projectedCount: 0,
      conflictedCount: 2,
      heldCount: 0,
      rejectedCount: 0,
      reviewSummary: {
        groups: [
          {
            actionability: "manual_review",
            conflictType: "inventory",
            count: 2,
            latestCreatedAt: 160,
            latestSequence: 44,
            owner: "manual_review",
          },
        ],
        meta: {
          cap: 50,
          hasMore: false,
          sampledCount: 2,
          targetResolutionIncomplete: false,
        },
      },
      unresolvedConflictCount: 2,
    });

    const result = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );

    expect(result?.attentionReasons).toEqual([
      expect.objectContaining({
        count: 2,
        summary: "2 inventory review items need attention.",
        type: "synced_sale_inventory_review",
      }),
    ]);
    expect(result?.attentionReasons[0]?.actionTarget).toBeUndefined();
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

  it("routes projected inventory review conflicts to operations work", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(null);
    vi.mocked(getTerminalSyncEvidence).mockResolvedValue({
      latestEvent: {
        localEventId: "event-sale-completed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 26,
        eventType: "sale_completed",
        status: "conflicted",
        occurredAt: 120,
        submittedAt: 130,
      },
      latestReviewEvent: {
        localEventId: "event-sale-completed-1",
        localRegisterSessionId: "local-register-1",
        sequence: 26,
        eventType: "sale_completed",
        status: "conflicted",
      },
      sampledEventCount: 1,
      acceptedCount: 0,
      projectedCount: 1,
      conflictedCount: 1,
      heldCount: 0,
      rejectedCount: 0,
      unresolvedConflictCount: 1,
      unresolvedConflicts: [
        {
          _id: "conflict-1" as Id<"posLocalSyncConflict">,
          conflictType: "inventory",
          createdAt: 140,
          localEventId: "event-sale-completed-1",
          localRegisterSessionId: "local-register-1",
          sequence: 26,
          summary: "Inventory needs manager review for a synced offline sale.",
        },
      ],
      reviewSummary: {
        groups: [
          {
            actionability: "open_work_review",
            conflictType: "inventory",
            count: 1,
            latestCreatedAt: 140,
            latestSequence: 26,
            owner: "operations_open_work",
            reviewTarget: {
              type: "open_work",
              workItemId: "work-item-1" as Id<"operationalWorkItem">,
              workItemType: "synced_sale_inventory_review",
            },
          },
        ],
        meta: {
          cap: 50,
          hasMore: false,
          sampledCount: 1,
          targetResolutionIncomplete: false,
        },
      },
    });

    const result = await getTerminalHealthSummary(
      {
        db: {
          query: vi.fn((tableName: string) => ({
            withIndex: vi.fn(() => {
              const query = {
                order: vi.fn(() => query),
                take: vi.fn().mockResolvedValue(
                  tableName === "operationalWorkItem"
                    ? [
                        {
                          _id: "work-item-1" as Id<"operationalWorkItem">,
                          metadata: {
                            localEventId: "event-sale-completed-1",
                          },
                          status: "open",
                          storeId: "store-1",
                          type: "synced_sale_inventory_review",
                        },
                      ]
                    : [],
                ),
              };
              return query;
            }),
          })),
        },
      } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );

    expect(resolveTerminalRegisterSessionActionTarget).not.toHaveBeenCalled();
    expect(result?.attentionReasons).toEqual([
      expect.objectContaining({
        actionTarget: {
          label: "Review inventory work",
          type: "open_work",
        },
        count: 1,
        source: "cloud_sync",
        summary: "1 inventory review item needs attention.",
        type: "synced_sale_inventory_review",
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

  it("classifies healthy idle separately from able to transact now", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(
      buildPersistedRuntimeStatus({
        receivedAt: 220,
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
      latestEvent: null,
      sampledEventCount: 0,
      acceptedCount: 0,
      projectedCount: 0,
      conflictedCount: 0,
      heldCount: 0,
      rejectedCount: 0,
      unresolvedConflictCount: 0,
      unresolvedConflicts: [],
    });

    const healthyIdle = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );
    expect(healthyIdle?.recoveryPreview?.readiness).toBe("healthy_idle");

    vi.mocked(getActiveRegisterSessionForTerminal).mockResolvedValue(
      buildRegisterSession({
        _id: "register-1" as Id<"registerSession">,
        status: "active",
      }),
    );
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(
      buildPersistedRuntimeStatus({
        receivedAt: 230,
        saleAuthority: {
          localPosSessionId: "local-pos-session-1",
          localRegisterSessionId: "register-1",
          observedAt: 230,
          staffProfileId: "staff-1" as Id<"staffProfile">,
          status: "ready",
          transactionMode: "products_and_services",
        },
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

    const ableToTransact = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 230,
      },
    );
    expect(ableToTransact?.recoveryPreview?.readiness).toBe(
      "able_to_transact_now",
    );
  });

  it("requires fresh runtime sale authority before reporting able to transact now", async () => {
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(
      buildPersistedRuntimeStatus({
        receivedAt: 220 - 10 * 60 * 1000,
        saleAuthority: {
          localPosSessionId: "local-pos-session-1",
          localRegisterSessionId: "register-1",
          observedAt: 200,
          status: "ready",
        },
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
        localEventId: "register-opened",
        localRegisterSessionId: "register-1",
        sequence: 1,
        eventType: "register_opened",
        status: "projected",
        occurredAt: 100,
        submittedAt: 110,
        projectedAt: 120,
      },
      sampledEventCount: 1,
      acceptedCount: 0,
      projectedCount: 1,
      conflictedCount: 0,
      heldCount: 0,
      rejectedCount: 0,
      unresolvedConflictCount: 0,
      unresolvedConflicts: [],
    });

    const result = await getTerminalHealthSummary(
      { db: null as never } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );

    expect(result?.recoveryPreview?.runtimeFresh).toBe(false);
    expect(result?.recoveryPreview?.readiness).toBe("healthy_idle");
  });

  it("returns cloud repair preview only for safe stale duplicate register-open conflicts", async () => {
    const conflict = buildSyncConflict({
      _id: "conflict-safe" as Id<"posLocalSyncConflict">,
      createdAt: 220 - 20 * 60 * 1000,
      details: { reason: "duplicate_register_opened" },
      summary: "Duplicate register-open attempt for an already opened drawer.",
    });
    vi.mocked(getTerminalById).mockResolvedValue(existingTerminal);
    vi.mocked(getLatestRuntimeStatusForTerminal).mockResolvedValue(
      buildPersistedRuntimeStatus({
        receivedAt: 220,
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
        localEventId: "event-1",
        localRegisterSessionId: "register-1",
        sequence: 1,
        eventType: "register_opened",
        status: "conflicted",
        occurredAt: 100,
        submittedAt: 110,
      },
      sampledEventCount: 1,
      acceptedCount: 0,
      projectedCount: 0,
      conflictedCount: 1,
      heldCount: 0,
      rejectedCount: 0,
      unresolvedConflictCount: 1,
      unresolvedConflicts: [],
    });
    vi.mocked(listTerminalRecoveryConflictsForRepair).mockResolvedValue([
      conflict,
    ]);
    vi.mocked(getTerminalRecoverySourceEvent).mockResolvedValue(
      buildSyncEvent({ eventType: "register_opened", status: "conflicted" }),
    );

    const result = await getTerminalHealthSummary(
      {
        db: buildTerminalHealthDb({
          posTerminal: [existingTerminal],
          registerSession: [],
          staffProfile: [
            {
              _id: "staff-1" as Id<"staffProfile">,
              _creationTime: 100,
              status: "active",
              storeId: "store-1" as Id<"store">,
            } as Doc<"staffProfile">,
          ],
          staffRoleAssignment: [
            {
              _id: "role-1",
              _creationTime: 100,
              role: "cashier",
              staffProfileId: "staff-1",
              status: "active",
              storeId: "store-1",
            },
          ],
        }),
      } as never,
      {
        storeId: "store-1" as Id<"store">,
        terminalId: "terminal-1" as Id<"posTerminal">,
        now: 220,
      },
    );

    expect(result?.recoveryPreview).toMatchObject({
      readiness: "needs_cloud_repair",
      cloudRepair: {
        safeConflictIds: ["conflict-safe"],
        skippedConflictIds: [],
      },
    });
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
    saleAuthority?: Doc<"posTerminalRuntimeStatus">["saleAuthority"];
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

function buildSyncConflict(
  overrides: Partial<Doc<"posLocalSyncConflict">> = {},
): Doc<"posLocalSyncConflict"> {
  return {
    _id: "conflict-1" as Id<"posLocalSyncConflict">,
    _creationTime: overrides.sequence ?? 1,
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    localRegisterSessionId: "register-1",
    localEventId: "event-1",
    sequence: 1,
    conflictType: "duplicate_local_id",
    status: "needs_review",
    summary: "Duplicate register-open attempt.",
    details: { reason: "duplicate_register_opened" },
    createdAt: 100,
    ...overrides,
  } as Doc<"posLocalSyncConflict">;
}

function buildSyncEvent(
  overrides: Partial<Doc<"posLocalSyncEvent">> = {},
): Doc<"posLocalSyncEvent"> {
  return {
    _id: "event-1-id" as Id<"posLocalSyncEvent">,
    _creationTime: overrides.sequence ?? 1,
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    localRegisterSessionId: "register-1",
    localEventId: "event-1",
    eventType: "register_opened",
    occurredAt: 100,
    staffProfileId: "staff-1" as Id<"staffProfile">,
    payload: {
      openingFloat: 100,
      registerNumber: "A1",
    },
    sequence: 1,
    status: "conflicted",
    submittedAt: 110,
    ...overrides,
  } as Doc<"posLocalSyncEvent">;
}

function buildRegisterSession(
  overrides: Partial<Doc<"registerSession">> = {},
): Doc<"registerSession"> {
  return {
    _id: "register-1" as Id<"registerSession">,
    _creationTime: 100,
    closeoutRecords: [],
    closedAt: undefined,
    expectedCash: 0,
    openedAt: 100,
    openingFloat: 0,
    registerNumber: "A1",
    status: "open",
    storeId: "store-1" as Id<"store">,
    terminalId: "terminal-1" as Id<"posTerminal">,
    ...overrides,
  };
}

function buildTerminalHealthDb(
  records: Partial<Record<string, Array<Record<string, unknown>>>>,
) {
  return {
    get: vi.fn(async (tableName: string, id: string) => {
      return records[tableName]?.find((record) => record._id === id) ?? null;
    }),
    normalizeId: vi.fn((tableName: string, value: string) => {
      return records[tableName]?.some((record) => record._id === value)
        ? value
        : null;
    }),
    query: vi.fn((tableName: string) =>
      buildTerminalHealthQuery(records[tableName] ?? []),
    ),
  };
}

function buildTerminalHealthQuery(
  records: Array<Record<string, unknown>>,
  indexNames?: string[],
) {
  let currentRecords = [...records];
  const chain = {
    first: vi.fn(async () => currentRecords[0] ?? null),
    order: vi.fn((direction: "asc" | "desc") => {
      currentRecords = [...currentRecords].sort((left, right) => {
        const leftTime = Number(left._creationTime ?? 0);
        const rightTime = Number(right._creationTime ?? 0);
        return direction === "desc"
          ? rightTime - leftTime
          : leftTime - rightTime;
      });
      return chain;
    }),
    take: vi.fn(async (count: number) => currentRecords.slice(0, count)),
    withIndex: vi.fn(
      (
        indexName: string,
        build: (q: {
          eq: (field: string, value: unknown) => unknown;
        }) => unknown,
      ) => {
        indexNames?.push(indexName);
        const q = {
          eq: vi.fn((field: string, value: unknown) => {
            currentRecords = currentRecords.filter(
              (record) => record[field] === value,
            );
            return q;
          }),
        };
        build(q);
        return chain;
      },
    ),
  };
  return chain;
}
