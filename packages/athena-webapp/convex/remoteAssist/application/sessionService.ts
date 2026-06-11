import {
  ok,
  userError,
  type CommandResult,
} from "../../../shared/commandResult";
import {
  evaluateRemoteAssistPolicy,
  type RemoteAssistActor,
} from "./policy";
import {
  REMOTE_ASSIST_SESSION_TTL_MS,
  sanitizeRemoteAssistMetadata,
  summarizeRemoteAssistReason,
  type RemoteAssistClient,
  type RemoteAssistMode,
  type RemoteAssistSession,
  type RemoteAssistSessionEvent,
} from "./types";

export type RemoteAssistRepository = {
  getClient(clientId: string): Promise<RemoteAssistClient | null>;
  getSession(sessionId: string): Promise<RemoteAssistSession | null>;
  insertSession(
    input: Omit<RemoteAssistSession, "_id">,
  ): Promise<RemoteAssistSession>;
  insertEvent(input: RemoteAssistSessionEvent): Promise<void>;
  listReusableSessionsForClient(args: {
    clientId: string;
    now: number;
  }): Promise<RemoteAssistSession[]>;
  patchSession(
    sessionId: string,
    patch: Partial<Omit<RemoteAssistSession, "_id">>,
  ): Promise<void>;
};

export async function startRemoteAssistSession(
  repository: RemoteAssistRepository,
  args: {
    actor: RemoteAssistActor;
    clientId: string;
    metadata?: Record<string, unknown>;
    now: number;
    reason: string;
    requestedMode: RemoteAssistMode;
    transportProvider?: RemoteAssistSession["transportProvider"];
    transportRoomId?: string;
  },
): Promise<CommandResult<RemoteAssistSession>> {
  const client = await repository.getClient(args.clientId);
  if (!client) {
    return userError({
      code: "not_found",
      message: "Remote Assist client was not found.",
    });
  }
  const metadata = sanitizeRemoteAssistMetadata(args.metadata);
  if (metadata.kind !== "ok") {
    return metadata;
  }
  const decision = evaluateRemoteAssistPolicy({
    actor: args.actor,
    client,
    now: args.now,
    requestedMode: args.requestedMode,
  });
  if (decision.kind === "denied") {
    await repository.insertEvent({
      organizationId: client.organizationId,
      storeId: client.storeId,
      clientId: client._id,
      actorUserId: args.actor.userId,
      eventType: "policy_denied",
      occurredAt: args.now,
      summary: decision.reason,
      metadata: metadata.data,
    });
    return userError({
      code: decision.code,
      message: decision.reason,
    });
  }

  const reusableSession = await findReusableRemoteAssistSession(repository, {
    clientId: client._id,
    now: args.now,
    requestedByUserId: args.actor.userId,
  });
  if (reusableSession) {
    return ok(reusableSession);
  }

  const sessionInput = {
    organizationId: client.organizationId,
    storeId: client.storeId,
    clientId: client._id,
    requestedByUserId: args.actor.userId,
    requestedMode: args.requestedMode,
    effectiveMode: decision.effectiveMode,
    reason: summarizeRemoteAssistReason(args.reason),
    status: decision.requiresLocalApproval
      ? "pending_attended_approval"
      : "connecting",
    transportProvider: args.transportProvider ?? "livekit",
    transportRoomId: args.transportRoomId,
    sensitiveModeActive: false,
    requestedAt: args.now,
    expiresAt: args.now + REMOTE_ASSIST_SESSION_TTL_MS,
  } satisfies Omit<RemoteAssistSession, "_id">;
  const session = await repository.insertSession(sessionInput);

  await repository.insertEvent({
    organizationId: client.organizationId,
    storeId: client.storeId,
    clientId: client._id,
    sessionId: session._id,
    actorUserId: args.actor.userId,
    participantRole: "support",
    eventType: "session_requested",
    occurredAt: args.now,
    summary: decision.requiresLocalApproval
      ? "Remote Assist session is waiting for local approval."
      : "Remote Assist session requested.",
    metadata: metadata.data,
  });
  await repository.insertEvent({
    organizationId: client.organizationId,
    storeId: client.storeId,
    clientId: client._id,
    sessionId: session._id,
    actorUserId: args.actor.userId,
    eventType: "policy_allowed",
    occurredAt: args.now,
    summary: "Remote Assist policy allowed the session.",
    metadata: {
      requestedMode: args.requestedMode,
      effectiveMode: decision.effectiveMode,
      requiresLocalApproval: decision.requiresLocalApproval,
    },
  });

  return ok(session);
}

export async function claimRemoteAssistSession(
  repository: RemoteAssistRepository,
  args: {
    clientId: string;
    now: number;
    sessionId: string;
  },
): Promise<CommandResult<RemoteAssistSession>> {
  const session = await repository.getSession(args.sessionId);
  if (!session) {
    return userError({
      code: "not_found",
      message: "Remote Assist session was not found.",
    });
  }
  if (session.clientId !== args.clientId) {
    return userError({
      code: "authorization_failed",
      message: "This runtime cannot claim the Remote Assist session.",
    });
  }
  if (session.expiresAt <= args.now) {
    await repository.patchSession(session._id, {
      status: "expired",
      endedAt: args.now,
      terminationReason: "expired_before_runtime_claim",
    });
    await repository.insertEvent({
      organizationId: session.organizationId,
      storeId: session.storeId,
      clientId: session.clientId,
      sessionId: session._id,
      participantRole: "runtime",
      eventType: "session_expired",
      occurredAt: args.now,
      summary: "Remote Assist session expired before runtime claim.",
    });
    return userError({
      code: "precondition_failed",
      message: "This Remote Assist session has expired.",
    });
  }
  if (session.status === "active") {
    return ok(session);
  }
  if (session.status === "pending_attended_approval") {
    return userError({
      code: "precondition_failed",
      message: "This Remote Assist session is waiting for local approval.",
    });
  }
  if (session.status !== "connecting") {
    return userError({
      code: "precondition_failed",
      message: "This Remote Assist session cannot be claimed.",
    });
  }

  const patch = {
    status: "active" as const,
    startedAt: args.now,
  };
  await repository.patchSession(session._id, patch);
  await repository.insertEvent({
    organizationId: session.organizationId,
    storeId: session.storeId,
    clientId: session.clientId,
    sessionId: session._id,
    participantRole: "runtime",
    eventType: "runtime_claimed",
    occurredAt: args.now,
    summary: "Remote Assist runtime joined the session.",
  });
  return ok({ ...session, ...patch });
}

export async function approveAttendedRemoteAssistSession(
  repository: RemoteAssistRepository,
  args: {
    actorUserId?: string;
    clientId: string;
    now: number;
    sessionId: string;
  },
): Promise<CommandResult<RemoteAssistSession>> {
  const session = await repository.getSession(args.sessionId);
  if (!session) {
    return userError({
      code: "not_found",
      message: "Remote Assist session was not found.",
    });
  }
  if (session.clientId !== args.clientId) {
    return userError({
      code: "authorization_failed",
      message: "This runtime cannot approve the Remote Assist session.",
    });
  }
  if (session.status !== "pending_attended_approval") {
    return userError({
      code: "precondition_failed",
      message: "This Remote Assist session is not waiting for approval.",
    });
  }
  if (session.expiresAt <= args.now) {
    await repository.patchSession(session._id, {
      endedAt: args.now,
      status: "expired",
      terminationReason: "expired_before_local_approval",
    });
    return userError({
      code: "precondition_failed",
      message: "This Remote Assist session has expired.",
    });
  }

  const patch = {
    status: "connecting" as const,
  };
  await repository.patchSession(session._id, patch);
  await repository.insertEvent({
    organizationId: session.organizationId,
    storeId: session.storeId,
    clientId: session.clientId,
    sessionId: session._id,
    actorUserId: args.actorUserId,
    participantRole: "runtime",
    eventType: "session_started",
    occurredAt: args.now,
    summary: "Local approval granted for attended Remote Assist.",
  });
  return ok({ ...session, ...patch });
}

export async function endRemoteAssistSession(
  repository: RemoteAssistRepository,
  args: {
    actorUserId?: string;
    now: number;
    reason: string;
    sessionId: string;
  },
): Promise<CommandResult<RemoteAssistSession>> {
  const session = await repository.getSession(args.sessionId);
  if (!session) {
    return userError({
      code: "not_found",
      message: "Remote Assist session was not found.",
    });
  }
  if (session.status === "ended" || session.status === "expired") {
    return ok(session);
  }
  const expired = session.expiresAt <= args.now;
  const patch = {
    status: expired ? ("expired" as const) : ("ended" as const),
    endedAt: args.now,
    terminationReason: summarizeRemoteAssistReason(args.reason),
  };
  await repository.patchSession(session._id, patch);
  await repository.insertEvent({
    organizationId: session.organizationId,
    storeId: session.storeId,
    clientId: session.clientId,
    sessionId: session._id,
    actorUserId: args.actorUserId,
    eventType: expired ? "session_expired" : "session_ended",
    occurredAt: args.now,
    summary: patch.terminationReason,
  });
  return ok({ ...session, ...patch });
}

async function findReusableRemoteAssistSession(
  repository: RemoteAssistRepository,
  args: {
    clientId: string;
    now: number;
    requestedByUserId: string;
  },
) {
  const sessions = await repository.listReusableSessionsForClient({
    clientId: args.clientId,
    now: args.now,
  });
  return (
    sessions
      .filter((session) => session.requestedByUserId === args.requestedByUserId)
      .filter((session) => session.expiresAt > args.now)
      .find((session) =>
        ["active", "connecting", "pending_attended_approval"].includes(
          session.status,
        ),
      ) ?? null
  );
}
