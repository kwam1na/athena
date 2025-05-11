import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import {
  appVerificationCodeSchema,
  athenaUserSchema,
  bestSellerSchema,
  categorySchema,
  colorSchema,
  featuredItemSchema,
  inviteCodeSchema,
  organizationMemberSchema,
  organizationSchema,
  productSchema,
  productSkuSchema,
  promoCodeItemSchema,
  promoCodeSchema,
  redeemedPromoCodeSchema,
  storeAssetSchema,
  storeSchema,
  subcategorySchema,
  complimentaryProductsCollectionSchema,
  complimentaryProductSchema,
} from "./schemas/inventory";
import {
  bagItemSchema,
  bagSchema,
  savedBagSchema,
  savedBagItemSchema,
  customerSchema,
  guestSchema,
  checkoutSessionSchema,
  checkoutSessionItemSchema,
  onlineOrderSchema,
  onlineOrderItemSchema,
  storeFrontVerificationCode,
  storeFrontUserSchema,
  storeFrontSessionSchema,
  supportTicketSchema,
  analyticsSchema,
  reviewSchema,
  rewardPointsSchema,
  rewardTransactionSchema,
  rewardTierSchema,
} from "./schemas/storeFront";

const schema = defineSchema({
  ...authTables,
  analytics: defineTable(analyticsSchema).index("by_storeId", ["storeId"]),
  appVerificationCode: defineTable(appVerificationCodeSchema),
  athenaUser: defineTable(athenaUserSchema),
  bag: defineTable(bagSchema).index("by_storeId", ["storeId"]),
  bagItem: defineTable(bagItemSchema).index("by_bagId", ["bagId"]),
  bestSeller: defineTable(bestSellerSchema),
  category: defineTable(categorySchema),
  checkoutSession: defineTable(checkoutSessionSchema),
  checkoutSessionItem: defineTable(checkoutSessionItemSchema),
  color: defineTable(colorSchema),
  complimentaryProductsCollection: defineTable(
    complimentaryProductsCollectionSchema
  ).index("by_storeId", ["storeId"]),
  complimentaryProduct: defineTable(complimentaryProductSchema)
    .index("by_storeId", ["storeId"])
    .index("by_collectionId", ["collectionId"]),
  customer: defineTable(customerSchema),
  featuredItem: defineTable(featuredItemSchema),
  guest: defineTable(guestSchema).index("by_storeId", ["storeId"]),
  inviteCode: defineTable(inviteCodeSchema),
  onlineOrder: defineTable(onlineOrderSchema).index("by_storeFrontUserId", [
    "storeFrontUserId",
  ]),
  onlineOrderItem: defineTable(onlineOrderItemSchema),
  organization: defineTable(organizationSchema),
  organizationMember: defineTable(organizationMemberSchema),
  product: defineTable(productSchema).index("by_storeId", ["storeId"]),
  productSku: defineTable(productSkuSchema).index("by_productId", [
    "productId",
  ]),
  promoCode: defineTable(promoCodeSchema),
  promoCodeItem: defineTable(promoCodeItemSchema),
  redeemedPromoCode: defineTable(redeemedPromoCodeSchema),
  savedBag: defineTable(savedBagSchema),
  savedBagItem: defineTable(savedBagItemSchema),
  store: defineTable(storeSchema),
  storeAsset: defineTable(storeAssetSchema),
  storeFrontSession: defineTable(storeFrontSessionSchema),
  storeFrontUser: defineTable(storeFrontUserSchema),
  storeFrontVerificationCode: defineTable(storeFrontVerificationCode),
  subcategory: defineTable(subcategorySchema),
  supportTicket: defineTable(supportTicketSchema),
  review: defineTable(reviewSchema).index("by_orderItemId", ["orderItemId"]),
  rewardPoints: defineTable(rewardPointsSchema).index("by_user_store", [
    "storeFrontUserId",
    "storeId",
  ]),
  rewardTransactions: defineTable(rewardTransactionSchema)
    .index("by_user", ["storeFrontUserId"])
    .index("by_order", ["orderId"]),
  rewardTiers: defineTable(rewardTierSchema).index("by_store", ["storeId"]),
});

export default schema;
