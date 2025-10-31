import {
  getReviewByOrderItem,
  hasReviewForOrderItem,
  hasUserReviewForOrderItem,
  getUserReviewsForProduct,
} from "@/api/reviews";
import { queryOptions } from "@tanstack/react-query";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";

export const useReviewQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    all: () => ["reviews"],

    hasReview: () => ["reviews", "has-review"],
    hasReviewForOrderItem: (orderItemId: string) =>
      queryOptions({
        queryKey: ["reviews", "has-review", orderItemId],
        queryFn: () => hasReviewForOrderItem(orderItemId),
        staleTime: 30000, // 30 seconds
        enabled: queryEnabled && Boolean(orderItemId),
      }),

    hasUserReview: () => ["reviews", "has-user-review"],
    hasUserReviewForOrderItem: (orderItemId: string) =>
      queryOptions({
        queryKey: ["reviews", "has-user-review", orderItemId],
        queryFn: () => hasUserReviewForOrderItem(orderItemId),
        staleTime: 30000, // 30 seconds
        enabled: queryEnabled && Boolean(orderItemId),
      }),

    byOrderItems: () => ["reviews", "by-order-item"],
    byOrderItem: (orderItemId: string) =>
      queryOptions({
        queryKey: ["reviews", "by-order-item", orderItemId],
        queryFn: () => getReviewByOrderItem(orderItemId),
        staleTime: 30000, // 30 seconds
        enabled: queryEnabled && Boolean(orderItemId),
      }),

    userProductReviews: () => ["reviews", "user-product"],
    userProductReview: (productSkuId: string) =>
      queryOptions({
        queryKey: ["reviews", "user-product", productSkuId],
        queryFn: () => getUserReviewsForProduct(productSkuId),
        staleTime: 30000, // 30 seconds
        enabled: queryEnabled && Boolean(productSkuId),
      }),
  };
};
