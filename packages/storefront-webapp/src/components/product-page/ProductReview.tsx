import { Review } from "@athena/webapp";
import { Star, ThumbsUp } from "lucide-react";
import { getProductName } from "@/lib/productUtils";
import { RatingDimension } from "@/api/reviews";
import { markReviewHelpful } from "@/api/reviews";
import { useAuth } from "@/hooks/useAuth";
import React from "react";
import { useQueryClient } from "@tanstack/react-query";

interface StarRatingProps {
  rating: number;
  size?: "sm" | "md" | "lg";
  showValue?: boolean;
}

function StarRating({ rating, size = "md" }: StarRatingProps) {
  const sizeClasses = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
    lg: "w-5 h-5",
    xl: "w-6 h-6",
  };
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={`${sizeClasses[size]} fill-warning text-warning`}
        />
      ))}
    </div>
  );
}

interface ProductReviewProps {
  review: Review;
}

export function ProductReview({ review }: ProductReviewProps) {
  // Calculate overall rating
  const overallRating = (() => {
    const explicitOverall = review.ratings.find(
      (r: RatingDimension) => r.key === "overall"
    );
    if (explicitOverall) {
      return explicitOverall.value;
    }
    // Calculate average of all dimensions
    const sum = review.ratings.reduce((acc, r) => acc + r.value, 0);
    return Math.round(sum / review.ratings.length);
  })();

  // Example: extract fit and size ordered from dimensions
  const trueToLength =
    review.ratings.find((r) => r.key === "trueToLength")?.value || "";

  // Reviewer name formatting
  let reviewerName = "Anonymous";
  if (review.user) {
    if (review.user.firstName && review.user.lastName) {
      reviewerName = `${review.user.firstName} ${review.user.lastName.charAt(0).toUpperCase()}.`;
    } else if (review.user.firstName) {
      reviewerName = review.user.firstName;
    } else if (review.user.email) {
      reviewerName = review.user.email;
    }
  }

  const reviewDate = review._creationTime
    ? new Date(review._creationTime).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  const { storeFrontUserId } = useAuth();
  const hasVoted =
    storeFrontUserId && review.helpfulUserIds?.includes(storeFrontUserId);
  const [helpfulCount, setHelpfulCount] = React.useState(
    review.helpfulCount ?? 0
  );
  const [voted, setVoted] = React.useState(hasVoted);
  const [loading, setLoading] = React.useState(false);
  const queryClient = useQueryClient();

  const handleHelpful = async () => {
    if (!storeFrontUserId || loading) return;
    setLoading(true);
    try {
      const res = await markReviewHelpful(review._id, storeFrontUserId);
      setHelpfulCount(res.helpfulCount);
      setVoted(!voted);
      // Invalidate the reviews query for this product
      queryClient.invalidateQueries({
        queryKey: ["product-reviews", review.productId],
      });
    } catch (e) {
      // Optionally handle error
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col border-t py-6 first:border-t-0 md:flex-row md:items-start md:gap-8">
      {/* Left column */}
      <div className="w-full md:w-1/4 flex flex-col items-start gap-2 mb-4 md:mb-0">
        <StarRating rating={overallRating} size="md" />
        <span className="font-medium">{reviewerName}</span>
        <span className="text-sm text-muted-foreground">{reviewDate}</span>
      </div>
      {/* Right column */}
      <div className="w-full md:w-3/4 flex flex-col gap-2 relative">
        <div className="flex items-start justify-between">
          <span className="font-extrabold tracking-tight">{review.title}</span>
          <button
            aria-label={`Mark review by ${reviewerName} helpful`}
            className="ml-4 flex min-h-control-standard items-center gap-1 rounded-pill border border-border bg-surface px-5 py-2 text-sm font-medium text-foreground shadow-surface hover:bg-surface-subtle"
            disabled={loading}
            onClick={handleHelpful}
          >
            <ThumbsUp aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="text-xs">Helpful ({helpfulCount})</span>
          </button>
        </div>
        <div className="mt-1 flex gap-6 text-sm text-muted-foreground">
          {trueToLength && (
            <span className="mb-2 text-xs text-muted-foreground">
              True to Length: {trueToLength}/5
            </span>
          )}
          {/* Product Name */}
          {review.productSku && (
            <span className="mb-2 text-xs text-muted-foreground">
              {getProductName(review.productSku)}
            </span>
          )}
        </div>
        {review.content && (
          <p className="mt-1 text-sm text-foreground/80">{review.content}</p>
        )}
      </div>
    </div>
  );
}
