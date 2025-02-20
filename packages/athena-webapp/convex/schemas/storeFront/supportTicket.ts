import { v } from "convex/values";

export const supportTicketSchema = v.object({
  storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  storeId: v.id("store"),
  origin: v.string(),
  checkoutSessionId: v.optional(v.id("checkoutSession")),
});
