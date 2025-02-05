import { v } from "convex/values";

export const redeemedPromoCodeSchema = v.object({
  promoCodeId: v.id("promoCode"),
  storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
});
