import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { hashPosTerminalSyncSecret } from "../pos/application/sync/terminalSyncSecret";
import {
  buildRemoteAssistTransportCredentialContext,
  buildRemoteAssistTransportRoomId,
  REMOTE_ASSIST_TRANSPORT_TOKEN_TTL_MS,
} from "./infrastructure/transport/RemoteAssistTransportProvider";
import { createRemoteAssistRepository } from "./infrastructure/remoteAssistRepository";

const credentialContextValidator = v.object({
  clientId: v.id("remoteAssistClient"),
  expiresAt: v.number(),
  organizationId: v.id("organization"),
  participantIdentity: v.string(),
  participantRole: v.union(v.literal("support"), v.literal("runtime")),
  provider: v.literal("livekit"),
  roomId: v.string(),
  sessionId: v.id("remoteAssistSession"),
  storeId: v.optional(v.id("store")),
  topics: v.object({
    controlIntents: v.string(),
    controlResults: v.string(),
    runtimeFrames: v.string(),
    runtimeState: v.string(),
  }),
});

export const prepareSupportCredential = internalMutation({
  args: {
    sessionId: v.id("remoteAssistSession"),
  },
  returns: v.union(
    v.object({
      kind: v.literal("ok"),
      data: credentialContextValidator,
    }),
    v.object({
      kind: v.literal("user_error"),
      error: v.object({
        code: v.union(
          v.literal("authorization_failed"),
          v.literal("not_found"),
          v.literal("precondition_failed"),
          v.literal("unavailable"),
        ),
        message: v.string(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    const repository = createRemoteAssistRepository(ctx);
    const session = await repository.getSession(args.sessionId);
    if (!session) {
      return remoteAssistTransportUserError({
        code: "not_found",
        message: "Remote Assist session was not found.",
      });
    }
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "You do not have access to join this Remote Assist session.",
      organizationId: session.organizationId as Id<"organization">,
      userId: athenaUser._id,
    });
    if (!["active", "connecting", "pending_attended_approval"].includes(session.status)) {
      return remoteAssistTransportUserError({
        code: "precondition_failed",
        message: "This Remote Assist session is not available for live transport.",
      });
    }

    const now = Date.now();
    if (session.expiresAt <= now) {
      return remoteAssistTransportUserError({
        code: "precondition_failed",
        message: "This Remote Assist session has expired.",
      });
    }

    const roomId = session.transportRoomId ?? buildRemoteAssistTransportRoomId(session._id);
    if (!session.transportRoomId) {
      await repository.patchSession(session._id, { transportRoomId: roomId });
    }
    const context = buildRemoteAssistTransportCredentialContext({
      clientId: session.clientId,
      expiresAt: Math.min(session.expiresAt, now + REMOTE_ASSIST_TRANSPORT_TOKEN_TTL_MS),
      organizationId: session.organizationId,
      participantRole: "support",
      requestedByUserId: athenaUser._id,
      roomId,
      sessionId: session._id,
      storeId: session.storeId,
    });

    await repository.insertEvent({
      organizationId: session.organizationId,
      storeId: session.storeId,
      clientId: session.clientId,
      sessionId: session._id,
      actorUserId: athenaUser._id,
      participantRole: "support",
      eventType: "transport_token_issued",
      occurredAt: now,
      summary: "Remote Assist support transport credential issued.",
      metadata: {
        expiresAt: context.expiresAt,
        provider: context.provider,
        roomId: context.roomId,
        role: context.participantRole,
      },
    });

    return remoteAssistTransportOk(toCredentialContextReturn(context));
  },
});

export const prepareRuntimeCredential = internalMutation({
  args: {
    sessionId: v.id("remoteAssistSession"),
    storeId: v.id("store"),
    syncSecretHash: v.string(),
    terminalId: v.id("posTerminal"),
  },
  returns: v.union(
    v.object({
      kind: v.literal("ok"),
      data: credentialContextValidator,
    }),
    v.object({
      kind: v.literal("user_error"),
      error: v.object({
        code: v.union(
          v.literal("authorization_failed"),
          v.literal("not_found"),
          v.literal("precondition_failed"),
          v.literal("unavailable"),
        ),
        message: v.string(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    const terminal = await ctx.db.get("posTerminal", args.terminalId);
    const submittedSyncSecretHash = await hashPosTerminalSyncSecret(
      args.syncSecretHash,
    );
    if (
      !terminal ||
      terminal.storeId !== args.storeId ||
      terminal.status !== "active" ||
      !terminal.syncSecretHash ||
      terminal.syncSecretHash !== submittedSyncSecretHash
    ) {
      return remoteAssistTransportUserError({
        code: "authorization_failed",
        message: "This terminal cannot join the Remote Assist session.",
      });
    }

    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      return remoteAssistTransportUserError({
        code: "not_found",
        message: "Store was not found.",
      });
    }

    const repository = createRemoteAssistRepository(ctx);
    const client = await repository.getClientByRuntime({
      organizationId: store.organizationId,
      runtimeIdentity: args.terminalId,
      runtimeType: "pos_terminal",
    });
    const session = await repository.getSession(args.sessionId);
    if (!client || !session || session.clientId !== client._id) {
      return remoteAssistTransportUserError({
        code: "authorization_failed",
        message: "This terminal cannot join the Remote Assist session.",
      });
    }
    if (!["active", "connecting"].includes(session.status)) {
      return remoteAssistTransportUserError({
        code: "precondition_failed",
        message: "This Remote Assist session is not ready for runtime transport.",
      });
    }

    const now = Date.now();
    if (session.expiresAt <= now) {
      return remoteAssistTransportUserError({
        code: "precondition_failed",
        message: "This Remote Assist session has expired.",
      });
    }

    const roomId = session.transportRoomId ?? buildRemoteAssistTransportRoomId(session._id);
    if (!session.transportRoomId) {
      await repository.patchSession(session._id, { transportRoomId: roomId });
    }
    const context = buildRemoteAssistTransportCredentialContext({
      clientId: session.clientId,
      expiresAt: Math.min(session.expiresAt, now + REMOTE_ASSIST_TRANSPORT_TOKEN_TTL_MS),
      organizationId: session.organizationId,
      participantRole: "runtime",
      roomId,
      sessionId: session._id,
      storeId: session.storeId,
    });

    await repository.insertEvent({
      organizationId: session.organizationId,
      storeId: session.storeId,
      clientId: session.clientId,
      sessionId: session._id,
      participantRole: "runtime",
      eventType: "transport_token_issued",
      occurredAt: now,
      summary: "Remote Assist runtime transport credential issued.",
      metadata: {
        expiresAt: context.expiresAt,
        provider: context.provider,
        roomId: context.roomId,
        role: context.participantRole,
      },
    });

    return remoteAssistTransportOk(toCredentialContextReturn(context));
  },
});

function toCredentialContextReturn(
  context: ReturnType<typeof buildRemoteAssistTransportCredentialContext>,
) {
  return {
    ...context,
    clientId: context.clientId as Id<"remoteAssistClient">,
    organizationId: context.organizationId as Id<"organization">,
    provider: "livekit" as const,
    sessionId: context.sessionId as Id<"remoteAssistSession">,
    storeId: context.storeId as Id<"store"> | undefined,
  };
}

function remoteAssistTransportUserError(error: {
  code: "authorization_failed" | "not_found" | "precondition_failed" | "unavailable";
  message: string;
}) {
  return {
    error,
    kind: "user_error" as const,
  };
}

function remoteAssistTransportOk(data: ReturnType<typeof toCredentialContextReturn>) {
  return {
    data,
    kind: "ok" as const,
  };
}
