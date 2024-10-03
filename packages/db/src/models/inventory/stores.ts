import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type { Category } from "./categories";
import type { Subcategory } from "./subcategories";

export const stores = pgTable("stores", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  name: text("name").notNull(),
  currency: text("currency").notNull(),
  createdByUserId: integer("created_by_user_id").notNull(),
  slug: text("slug").notNull(),
  address: text("address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type S = typeof stores.$inferSelect;

export type Store = S & {
  categories: Pick<Category, "id" | "name" | "slug">[];
  subcategories: Pick<Subcategory, "id" | "name" | "slug">[];
};

const insertStoreSchema = createInsertSchema(stores);

export const storeRequestSchema = insertStoreSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  slug: true,
});

export type StoreRequest = z.infer<typeof storeRequestSchema>;
