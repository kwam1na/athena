import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRemoteAssistRepository: vi.fn(),
  endRemoteAssistSession: vi.fn(),
  getClient: vi.fn(),
  getClientByRuntime: vi.fn(),
  getSession: vi.fn(),
  listReusableSessionsForClient: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
  startRemoteAssistSession: vi.fn(),
}));

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));

vi.mock("./application/sessionService", () => ({
  endRemoteAssistSession: mocks.endRemoteAssistSession,
  startRemoteAssistSession: mocks.startRemoteAssistSession,
}));

vi.mock("./infrastructure/remoteAssistRepository", () => ({
  createRemoteAssistRepository: mocks.createRemoteAssistRepository,
}));

import * as remoteAssistPublic from "./public";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("remote assist public API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "athena-user-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue(undefined);
    mocks.getClientByRuntime.mockResolvedValue(buildClient());
    mocks.getClient.mockResolvedValue(buildClient());
    mocks.getSession.mockResolvedValue(buildSession());
    mocks.createRemoteAssistRepository.mockReturnValue({
      getClient: mocks.getClient,
      getClientByRuntime: mocks.getClientByRuntime,
      getSession: mocks.getSession,
      listReusableSessionsForClient: mocks.listReusableSessionsForClient,
    });
    mocks.listReusableSessionsForClient.mockResolvedValue([
      buildSession({
        _id: "connecting-session",
        requestedAt: 20,
        status: "connecting",
      }),
      buildSession({
        _id: "active-session",
        requestedAt: 10,
        status: "active",
      }),
    ]);
    mocks.startRemoteAssistSession.mockResolvedValue({
      kind: "ok",
      data: buildSession({ status: "connecting" }),
    });
    mocks.endRemoteAssistSession.mockResolvedValue({
      kind: "ok",
      data: buildSession({ endedAt: 2_000, status: "ended" }),
    });
  });

  it("does not expose runtime claim or approval without runtime-bound proof", () => {
    expect(remoteAssistPublic).not.toHaveProperty("approveAttendedSession");
    expect(remoteAssistPublic).not.toHaveProperty("claimRuntimeSession");
    expect(remoteAssistPublic).not.toHaveProperty("upsertClientPresence");
  });

  it("exposes only support-scoped session lifecycle mutations in v1", () => {
    expect(remoteAssistPublic).toHaveProperty("getClientByRuntime");
    expect(remoteAssistPublic).toHaveProperty("getCurrentSessionByClient");
    expect(remoteAssistPublic).toHaveProperty("startSession");
    expect(remoteAssistPublic).toHaveProperty("endSupportSession");
  });

  it("requires organization membership before returning a runtime client", async () => {
    const ctx = {};

    await getHandler(remoteAssistPublic.getClientByRuntime)(ctx, {
      organizationId: "org-1",
      runtimeIdentity: "terminal-1",
      runtimeType: "pos_terminal",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.getClientByRuntime).toHaveBeenCalledWith({
      organizationId: "org-1",
      runtimeIdentity: "terminal-1",
      runtimeType: "pos_terminal",
    });
  });

  it("returns not_found before authorizing a missing client start", async () => {
    mocks.getClient.mockResolvedValue(null);

    const result = await getHandler(remoteAssistPublic.startSession)(
      {},
      {
        clientId: "client-1",
        reason: "M Supplies terminal recovery",
        requestedMode: "unattended",
      },
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Remote Assist client was not found.",
      },
    });
    expect(mocks.requireOrganizationMemberRoleWithCtx).not.toHaveBeenCalled();
    expect(mocks.startRemoteAssistSession).not.toHaveBeenCalled();
  });

  it("requires full admin membership before starting a support session", async () => {
    mocks.requireOrganizationMemberRoleWithCtx.mockRejectedValue(
      new Error("denied"),
    );

    await expect(
      getHandler(remoteAssistPublic.startSession)(
        {},
        {
          clientId: "client-1",
          reason: "M Supplies terminal recovery",
          requestedMode: "unattended",
        },
      ),
    ).rejects.toThrow("denied");

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        allowedRoles: ["full_admin"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.startRemoteAssistSession).not.toHaveBeenCalled();
  });

  it("delegates support session starts with actor, mode, and metadata", async () => {
    const ctx = {};

    const result = await getHandler(remoteAssistPublic.startSession)(ctx, {
      clientId: "client-1",
      metadata: { terminalId: "terminal-1" },
      reason: "M Supplies terminal recovery",
      requestedMode: "unattended",
      transportRoomId: "room-1",
    });

    expect(result.kind).toBe("ok");
    expect(mocks.startRemoteAssistSession).toHaveBeenCalledWith(
      expect.objectContaining({
        getClient: mocks.getClient,
      }),
      expect.objectContaining({
        actor: expect.objectContaining({
          organizationId: "org-1",
          remoteAssistAllowed: true,
          role: "full_admin",
          storeIds: ["store-1"],
          userId: "athena-user-1",
        }),
        clientId: "client-1",
        metadata: { terminalId: "terminal-1" },
        reason: "M Supplies terminal recovery",
        requestedMode: "unattended",
        transportRoomId: "room-1",
      }),
    );
  });

  it("returns the current reusable session for a support client view", async () => {
    const ctx = {};

    const result = await getHandler(remoteAssistPublic.getCurrentSessionByClient)(
      ctx,
      {
        clientId: "client-1",
      },
    );

    expect(result?._id).toBe("active-session");
    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.listReusableSessionsForClient).toHaveBeenCalledWith({
      clientId: "client-1",
      now: expect.any(Number),
    });
  });

  it("returns null before authorizing a missing current-session client", async () => {
    mocks.getClient.mockResolvedValue(null);

    const result = await getHandler(remoteAssistPublic.getCurrentSessionByClient)(
      {},
      {
        clientId: "client-1",
      },
    );

    expect(result).toBeNull();
    expect(mocks.requireOrganizationMemberRoleWithCtx).not.toHaveBeenCalled();
    expect(mocks.listReusableSessionsForClient).not.toHaveBeenCalled();
  });

  it("returns not_found before authorizing a missing session end", async () => {
    mocks.getSession.mockResolvedValue(null);

    const result = await getHandler(remoteAssistPublic.endSupportSession)(
      {},
      {
        reason: "support finished",
        sessionId: "session-1",
      },
    );

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Remote Assist session was not found.",
      },
    });
    expect(mocks.requireOrganizationMemberRoleWithCtx).not.toHaveBeenCalled();
    expect(mocks.endRemoteAssistSession).not.toHaveBeenCalled();
  });

  it("requires full admin membership before ending a support session", async () => {
    const ctx = {};

    await getHandler(remoteAssistPublic.endSupportSession)(ctx, {
      reason: "support finished",
      sessionId: "session-1",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        allowedRoles: ["full_admin"],
        organizationId: "org-1",
        userId: "athena-user-1",
      }),
    );
    expect(mocks.endRemoteAssistSession).toHaveBeenCalledWith(
      expect.objectContaining({
        getSession: mocks.getSession,
      }),
      expect.objectContaining({
        actorUserId: "athena-user-1",
        reason: "support finished",
        sessionId: "session-1",
      }),
    );
  });
});

function buildClient(overrides: Record<string, unknown> = {}) {
  return {
    _creationTime: 1,
    _id: "client-1",
    accessPolicy: "unattended_allowed",
    capabilities: {
      attendedScreenShare: true,
      boundedControl: true,
      sensitiveMasking: true,
      unattendedCoBrowsing: true,
    },
    createdAt: 1,
    displayName: "M Supplies Register",
    enrollmentStatus: "active",
    lastPresenceAt: 1,
    organizationId: "org-1",
    presenceStatus: "online",
    runtimeIdentity: "terminal-1",
    runtimeType: "pos_terminal",
    storeId: "store-1",
    updatedAt: 1,
    ...overrides,
  };
}

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    _creationTime: 1,
    _id: "session-1",
    clientId: "client-1",
    effectiveMode: "unattended",
    expiresAt: 10_000,
    organizationId: "org-1",
    reason: "M Supplies terminal recovery",
    requestedAt: 1,
    requestedByUserId: "athena-user-1",
    requestedMode: "unattended",
    sensitiveModeActive: false,
    status: "active",
    storeId: "store-1",
    transportProvider: "livekit",
    transportRoomId: "room-1",
    ...overrides,
  };
}
