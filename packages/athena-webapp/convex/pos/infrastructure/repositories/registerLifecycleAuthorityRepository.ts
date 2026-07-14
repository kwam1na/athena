import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

export type RegisterLifecycleAuthorityRepository = {
  getRegisterMappingAuthority(input: {
    localRegisterSessionId: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  }): Promise<Doc<"posRegisterMappingAuthority"> | null>;
  getRegisterSession(
    cloudRegisterSessionId: string,
  ): Promise<Doc<"registerSession"> | null>;
  listRegisterSessionMappings(input: {
    localRegisterSessionId: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  }): Promise<Doc<"posLocalSyncMapping">[]>;
  listSaleUsableRegisterSessions(input: {
    status: "active" | "open";
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  }): Promise<Doc<"registerSession">[]>;
};

export function createRegisterLifecycleAuthorityRepository(
  ctx: Pick<QueryCtx, "db">,
): RegisterLifecycleAuthorityRepository {
  return {
    async getRegisterMappingAuthority(input) {
      return ctx.db
        .query("posRegisterMappingAuthority")
        .withIndex("by_store_terminal_localRegisterSession", (q) =>
          q
            .eq("storeId", input.storeId)
            .eq("terminalId", input.terminalId)
            .eq("localRegisterSessionId", input.localRegisterSessionId),
        )
        .unique();
    },

    async listRegisterSessionMappings(input) {
      return ctx.db
        .query("posLocalSyncMapping")
        .withIndex("by_store_terminal_localKindId", (q) =>
          q
            .eq("storeId", input.storeId)
            .eq("terminalId", input.terminalId)
            .eq("localIdKind", "registerSession")
            .eq("localId", input.localRegisterSessionId),
        )
        .take(2);
    },

    async getRegisterSession(cloudRegisterSessionId) {
      const registerSessionId = ctx.db.normalizeId(
        "registerSession",
        cloudRegisterSessionId,
      );
      if (!registerSessionId) return null;

      return ctx.db.get("registerSession", registerSessionId);
    },

    async listSaleUsableRegisterSessions(input) {
      return ctx.db
        .query("registerSession")
        .withIndex("by_storeId_status_terminalId", (q) =>
          q
            .eq("storeId", input.storeId)
            .eq("status", input.status)
            .eq("terminalId", input.terminalId),
        )
        .order("desc")
        .take(1);
    },
  };
}
