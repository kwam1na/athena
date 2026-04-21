import { v } from "convex/values";

export const inventoryMovementSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  movementType: v.string(),
  sourceType: v.string(),
  sourceId: v.string(),
  quantityDelta: v.number(),
  createdAt: v.number(),
  productId: v.optional(v.id("product")),
  productSkuId: v.optional(v.id("productSku")),
  actorUserId: v.optional(v.id("athenaUser")),
  actorStaffProfileId: v.optional(v.id("staffProfile")),
  customerProfileId: v.optional(v.id("customerProfile")),
  workItemId: v.optional(v.id("operationalWorkItem")),
  registerSessionId: v.optional(v.id("registerSession")),
  onlineOrderId: v.optional(v.id("onlineOrder")),
  posTransactionId: v.optional(v.id("posTransaction")),
  reasonCode: v.optional(v.string()),
  notes: v.optional(v.string()),
});
