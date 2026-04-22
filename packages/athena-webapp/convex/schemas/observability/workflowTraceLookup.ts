import { v } from "convex/values";

export const workflowTraceLookupSchema = v.object({
  storeId: v.id("store"),
  workflowType: v.string(),
  lookupType: v.string(),
  lookupValue: v.string(),
  traceId: v.string(),
});
