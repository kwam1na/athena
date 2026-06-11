import { v } from "convex/values";

import { mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { commandResultValidator } from "../lib/commandResultValidators";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import {
  remoteAssistAccessPolicyValidator,
  remoteAssistCapabilitiesValidator,
  remoteAssistEnrollmentStatusValidator,
  remoteAssistRuntimeTypeValidator,
} from "../schemas/remoteAssist";
import {
  remoteAssistModeValidator,
  remoteAssistSessionStatusValidator,
  remoteAssistTransportProviderValidator,
} from "../schemas/remoteAssist/remoteAssistSession";
import {
  endRemoteAssistSession,
  startRemoteAssistSession,
} from "./application/sessionService";
import { createRemoteAssistRepository } from "./infrastructure/remoteAssistRepository";

const remoteAssistClientReturnValidator = v.object({
  _id: v.id("remoteAssistClient"),
  _creationTime: v.number(),
  organizationId: v.id("organization"),
  storeId: v.optional(v.id("store")),
  runtimeType: remoteAssistRuntimeTypeValidator,
  runtimeIdentity: v.string(),
  displayName: v.string(),
  enrollmentStatus: remoteAssistEnrollmentStatusValidator,
  accessPolicy: remoteAssistAccessPolicyValidator,
  capabilities: remoteAssistCapabilitiesValidator,
  adapterRef: v.optional(
    v.object({
      kind: v.string(),
      id: v.string(),
      label: v.optional(v.string()),
    }),
  ),
  presenceStatus: v.union(
    v.literal("online"),
    v.literal("stale"),
    v.literal("offline"),
    v.literal("unknown"),
  ),
  lastPresenceAt: v.optional(v.number()),
  browserSummary: v.optional(v.record(v.string(), v.string())),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const remoteAssistSessionReturnValidator = v.object({
  _id: v.id("remoteAssistSession"),
  _creationTime: v.number(),
  organizationId: v.id("organization"),
  storeId: v.optional(v.id("store")),
  clientId: v.id("remoteAssistClient"),
  requestedByUserId: v.id("athenaUser"),
  requestedMode: remoteAssistModeValidator,
  effectiveMode: remoteAssistModeValidator,
  reason: v.string(),
  status: remoteAssistSessionStatusValidator,
  transportProvider: remoteAssistTransportProviderValidator,
  transportRoomId: v.optional(v.string()),
  sensitiveModeActive: v.boolean(),
  requestedAt: v.number(),
  startedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
  expiresAt: v.number(),
  terminationReason: v.optional(v.string()),
});

export const getClientByRuntime = query({
  args: {
    organizationId: v.id("organization"),
    runtimeIdentity: v.string(),
    runtimeType: remoteAssistRuntimeTypeValidator,
  },
  returns: v.union(remoteAssistClientReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You do not have access to view Remote Assist clients.",
      organizationId: args.organizationId,
      userId: athenaUser._id,
    });

    const repository = createRemoteAssistRepository(ctx);
    return repository.getClientByRuntime(args);
  },
});

export const startSession = mutation({
  args: {
    clientId: v.id("remoteAssistClient"),
    metadata: v.optional(v.record(v.string(), v.any())),
    reason: v.string(),
    requestedMode: remoteAssistModeValidator,
    transportProvider: v.optional(remoteAssistTransportProviderValidator),
    transportRoomId: v.optional(v.string()),
  },
  returns: commandResultValidator(remoteAssistSessionReturnValidator),
  handler: async (ctx, args) => {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    const repository = createRemoteAssistRepository(ctx);
    const client = await repository.getClient(args.clientId);
    if (!client) {
      return {
        kind: "user_error",
        error: {
          code: "not_found",
          message: "Remote Assist client was not found.",
        },
      } as const;
    }
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "You do not have access to start Remote Assist sessions.",
      organizationId: client.organizationId as Id<"organization">,
      userId: athenaUser._id,
    });

    return startRemoteAssistSession(repository, {
      actor: {
        organizationId: client.organizationId,
        remoteAssistAllowed: true,
        role: "full_admin",
        storeIds: client.storeId ? [client.storeId] : undefined,
        userId: athenaUser._id,
      },
      clientId: args.clientId,
      metadata: args.metadata,
      now: Date.now(),
      reason: args.reason,
      requestedMode: args.requestedMode,
      transportProvider: args.transportProvider,
      transportRoomId: args.transportRoomId,
    });
  },
});

export const endSupportSession = mutation({
  args: {
    reason: v.string(),
    sessionId: v.id("remoteAssistSession"),
  },
  returns: commandResultValidator(remoteAssistSessionReturnValidator),
  handler: async (ctx, args) => {
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    const repository = createRemoteAssistRepository(ctx);
    const session = await repository.getSession(args.sessionId);
    if (!session) {
      return {
        kind: "user_error",
        error: {
          code: "not_found",
          message: "Remote Assist session was not found.",
        },
      } as const;
    }
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "You do not have access to end this Remote Assist session.",
      organizationId: session.organizationId as Id<"organization">,
      userId: athenaUser._id,
    });
    return endRemoteAssistSession(repository, {
      actorUserId: athenaUser._id,
      now: Date.now(),
      reason: args.reason,
      sessionId: args.sessionId,
    });
  },
});
