import { v } from "convex/values";

export const cashierSchema = v.object({
  firstName: v.string(),
  lastName: v.string(),
  username: v.string(),
  pin: v.string(), // Hashed PIN (bcrypt) - hashed client-side before storage
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  active: v.boolean(),
});
