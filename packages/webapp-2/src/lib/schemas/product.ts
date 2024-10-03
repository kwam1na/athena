import { z } from "zod";

export const productSchema = z.object({
  availability: z.enum(["archived", "draft", "published"]),
  categoryId: z.number(),
  currency: z.string(),
  storeId: z.number(),
  organizationId: z.number(),
  subcategoryId: z.number(),
  name: z.string().min(2),
});

export type ProductType = z.infer<typeof productSchema>;

export type ProductResponseBody = ProductType & {
  id: string;
  createdByUserId: string;
  productSlug: string;
};

export type ProductResponse = {
  product: ProductResponseBody;
  warning: string;
};
