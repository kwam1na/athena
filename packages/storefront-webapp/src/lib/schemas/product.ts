import { z } from "zod";

export const productSchema = z.object({
  availability: z.string(),
  inventoryCount: z.number().min(0),
  categoryId: z.string(),
  currency: z.string(),
  storeId: z.string(),
  organizationId: z.string(),
  subcategoryId: z.string(),
  sku: z.string().min(3).optional(),
  productName: z.string().min(2),
  price: z.number().min(0),
  unitCost: z.number().min(0),
  images: z.array(z.string()),
});

export type ProductType = z.infer<typeof productSchema>;

export type ProductResponseBody = ProductType & {
  id: string;
  productSlug: string;
  createdByUserId: string;
};

export type ProductResponse = {
  product: ProductResponseBody;
  warning: string;
};
