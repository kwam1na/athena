import { v } from "convex/values";
import { internalMutation, mutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createSupportTicketOperationDefinition } from "../operationAdmission/domains/storefrontCustomer_definitions";
import { admitPublicMutation } from "../platform/operationAdmission";
import {
  assertCustomerOwnsRow,
  assertCustomerOwnsStore,
  customerOwnerValidator,
} from "./customerOwnership";

const entity = "supportTicket";

const createArgs = {
  storeId: v.id("store"),
  storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  origin: v.string(),
  checkoutSessionId: v.optional(v.id("checkoutSession")),
};

type CreateSupportTicketArgs = {
  storeId: Id<"store">;
  storeFrontUserId: Id<"storeFrontUser"> | Id<"guest">;
  origin: string;
  checkoutSessionId?: Id<"checkoutSession">;
};

async function createSupportTicketWithCtx(
  ctx: MutationCtx,
  args: CreateSupportTicketArgs,
) {
  const id = await ctx.db.insert(entity, {
    ...args,
  });

  return await ctx.db.get("supportTicket", id);
}

export const create = mutation({
  args: createArgs,
  handler: admitPublicMutation(
    createSupportTicketOperationDefinition,
    async (ctx, args: CreateSupportTicketArgs) =>
      createSupportTicketWithCtx(ctx, args),
  ),
});

/**
 * Internal sibling for storefront-reachable callers. Both caller-supplied ids
 * are checked against the admitted shopper: a ticket may only be raised for
 * that shopper, in that shopper's store, and against a checkout session they
 * own.
 */
export const createInternal = internalMutation({
  args: { ...createArgs, owner: customerOwnerValidator },
  handler: async (ctx, { owner, ...args }) => {
    assertCustomerOwnsStore(owner, args.storeId);
    assertCustomerOwnsRow(owner, {
      storeFrontUserId: args.storeFrontUserId,
      storeId: args.storeId,
    });
    if (args.checkoutSessionId) {
      const session = await ctx.db.get(
        "checkoutSession",
        args.checkoutSessionId,
      );
      assertCustomerOwnsRow(owner, session);
    }
    return await createSupportTicketWithCtx(ctx, args);
  },
});
