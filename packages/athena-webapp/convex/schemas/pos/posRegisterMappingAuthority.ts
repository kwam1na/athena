import { v } from "convex/values";

export const posRegisterMappingAuthorityStateValidator = v.union(
  v.literal("mapped"),
  v.literal("ambiguous"),
  v.literal("tombstoned"),
);

export const posRegisterMappingAuthoritySchema = v.object({
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  localRegisterSessionId: v.string(),
  revision: v.number(),
  state: posRegisterMappingAuthorityStateValidator,
  cloudRegisterSessionId: v.optional(v.string()),
  mappingId: v.optional(v.id("posLocalSyncMapping")),
  sourceEventType: v.optional(v.string()),
  updatedAt: v.number(),
});
