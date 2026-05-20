import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteTerminalCommand: vi.fn(),
  getTerminalHealthSummaryQuery: vi.fn(),
  getTerminalByFingerprintQuery: vi.fn(),
  listTerminalHealthSummariesQuery: vi.fn(),
  listTerminalsQuery: vi.fn(),
  registerTerminalCommand: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  submitTerminalRuntimeStatusCommand: vi.fn(),
  updateTerminalCommand: vi.fn(),
}));

vi.mock("../../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));

vi.mock("../application/commands/terminals", () => ({
  deleteTerminal: mocks.deleteTerminalCommand,
  registerTerminal: mocks.registerTerminalCommand,
  submitTerminalRuntimeStatus: mocks.submitTerminalRuntimeStatusCommand,
  updateTerminal: mocks.updateTerminalCommand,
}));

vi.mock("../application/queries/terminals", () => ({
  getTerminalByFingerprint: mocks.getTerminalByFingerprintQuery,
  getTerminalHealthSummary: mocks.getTerminalHealthSummaryQuery,
  listTerminalHealthSummaries: mocks.listTerminalHealthSummariesQuery,
  listTerminals: mocks.listTerminalsQuery,
}));

import {
  deleteTerminal,
  getTerminalByFingerprint,
  getTerminalHealthSummary,
  listTerminalHealthSummaries,
  listTerminals,
  registerTerminal,
  submitTerminalRuntimeStatus,
  updateTerminal,
} from "./terminals";

const SYNC_SECRET_HASH =
  "e3aaef72556405db4093f59a9aa8ee6539f8e6542e60d92f08e782faa0d246fa";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("POS terminal public mutations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue(undefined);
    mocks.registerTerminalCommand.mockResolvedValue({
      kind: "ok",
      data: {
        _id: "terminal-1",
        _creationTime: 1,
        storeId: "store-1",
        fingerprintHash: "fingerprint-1",
        syncSecretHash: "sync-secret-1",
        displayName: "Front register",
        registeredByUserId: "athena-user-1",
        browserInfo: { userAgent: "test" },
        registeredAt: 1,
        status: "active",
      },
    });
    mocks.deleteTerminalCommand.mockResolvedValue(null);
    mocks.updateTerminalCommand.mockResolvedValue({
      _id: "terminal-1",
      _creationTime: 1,
      storeId: "store-1",
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-1",
      displayName: "Front register",
      registeredByUserId: "athena-user-1",
      browserInfo: { userAgent: "test" },
      registeredAt: 1,
      status: "active",
    });
    mocks.listTerminalsQuery.mockResolvedValue([]);
    mocks.getTerminalByFingerprintQuery.mockResolvedValue(null);
    mocks.listTerminalHealthSummariesQuery.mockResolvedValue([]);
    mocks.getTerminalHealthSummaryQuery.mockResolvedValue(null);
    mocks.submitTerminalRuntimeStatusCommand.mockResolvedValue({
      kind: "ok",
      data: {
        terminalId: "terminal-1",
        reportedAt: 100,
        receivedAt: 200,
      },
    });
  });

  it("derives terminal ownership from the signed-in user and verifies store membership", async () => {
    const ctx = buildCtx();

    await getHandler(registerTerminal)(ctx as never, {
      storeId: "store-1",
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-1",
      displayName: "Front register",
      registerNumber: "1",
      browserInfo: { userAgent: "test" },
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.registerTerminalCommand).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        registeredByUserId: "athena-user-1",
      }),
    );
  });

  it("does not register a terminal when store membership is missing", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("denied"),
    );
    const ctx = buildCtx();

    const result = await getHandler(registerTerminal)(ctx as never, {
      storeId: "store-1",
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-1",
      displayName: "Front register",
      registerNumber: "1",
      browserInfo: { userAgent: "test" },
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to register this POS terminal.",
      },
    });
    expect(mocks.registerTerminalCommand).not.toHaveBeenCalled();
  });

  it("requires full admin membership before deleting a terminal", async () => {
    const ctx = buildCtx();

    await getHandler(deleteTerminal)(ctx as never, {
      terminalId: "terminal-1",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.deleteTerminalCommand).toHaveBeenCalledWith(ctx, {
      terminalId: "terminal-1",
    });
  });

  it("does not delete a terminal when full admin membership is missing", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("denied"),
    );
    const ctx = buildCtx();

    await expect(
      getHandler(deleteTerminal)(ctx as never, { terminalId: "terminal-1" }),
    ).rejects.toThrow("denied");
    expect(mocks.deleteTerminalCommand).not.toHaveBeenCalled();
  });

  it("requires full admin membership before updating a terminal", async () => {
    const ctx = buildCtx();

    const result = await getHandler(updateTerminal)(ctx as never, {
      terminalId: "terminal-1",
      displayName: "Updated terminal",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.updateTerminalCommand).toHaveBeenCalledWith(ctx, {
      terminalId: "terminal-1",
      displayName: "Updated terminal",
    });
    expect(result).toEqual(
      expect.not.objectContaining({
        syncSecretHash: expect.any(String),
      }),
    );
  });

  it("requires store membership before listing terminals", async () => {
    mocks.listTerminalsQuery.mockResolvedValue([
      {
        _id: "terminal-1",
        _creationTime: 1,
        storeId: "store-1",
        fingerprintHash: "fingerprint-1",
        syncSecretHash: "sync-secret-1",
        displayName: "Front register",
        registeredByUserId: "athena-user-1",
        browserInfo: { userAgent: "test" },
        registeredAt: 1,
        status: "active",
      },
    ]);
    const ctx = buildCtx();

    const result = await getHandler(listTerminals)(ctx as never, {
      storeId: "store-1",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.listTerminalsQuery).toHaveBeenCalledWith(ctx, {
      storeId: "store-1",
    });
    expect(result).toEqual([
      expect.not.objectContaining({
        syncSecretHash: expect.any(String),
      }),
    ]);
  });

  it("requires store membership before looking up terminals by fingerprint", async () => {
    mocks.getTerminalByFingerprintQuery.mockResolvedValue({
      _id: "terminal-1",
      _creationTime: 1,
      storeId: "store-1",
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-1",
      displayName: "Front register",
      registeredByUserId: "athena-user-1",
      browserInfo: { userAgent: "test" },
      registeredAt: 1,
      status: "active",
    });
    const ctx = buildCtx();

    const result = await getHandler(getTerminalByFingerprint)(ctx as never, {
      storeId: "store-1",
      fingerprintHash: "fingerprint-1",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.getTerminalByFingerprintQuery).toHaveBeenCalledWith(ctx, {
      storeId: "store-1",
      fingerprintHash: "fingerprint-1",
    });
    expect(result).toEqual(
      expect.not.objectContaining({
        syncSecretHash: expect.any(String),
      }),
    );
  });

  it("returns the sync secret only from terminal registration", async () => {
    const ctx = buildCtx();

    const result = await getHandler(registerTerminal)(ctx as never, {
      storeId: "store-1",
      fingerprintHash: "fingerprint-1",
      syncSecretHash: "sync-secret-1",
      displayName: "Front register",
      registerNumber: "1",
      browserInfo: { userAgent: "test" },
    });

    expect(result).toEqual({
      kind: "ok",
      data: expect.objectContaining({
        syncSecretHash: "sync-secret-1",
      }),
    });
    expect(mocks.registerTerminalCommand).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        syncSecretHash: SYNC_SECRET_HASH,
      }),
    );
  });

  it("accepts redacted runtime status from the terminal owner only", async () => {
    const ctx = buildCtx();

    const result = await getHandler(submitTerminalRuntimeStatus)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      status: buildRuntimeStatus({
        staffProofToken: "proof-token",
        verifierMetadata: { salt: "never" },
        rawLocalEvents: [{ payload: { customerInfo: { phone: "never" } } }],
      }),
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        terminalId: "terminal-1",
        reportedAt: 100,
        receivedAt: 200,
      },
    });
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.submitTerminalRuntimeStatusCommand).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        storeId: "store-1",
        terminalId: "terminal-1",
        status: expect.not.objectContaining({
          staffProofToken: expect.anything(),
          verifierMetadata: expect.anything(),
          rawLocalEvents: expect.anything(),
        }),
      }),
    );
  });

  it.each([
    {
      name: "missing terminal",
      terminal: null,
    },
    {
      name: "inactive terminal",
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "revoked",
        registeredByUserId: "athena-user-1",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    },
    {
      name: "wrong store",
      terminal: {
        _id: "terminal-1",
        storeId: "store-2",
        status: "active",
        registeredByUserId: "athena-user-1",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    },
    {
      name: "wrong registered user",
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-2",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    },
    {
      name: "missing sync secret",
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-1",
      },
    },
    {
      name: "wrong sync secret",
      syncSecretHash: "wrong-sync-secret",
      terminal: {
        _id: "terminal-1",
        storeId: "store-1",
        status: "active",
        registeredByUserId: "athena-user-1",
        syncSecretHash: SYNC_SECRET_HASH,
      },
    },
  ])("does not write runtime status for $name", async (scenario) => {
    const ctx = buildCtx({ terminal: scenario.terminal });

    const result = await getHandler(submitTerminalRuntimeStatus)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: scenario.syncSecretHash ?? "sync-secret-1",
      status: buildRuntimeStatus(),
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to update this POS terminal status.",
      },
    });
    expect(mocks.submitTerminalRuntimeStatusCommand).not.toHaveBeenCalled();
  });

  it("does not inspect terminal credentials when runtime status store membership is denied", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("denied"),
    );
    const ctx = buildCtx();

    const result = await getHandler(submitTerminalRuntimeStatus)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      syncSecretHash: "sync-secret-1",
      status: buildRuntimeStatus(),
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to update this POS terminal status.",
      },
    });
    expect(ctx.db.get).toHaveBeenCalledWith("store", "store-1");
    expect(ctx.db.get).not.toHaveBeenCalledWith("posTerminal", "terminal-1");
    expect(mocks.submitTerminalRuntimeStatusCommand).not.toHaveBeenCalled();
  });

  it("requires store membership before listing terminal health summaries", async () => {
    const ctx = buildCtx();

    await getHandler(listTerminalHealthSummaries)(ctx as never, {
      storeId: "store-1",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.listTerminalHealthSummariesQuery).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        storeId: "store-1",
      }),
    );
  });

  it("requires store membership before loading terminal health detail", async () => {
    const ctx = buildCtx();

    await getHandler(getTerminalHealthSummary)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.getTerminalHealthSummaryQuery).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
  });
});

function buildRuntimeStatus(extra: Record<string, unknown> = {}) {
  return {
    reportedAt: 100,
    source: "sync-runtime",
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
    },
    sync: {
      status: "pending",
      pendingEventCount: 2,
      uploadableEventCount: 2,
      failedEventCount: 0,
      reviewEventCount: 0,
      localOnlyEventCount: 0,
      oldestPendingEventAt: 90,
      nextPendingUploadSequence: 4,
      lastSyncedSequence: 3,
      lastTrigger: "event-append",
    },
    staffAuthority: {
      status: "ready",
      staffProfileId: "staff-1",
      expiresAt: 1000,
    },
    snapshots: {
      catalogAgeMs: 10,
      availabilityAgeMs: 20,
      registerReadModelAgeMs: 30,
    },
    ...extra,
  };
}

function buildCtx(
  overrides: {
    terminal?: Record<string, unknown> | null;
  } = {},
) {
  return {
    db: {
      get: vi.fn(async (tableName: string, id: string) => {
        if (tableName === "store" && id === "store-1") {
          return {
            _id: "store-1",
            organizationId: "org-1",
          };
        }

        if (tableName === "posTerminal" && id === "terminal-1") {
          return Object.prototype.hasOwnProperty.call(overrides, "terminal")
            ? overrides.terminal
            : {
            _id: "terminal-1",
            storeId: "store-1",
            status: "active",
            registeredByUserId: "athena-user-1",
            syncSecretHash: SYNC_SECRET_HASH,
          };
        }

        return null;
      }),
    },
  };
}
