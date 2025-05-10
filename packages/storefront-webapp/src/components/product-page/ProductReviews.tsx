import { useGetProductReviewsQuery } from "@/hooks/useGetProductReviews";
import { ReviewSummary } from "./ReviewSummary";
import { ProductReview } from "./ProductReview";
import { Skeleton } from "../ui/skeleton";
import { DimensionBar } from "./DimensionBar";
import { motion, AnimatePresence } from "framer-motion";

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
          This product has no reviews yet
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
        <AnimatePresence>
          {reviews.map((review) => (
            <motion.div
              key={review._id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="first:border-t-0 border-t"
            >
              <ProductReview review={review} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
