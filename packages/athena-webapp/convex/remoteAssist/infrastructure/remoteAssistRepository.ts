import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { RemoteAssistRepository } from "../application/sessionService";
import { createRemoteAssistReadRepository } from "./remoteAssistReadRepository";

export function createRemoteAssistRepository(
  ctx: MutationCtx,
): RemoteAssistRepository & ReturnType<typeof createRemoteAssistReadRepository> & {
  upsertClient(
    input: Omit<Doc<"remoteAssistClient">, "_id" | "_creationTime">,
  ): Promise<Doc<"remoteAssistClient">>;
} {
  const readRepository = createRemoteAssistReadRepository(ctx);
  return {
    ...readRepository,
    async insertEvent(input) {
      const mutationCtx = ctx as MutationCtx;
      await mutationCtx.db.insert("remoteAssistSessionEvent", {
        ...input,
        clientId: input.clientId as Id<"remoteAssistClient">,
        sessionId: input.sessionId as Id<"remoteAssistSession"> | undefined,
        actorUserId: input.actorUserId as Id<"athenaUser"> | undefined,
        organizationId: input.organizationId as Id<"organization">,
        storeId: input.storeId as Id<"store"> | undefined,
      });
    },
    async insertSession(input) {
      const mutationCtx = ctx as MutationCtx;
      const sessionId = await mutationCtx.db.insert("remoteAssistSession", {
        ...input,
        clientId: input.clientId as Id<"remoteAssistClient">,
        requestedByUserId: input.requestedByUserId as Id<"athenaUser">,
        organizationId: input.organizationId as Id<"organization">,
        storeId: input.storeId as Id<"store"> | undefined,
      });
      const remoteAssistSession = await readRepository.getSession(sessionId);
      if (!remoteAssistSession) {
        throw new Error("Remote Assist session could not be loaded after insert.");
      }
      return remoteAssistSession;
    },
    async patchSession(sessionId, patch) {
      const mutationCtx = ctx as MutationCtx;
      const normalizedPatch = { ...patch } as Partial<Doc<"remoteAssistSession">>;
      if ("clientId" in patch) {
        normalizedPatch.clientId =
          patch.clientId as Id<"remoteAssistClient"> | undefined;
      }
      if ("requestedByUserId" in patch) {
        normalizedPatch.requestedByUserId =
          patch.requestedByUserId as Id<"athenaUser"> | undefined;
      }
      if ("organizationId" in patch) {
        normalizedPatch.organizationId =
          patch.organizationId as Id<"organization"> | undefined;
      }
      if ("storeId" in patch) {
        normalizedPatch.storeId = patch.storeId as Id<"store"> | undefined;
      }
      await mutationCtx.db.patch(
        "remoteAssistSession",
        sessionId as Id<"remoteAssistSession">,
        normalizedPatch,
      );
    },
    async upsertClient(input) {
      const mutationCtx = ctx as MutationCtx;
      const existing = await readRepository.getClientByRuntime({
        organizationId: input.organizationId,
        runtimeIdentity: input.runtimeIdentity,
        runtimeType: input.runtimeType,
      });
      if (existing) {
        await mutationCtx.db.patch("remoteAssistClient", existing._id, {
          adapterRef: input.adapterRef,
          browserSummary: input.browserSummary,
          capabilities: input.capabilities,
          displayName: input.displayName,
          lastPresenceAt: input.lastPresenceAt,
          presenceStatus: input.presenceStatus,
          storeId: input.storeId,
          updatedAt: input.updatedAt,
        });
        const updated = await mutationCtx.db.get(
          "remoteAssistClient",
          existing._id,
        );
        if (!updated) {
          throw new Error("Remote Assist client could not be loaded after update.");
        }
        return updated;
      }
      const clientId = await mutationCtx.db.insert("remoteAssistClient", input);
      const client = await mutationCtx.db.get("remoteAssistClient", clientId);
      if (!client) {
        throw new Error("Remote Assist client could not be loaded after insert.");
      }
      return client;
    },
  };
}
