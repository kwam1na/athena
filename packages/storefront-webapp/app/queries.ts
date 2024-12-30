import { queryOptions, useMutation } from "@tanstack/react-query";
import { getAllProducts, getBestSellers, getProduct } from "./api/product";
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
  }: {
    organizationId: string;
    storeId: string;
  }) =>
    queryOptions({
      queryKey: ["bestSellers"],
      queryFn: () => getBestSellers({ organizationId, storeId }),
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
          customerId: userId!,
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
          customerId: userId!,
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
    customerId,
    organizationId,
    storeId,
  }: {
    customerId: string;
    organizationId: string;
    storeId: string;
  }) =>
    queryOptions({
      queryKey: [...onlineOrderQueries.lists()],
      queryFn: () => getOrders({ customerId, organizationId, storeId }),
    }),
  details: () => [...onlineOrderQueries.all(), "detail"],
  detail: ({
    customerId,
    organizationId,
    storeId,
    orderId,
  }: {
    customerId: string;
    organizationId: string;
    storeId: string;
    orderId: string;
  }) =>
    queryOptions({
      queryKey: [...onlineOrderQueries.details(), orderId],
      queryFn: () => getOrder({ customerId, organizationId, storeId, orderId }),
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
          customerId: userId!,
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
          customerId: userId!,
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
          customerId: userId!,
          sessionId: sessionId!,
        }),
      enabled: Boolean(userId && sessionId),
      retry: false,
    }),
};
