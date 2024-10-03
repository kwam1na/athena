import { z } from "zod";

export const categorySchema = z.object({
  storeId: z.string(),
  organizationId: z.string(),
  categoryName: z.string().min(3),
});

export type CategoryType = z.infer<typeof categorySchema>;

export type CategoryResponse = CategoryType & { id: string };
