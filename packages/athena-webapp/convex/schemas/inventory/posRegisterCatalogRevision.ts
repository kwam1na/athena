import { v } from "convex/values";

export const posRegisterCatalogRevisionSchema = v.object({
  storeId: v.id("store"),
  revision: v.number(),
  updatedAt: v.number(),
});
