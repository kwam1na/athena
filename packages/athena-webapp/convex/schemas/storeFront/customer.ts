import { v } from "convex/values";

export const customerSchema = v.object({
  name: v.string(),
  email: v.string(),
});
