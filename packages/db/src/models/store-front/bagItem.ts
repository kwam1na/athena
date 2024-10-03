import {
  date,
  doublePrecision,
  integer,
  pgTable,
  serial,
  timestamp,
} from "drizzle-orm/pg-core";
import { bags } from "./bag";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const bagItems = pgTable("bagItems", {
  id: serial("id").primaryKey(),
  bagId: integer("bag_id")
    .references(() => bags.id)
    .notNull(),
  productId: integer("product_id").notNull(),
  customerId: integer("customer_id").notNull(),
  quantity: integer("quantity").notNull(),
  price: doublePrecision("price").notNull(),
  addedAt: date("added_at").defaultNow().notNull(),
});

export type BagItem = typeof bagItems.$inferSelect;

export type BagItemPreview = Pick<
  BagItem,
  "id" | "productId" | "quantity" | "price"
> & {
  productName: string | null;
  productSlug: string | null;
  productImage: string | null;
};

const insertBagItemSchema = createInsertSchema(bagItems);

export const bagItemRequestSchema = insertBagItemSchema.omit({
  id: true,
});

export type BagItemRequest = z.infer<typeof bagItemRequestSchema>;
