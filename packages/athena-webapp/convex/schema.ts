import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import {
  appVerificationCodeSchema,
  athenaUserSchema,
  bannerMessageSchema,
  bestSellerSchema,
  cashierSchema,
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
  posTerminalSchema,
  expenseSessionSchema,
  expenseSessionItemSchema,
  expenseTransactionSchema,
  expenseTransactionItemSchema,
} from "./schemas/pos";
import { posSessionSchema } from "./schemas/pos/posSession";
import {
  mtnCollectionsTokenSchema,
  mtnCollectionTransactionSchema,
} from "./schemas/payments/mtnCollections";

const schema = defineSchema({
  ...authTables,
  analytics: defineTable(analyticsSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeFrontUserId", ["storeFrontUserId"])
    .index("by_storeFrontUserId_storeId", ["storeFrontUserId", "storeId"])
    .index("by_action_productId", ["action", "productId"])
    .index("by_storeId_action", ["storeId", "action"])
    .index("by_storeId_action_productId", ["storeId", "action", "productId"])
    .index("by_promoCodeId", ["promoCodeId"]),
  appVerificationCode: defineTable(appVerificationCodeSchema),
  athenaUser: defineTable(athenaUserSchema),
  bag: defineTable(bagSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeFrontUserId", ["storeFrontUserId"]),
  bagItem: defineTable(bagItemSchema)
    .index("by_bagId", ["bagId"])
    .index("by_productSkuId", ["productSkuId"]),
  bannerMessage: defineTable(bannerMessageSchema).index("by_storeId", [
    "storeId",
  ]),
  bestSeller: defineTable(bestSellerSchema),
  cashier: defineTable(cashierSchema)
    .index("by_storeId", ["storeId"])
    .index("by_store_and_username", ["storeId", "username"]),
  category: defineTable(categorySchema).index("by_storeId_slug", [
    "storeId",
    "slug",
  ]),
  checkoutSession: defineTable(checkoutSessionSchema)
    .index("by_storeFrontUserId", ["storeFrontUserId"])
    .index("by_storeId", ["storeId"]),
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
  guest: defineTable(guestSchema)
    .index("by_storeId", ["storeId"])
    .index("by_marker", ["marker"]),
  inviteCode: defineTable(inviteCodeSchema),
  onlineOrder: defineTable(onlineOrderSchema)
    .index("by_checkoutSessionId", ["checkoutSessionId"])
    .index("by_storeFrontUserId", ["storeFrontUserId"])
    .index("by_storeId", ["storeId"])
    .index("by_storeId_status", ["storeId", "status"])
    .index("by_externalReference", ["externalReference"]),
  onlineOrderItem: defineTable(onlineOrderItemSchema).index("by_orderId", [
    "orderId",
  ]),
  mtnCollectionsToken: defineTable(mtnCollectionsTokenSchema).index("by_storeId", ["storeId"]),
  mtnCollectionTransaction: defineTable(mtnCollectionTransactionSchema)
    .index("by_providerReference", ["providerReference"])
    .index("by_storeId_requestedAt", ["storeId", "requestedAt"]),
  organization: defineTable(organizationSchema),
  organizationMember: defineTable(organizationMemberSchema),
  posCustomer: defineTable(posCustomerSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_and_email", ["storeId", "email"])
    .index("by_storeId_and_phone", ["storeId", "phone"])
    .index("by_linkedStoreFrontUserId", ["linkedStoreFrontUserId"]),
  posTerminal: defineTable(posTerminalSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_and_fingerprintHash", ["storeId", "fingerprintHash"]),
  posTransaction: defineTable(posTransactionSchema)
    .index("by_storeId", ["storeId"])
    .index("by_storeId_status_completedAt", [
      "storeId",
      "status",
      "completedAt",
    ]),
  posTransactionItem: defineTable(posTransactionItemSchema).index(
    "by_transactionId",
    ["transactionId"]
  ),
  posSession: defineTable(posSessionSchema)
    .index("by_storeId", ["storeId"])
    .index("by_status", ["status"])
    .index("by_cashierId", ["cashierId"])
    .index("by_cashierId_and_status", ["cashierId", "status"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"])
    .index("by_storeId_and_status", ["storeId", "status"])
    .index("by_storeId_terminalId", ["storeId", "terminalId"])
    .index("by_storeId_cashierId", ["storeId", "cashierId"])
    .index("by_storeId_status_terminalId", ["storeId", "status", "terminalId"])
    .index("by_storeId_status_cashierId", ["storeId", "status", "cashierId"]),
  posSessionItem: defineTable(posSessionItemSchema).index("by_sessionId", [
    "sessionId",
  ]),
  expenseSession: defineTable(expenseSessionSchema)
    .index("by_storeId", ["storeId"])
    .index("by_status", ["status"])
    .index("by_cashierId", ["cashierId"])
    .index("by_cashierId_and_status", ["cashierId", "status"])
    .index("by_status_and_expiresAt", ["status", "expiresAt"])
    .index("by_storeId_and_status", ["storeId", "status"])
    .index("by_storeId_terminalId", ["storeId", "terminalId"])
    .index("by_storeId_cashierId", ["storeId", "cashierId"])
    .index("by_storeId_status_terminalId", ["storeId", "status", "terminalId"])
    .index("by_storeId_status_cashierId", ["storeId", "status", "cashierId"]),
  expenseSessionItem: defineTable(expenseSessionItemSchema).index(
    "by_sessionId",
    ["sessionId"]
  ),
  expenseTransaction: defineTable(expenseTransactionSchema)
    .index("by_storeId", ["storeId"])
    .index("by_status", ["status"])
    .index("by_sessionId", ["sessionId"]),
  expenseTransactionItem: defineTable(expenseTransactionItemSchema).index(
    "by_transactionId",
    ["transactionId"]
  ),
  product: defineTable(productSchema).index("by_storeId", ["storeId"]),
  productSku: defineTable(productSkuSchema)
    .index("by_productId", ["productId"])
    .index("by_storeId", ["storeId"])
    .index("by_storeId_barcode", ["storeId", "barcode"])
    .index("by_storeId_sku", ["storeId", "sku"]),
  promoCode: defineTable(promoCodeSchema),
  promoCodeItem: defineTable(promoCodeItemSchema)
    .index("by_promoCodeId", ["promoCodeId"])
    .index("by_productSkuId", ["productSkuId"]),
  redeemedPromoCode: defineTable(redeemedPromoCodeSchema).index(
    "by_promoCodeId_storeFrontUserId",
    ["promoCodeId", "storeFrontUserId"]
  ),
  savedBag: defineTable(savedBagSchema).index("by_storeFrontUserId", [
    "storeFrontUserId",
  ]),
  savedBagItem: defineTable(savedBagItemSchema).index("by_savedBagId", [
    "savedBagId",
  ]),
  store: defineTable(storeSchema),
  storeAsset: defineTable(storeAssetSchema),
  storeFrontSession: defineTable(storeFrontSessionSchema),
  storeFrontUser: defineTable(storeFrontUserSchema),
  storeFrontVerificationCode: defineTable(storeFrontVerificationCode),
  subcategory: defineTable(subcategorySchema)
    .index("by_slug", ["slug"])
    .index("by_categoryId_slug", ["categoryId", "slug"]),
  supportTicket: defineTable(supportTicketSchema),
  review: defineTable(reviewSchema)
    .index("by_orderItemId", ["orderItemId"])
    .index("by_createdByStoreFrontUserId", ["createdByStoreFrontUserId"])
    .index("by_createdByStoreFrontUserId_productSkuId", [
      "createdByStoreFrontUserId",
      "productSkuId",
    ])
    .index("by_productSkuId", ["productSkuId"])
    .index("by_storeId", ["storeId"])
    .index("by_productId", ["productId"]),
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
    .index("by_storeFrontUserId_promoCodeId", [
      "storeFrontUserId",
      "promoCodeId",
    ])
    .index("by_promoCodeId", ["promoCodeId"])
    .index("by_storeId", ["storeId"])
    .index("by_storeId_status", ["storeId", "status"]),
});

export default schema;
