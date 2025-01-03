import { v } from "convex/values";

export const storeFrontSessionSchema = v.object({
  userId: v.id("storeFrontUser"),
  refreshToken: v.string(),
});
