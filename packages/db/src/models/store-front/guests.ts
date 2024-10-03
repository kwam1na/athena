import { date, pgTable, serial } from "drizzle-orm/pg-core";

export const guests = pgTable("guests", {
  id: serial("id").primaryKey(),
  createdAt: date("created_at").defaultNow().notNull(),
});

export type Guest = typeof guests.$inferSelect;
