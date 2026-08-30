import { v } from "convex/values";

/** Operations-owned reporting inputs: no titles, customer/staff or source payloads. */
export const operationalInventoryContributionSchema = v.object({
  storeId: v.id("store"),
  workItemId: v.id("operationalWorkItem"),
  sourceIdentity: v.string(),
  productSkuId: v.union(v.id("productSku"), v.null()),
  approvalPriority: v.boolean(),
  inProgress: v.boolean(),
  priority: v.union(v.literal("high"), v.literal("normal"), v.literal("other")),
  actionableAt: v.number(),
  createdAt: v.number(),
  complete: v.boolean(),
});

export const operationalInventoryRepairSchema = v.object({
  storeId: v.id("store"),
  repairId: v.id("oversizedOperationalWorkRepair"),
  groupKey: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("paused"),
    v.literal("completed"),
  ),
  sourceCreatedAt: v.number(),
  memberCount: v.number(),
  complete: v.boolean(),
});

export const operationalInventoryRepairMemberSchema = v.object({
  storeId: v.id("store"),
  repairId: v.id("oversizedOperationalWorkRepair"),
  sourceIdentity: v.string(),
});

/** Only a completed source-domain rebuild can make absence mean zero. */
export const operationalInventoryCoverageSchema = v.object({
  storeId: v.id("store"),
  complete: v.boolean(),
  updatedAt: v.number(),
  rebuildGeneration: v.optional(v.number()),
  rebuild: v.optional(
    v.object({
      phase: v.union(
        v.literal("work"),
        v.literal("repair"),
        v.literal("prune_work"),
        v.literal("prune_repair"),
      ),
      lane: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  ),
});
