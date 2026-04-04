import { action, internalAction } from "../_generated/server";
import {
  formatOrderItems,
  orderUpdateEmailArgs,
  processOrderUpdateEmail,
} from "./helpers/orderUpdateEmails";

export { formatOrderItems };

export const sendOrderUpdateEmail = action({
  args: orderUpdateEmailArgs,
  handler: async (ctx, args) => {
    return await processOrderUpdateEmail(ctx, args);
  },
});

export const sendOrderUpdateEmailInternal = internalAction({
  args: orderUpdateEmailArgs,
  handler: async (ctx, args) => {
    return await processOrderUpdateEmail(ctx, args);
  },
});
