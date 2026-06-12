import { describe, expect, it, vi } from "vitest";

import {
  approveAttendedRemoteAssistSession,
  claimRemoteAssistSession,
  disconnectRemoteAssistRuntimeSession,
  endRemoteAssistSession,
  startRemoteAssistSession,
  type RemoteAssistRepository,
} from "./sessionService";
import type { RemoteAssistClient, RemoteAssistSession } from "./types";

const now = 2_000_000;

describe("remote assist session service", () => {
  it("starts an unattended session and records allow/request events", async () => {
    const repository = buildRepository();

    const result = await startRemoteAssistSession(repository, {
      actor: {
        organizationId: "org-1",
        remoteAssistAllowed: true,
        role: "support",
        storeIds: ["store-1"],
        userId: "user-1",
      },
      clientId: "client-1",
      metadata: {
        terminalId: "terminal-1",
      },
      now,
      reason: "M Supplies terminal recovery",
      requestedMode: "unattended",
      transportRoomId: "room-1",
    });

    expect(result).toMatchObject({
      data: {
        effectiveMode: "unattended",
        status: "connecting",
        transportProvider: "livekit",
      },
      kind: "ok",
    });
    expect(repository.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "session_requested",
      }),
    );
    expect(repository.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "policy_allowed",
      }),
    );
  });

  it("reuses an active session for the client", async () => {
    const repository = buildRepository({
      sessions: [
        buildSession({
          _id: "session-existing",
          status: "active",
        }),
      ],
    });

    const result = await startRemoteAssistSession(repository, {
      actor: {
        organizationId: "org-1",
        remoteAssistAllowed: true,
        role: "support",
        storeIds: ["store-1"],
        userId: "user-1",
      },
      clientId: "client-1",
      now,
      reason: "M Supplies terminal recovery",
      requestedMode: "unattended",
    });

    expect(result).toMatchObject({
      data: {
        _id: "session-existing",
      },
      kind: "ok",
    });
    expect(repository.insertSession).not.toHaveBeenCalled();
    expect(repository.insertEvent).not.toHaveBeenCalled();
  });

  it("reuses an active client session requested by another support user", async () => {
    const repository = buildRepository({
      sessions: [
        buildSession({
          _id: "session-existing",
          requestedByUserId: "user-1",
          status: "active",
        }),
      ],
    });

    const result = await startRemoteAssistSession(repository, {
      actor: {
        organizationId: "org-1",
        remoteAssistAllowed: true,
        role: "support",
        storeIds: ["store-1"],
        userId: "user-2",
      },
      clientId: "client-1",
      now,
      reason: "Drawer repair support",
      requestedMode: "unattended",
    });

    expect(result).toMatchObject({
      data: {
        _id: "session-existing",
      },
      kind: "ok",
    });
    expect(repository.insertSession).not.toHaveBeenCalled();
    expect(repository.insertEvent).not.toHaveBeenCalled();
  });

  it("records denial events without creating a session", async () => {
    const repository = buildRepository({
      client: buildClient({
        presenceStatus: "offline",
      }),
    });

    const result = await startRemoteAssistSession(repository, {
      actor: {
        organizationId: "org-1",
        remoteAssistAllowed: true,
        role: "support",
        storeIds: ["store-1"],
        userId: "user-1",
      },
      clientId: "client-1",
      now,
      reason: "M Supplies terminal recovery",
      requestedMode: "unattended",
    });

    expect(result).toMatchObject({
      error: {
        code: "unavailable",
      },
      kind: "user_error",
    });
    expect(repository.insertSession).not.toHaveBeenCalled();
    expect(repository.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "policy_denied",
      }),
    );
  });

  it("claims and ends sessions idempotently", async () => {
    const repository = buildRepository({
      session: buildSession({
        status: "connecting",
      }),
    });

    await expect(
      claimRemoteAssistSession(repository, {
        clientId: "client-1",
        now: now + 100,
        sessionId: "session-1",
      }),
    ).resolves.toMatchObject({
      data: {
        startedAt: now + 100,
        status: "active",
      },
      kind: "ok",
    });

    expect(repository.patchSession).toHaveBeenCalledWith("session-1", {
      startedAt: now + 100,
      status: "active",
    });

    await expect(
      endRemoteAssistSession(repository, {
        actorUserId: "user-1",
        now: now + 200,
        reason: "support finished",
        sessionId: "session-1",
      }),
    ).resolves.toMatchObject({
      data: {
        status: "ended",
        terminationReason: "support finished",
      },
      kind: "ok",
    });
  });

  it("records runtime-attributed disconnect events", async () => {
    const repository = buildRepository({
      session: buildSession({
        status: "active",
      }),
    });

    const result = await disconnectRemoteAssistRuntimeSession(repository, {
      clientId: "client-1",
      now,
      sessionId: "session-1",
    });

    expect(result).toMatchObject({
      data: {
        status: "ended",
        terminationReason: "Terminal disconnected Remote Assist.",
      },
      kind: "ok",
    });
    expect(repository.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "runtime_disconnected",
        participantRole: "runtime",
        summary: "Terminal disconnected Remote Assist.",
      }),
    );
  });

  it("does not let another runtime disconnect a Remote Assist session", async () => {
    const repository = buildRepository({
      session: buildSession({
        clientId: "client-1",
        status: "active",
      }),
    });

    const result = await disconnectRemoteAssistRuntimeSession(repository, {
      clientId: "client-2",
      now,
      sessionId: "session-1",
    });

    expect(result).toMatchObject({
      error: {
        code: "authorization_failed",
      },
      kind: "user_error",
    });
    expect(repository.patchSession).not.toHaveBeenCalled();
    expect(repository.insertEvent).not.toHaveBeenCalled();
  });

  it("requires local approval before an attended session can be claimed", async () => {
    const repository = buildRepository({
      session: buildSession({
        status: "pending_attended_approval",
      }),
    });

    await expect(
      claimRemoteAssistSession(repository, {
        clientId: "client-1",
        now,
        sessionId: "session-1",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "precondition_failed",
      },
      kind: "user_error",
    });
    expect(repository.patchSession).not.toHaveBeenCalled();
  });

  it("rejects runtime claim from the wrong client", async () => {
    const repository = buildRepository();

    await expect(
      claimRemoteAssistSession(repository, {
        clientId: "client-2",
        now,
        sessionId: "session-1",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "authorization_failed",
      },
      kind: "user_error",
    });
    expect(repository.patchSession).not.toHaveBeenCalled();
  });

  it("rejects active-session idempotent claims from the wrong client", async () => {
    const repository = buildRepository({
      session: buildSession({
        status: "active",
      }),
    });

    await expect(
      claimRemoteAssistSession(repository, {
        clientId: "client-2",
        now,
        sessionId: "session-1",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "authorization_failed",
      },
      kind: "user_error",
    });
  });

  it("expires active sessions before returning idempotent runtime claims", async () => {
    const repository = buildRepository({
      session: buildSession({
        expiresAt: now - 1,
        status: "active",
      }),
    });

    await expect(
      claimRemoteAssistSession(repository, {
        clientId: "client-1",
        now,
        sessionId: "session-1",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "precondition_failed",
      },
      kind: "user_error",
    });
    expect(repository.patchSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        status: "expired",
      }),
    );
    expect(repository.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "session_expired",
      }),
    );
  });

  it("expires stale sessions before runtime claim", async () => {
    const repository = buildRepository({
      session: buildSession({
        expiresAt: now - 1,
        status: "connecting",
      }),
    });

    await expect(
      claimRemoteAssistSession(repository, {
        clientId: "client-1",
        now,
        sessionId: "session-1",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "precondition_failed",
      },
      kind: "user_error",
    });
    expect(repository.patchSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        status: "expired",
      }),
    );
  });

  it("approves pending attended sessions and records audit events", async () => {
    const repository = buildRepository({
      session: buildSession({
        effectiveMode: "attended",
        requestedMode: "attended",
        status: "pending_attended_approval",
      }),
    });

    await expect(
      approveAttendedRemoteAssistSession(repository, {
        actorUserId: "cashier-1",
        clientId: "client-1",
        now: now + 100,
        sessionId: "session-1",
      }),
    ).resolves.toMatchObject({
      data: {
        status: "connecting",
      },
      kind: "ok",
    });
    expect(repository.patchSession).toHaveBeenCalledWith("session-1", {
      status: "connecting",
    });
    expect(repository.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "cashier-1",
        eventType: "session_started",
        summary: "Local approval granted for attended Remote Assist.",
      }),
    );
  });

  it("rejects attended approval from the wrong runtime client", async () => {
    const repository = buildRepository({
      session: buildSession({
        status: "pending_attended_approval",
      }),
    });

    await expect(
      approveAttendedRemoteAssistSession(repository, {
        clientId: "client-2",
        now,
        sessionId: "session-1",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "authorization_failed",
      },
      kind: "user_error",
    });
    expect(repository.patchSession).not.toHaveBeenCalled();
  });

  it("requires pending attended approval before approving a session", async () => {
    const repository = buildRepository({
      session: buildSession({
        status: "connecting",
      }),
    });

    await expect(
      approveAttendedRemoteAssistSession(repository, {
        clientId: "client-1",
        now,
        sessionId: "session-1",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "precondition_failed",
      },
      kind: "user_error",
    });
    expect(repository.patchSession).not.toHaveBeenCalled();
  });

  it("returns not found when approving a missing attended session", async () => {
    const repository = buildRepository({
      session: null,
    });

    await expect(
      approveAttendedRemoteAssistSession(repository, {
        clientId: "client-1",
        now,
        sessionId: "session-missing",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "not_found",
      },
      kind: "user_error",
    });
    expect(repository.patchSession).not.toHaveBeenCalled();
  });

  it("expires stale attended sessions before approval", async () => {
    const repository = buildRepository({
      session: buildSession({
        expiresAt: now - 1,
        status: "pending_attended_approval",
      }),
    });

    await expect(
      approveAttendedRemoteAssistSession(repository, {
        clientId: "client-1",
        now,
        sessionId: "session-1",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "precondition_failed",
      },
      kind: "user_error",
    });
    expect(repository.patchSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        status: "expired",
      }),
    );
    expect(repository.insertEvent).not.toHaveBeenCalled();
  });
});

function buildRepository(overrides: {
  client?: RemoteAssistClient | null;
  session?: RemoteAssistSession | null;
  sessions?: RemoteAssistSession[];
} = {}): RemoteAssistRepository {
  let session: RemoteAssistSession | null = Object.prototype.hasOwnProperty.call(overrides, "session")
    ? (overrides.session ?? null)
    : buildSession();
  return {
    getClient: vi.fn(async () => overrides.client ?? buildClient()),
    getCurrentSessionForClient: vi.fn(async () => overrides.sessions?.[0] ?? session),
    getSession: vi.fn(async () => session),
    insertEvent: vi.fn(async () => {}),
    insertSession: vi.fn(async (input) => {
      const insertedSession = {
        _creationTime: 1,
        _id: "session-1",
        ...input,
      };
      session = insertedSession;
      return insertedSession;
    }),
    listReusableSessionsForClient: vi.fn(async () => overrides.sessions ?? []),
    patchSession: vi.fn(async (_sessionId, patch) => {
      if (session) {
        session = {
          ...session,
          ...patch,
        };
      }
    }),
  };
}

function buildClient(overrides: Partial<RemoteAssistClient> = {}): RemoteAssistClient {
  return {
    _id: "client-1",
    accessPolicy: "unattended_allowed",
    capabilities: {
      attendedScreenShare: true,
      boundedControl: true,
      sensitiveMasking: true,
      unattendedCoBrowsing: true,
    },
    createdAt: now - 1_000,
    displayName: "M Supplies Register",
    enrollmentStatus: "active",
    lastPresenceAt: now - 1_000,
    organizationId: "org-1",
    presenceStatus: "online",
    runtimeIdentity: "terminal-1",
    runtimeType: "pos_terminal",
    storeId: "store-1",
    updatedAt: now - 1_000,
    ...overrides,
  };
}

function buildSession(overrides: Partial<RemoteAssistSession> = {}): RemoteAssistSession {
  return {
    clientId: "client-1",
    effectiveMode: "unattended",
    expiresAt: now + 1_000,
    organizationId: "org-1",
    reason: "M Supplies terminal recovery",
    requestedAt: now,
    requestedByUserId: "user-1",
    requestedMode: "unattended",
    sensitiveModeActive: false,
    status: "connecting",
    storeId: "store-1",
    transportProvider: "livekit",
    transportRoomId: "room-1",
    ...overrides,
    _creationTime: overrides._creationTime ?? 1,
    _id: overrides._id ?? "session-1",
  };
}
