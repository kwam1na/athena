import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import View from "../View";
import { Review } from "../../../types";
import { MessageCircle } from "lucide-react";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { ReviewCard } from "./ReviewCard";
import { EmptyState } from "../states/empty/empty-state";
import { toast } from "sonner";
import { Id } from "../../../convex/_generated/dataModel";
import { useAuth } from "~/src/hooks/useAuth";

const Header = () => {
  return (
    <div className="container mx-auto flex gap-2 h-[40px] items-center justify-between">
      <p className="text-xl font-medium">Reviews</p>
    </div>
  );
};

interface RatingDimension {
  key: string;
  label: string;
  value: number;
  optional?: boolean;
}

export function ReviewsView() {
  const { activeStore } = useGetActiveStore();
  const { user } = useAuth();

  const reviews = useQuery(
    api.storeFront.reviews.getAllReviewsForStore,
    activeStore ? { storeId: activeStore._id } : "skip"
  );

  const approveReview = useMutation(api.storeFront.reviews.approve);
  const rejectReview = useMutation(api.storeFront.reviews.reject);
  const publishReview = useMutation(api.storeFront.reviews.publish);
  const unpublishReview = useMutation(api.storeFront.reviews.unpublish);

  const handleApprove = async (reviewId: Id<"review">) => {
    if (!user?._id) {
      toast.error("You must be logged in to approve reviews");
      return;
    }

    try {
      await approveReview({ id: reviewId, userId: user._id });
      toast.success("Review approved successfully");
    } catch (error) {
      toast.error("Failed to approve review", {
        description: (error as Error).message,
      });
    }
  };

  const handleReject = async (reviewId: Id<"review">) => {
    if (!user?._id) {
      toast.error("You must be logged in to reject reviews");
      return;
    }

    try {
      await rejectReview({ id: reviewId, userId: user._id });
      toast.success("Review rejected successfully");
    } catch (error) {
      toast.error("Failed to reject review", {
        description: (error as Error).message,
      });
    }
  };

  const handlePublish = async (reviewId: Id<"review">) => {
    if (!user?._id) {
      toast.error("You must be logged in to publish reviews");
      return;
    }

    try {
      await publishReview({ id: reviewId, userId: user._id });
      toast.success("Review published successfully");
    } catch (error) {
      toast.error("Failed to publish review", {
        description: (error as Error).message,
      });
    }
  };

  const handleUnpublish = async (reviewId: Id<"review">) => {
    if (!user?._id) {
      toast.error("You must be logged in to unpublish reviews");
      return;
    }

    try {
      await unpublishReview({ id: reviewId, userId: user._id });
      toast.success("Review unpublished successfully");
    } catch (error) {
      toast.error("Failed to unpublish review", {
        description: (error as Error).message,
      });
    }
  };

  if (!reviews) {
    return null;
  }

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      header={reviews.length > 0 ? <Header /> : null}
    >
      <div className="container mx-auto py-8 space-y-8">
        {reviews.length === 0 ? (
          <div className="flex items-center justify-center min-h-[60vh] w-full">
            <EmptyState
              icon={<MessageCircle className="w-16 h-16" />}
              title={
                <p className="text-sm text-muted-foreground">
                  No product reviews
                </p>
              }
            />
          </div>
        ) : (
          <div className="space-y-8">
            {reviews.map((review) => (
              <ReviewCard
                key={review._id}
                review={review as Review}
                onApprove={() => handleApprove(review._id)}
                onReject={() => handleReject(review._id)}
                onPublish={() => handlePublish(review._id)}
                onUnpublish={() => handleUnpublish(review._id)}
              />
            ))}
          </div>
        )}
      </div>
    </View>
  );
}
