import { v } from "convex/values";

export const reviewSchema = v.object({
  orderId: v.id("onlineOrder"),
  orderNumber: v.string(),
  orderItemId: v.id("onlineOrderItem"),
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  storeId: v.id("store"),
  title: v.string(),
  content: v.optional(v.string()),
  createdByStoreFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  ratings: v.array(
    v.object({
      key: v.string(),
      label: v.string(),
      value: v.number(),
      optional: v.optional(v.boolean()),
    })
  ),
  isApproved: v.optional(v.boolean()),
  approvedAt: v.optional(v.number()),
  approvedByAthenaUserId: v.optional(v.id("athenaUser")),
  isPublished: v.optional(v.boolean()),
  publishedAt: v.optional(v.number()),
  publishedByAthenaUserId: v.optional(v.id("athenaUser")),
  updatedAt: v.number(),
  helpfulCount: v.optional(v.number()),
  helpfulUserIds: v.optional(
    v.array(v.union(v.id("storeFrontUser"), v.id("guest")))
  ),
});
