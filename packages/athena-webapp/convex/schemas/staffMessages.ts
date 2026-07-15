import { v } from "convex/values";

export const staffMessageSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  authorUserId: v.id("athenaUser"),
  body: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});
