import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import {
  bestSellerSchema,
  categorySchema,
  colorSchema,
  featuredItemSchema,
  organizationSchema,
  productSchema,
  productSkuSchema,
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
} from "./schemas/storeFront";

const schema = defineSchema({
  ...authTables,
  bestSeller: defineTable(bestSellerSchema),
  category: defineTable(categorySchema),
  color: defineTable(colorSchema),
  featuredItem: defineTable(featuredItemSchema),
  subcategory: defineTable(subcategorySchema),
  store: defineTable(storeSchema),
  storeFrontUser: defineTable(storeFrontUserSchema),
  storeFrontVerificationCode: defineTable(storeFrontVerificationCode),
  organization: defineTable(organizationSchema),
  product: defineTable(productSchema),
  productSku: defineTable(productSkuSchema),
  bag: defineTable(bagSchema),
  bagItem: defineTable(bagItemSchema),
  savedBag: defineTable(savedBagSchema),
  savedBagItem: defineTable(savedBagItemSchema),
  customer: defineTable(customerSchema),
  guest: defineTable(guestSchema),
  checkoutSession: defineTable(checkoutSessionSchema),
  checkoutSessionItem: defineTable(checkoutSessionItemSchema),
  onlineOrder: defineTable(onlineOrderSchema),
  onlineOrderItem: defineTable(onlineOrderItemSchema),
});

export default schema;
