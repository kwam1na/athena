import type { WithoutSystemFields } from "convex/server";

import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../_generated/server";

type AcknowledgementValue = Omit<
  WithoutSystemFields<Doc<"posRegisterAuthorityReplicationStatus">>,
  "terminalId"
>;

export type RegisterLifecycleAuthorityStatusRepository = {
  getLatest(
    terminalId: Id<"posTerminal">,
  ): Promise<Doc<"posRegisterAuthorityReplicationStatus"> | null>;
  upsertLatest(
    terminalId: Id<"posTerminal">,
    value: AcknowledgementValue,
  ): Promise<Id<"posRegisterAuthorityReplicationStatus">>;
};

export type RegisterLifecycleAuthorityStatusReadRepository = Pick<
  RegisterLifecycleAuthorityStatusRepository,
  "getLatest"
>;

export function createRegisterLifecycleAuthorityStatusReadRepository(
  ctx: Pick<QueryCtx, "db">,
): RegisterLifecycleAuthorityStatusReadRepository {
  return {
    getLatest(terminalId) {
      return ctx.db
        .query("posRegisterAuthorityReplicationStatus")
        .withIndex("by_terminalId", (q) => q.eq("terminalId", terminalId))
        .unique();
    },
  };
}

export function createRegisterLifecycleAuthorityStatusRepository(
  ctx: Pick<MutationCtx, "db">,
): RegisterLifecycleAuthorityStatusRepository {
  return {
    ...createRegisterLifecycleAuthorityStatusReadRepository(ctx),
    async upsertLatest(terminalId, value) {
      const existing = await ctx.db
        .query("posRegisterAuthorityReplicationStatus")
        .withIndex("by_terminalId", (q) => q.eq("terminalId", terminalId))
        .unique();
      if (existing) {
        await ctx.db.replace(
          "posRegisterAuthorityReplicationStatus",
          existing._id,
          { terminalId, ...value },
        );
        return existing._id;
      }
      return ctx.db.insert("posRegisterAuthorityReplicationStatus", {
        terminalId,
        ...value,
      });
    },
  };
}
