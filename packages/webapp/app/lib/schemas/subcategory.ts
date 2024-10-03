import { z } from "zod";

export const subcategorySchema = z.object({
  storeId: z.string(),
  organizationId: z.string(),
  categoryId: z.string(),
  subcategoryName: z.string().min(3),
});

export type SubcategoryType = z.infer<typeof subcategorySchema>;

export type SubcategoryResponse = SubcategoryType & { id: string };
