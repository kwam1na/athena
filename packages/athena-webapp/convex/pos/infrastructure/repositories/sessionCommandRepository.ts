import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";

const ACTIVE_SESSION_CANDIDATE_LIMIT = 100;
const MAX_SESSION_ITEMS = 200;

export interface SessionCommandRepository {
  getLatestSessionNumber(storeId: Id<"store">): Promise<string | null>;
  listActiveSessionsForTerminal(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  }): Promise<Doc<"posSession">[]>;
  listActiveSessionsForCashier(args: {
    storeId: Id<"store">;
    cashierId: Id<"cashier">;
  }): Promise<Doc<"posSession">[]>;
  getSessionById(
    sessionId: Id<"posSession">,
  ): Promise<Doc<"posSession"> | null>;
  listSessionItems(
    sessionId: Id<"posSession">,
  ): Promise<Doc<"posSessionItem">[]>;
  findSessionItemBySku(args: {
    sessionId: Id<"posSession">;
    productSkuId: Id<"productSku">;
  }): Promise<Doc<"posSessionItem"> | null>;
  getSessionItemById(
    itemId: Id<"posSessionItem">,
  ): Promise<Doc<"posSessionItem"> | null>;
  createSession(
    input: Omit<Doc<"posSession">, "_id" | "_creationTime">,
  ): Promise<Id<"posSession">>;
  patchSession(
    sessionId: Id<"posSession">,
    patch: Partial<Omit<Doc<"posSession">, "_id" | "_creationTime">>,
  ): Promise<void>;
  createSessionItem(
    input: Omit<Doc<"posSessionItem">, "_id" | "_creationTime">,
  ): Promise<Id<"posSessionItem">>;
  patchSessionItem(
    itemId: Id<"posSessionItem">,
    patch: Partial<Omit<Doc<"posSessionItem">, "_id" | "_creationTime">>,
  ): Promise<void>;
  deleteSessionItem(itemId: Id<"posSessionItem">): Promise<void>;
}

export function createSessionCommandRepository(
  ctx: MutationCtx,
): SessionCommandRepository {
  return {
    async getLatestSessionNumber(storeId) {
      const latestSession = await ctx.db
        .query("posSession")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .order("desc")
        .first();

      return latestSession?.sessionNumber ?? null;
    },
    listActiveSessionsForTerminal(args) {
      return ctx.db
        .query("posSession")
        .withIndex("by_storeId_status_terminalId", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("status", "active")
            .eq("terminalId", args.terminalId),
        )
        .take(ACTIVE_SESSION_CANDIDATE_LIMIT);
    },
    listActiveSessionsForCashier(args) {
      return ctx.db
        .query("posSession")
        .withIndex("by_storeId_status_cashierId", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("status", "active")
            .eq("cashierId", args.cashierId),
        )
        .take(ACTIVE_SESSION_CANDIDATE_LIMIT);
    },
    getSessionById(sessionId) {
      return ctx.db.get("posSession", sessionId);
    },
    listSessionItems(sessionId) {
      return ctx.db
        .query("posSessionItem")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .take(MAX_SESSION_ITEMS);
    },
    async findSessionItemBySku(args) {
      const items = await ctx.db
        .query("posSessionItem")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
        .take(MAX_SESSION_ITEMS);

      return (
        items.find((item) => item.productSkuId === args.productSkuId) ?? null
      );
    },
    getSessionItemById(itemId) {
      return ctx.db.get("posSessionItem", itemId);
    },
    createSession(input) {
      return ctx.db.insert("posSession", input);
    },
    async patchSession(sessionId, patch) {
      await ctx.db.patch("posSession", sessionId, patch);
    },
    createSessionItem(input) {
      return ctx.db.insert("posSessionItem", input);
    },
    async patchSessionItem(itemId, patch) {
      await ctx.db.patch("posSessionItem", itemId, patch);
    },
    async deleteSessionItem(itemId) {
      await ctx.db.delete("posSessionItem", itemId);
    },
  };
}
