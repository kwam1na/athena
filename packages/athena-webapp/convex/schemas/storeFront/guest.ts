import { v } from "convex/values";

export const guestSchema = v.object({
  marker: v.optional(v.string()),
  creationOrigin: v.optional(v.string()),
});
