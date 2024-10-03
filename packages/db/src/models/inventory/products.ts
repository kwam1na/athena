import {
  pgTable,
  serial,
  text,
  integer,
  pgEnum,
  timestamp,
} from "drizzle-orm/pg-core";
import { categories } from "./categories";
import { subcategories } from "./subcategories";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { stores } from "./stores";
import { organizations } from "./organizations";
import { productSkus, type ProductSKU } from "./productSkus";
import { relations } from "drizzle-orm";

export const productAvailabilityEnum = pgEnum("availability", [
  "archived",
  "draft",
  "published",
]);

export type ProductAvailability = "archived" | "draft" | "published";

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  availability: productAvailabilityEnum("availability").notNull(),
  currency: text("currency").notNull(),
  createdByUserId: integer("created_by_user_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  categoryId: integer("category_id")
    .references(() => categories.id)
    .notNull(),
  subcategoryId: integer("subcategory_id")
    .references(() => subcategories.id)
    .notNull(),
  storeId: integer("store_id")
    .references(() => stores.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

type P = typeof products.$inferSelect;

export type Product = P & {
  skus: ProductSKU[];
};

const insertProductSchema = createInsertSchema(products);

const insertProductSkuSchema = createInsertSchema(productSkus);

export const productRequestSchema = insertProductSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    slug: true,
  })
  .extend({
    skus: z.array(
      insertProductSkuSchema
        .omit({
          id: true,
          productId: true,
          createdAt: true,
          updatedAt: true,
          sku: true,
        })
        .extend({
          sku: z.string().optional(),
        })
    ),
  });

// export type ProductRequest = Omit<
//   Product,
//   "id" | "createdAt" | "updatedAt" | "slug"
// >;

export type ProductRequest = z.infer<typeof productRequestSchema>;
