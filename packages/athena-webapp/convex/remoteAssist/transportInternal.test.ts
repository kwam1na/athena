import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRemoteAssistRepository: vi.fn(),
  getClientByRuntime: vi.fn(),
  getSession: vi.fn(),
  hashPosTerminalSyncSecret: vi.fn(async (secret: string) => `hashed:${secret}`),
  insertEvent: vi.fn(),
  patchSession: vi.fn(),
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));

vi.mock("../lib/athenaUserAuth", () => ({
  requireAuthenticatedAthenaUserWithCtx:
    mocks.requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx:
    mocks.requireOrganizationMemberRoleWithCtx,
}));

vi.mock("../pos/application/sync/terminalSyncSecret", () => ({
  hashPosTerminalSyncSecret: mocks.hashPosTerminalSyncSecret,
}));

vi.mock("./infrastructure/remoteAssistRepository", () => ({
  createRemoteAssistRepository: mocks.createRemoteAssistRepository,
}));

import {
  prepareRuntimeCredential,
  prepareSupportCredential,
} from "./transportInternal";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("remote assist transport credential preparation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.resetAllMocks();
    mocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
      _id: "support-user-1",
    });
    mocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue(undefined);
    mocks.getSession.mockResolvedValue(buildSession());
    mocks.getClientByRuntime.mockResolvedValue(buildClient());
    mocks.createRemoteAssistRepository.mockReturnValue({
      getClientByRuntime: mocks.getClientByRuntime,
      getSession: mocks.getSession,
      insertEvent: mocks.insertEvent,
      patchSession: mocks.patchSession,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns not_found before authorizing a missing support session", async () => {
    mocks.getSession.mockResolvedValue(null);

    const result = await getHandler(prepareSupportCredential)({}, {
      sessionId: "session-1",
    });

    expect(result).toMatchObject({
      error: { code: "not_found" },
      kind: "user_error",
    });
    expect(mocks.requireOrganizationMemberRoleWithCtx).not.toHaveBeenCalled();
  });

  it("requires full admin support membership and issues an audited support context", async () => {
    const result = await getHandler(prepareSupportCredential)({}, {
      sessionId: "session-1",
    });

    expect(mocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        allowedRoles: ["full_admin"],
        organizationId: "org-1",
        userId: "support-user-1",
      }),
    );
    expect(mocks.patchSession).toHaveBeenCalledWith("session-1", {
      transportRoomId: "athena-remote-assist-session-1",
    });
    expect(mocks.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "support-user-1",
        eventType: "transport_token_issued",
        metadata: expect.objectContaining({
          expiresAt: 1_300_000,
          provider: "livekit",
          roomId: "athena-remote-assist-session-1",
          role: "support",
        }),
        participantRole: "support",
      }),
    );
    expect(JSON.stringify(mocks.insertEvent.mock.calls[0][0].metadata)).not.toMatch(
      /jwt|secret|sync/i,
    );
    expect(result).toMatchObject({
      data: {
        expiresAt: 1_300_000,
        participantIdentity: "remote-assist:session-1:support:support-user-1",
        participantRole: "support",
        roomId: "athena-remote-assist-session-1",
      },
      kind: "ok",
    });
  });

  it.each(["ended", "expired"])(
    "rejects support credentials for %s sessions",
    async (status) => {
      mocks.getSession.mockResolvedValue(buildSession({ status }));

      const result = await getHandler(prepareSupportCredential)({}, {
        sessionId: "session-1",
      });

      expect(result).toMatchObject({
        error: { code: "precondition_failed" },
        kind: "user_error",
      });
      expect(mocks.insertEvent).not.toHaveBeenCalled();
    },
  );

  it("rejects support credentials for expired sessions", async () => {
    mocks.getSession.mockResolvedValue(buildSession({ expiresAt: 999_999 }));

    const result = await getHandler(prepareSupportCredential)({}, {
      sessionId: "session-1",
    });

    expect(result).toMatchObject({
      error: { code: "precondition_failed" },
      kind: "user_error",
    });
    expect(mocks.insertEvent).not.toHaveBeenCalled();
  });

  it("reuses an existing support transport room without patching the session", async () => {
    mocks.getSession.mockResolvedValue(
      buildSession({ transportRoomId: "existing-room" }),
    );

    const result = await getHandler(prepareSupportCredential)({}, {
      sessionId: "session-1",
    });

    expect(mocks.patchSession).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      data: {
        roomId: "existing-room",
      },
      kind: "ok",
    });
  });

  it("rejects runtime credentials when terminal sync proof does not match", async () => {
    const ctx = buildRuntimeCtx({
      terminal: buildTerminal({ syncSecretHash: "hashed:other-secret" }),
    });

    const result = await getHandler(prepareRuntimeCredential)(ctx, {
      sessionId: "session-1",
      storeId: "store-1",
      syncSecretHash: "sync-secret",
      terminalId: "terminal-1",
    });

    expect(result).toMatchObject({
      error: { code: "authorization_failed" },
      kind: "user_error",
    });
    expect(mocks.getClientByRuntime).not.toHaveBeenCalled();
  });

  it("issues runtime credentials only for the matching runtime client and session", async () => {
    const ctx = buildRuntimeCtx();

    const result = await getHandler(prepareRuntimeCredential)(ctx, {
      sessionId: "session-1",
      storeId: "store-1",
      syncSecretHash: "sync-secret",
      terminalId: "terminal-1",
    });

    expect(mocks.getClientByRuntime).toHaveBeenCalledWith({
      organizationId: "org-1",
      runtimeIdentity: "terminal-1",
      runtimeType: "pos_terminal",
    });
    expect(mocks.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "transport_token_issued",
        metadata: expect.objectContaining({
          provider: "livekit",
          role: "runtime",
        }),
        participantRole: "runtime",
      }),
    );
    expect(result).toMatchObject({
      data: {
        participantIdentity: "remote-assist:session-1:runtime:client-1",
        participantRole: "runtime",
        roomId: "athena-remote-assist-session-1",
      },
      kind: "ok",
    });
  });

  it("returns not_found when the runtime store lookup fails", async () => {
    const ctx = buildRuntimeCtx({ store: null });

    const result = await getHandler(prepareRuntimeCredential)(ctx, {
      sessionId: "session-1",
      storeId: "store-1",
      syncSecretHash: "sync-secret",
      terminalId: "terminal-1",
    });

    expect(result).toMatchObject({
      error: { code: "not_found" },
      kind: "user_error",
    });
    expect(mocks.getClientByRuntime).not.toHaveBeenCalled();
  });

  it("rejects runtime credentials when client or session ownership does not match", async () => {
    const ctx = buildRuntimeCtx();
    mocks.getClientByRuntime.mockResolvedValue(buildClient({ _id: "other-client" }));

    const result = await getHandler(prepareRuntimeCredential)(ctx, {
      sessionId: "session-1",
      storeId: "store-1",
      syncSecretHash: "sync-secret",
      terminalId: "terminal-1",
    });

    expect(result).toMatchObject({
      error: { code: "authorization_failed" },
      kind: "user_error",
    });
    expect(mocks.insertEvent).not.toHaveBeenCalled();
  });

  it.each(["pending_attended_approval", "ended", "expired"])(
    "rejects runtime credentials for %s sessions",
    async (status) => {
      const ctx = buildRuntimeCtx();
      mocks.getSession.mockResolvedValue(buildSession({ status }));

      const result = await getHandler(prepareRuntimeCredential)(ctx, {
        sessionId: "session-1",
        storeId: "store-1",
        syncSecretHash: "sync-secret",
        terminalId: "terminal-1",
      });

      expect(result).toMatchObject({
        error: { code: "precondition_failed" },
        kind: "user_error",
      });
      expect(mocks.insertEvent).not.toHaveBeenCalled();
    },
  );

  it("rejects runtime credentials for expired sessions", async () => {
    const ctx = buildRuntimeCtx();
    mocks.getSession.mockResolvedValue(buildSession({ expiresAt: 999_999 }));

    const result = await getHandler(prepareRuntimeCredential)(ctx, {
      sessionId: "session-1",
      storeId: "store-1",
      syncSecretHash: "sync-secret",
      terminalId: "terminal-1",
    });

    expect(result).toMatchObject({
      error: { code: "precondition_failed" },
      kind: "user_error",
    });
    expect(mocks.insertEvent).not.toHaveBeenCalled();
  });

  it("reuses an existing runtime transport room without patching the session", async () => {
    const ctx = buildRuntimeCtx();
    mocks.getSession.mockResolvedValue(
      buildSession({ transportRoomId: "existing-room" }),
    );

    const result = await getHandler(prepareRuntimeCredential)(ctx, {
      sessionId: "session-1",
      storeId: "store-1",
      syncSecretHash: "sync-secret",
      terminalId: "terminal-1",
    });

    expect(mocks.patchSession).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      data: {
        roomId: "existing-room",
      },
      kind: "ok",
    });
  });
});

function buildRuntimeCtx(
  args: {
    store?: Record<string, unknown> | null;
    terminal?: Record<string, unknown>;
  } = {},
) {
  return {
    db: {
      get: vi.fn(async (table: string) => {
        if (table === "posTerminal") {
          return args.terminal ?? buildTerminal();
        }
        if (table === "store") {
          return args.store === undefined ? {
            _id: "store-1",
            organizationId: "org-1",
          } : args.store;
        }
        return null;
      }),
    },
  };
}

function buildClient(args: Record<string, unknown> = {}) {
  return {
    _id: "client-1",
    organizationId: "org-1",
    runtimeIdentity: "terminal-1",
    runtimeType: "pos_terminal",
    ...args,
  };
}

function buildSession(args: Record<string, unknown> = {}) {
  return {
    _id: "session-1",
    clientId: "client-1",
    expiresAt: 1_600_000,
    organizationId: "org-1",
    status: "active",
    storeId: "store-1",
    transportRoomId: undefined,
    ...args,
  };
}

function buildTerminal(args: Record<string, unknown> = {}) {
  return {
    _id: "terminal-1",
    status: "active",
    storeId: "store-1",
    syncSecretHash: "hashed:sync-secret",
    ...args,
  };
}
