import { v } from "convex/values";

export const organizationSchema = v.object({
  name: v.string(),
  slug: v.string(),
  createdByUserId: v.id("athenaUser"),
});
