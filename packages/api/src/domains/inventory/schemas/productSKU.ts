import { z } from "zod";

export const productSKUSchema = z.object({
  unitCost: z.number(),
  productId: z.number(),
  inventoryCount: z.number(),
  price: z.number(),
  length: z.number(),
  color: z.string().min(2),
  sku: z.string().min(1).optional(),
  images: z.array(z.string()),
});
