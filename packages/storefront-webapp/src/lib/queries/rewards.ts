import {
  getUserPoints,
  getPointHistory,
  getRewardTiers,
  getEligiblePastOrders,
  getOrderRewardPoints,
} from "@/api/rewards";
import { queryOptions } from "@tanstack/react-query";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";

export const useRewardsQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    all: () => ["rewards"],

    points: () => ["rewards", "points"],
    pointsQuery: (storeId: string) =>
      queryOptions({
        queryKey: ["rewards", "points", storeId],
        queryFn: () => getUserPoints(storeId),
        enabled: queryEnabled && !!storeId,
      }),

    history: () => ["rewards", "history"],
    historyQuery: () =>
      queryOptions({
        queryKey: ["rewards", "history"],
        queryFn: () => getPointHistory(),
        enabled: queryEnabled,
      }),

    tiers: () => ["rewards", "tiers"],
    tiersQuery: (storeId: string) =>
      queryOptions({
        queryKey: ["rewards", "tiers", storeId],
        queryFn: () => getRewardTiers(),
        enabled: queryEnabled && !!storeId,
      }),

    pastOrders: () => ["rewards", "pastOrders"],
    pastOrdersQuery: (email: string) =>
      queryOptions({
        queryKey: ["rewards", "pastOrders", email],
        queryFn: () => getEligiblePastOrders(email),
        enabled: queryEnabled && !!email,
      }),

    orderPoints: () => ["rewards", "orderPoints"],
    orderPointsQuery: (orderId: string) =>
      queryOptions({
        queryKey: ["rewards", "orderPoints", orderId],
        queryFn: () => getOrderRewardPoints(orderId),
        enabled: queryEnabled && !!orderId,
      }),
  };
};
