import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { categories } from "./categories";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { stores } from "./stores";
import { organizations } from "./organizations";

export const subcategories = pgTable("subcategories", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id")
    .references(() => categories.id)
    .notNull(),
  createdByUserId: integer("created_by_userId").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  storeId: integer("store_id")
    .references(() => stores.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Subcategory = typeof subcategories.$inferSelect;

const insertSubcategorySchema = createInsertSchema(subcategories);

export const subcategoryRequestSchema = insertSubcategorySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  slug: true,
});

export type SubcategoryRequest = z.infer<typeof subcategoryRequestSchema>;
