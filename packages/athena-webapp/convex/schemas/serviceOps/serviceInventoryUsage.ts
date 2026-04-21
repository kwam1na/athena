import { v } from "convex/values";

export const serviceInventoryUsageSchema = v.object({
  serviceCaseId: v.id("serviceCase"),
  productSkuId: v.id("productSku"),
  inventoryMovementId: v.optional(v.id("inventoryMovement")),
  usageType: v.union(
    v.literal("planned"),
    v.literal("consumed"),
    v.literal("returned")
  ),
  quantity: v.number(),
  notes: v.optional(v.string()),
  createdAt: v.number(),
  recordedByUserId: v.optional(v.id("athenaUser")),
  recordedByStaffProfileId: v.optional(v.id("staffProfile")),
});
