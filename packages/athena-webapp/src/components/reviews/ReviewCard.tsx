import { Review } from "../../../types";
import { RatingStars } from "./RatingStars";
import { ReviewMetadata } from "./ReviewMetadata";
import { ReviewActions } from "./ReviewActions";
import { Link } from "@tanstack/react-router";
import { getOrigin } from "../../lib/navigationUtils";

interface RatingDimension {
  key: string;
  label: string;
  value: number;
  optional?: boolean;
}

interface ReviewCardProps {
  review: Review;
  onApprove?: () => void;
  onReject?: () => void;
  onPublish?: () => void;
  onUnpublish?: () => void;
}

export function ReviewCard({
  review,
  onApprove,
  onReject,
  onPublish,
  onUnpublish,
}: ReviewCardProps) {
  // Calculate overall rating - either from explicit overall rating or average of all dimensions
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

  return (
    <div className="w-full p-6 space-y-24 rounded-lg border">
      <div className="space-y-16">
        <div className="space-y-8">
          <div className="flex items-start gap-8">
            {review.productImage && (
              <Link
                to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
                params={(prev) => ({
                  ...prev,
                  orgUrlSlug: prev.orgUrlSlug!,
                  storeUrlSlug: prev.storeUrlSlug!,
                  productSlug: review.productId,
                })}
                search={{ o: getOrigin(), variant: review.productSku?.sku! }}
                className="block"
              >
                <img
                  src={review.productImage}
                  alt="Product"
                  className="w-24 h-24 rounded-lg object-cover"
                />
              </Link>
            )}
            <div className="flex-1 space-y-12">
              <div className="space-y-4">
                <RatingStars rating={overallRating} />

                <div className="space-y-2">
                  <h3 className="font-semibold mb-2">{review.title}</h3>
                  {review.content && (
                    <p className="text-gray-600 mb-4">{review.content}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <ReviewMetadata
            orderId={review.orderId}
            orderNumber={review.orderNumber}
            createdByStoreFrontUserId={review.createdByStoreFrontUserId}
            creationTime={review._creationTime}
          />
        </div>

        {/* Ratings breakdown Section */}
        <div className="space-y-4">
          <h4 className="font-medium">Ratings breakdown</h4>
          <div className="space-y-2">
            {review.ratings.map((rating: RatingDimension) => (
              <div key={rating.key} className="flex items-center gap-2">
                <span className="text-sm text-gray-600 w-48 min-w-[12rem]">
                  {rating.label}
                </span>
                <RatingStars rating={rating.value} />
              </div>
            ))}
          </div>
        </div>

        <ReviewActions
          review={review}
          onApprove={onApprove}
          onReject={onReject}
          onPublish={onPublish}
          onUnpublish={onUnpublish}
        />
      </div>
    </div>
  );
}
