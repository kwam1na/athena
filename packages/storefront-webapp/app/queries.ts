import { queryOptions, useMutation } from "@tanstack/react-query";
import {
  getAllProducts,
  getBestSellers,
  getFeatured,
  getProduct,
} from "./api/product";
import { FilterParams } from "./api/types";
import { getActiveSavedBag } from "./api/savedBag";
import { getActiveBag } from "./api/bag";
import { getOrder, getOrders } from "./api/onlineOrder";
import {
  getActiveCheckoutSession,
  getCheckoutSession,
  getPendingCheckoutSessions,
} from "./api/checkoutSession";

export const productQueries = {
  all: () => ["products"],
  bestSellers: ({
    organizationId,
    storeId,
    filters,
  }: {
    organizationId: string;
    storeId: string;
    filters?: FilterParams;
  }) =>
    queryOptions({
      queryKey: ["bestSellers", filters],
      queryFn: () => getBestSellers({ organizationId, storeId }),
    }),
  featured: ({
    organizationId,
    storeId,
  }: {
    organizationId: string;
    storeId: string;
  }) =>
    queryOptions({
      queryKey: ["featured"],
      queryFn: () => getFeatured({ organizationId, storeId }),
    }),
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
  activeSavedBagKey: () => ["active-saved-bag"],
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
      queryKey: [...bagQueries.activeSavedBagKey()],
      queryFn: () =>
        getActiveSavedBag({
          storeFrontUserId: userId!,
          organizationId,
          storeId,
        }),
      enabled: Boolean(userId),
    }),
  activeBagKey: () => ["active-bag"],
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
      queryKey: [...bagQueries.activeBagKey()],
      queryFn: () =>
        getActiveBag({
          storeFrontUserId: userId!,
          organizationId,
          storeId,
        }),
      enabled: Boolean(userId),
    }),
};

export const onlineOrderQueries = {
  all: () => ["online-orders"],
  lists: () => [...onlineOrderQueries.all(), "list"],
  list: ({
    storeFrontUserId,
    organizationId,
    storeId,
  }: {
    storeFrontUserId: string;
    organizationId: string;
    storeId: string;
  }) =>
    queryOptions({
      queryKey: [...onlineOrderQueries.lists()],
      queryFn: () => getOrders({ storeFrontUserId, organizationId, storeId }),
    }),
  details: () => [...onlineOrderQueries.all(), "detail"],
  detail: ({
    storeFrontUserId,
    organizationId,
    storeId,
    orderId,
  }: {
    storeFrontUserId: string;
    organizationId: string;
    storeId: string;
    orderId: string;
  }) =>
    queryOptions({
      queryKey: [...onlineOrderQueries.details(), orderId],
      queryFn: () =>
        getOrder({ storeFrontUserId, organizationId, storeId, orderId }),
    }),
};

export const checkoutSessionQueries = {
  activeSessionKey: () => ["active-checkout-session"],
  activeSession: ({
    organizationId,
    storeId,
    userId,
  }: {
    organizationId: string;
    storeId: string;
    userId?: string;
  }) =>
    queryOptions({
      queryKey: [...checkoutSessionQueries.activeSessionKey()],
      queryFn: () =>
        getActiveCheckoutSession({
          organizationId,
          storeId,
          storeFrontUserId: userId!,
        }),
      enabled: Boolean(userId),
    }),
  pendingSessionsKey: () => ["pending-checkout-sessions"],
  pendingSessions: ({
    organizationId,
    storeId,
    userId,
  }: {
    organizationId: string;
    storeId: string;
    userId?: string;
  }) =>
    queryOptions({
      queryKey: [...checkoutSessionQueries.pendingSessionsKey()],
      queryFn: () =>
        getPendingCheckoutSessions({
          organizationId,
          storeId,
          storeFrontUserId: userId!,
        }),
      enabled: Boolean(userId),
    }),
  sessionKey: () => ["checkout-session"],
  session: ({
    organizationId,
    storeId,
    userId,
    sessionId,
  }: {
    organizationId: string;
    storeId: string;
    userId?: string;
    sessionId?: string;
  }) =>
    queryOptions({
      queryKey: [...checkoutSessionQueries.sessionKey(), sessionId],
      queryFn: () =>
        getCheckoutSession({
          organizationId,
          storeId,
          storeFrontUserId: userId!,
          sessionId: sessionId!,
        }),
      enabled: Boolean(userId && sessionId),
      retry: false,
    }),
};
