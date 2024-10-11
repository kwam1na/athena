import { z } from "zod";

export const productSchema = z.object({
  availability: z.enum(["archived", "draft", "live"]),
  categoryId: z.string(),
  currency: z.string(),
  storeId: z.string(),
  organizationId: z.string(),
  subcategoryId: z.string(),
  name: z.string().min(2),
  description: z.string().optional(),
});
