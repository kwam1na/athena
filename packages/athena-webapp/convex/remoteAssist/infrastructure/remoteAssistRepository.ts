import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type {
  RemoteAssistClient,
  RemoteAssistSession,
} from "../application/types";
import type { RemoteAssistRepository } from "../application/sessionService";

type RemoteAssistCtx = QueryCtx | MutationCtx;

export function createRemoteAssistRepository(
  ctx: RemoteAssistCtx,
): RemoteAssistRepository & {
  getClientByRuntime(args: {
    organizationId: Id<"organization">;
    runtimeIdentity: string;
    runtimeType: Doc<"remoteAssistClient">["runtimeType"];
  }): Promise<Doc<"remoteAssistClient"> | null>;
  listReusableSessionsForClient(args: {
    clientId: string;
    now: number;
  }): Promise<RemoteAssistSession[]>;
  upsertClient(
    input: Omit<Doc<"remoteAssistClient">, "_id" | "_creationTime">,
  ): Promise<Doc<"remoteAssistClient">>;
} {
  return {
    async getClient(clientId) {
      return toRemoteAssistClient(
        await ctx.db.get(
          "remoteAssistClient",
          clientId as Id<"remoteAssistClient">,
        ),
      );
    },
    async getClientByRuntime(args) {
      const matches = await ctx.db
        .query("remoteAssistClient")
        .withIndex("by_organization_runtime", (q) =>
          q
            .eq("organizationId", args.organizationId)
            .eq("runtimeType", args.runtimeType)
            .eq("runtimeIdentity", args.runtimeIdentity),
        )
        .take(2);
      if (matches.length > 1) {
        throw new Error(
          "Duplicate Remote Assist clients exist for this runtime identity.",
        );
      }
      return matches[0] ?? null;
    },
    async getSession(sessionId) {
      return toRemoteAssistSession(
        await ctx.db.get(
          "remoteAssistSession",
          sessionId as Id<"remoteAssistSession">,
        ),
      );
    },
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
      const session = await mutationCtx.db.get("remoteAssistSession", sessionId);
      if (!session) {
        throw new Error("Remote Assist session could not be loaded after insert.");
      }
      const remoteAssistSession = toRemoteAssistSession(session);
      if (!remoteAssistSession) {
        throw new Error("Remote Assist session could not be mapped after insert.");
      }
      return remoteAssistSession;
    },
    async listReusableSessionsForClient(args) {
      const statuses: Array<Doc<"remoteAssistSession">["status"]> = [
        "active",
        "connecting",
        "pending_attended_approval",
      ];
      const sessions = (
        await Promise.all(
          statuses.map((status) =>
            ctx.db
              .query("remoteAssistSession")
              .withIndex("by_client_status_expiresAt", (q) =>
                q
                  .eq("clientId", args.clientId as Id<"remoteAssistClient">)
                  .eq("status", status)
                  .gt("expiresAt", args.now),
              )
              .take(10),
          ),
        )
      ).flat();
      return sessions
        .map(toRemoteAssistSession)
        .filter((session): session is RemoteAssistSession => Boolean(session));
    },
    async patchSession(sessionId, patch) {
      const mutationCtx = ctx as MutationCtx;
      await mutationCtx.db.patch(
        "remoteAssistSession",
        sessionId as Id<"remoteAssistSession">,
        {
          ...patch,
          clientId: patch.clientId as Id<"remoteAssistClient"> | undefined,
          requestedByUserId:
            patch.requestedByUserId as Id<"athenaUser"> | undefined,
          organizationId: patch.organizationId as Id<"organization"> | undefined,
          storeId: patch.storeId as Id<"store"> | undefined,
        },
      );
    },
    async upsertClient(input) {
      const mutationCtx = ctx as MutationCtx;
      const existing = await this.getClientByRuntime({
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

function toRemoteAssistClient(
  doc: Doc<"remoteAssistClient"> | null,
): RemoteAssistClient | null {
  return doc
    ? {
        ...doc,
        _id: doc._id,
        organizationId: doc.organizationId,
        storeId: doc.storeId,
      }
    : null;
}

function toRemoteAssistSession(
  doc: Doc<"remoteAssistSession"> | null,
): RemoteAssistSession | null {
  return doc
    ? {
        ...doc,
        _id: doc._id,
        clientId: doc.clientId,
        organizationId: doc.organizationId,
        requestedByUserId: doc.requestedByUserId,
        storeId: doc.storeId,
      }
    : null;
}
