import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { commandResultValidator } from "../lib/commandResultValidators";
import {
  formatOrderItems,
  orderUpdateEmailArgs,
  processOrderUpdateEmail,
} from "./helpers/orderUpdateEmails";
import { ok, userError } from "../../shared/commandResult";

export { formatOrderItems };

export const sendOrderUpdateEmail = action({
  args: orderUpdateEmailArgs,
  returns: commandResultValidator(
    v.object({
      message: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const result = await processOrderUpdateEmail(ctx, args);

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
