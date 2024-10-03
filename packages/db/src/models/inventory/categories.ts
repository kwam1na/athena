import {
  pgTable,
  serial,
  text,
  integer,
  pgEnum,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organizations } from "./organizations";
import { stores } from "./stores";

export const productAvailabilityEnum = pgEnum("availability", [
  "archived",
  "draft",
  "published",
]);

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
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

export type Category = typeof categories.$inferSelect;

const insertCategorySchema = createInsertSchema(categories);

export const categoryRequestSchema = insertCategorySchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  slug: true,
});

export type CategoryRequest = z.infer<typeof categoryRequestSchema>;
