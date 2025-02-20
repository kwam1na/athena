import { getOrder, getOrders } from "@/api/onlineOrder";
import { queryOptions } from "@tanstack/react-query";
import { DEFAULT_STALE_TIME } from "../constants";

export const onlineOrderQueries = {
  all: () => ["online-orders"],
  lists: () => [...onlineOrderQueries.all(), "list"],
  list: () =>
    queryOptions({
      queryKey: [...onlineOrderQueries.lists()],
      queryFn: () => getOrders(),
      staleTime: DEFAULT_STALE_TIME,
    }),
  details: () => [...onlineOrderQueries.all(), "detail"],
  detail: (orderId: string) =>
    queryOptions({
      queryKey: [...onlineOrderQueries.details(), orderId],
      queryFn: () => getOrder(orderId),
      staleTime: DEFAULT_STALE_TIME,
    }),
};
