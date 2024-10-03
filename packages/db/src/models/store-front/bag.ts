import { integer, pgTable, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type { BagItemPreview } from "./bagItem";

export const bags = pgTable("bags", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

type B = typeof bags.$inferSelect;

export type Bag = B & {
  items: BagItemPreview[];
};

const insertBagSchema = createInsertSchema(bags);

export const bagRequestSchema = insertBagSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BagRequest = z.infer<typeof bagRequestSchema>;
