import { v } from "convex/values";

export const oversizedOperationalWorkRepairSchema = v.object({
  createdAt: v.number(),
  cursor: v.number(),
  error: v.optional(v.string()),
  groupKey: v.string(),
  initiatorIdentifier: v.string(),
  memberIds: v.array(v.id("operationalWorkItem")),
  organizationId: v.id("organization"),
  productSkuId: v.id("productSku"),
  reason: v.string(),
  sourceIdentities: v.array(v.string()),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("paused"),
    v.literal("completed"),
  ),
  storeId: v.id("store"),
  supportTicket: v.string(),
  updatedAt: v.number(),
});

export const oversizedOperationalWorkRepairActionSchema = v.object({
  action: v.union(
    v.literal("created"),
    v.literal("paused"),
    v.literal("amended"),
    v.literal("resumed"),
    v.literal("completed"),
  ),
  addedMemberIds: v.optional(v.array(v.id("operationalWorkItem"))),
  error: v.optional(v.string()),
  groupKey: v.string(),
  initiatorIdentifier: v.string(),
  occurredAt: v.number(),
  organizationId: v.id("organization"),
  reason: v.string(),
  repairId: v.id("oversizedOperationalWorkRepair"),
  storeId: v.id("store"),
  supportTicket: v.string(),
});
