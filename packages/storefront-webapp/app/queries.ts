import { queryOptions, useMutation } from "@tanstack/react-query";
import { getAllProducts, getProduct } from "./api/product";
import { FilterParams } from "./api/types";
import { getActiveSavedBag } from "./api/savedBag";
import { getActiveBag } from "./api/bag";

export const productQueries = {
  all: () => ["products"],
  lists: () => [...productQueries.all(), "list"],
  list: ({
    organizationId,
    storeId,
    filters,
  }: {
    organizationId: string;
    storeId: string;
    filters?: FilterParams;
  }) =>
    queryOptions({
      queryKey: [...productQueries.lists(), filters],
      queryFn: () => getAllProducts({ organizationId, storeId, filters }),
    }),
  details: () => [...productQueries.all(), "detail"],
  detail: ({
    organizationId,
    storeId,
    productId,
  }: {
    organizationId: string;
    storeId: string;
    productId: string;
  }) =>
    queryOptions({
      queryKey: [...productQueries.details(), productId],
      queryFn: () => getProduct({ organizationId, storeId, productId }),
      staleTime: 5000,
    }),
};

export const bagQueries = {
  activeSavedBag: ({
    userId,
    organizationId,
    storeId,
  }: {
    userId?: string;
    organizationId: string;
    storeId: string;
  }) =>
    queryOptions({
      queryKey: ["active-saved-bag"],
      queryFn: () =>
        getActiveSavedBag({
          customerId: userId!,
          organizationId,
          storeId,
        }),
      enabled: Boolean(userId),
    }),
  activeBag: ({
    userId,
    organizationId,
    storeId,
  }: {
    userId?: string;
    organizationId: string;
    storeId: string;
  }) =>
    queryOptions({
      queryKey: ["active-bag"],
      queryFn: () =>
        getActiveBag({
          customerId: userId!,
          organizationId,
          storeId,
        }),
      enabled: Boolean(userId),
    }),
};
