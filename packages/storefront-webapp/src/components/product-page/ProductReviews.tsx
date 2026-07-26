import { useGetProductReviewsQuery } from "@/hooks/useGetProductReviews";
import { ReviewSummary } from "./ReviewSummary";
import { ProductReview } from "./ProductReview";
import { Skeleton } from "../ui/skeleton";
import { DimensionBar } from "./DimensionBar";

interface ReviewsProps {
  productId: string;
  productCategory?: string;
}

export function Reviews({ productId, productCategory }: ReviewsProps) {
  const { data: reviews, isLoading } = useGetProductReviewsQuery(productId);

  if (isLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-6 w-32" />
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (!reviews?.length) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-medium">Reviews</h2>
        <p className="text-sm text-muted-foreground">
          This product has no reviews yet. Be the first to leave one!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h2 className="text-lg font-medium">Reviews</h2>
        <ReviewSummary reviews={reviews} />
      </div>
      {productCategory === "Hair" && (
        <DimensionBar
          reviews={reviews}
          dimensionKey="trueToLength"
          labels={["Not true to length", "True to length"]}
        />
      )}
      <div className="space-y-4">
        {reviews.map((review) => (
          <div key={review._id} className="first:border-t-0 border-t">
            <ProductReview review={review} />
          </div>
        ))}
      </div>
    </div>
  );
}
