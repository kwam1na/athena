import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import {
  collectSessionItemsFromPages,
  findSessionItemBySkuInPages,
} from "./sessionCommandRepository";

const ACTIVE_SESSION_CANDIDATE_LIMIT = 100;
const SESSION_ITEMS_PAGE_SIZE = 200;

export interface ExpenseSessionCommandRepository {
  getLatestSessionNumber(storeId: Id<"store">): Promise<string | null>;
  listActiveSessionsForTerminal(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  }): Promise<Doc<"expenseSession">[]>;
  listActiveSessionsForStaffProfile(args: {
    storeId: Id<"store">;
    staffProfileId: Id<"staffProfile">;
  }): Promise<Doc<"expenseSession">[]>;
  getSessionById(
    sessionId: Id<"expenseSession">,
  ): Promise<Doc<"expenseSession"> | null>;
  getRegisterSessionById(
    registerSessionId: Id<"registerSession">,
  ): Promise<Doc<"registerSession"> | null>;
  getOpenRegisterSessionForIdentity(args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    registerNumber?: string;
  }): Promise<Doc<"registerSession"> | null>;
  listSessionItems(
    sessionId: Id<"expenseSession">,
  ): Promise<Doc<"expenseSessionItem">[]>;
  findSessionItemBySku(args: {
    sessionId: Id<"expenseSession">;
    productSkuId: Id<"productSku">;
  }): Promise<Doc<"expenseSessionItem"> | null>;
  getSessionItemById(
    itemId: Id<"expenseSessionItem">,
  ): Promise<Doc<"expenseSessionItem"> | null>;
  createSession(
    input: Omit<Doc<"expenseSession">, "_id" | "_creationTime">,
  ): Promise<Id<"expenseSession">>;
  patchSession(
    sessionId: Id<"expenseSession">,
    patch: Partial<Omit<Doc<"expenseSession">, "_id" | "_creationTime">>,
  ): Promise<void>;
  createSessionItem(
    input: Omit<Doc<"expenseSessionItem">, "_id" | "_creationTime">,
  ): Promise<Id<"expenseSessionItem">>;
  patchSessionItem(
    itemId: Id<"expenseSessionItem">,
    patch: Partial<Omit<Doc<"expenseSessionItem">, "_id" | "_creationTime">>,
  ): Promise<void>;
  deleteSessionItem(itemId: Id<"expenseSessionItem">): Promise<void>;
}

export function createExpenseSessionCommandRepository(
  ctx: MutationCtx,
): ExpenseSessionCommandRepository {
  return {
    async getLatestSessionNumber(storeId) {
      const latestSession = await ctx.db
        .query("expenseSession")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .order("desc")
        .first();

      return latestSession?.sessionNumber ?? null;
    },
    listActiveSessionsForTerminal(args) {
      return ctx.db
        .query("expenseSession")
        .withIndex("by_storeId_status_terminalId", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("status", "active")
            .eq("terminalId", args.terminalId),
        )
        .take(ACTIVE_SESSION_CANDIDATE_LIMIT);
    },
    listActiveSessionsForStaffProfile(args) {
      return ctx.db
        .query("expenseSession")
        .withIndex("by_storeId_status_staffProfileId", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("status", "active")
            .eq("staffProfileId", args.staffProfileId),
        )
        .take(ACTIVE_SESSION_CANDIDATE_LIMIT);
    },
    getSessionById(sessionId) {
      return ctx.db.get("expenseSession", sessionId);
    },
    getRegisterSessionById(registerSessionId) {
      return ctx.db.get("registerSession", registerSessionId);
    },
    getOpenRegisterSessionForIdentity(args) {
      return ctx.runQuery(
        internal.operations.registerSessions.getOpenRegisterSession,
        {
          storeId: args.storeId,
          terminalId: args.terminalId,
          registerNumber: args.registerNumber,
        },
      );
    },
    listSessionItems(sessionId) {
      return collectSessionItemsFromPages((cursor) =>
        ctx.db
          .query("expenseSessionItem")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
          .paginate({
            cursor,
            numItems: SESSION_ITEMS_PAGE_SIZE,
          }),
      );
    },
    findSessionItemBySku(args) {
      return findSessionItemBySkuInPages(
        (cursor) =>
          ctx.db
            .query("expenseSessionItem")
            .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
            .paginate({
              cursor,
              numItems: SESSION_ITEMS_PAGE_SIZE,
            }),
        args.productSkuId,
      );
    },
    getSessionItemById(itemId) {
      return ctx.db.get("expenseSessionItem", itemId);
    },
    createSession(input) {
      return ctx.db.insert("expenseSession", input);
    },
    async patchSession(sessionId, patch) {
      await ctx.db.patch("expenseSession", sessionId, patch);
    },
    createSessionItem(input) {
      return ctx.db.insert("expenseSessionItem", input);
    },
    async patchSessionItem(itemId, patch) {
      await ctx.db.patch("expenseSessionItem", itemId, patch);
    },
    async deleteSessionItem(itemId) {
      await ctx.db.delete("expenseSessionItem", itemId);
    },
  };
}
