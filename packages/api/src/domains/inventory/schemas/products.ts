import { z } from "zod";

export const productSchema = z.object({
  availability: z.enum(["archived", "draft", "published"]),
  categoryId: z.number(),
  currency: z.string(),
  storeId: z.number(),
  organizationId: z.number(),
  subcategoryId: z.number(),
  name: z.string().min(2),
  description: z.string().optional(),
});
