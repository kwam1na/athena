import { useQuery } from "@tanstack/react-query";
import { getReviewsByProductId } from "@/api/reviews";

export const useGetProductReviewsQuery = (productId?: string) => {
  return useQuery({
    queryKey: ["product-reviews", productId],
    queryFn: () => getReviewsByProductId(productId!),
    enabled: Boolean(productId),
    staleTime: 0,
  });
};
