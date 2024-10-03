import { z } from "zod";

// Define the schema for an item in the bag
export const bagItemSchema = z.object({
  productId: z.string().uuid(), // The product ID for the item
  quantity: z.number().min(1), // Quantity of the product in the bag
  price: z.number().min(0), // Price of the product in the bag
  addedAt: z.string(), // Timestamp for when the item was added
});

// Type inference for BagItem
export type BagItemType = z.infer<typeof bagItemSchema>;

// Response structure for a single bag item
export type BagItemResponseBody = BagItemType & {
  bagItemId: string; // Unique ID for the item in the bag
};
