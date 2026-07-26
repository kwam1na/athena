import { Review } from "@athena/webapp";
import { Star } from "lucide-react";

interface ReviewSummaryProps {
  reviews: Review[];
}

export function ReviewSummary({ reviews }: ReviewSummaryProps) {
  if (!reviews.length) return null;

  // Calculate average rating
  const averageRating =
    reviews.reduce((acc, review) => {
      // First try to find an explicit overall rating
      const explicitOverall = review.ratings.find((r) => r.key === "overall");
      if (explicitOverall) {
        return acc + explicitOverall.value;
      }

      // If no explicit overall rating, calculate average of all dimensions
      const sum = review.ratings.reduce((sum, r) => sum + r.value, 0);
      return acc + sum / review.ratings.length;
    }, 0) / reviews.length;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <Star
          aria-hidden="true"
          className="h-4 w-4 fill-warning text-warning"
        />
        <span className="font-medium">{averageRating.toFixed(1)}</span>
      </div>
      <span className="text-muted-foreground">({reviews.length})</span>
    </div>
  );
}
