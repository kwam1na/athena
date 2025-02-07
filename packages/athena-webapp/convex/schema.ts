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
} from "./schemas/storeFront";

const schema = defineSchema({
  ...authTables,
  appVerificationCode: defineTable(appVerificationCodeSchema),
  athenaUser: defineTable(athenaUserSchema),
  bag: defineTable(bagSchema),
  bagItem: defineTable(bagItemSchema),
  bestSeller: defineTable(bestSellerSchema),
  category: defineTable(categorySchema),
  checkoutSession: defineTable(checkoutSessionSchema),
  checkoutSessionItem: defineTable(checkoutSessionItemSchema),
  color: defineTable(colorSchema),
  customer: defineTable(customerSchema),
  featuredItem: defineTable(featuredItemSchema),
  guest: defineTable(guestSchema),
  inviteCode: defineTable(inviteCodeSchema),
  onlineOrder: defineTable(onlineOrderSchema),
  onlineOrderItem: defineTable(onlineOrderItemSchema),
  organization: defineTable(organizationSchema),
  organizationMember: defineTable(organizationMemberSchema),
  product: defineTable(productSchema),
  productSku: defineTable(productSkuSchema),
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
});

export default schema;
