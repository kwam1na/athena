import { z } from "zod";

export const storeSchema = z.object({
  organizationId: z.string(),
  currency: z.string(),
  createdByUserId: z.string(),
  storeName: z.string().min(3),
});

export type StoreType = z.infer<typeof storeSchema>;

export type StoreResponse = StoreType & { id: string; storeUrlSlug: string };

export type StoresResponse = {
  stores: StoreResponse[];
};
