import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type {
  RemoteAssistClient,
  RemoteAssistSession,
} from "../application/types";

type RemoteAssistReadCtx = QueryCtx | MutationCtx;

export function createRemoteAssistReadRepository(ctx: RemoteAssistReadCtx) {
  const repository = {
    async getClient(clientId: string): Promise<RemoteAssistClient | null> {
      return toRemoteAssistClient(
        await ctx.db.get(
          "remoteAssistClient",
          clientId as Id<"remoteAssistClient">,
        ),
      );
    },
    async getClientByRuntime(args: {
      organizationId: Id<"organization">;
      runtimeIdentity: string;
      runtimeType: Doc<"remoteAssistClient">["runtimeType"];
    }): Promise<Doc<"remoteAssistClient"> | null> {
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
    async getCurrentSessionForClient(args: {
      clientId: string;
      now: number;
    }): Promise<RemoteAssistSession | null> {
      const sessions = await repository.listReusableSessionsForClient(args);
      return sessions.sort(compareRemoteAssistSessionForSupportView)[0] ?? null;
    },
    async getSession(sessionId: string): Promise<RemoteAssistSession | null> {
      return toRemoteAssistSession(
        await ctx.db.get(
          "remoteAssistSession",
          sessionId as Id<"remoteAssistSession">,
        ),
      );
    },
    async listReusableSessionsForClient(args: {
      clientId: string;
      now: number;
    }): Promise<RemoteAssistSession[]> {
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
  };
  return repository;
}

function compareRemoteAssistSessionForSupportView(
  left: RemoteAssistSession,
  right: RemoteAssistSession,
) {
  const statusPriority: Record<RemoteAssistSession["status"], number> = {
    active: 0,
    connecting: 1,
    pending_attended_approval: 2,
    denied: 3,
    ended: 4,
    expired: 5,
  };
  const leftPriority = statusPriority[left.status] ?? 99;
  const rightPriority = statusPriority[right.status] ?? 99;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return right.requestedAt - left.requestedAt;
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
