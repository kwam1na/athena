"use node";

import { v } from "convex/values";

import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { commandResultValidator } from "../lib/commandResultValidators";
import { type CommandResult, userError } from "../../shared/commandResult";
// eslint-disable-next-line @convex-dev/import-wrong-runtime -- this public action is explicitly Node-runtime and owns the provider SDK boundary.
import { createRemoteAssistTransportProvider } from "./infrastructure/transport/createRemoteAssistTransportProvider";
import { REMOTE_ASSIST_TRANSPORT_TOKEN_TTL_MS } from "./infrastructure/transport/RemoteAssistTransportProvider";

const transportCredentialValidator = v.object({
  clientId: v.id("remoteAssistClient"),
  expiresAt: v.number(),
  participantIdentity: v.string(),
  participantRole: v.union(v.literal("support"), v.literal("runtime")),
  provider: v.union(
    v.literal("livekit"),
    v.literal("provider_adapter"),
    v.literal("none"),
  ),
  roomId: v.string(),
  sessionId: v.id("remoteAssistSession"),
  token: v.string(),
  topics: v.object({
    controlIntents: v.string(),
    controlResults: v.string(),
    runtimeFrames: v.string(),
    runtimeState: v.string(),
  }),
  url: v.string(),
});

const transportInternal: any = (internal as any).remoteAssist.transportInternal;

export const requestSupportCredential = action({
  args: {
    sessionId: v.id("remoteAssistSession"),
  },
  returns: commandResultValidator(transportCredentialValidator),
  handler: async (ctx, args) => {
    const prepared = await ctx.runMutation(
      transportInternal.prepareSupportCredential,
      args,
    );
    if (prepared.kind !== "ok") {
      return prepared;
    }

    return issueCredential(prepared.data);
  },
});

export const requestRuntimeCredential = action({
  args: {
    sessionId: v.id("remoteAssistSession"),
    storeId: v.id("store"),
    syncSecretHash: v.string(),
    terminalId: v.id("posTerminal"),
  },
  returns: commandResultValidator(transportCredentialValidator),
  handler: async (ctx, args) => {
    const prepared = await ctx.runMutation(
      transportInternal.prepareRuntimeCredential,
      args,
    );
    if (prepared.kind !== "ok") {
      return prepared;
    }

    return issueCredential(prepared.data);
  },
});

type TransportCredentialReturn = {
  clientId: any;
  expiresAt: number;
  participantIdentity: string;
  participantRole: "support" | "runtime";
  provider: "livekit" | "provider_adapter" | "none";
  roomId: string;
  sessionId: any;
  token: string;
  topics: {
    controlIntents: string;
    controlResults: string;
    runtimeFrames: string;
    runtimeState: string;
  };
  url: string;
};

async function issueCredential(
  context: any,
): Promise<CommandResult<TransportCredentialReturn>> {
  try {
    const provider = createRemoteAssistTransportProvider(context.provider);
    const credential = await provider.issueCredential({
      context,
      ttlSeconds: Math.max(
        1,
        Math.floor(
          Math.min(
            REMOTE_ASSIST_TRANSPORT_TOKEN_TTL_MS,
            context.expiresAt - Date.now(),
          ) / 1000,
        ),
      ),
    });
    return {
      kind: "ok" as const,
      data: {
        clientId: credential.clientId,
        expiresAt: credential.expiresAt,
        participantIdentity: credential.participantIdentity,
        participantRole: credential.participantRole,
        provider: credential.provider,
        roomId: credential.roomId,
        sessionId: credential.sessionId,
        token: credential.token,
        topics: credential.topics,
        url: credential.url,
      },
    };
  } catch {
    return userError({
      code: "unavailable",
      message: "Remote Assist live transport is not available right now.",
      retryable: true,
    });
  }
}
