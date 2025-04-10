import { v } from "convex/values";
import { bagItemSchema } from "./bagItem";

export const bagSchema = v.object({
  storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  storeId: v.id("store"),
  updatedAt: v.number(),
  items: v.array(bagItemSchema),
});
