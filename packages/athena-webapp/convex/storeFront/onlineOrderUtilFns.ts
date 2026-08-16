import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { commandResultValidator } from "../lib/commandResultValidators";
import { sendOrderUpdateEmailOperationDefinition } from "../operationAdmission/definitions";
import { admitPublicAction } from "../platform/operationAdmission";
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
  // Actions enter the admission rail through the registered internal mutation
  // because they have no `db` of their own; `admitPublicAction` owns that hop,
  // so the definition — not a hand-written operationId string — is what this
  // site names, and the full admission projection reaches the handler.
  handler: admitPublicAction(
    sendOrderUpdateEmailOperationDefinition,
    async (
      ctx,
      args: { newStatus: string; orderId: Id<"onlineOrder"> },
    ) => {
      const isSharedDemo = ctx.operationAdmission.actor.kind === "shared_demo";
      const result = await processOrderUpdateEmail(ctx, args, {
        simulateExternalEffects: isSharedDemo,
      });

      if (!result.success) {
        return userError({
          code:
            result.message === "Order not found" ||
            result.message === "Store not found"
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
  ),
});

export const sendOrderUpdateEmailInternal = internalAction({
  args: orderUpdateEmailArgs,
  handler: async (ctx, args) => {
    return await processOrderUpdateEmail(ctx, args);
  },
});
