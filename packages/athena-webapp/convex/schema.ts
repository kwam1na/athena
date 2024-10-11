import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v, Infer } from "convex/values";
import {
  categorySchema,
  organizationSchema,
  productSchema,
  productSkuSchema,
  storeSchema,
  subcategorySchema,
} from "./schemas/inventory";
import {
  bagItemSchema,
  bagSchema,
  customerSchema,
  guestSchema,
} from "./schemas/storeFront";

const schema = defineSchema({
  ...authTables,
  category: defineTable(categorySchema),
  subcategory: defineTable(subcategorySchema),
  store: defineTable(storeSchema),
  organization: defineTable(organizationSchema),
  product: defineTable(productSchema),
  productSku: defineTable(productSkuSchema),
  bag: defineTable(bagSchema),
  bagItem: defineTable(bagItemSchema),
  customer: defineTable(customerSchema),
  guest: defineTable(guestSchema),
});

export default schema;
