import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v, Infer } from "convex/values";
import {
  categorySchema,
  colorSchema,
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
} from "./schemas/storeFront";

const schema = defineSchema({
  ...authTables,
  category: defineTable(categorySchema),
  color: defineTable(colorSchema),
  subcategory: defineTable(subcategorySchema),
  store: defineTable(storeSchema),
  organization: defineTable(organizationSchema),
  product: defineTable(productSchema),
  productSku: defineTable(productSkuSchema),
  bag: defineTable(bagSchema),
  bagItem: defineTable(bagItemSchema),
  savedBag: defineTable(savedBagSchema),
  savedBagItem: defineTable(savedBagItemSchema),
  customer: defineTable(customerSchema),
  guest: defineTable(guestSchema),
});

export default schema;
