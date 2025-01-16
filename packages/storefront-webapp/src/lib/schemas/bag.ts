import { z } from "zod";
import { BagItemResponseBody } from "./bagItem";

// Define the schema for a Bag
export const bagSchema = z.object({
  customerId: z.string().uuid(), // The customer who owns the bag
  bagId: z.string(), // Unique ID for the bag
  createdAt: z.string(), // Timestamp for when the bag was created
  updatedAt: z.string(), // Timestamp for the last update to the bag
});

// Type inference for Bag
export type BagType = z.infer<typeof bagSchema>;

// Response structure for a single bag
export type BagResponseBody = BagType & {
  items?: BagItemResponseBody[]; // Optional array of items in the bag
};
