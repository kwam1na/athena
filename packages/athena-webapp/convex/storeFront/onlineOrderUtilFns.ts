import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { commandResultValidator } from "../lib/commandResultValidators";
import {
  formatOrderItems,
  orderUpdateEmailArgs,
  processOrderUpdateEmail,
} from "./helpers/orderUpdateEmails";
import { ok, userError } from "../../shared/commandResult";

export { formatOrderItems };

const enforceSharedDemoActionCapabilityRef =
  (internal as any).sharedDemo.actor.enforceSharedDemoActionCapability;

export const sendOrderUpdateEmail = action({
  args: orderUpdateEmailArgs,
  returns: commandResultValidator(
    v.object({
      message: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const isSharedDemo = await ctx.runQuery(
      enforceSharedDemoActionCapabilityRef,
      { capability: "customer.messaging.send" },
    );
    const result = await processOrderUpdateEmail(ctx, args, {
      simulateExternalEffects: isSharedDemo,
    });

    if (!result.success) {
      return userError({
        code:
          result.message === "Order not found" || result.message === "Store not found"
            ? "not_found"
            : result.message === "No email sent for this status"
              ? "precondition_failed"
              : "unavailable",
        message: result.message,
      });
    }

    return ok({
      message: result.message,
    });
  },
});

export const sendOrderUpdateEmailInternal = internalAction({
  args: orderUpdateEmailArgs,
  handler: async (ctx, args) => {
    return await processOrderUpdateEmail(ctx, args);
  },
});
