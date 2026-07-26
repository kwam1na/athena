import { useStoreContext } from "@/contexts/StoreContext";
import { useOnlineOrderQueries } from "@/lib/queries/onlineOrder";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "@tanstack/react-router";
import NotFound from "../states/not-found/NotFound";
import { FadeIn } from "../common/FadeIn";
import { OrderNavigation } from "@/routes/_layout/_ordersLayout/shop/orders/$orderId/review";
import {
  RatingDimension,
  createReview,
  getReviewByOrderItem,
  getUserReviewsForProduct,
} from "@/api/reviews";
import { OrderItem } from "./OrderItem";
import {
  GENERIC_DIMENSIONS,
  HAIR_DIMENSIONS,
  ReviewFormData,
  SubmissionStatus,
} from "./types";
import { ReviewForm } from "./ReviewForm";
import { SuccessMessage } from "./SuccessMessage";
import { ErrorMessage } from "./ErrorMessage";
import { ExistingReviewMessage } from "./ExistingReviewMessage";
import { ArrowRight } from "lucide-react";
import { useStorefrontObservability } from "@/hooks/useStorefrontObservability";
import {
  createReviewEditorViewedEvent,
  createReviewSubmittedEvent,
} from "@/lib/storefrontJourneyEvents";
import { cn } from "@/lib/utils";
import { InlineAlert } from "../ui/inline-alert";
import { PageState } from "../states/PageState";
import { StorefrontPage } from "../common/StorefrontPage";

const PublishedReviewMessage = ({ productId }: { productId: string }) => {
  return (
    <InlineAlert tone="success" title="Your review has been published!">
      <p className="text-sm">
        Thank you for your feedback. Your review is now visible on the product
        page.
      </p>
      <div>
        <Link
          to="/shop/product/$productSlug"
          params={{ productSlug: productId }}
          className="flex items-center group"
        >
          <p className="text-sm">View your review on the product page</p>
          <ArrowRight className="w-3.5 h-3.5 ml-2 -me-1 ms-2 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
    </InlineAlert>
  );
};

export const ReviewEditor = () => {
  const { orderId, orderItemId } = useParams({ strict: false });
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<ReviewFormData>({
    title: "",
    content: "",
    hairQuality: 0,
    trueToLength: 0,
    capFit: 0,
    styleAppearance: 0,
    easeOfInstallation: 0,
    overall: 0,
    value: 0,
    quality: 0,
  });
  const [submissionStatus, setSubmissionStatus] = useState<SubmissionStatus>({
    type: null,
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const onlineOrderQueries = useOnlineOrderQueries();
  const { formatter } = useStoreContext();
  const { data, isLoading } = useQuery(
    onlineOrderQueries.detail(orderId || "")
  );

  const { data: orderData } = useQuery(
    onlineOrderQueries.detail(orderId || "")
  );

  const item: any = data?.items?.find((item: any) => item._id == orderItemId);

  const { track } = useStorefrontObservability();
  const hasTrackedView = useRef(false);

  useEffect(() => {
    if (!hasTrackedView.current && item) {
      hasTrackedView.current = true;
      void track(
        createReviewEditorViewedEvent({
          orderId: orderId || "",
          orderItemId: orderItemId || "",
          productId: item?.productId,
          productImageUrl: item?.productImage,
        }),
      );
    }
  }, [item, orderId, orderItemId, track]);

  // Check if review already exists for this order item
  const { data: existingReview, isLoading: isLoadingReview } = useQuery({
    queryKey: ["review", orderItemId],
    queryFn: async () => {
      try {
        return await getReviewByOrderItem(orderItemId || "");
      } catch (error) {
        return null;
      }
    },
    enabled: !!orderItemId,
  });

  // Check if user has already reviewed this product
  const { data: userProductReviews, isLoading: isLoadingUserProductReviews } =
    useQuery({
      queryKey: ["user-reviews", item?.productSkuId],
      queryFn: async () => {
        try {
          return await getUserReviewsForProduct(item?.productSkuId || "");
        } catch (error) {
          return [];
        }
      },
      enabled: !!item?.productSkuId,
    });

  if (isLoading || isLoadingReview || isLoadingUserProductReviews) {
    return (
      <PageState
        state="loading"
        title="Loading your review"
        description="We're checking this order item and its review status."
      />
    );
  }

  if (!item) {
    return <NotFound />;
  }

  const isHair = item.productCategory === "Hair";
  const hasUserReviewedProduct = (userProductReviews?.length ?? 0) > 0;
  const existingUserReview = userProductReviews?.[0];
  const hasReviewedThisOrderItem = !!existingReview;
  const isReviewPublished = existingReview?.isPublished;

  const handleFormDataChange = (
    field: keyof ReviewFormData,
    value: string | number
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    try {
      const dimensions = isHair ? HAIR_DIMENSIONS : GENERIC_DIMENSIONS;
      const ratings: RatingDimension[] = dimensions.map((dim) => {
        const value = isHair
          ? (formData[dim.key as keyof typeof formData] as number)
          : (formData[dim.key as keyof typeof formData] as number);

        return {
          key: dim.key,
          label: dim.label,
          value: value || 0,
          optional: dim.optional,
        };
      });

      setSubmissionStatus({
        type: null,
        message: "",
      });

      setIsSubmitting(true);

      await Promise.all([
        createReview({
          orderId: orderId as any,
          orderNumber: orderData?.orderNumber,
          orderItemId: orderItemId as any,
          productId: item.productId,
          productSkuId: item.productSkuId,
          title: formData.title,
          content: formData.content,
          ratings,
        }),

        track(
          createReviewSubmittedEvent({
            orderId: orderId || "",
            orderItemId: orderItemId || "",
            productId: item.productId,
            productSkuId: item.productSkuId,
            productImageUrl: item.productImage,
          }),
        ),
      ]);

      // Invalidate all review queries
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["user-reviews", item.productSkuId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["review", orderItemId],
        }),
      ]);

      setSubmissionStatus({
        type: "success",
        message: "Thank you for your feedback!",
      });
      setIsSubmitted(true);
    } catch (error) {
      setSubmissionStatus({
        type: "error",
        message: "Failed to submit review. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StorefrontPage as="section" spacing="relaxed">
      <FadeIn
        className={cn(
          "space-y-8 lg:space-y-24",
          !hasReviewedThisOrderItem && !isSubmitted && "min-h-full",
        )}
      >
        <div className="space-y-8">
          <OrderNavigation />

          <div className="grid grid-cols-1 gap-24 lg:grid-cols-3">
            <OrderItem item={item} formatter={formatter} />

            <div className="space-y-12 lg:col-span-2">
              {!isSubmitted && !hasReviewedThisOrderItem ? (
                <>
                  {hasUserReviewedProduct && existingUserReview && (
                    <ExistingReviewMessage
                      creationTime={existingUserReview._creationTime}
                      orderId={orderId || ""}
                    />
                  )}
                  <ReviewForm
                    isHair={isHair}
                    formData={formData}
                    onFormDataChange={handleFormDataChange}
                    isSubmitting={isSubmitting}
                    onSubmit={handleSubmit}
                    hasUserReviewedProduct={hasUserReviewedProduct}
                  />
                  {submissionStatus.type === "error" && (
                    <ErrorMessage message={submissionStatus.message} />
                  )}
                </>
              ) : isReviewPublished ? (
                <PublishedReviewMessage productId={item.productId} />
              ) : (
                <SuccessMessage orderId={orderId || ""} />
              )}
            </div>
          </div>
        </div>
      </FadeIn>
    </StorefrontPage>
  );
};
