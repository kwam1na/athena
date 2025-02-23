import { getOrder, getOrders } from "@/api/onlineOrder";
import { queryOptions } from "@tanstack/react-query";
import { DEFAULT_STALE_TIME } from "../constants";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";

export const useOnlineOrderQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    all: () => ["online-orders"],
    lists: () => ["online-orders", "list"],
    list: () =>
      queryOptions({
        queryKey: ["online-orders", "list"],
        queryFn: () => getOrders(),
        staleTime: DEFAULT_STALE_TIME,
        enabled: queryEnabled,
      }),
    details: () => ["online-orders", "detail"],
    detail: (orderId: string) =>
      queryOptions({
        queryKey: ["online-orders", "detail", orderId],
        queryFn: () => getOrder(orderId),
        staleTime: DEFAULT_STALE_TIME,
        enabled: queryEnabled,
      }),
  };
};
