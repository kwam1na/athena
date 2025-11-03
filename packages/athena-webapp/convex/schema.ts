import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import {
  appVerificationCodeSchema,
  athenaUserSchema,
  bannerMessageSchema,
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
  offerSchema,
} from "./schemas/storeFront";
import {
  posTransactionSchema,
  posTransactionItemSchema,
  posSessionItemSchema,
  posCustomerSchema,
} from "./schemas/pos";
import { posSessionSchema } from "./schemas/pos/posSession";

const schema = defineSchema({
  ...authTables,
  analytics: defineTable(analyticsSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeFrontUserId", ["storeFrontUserId"])
    .index("by_storeId_action", ["storeId", "action"])
    .index("by_storeId_action_productId", ["storeId", "action", "productId"]),
  appVerificationCode: defineTable(appVerificationCodeSchema),
  athenaUser: defineTable(athenaUserSchema),
  bag: defineTable(bagSchema).index("by_storeId", ["storeId"]),
  bagItem: defineTable(bagItemSchema)
    .index("by_bagId", ["bagId"])
    .index("by_productSkuId", ["productSkuId"]),
  bannerMessage: defineTable(bannerMessageSchema).index("by_storeId", [
    "storeId",
  ]),
  bestSeller: defineTable(bestSellerSchema),
  category: defineTable(categorySchema),
  checkoutSession: defineTable(checkoutSessionSchema),
  checkoutSessionItem: defineTable(checkoutSessionItemSchema).index(
    "by_sessionId",
    ["sesionId"]
  ),
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
  posCustomer: defineTable(posCustomerSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_and_name", ["storeId", "name"])
    .index("by_storeId_and_email", ["storeId", "email"])
    .index("by_storeId_and_phone", ["storeId", "phone"])
    .index("by_linkedStoreFrontUserId", ["linkedStoreFrontUserId"])
    .index("by_linkedGuestId", ["linkedGuestId"])
    .index("by_loyaltyTier", ["loyaltyTier"])
    .index("by_createdBy", ["createdBy"]),
  posTransaction: defineTable(posTransactionSchema)
    .index("by_storeId", ["storeId"])
    .index("by_transactionNumber", ["transactionNumber"])
    .index("by_status", ["status"])
    .index("by_cashierId", ["cashierId"])
    .index("by_customerId", ["customerId"])
    .index("by_sessionId", ["sessionId"]),
  posTransactionItem: defineTable(posTransactionItemSchema)
    .index("by_transactionId", ["transactionId"])
    .index("by_productId", ["productId"])
    .index("by_productSkuId", ["productSkuId"]),
  posSession: defineTable(posSessionSchema)
    .index("by_storeId", ["storeId"])
    .index("by_status", ["status"])
    .index("by_cashierId", ["cashierId"])
    .index("by_storeId_and_status", ["storeId", "status"])
    .index("by_sessionNumber", ["sessionNumber"]),
  posSessionItem: defineTable(posSessionItemSchema)
    .index("by_sessionId", ["sessionId"])
    .index("by_productSkuId", ["productSkuId"])
    .index("by_storeId", ["storeId"]),
  product: defineTable(productSchema).index("by_storeId", ["storeId"]),
  productSku: defineTable(productSkuSchema)
    .index("by_productId", ["productId"])
    .index("by_storeId", ["storeId"])
    .index("by_storeId_barcode", ["storeId", "barcode"]),
  promoCode: defineTable(promoCodeSchema),
  promoCodeItem: defineTable(promoCodeItemSchema).index("by_promoCodeId", [
    "promoCodeId",
  ]),
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
  offer: defineTable(offerSchema)
    .index("by_email", ["email"])
    .index("by_storeFrontUserId", ["storeFrontUserId"])
    .index("by_promoCodeId", ["promoCodeId"])
    .index("by_storeId", ["storeId"])
    .index("by_ipAddress", ["ipAddress"]),
});

export default schema;
