import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { products } from "./products";

export const productSkus = pgTable("product_skus", {
  id: serial("id").primaryKey(),
  productId: integer("product_id")
    .references(() => products.id, { onDelete: "cascade" })
    .notNull(),
  sku: text("sku").notNull(),
  length: integer("length"),
  size: text("size"),
  color: text("color"),
  price: doublePrecision("price").notNull(),
  inventoryCount: integer("inventory_count").notNull(),
  unitCost: doublePrecision("unit_cost").notNull(),
  attributes: jsonb("attributes").notNull(),
  images: text("images").array().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

type Psku = typeof productSkus.$inferSelect;

export type ProductSKU = Omit<Psku, "attributes"> & {
  attributes: Record<string, any>;
};

export type ProductSKURequest = Omit<
  ProductSKU,
  "id" | "createdAt" | "updatedAt" | "sku"
> & { sku?: string };
