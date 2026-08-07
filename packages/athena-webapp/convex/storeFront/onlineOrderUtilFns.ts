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

export const sendOrderUpdateEmail = action({
  args: orderUpdateEmailArgs,
  returns: commandResultValidator(
    v.object({
      message: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    // Actions enter the admission rail through a mutation because they have no
    // `db` of their own. This applies the same definition the mutation path
    // uses, and records the admitted action for demo visibility.
    const admission = await ctx.runMutation(
      internal.operationAdmission.actionAdmission.admitOperationForAction,
      {
        operationId: "storeFront/onlineOrderUtilFns.sendOrderUpdateEmail",
        operationArgs: { orderId: args.orderId },
      },
    );
    const isSharedDemo = admission.actorKind === "shared_demo";
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
