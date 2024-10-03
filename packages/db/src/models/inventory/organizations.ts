import { sql } from "drizzle-orm";
import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  createdByUserId: integer("created_by_user_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Organization = typeof organizations.$inferSelect;

const insertOrganizationSchema = createInsertSchema(organizations);

export const organizationRequestSchema = insertOrganizationSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  slug: true,
});

export type OrganizationRequest = z.infer<typeof organizationRequestSchema>;
