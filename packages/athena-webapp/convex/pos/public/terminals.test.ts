import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteTerminalCommand: vi.fn(),
  getTerminalByFingerprintQuery: vi.fn(),
  listTerminalsQuery: vi.fn(),
  registerTerminalCommand: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
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
  updateTerminal: mocks.updateTerminalCommand,
}));

vi.mock("../application/queries/terminals", () => ({
  getTerminalByFingerprint: mocks.getTerminalByFingerprintQuery,
  listTerminals: mocks.listTerminalsQuery,
}));

import {
  deleteTerminal,
  getTerminalByFingerprint,
  listTerminals,
  registerTerminal,
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
});

function buildCtx() {
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
          return {
            _id: "terminal-1",
            storeId: "store-1",
            status: "active",
          };
        }

        return null;
      }),
    },
  };
}
