import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { internal } from "../../../_generated/api";

const ACTIVE_SESSION_CANDIDATE_LIMIT = 100;
const SESSION_ITEMS_PAGE_SIZE = 200;

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
  getRegisterSessionById(
    registerSessionId: Id<"registerSession">,
  ): Promise<Doc<"registerSession"> | null>;
  getOpenRegisterSessionForIdentity(args: {
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
    registerNumber?: string;
  }): Promise<Doc<"registerSession"> | null>;
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
          .query("posSessionItem")
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
            .query("posSessionItem")
            .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
            .paginate({
              cursor,
              numItems: SESSION_ITEMS_PAGE_SIZE,
            }),
        args.productSkuId,
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

type PaginatedPage<TItem> = {
  page: TItem[];
  isDone: boolean;
  continueCursor: string;
};

type PaginatedLoader<TItem> = (
  cursor: string | null,
) => Promise<PaginatedPage<TItem>>;

export async function collectSessionItemsFromPages<TItem>(
  loadPage: PaginatedLoader<TItem>,
): Promise<TItem[]> {
  const items: TItem[] = [];
  let cursor: string | null = null;

  while (true) {
    const page = await loadPage(cursor);
    items.push(...page.page);

    if (page.isDone) {
      return items;
    }

    cursor = page.continueCursor;
  }
}

export async function findSessionItemBySkuInPages<
  TItem extends Pick<Doc<"posSessionItem">, "productSkuId">,
>(
  loadPage: PaginatedLoader<TItem>,
  productSkuId: Id<"productSku">,
): Promise<TItem | null> {
  let cursor: string | null = null;

  while (true) {
    const page = await loadPage(cursor);
    const matchingItem =
      page.page.find((item) => item.productSkuId === productSkuId) ?? null;

    if (matchingItem) {
      return matchingItem;
    }

    if (page.isDone) {
      return null;
    }

    cursor = page.continueCursor;
  }
}
