import { useStoreContext } from "@/contexts/StoreContext";
import { useOnlineOrderQueries } from "@/lib/queries/onlineOrder";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
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
import { ArrowRight, CheckCircle } from "lucide-react";
import { useTrackEvent } from "@/hooks/useTrackEvent";
import { postAnalytics } from "@/api/analytics";

const PublishedReviewMessage = ({ productId }: { productId: string }) => {
  return (
    <div className="rounded-lg border p-6 space-y-4">
      <div className="flex items-center gap-2 text-green-600">
        <CheckCircle className="h-5 w-5" />
        <h3 className="font-medium">Your review has been published!</h3>
      </div>
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
    </div>
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

  useTrackEvent({
    action: "navigated_to_product_review_editor",
    data: {
      orderId: orderId || "",
      orderItemId: orderItemId || "",
      product: item?.productId,
      productImageUrl: item?.productImage,
    },
  });

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

  if (isLoading || isLoadingReview || isLoadingUserProductReviews)
    return <div className="h-screen"></div>;

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
        await createReview({
          orderId: orderId as any,
          orderNumber: orderData?.orderNumber,
          orderItemId: orderItemId as any,
          productId: item.productId,
          productSkuId: item.productSkuId,
          title: formData.title,
          content: formData.content,
          ratings,
        }),

        await postAnalytics({
          action: "submitted_a_product_review",
          data: {
            orderId: orderId || "",
            orderItemId: orderItemId || "",
            productId: item.productId,
            productSkuId: item.productSkuId,
            productImageUrl: item.productImage,
          },
        }),
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
    <FadeIn className="container mx-auto max-w-[1024px] px-6 xl:px-0 space-y-8 lg:space-y-24 py-8 pb-56">
      <div className="space-y-8">
        <OrderNavigation />

        <div className="grid grid-cols-1 lg:grid-cols-[1fr,2fr] gap-24">
          <OrderItem item={item} formatter={formatter} />

          <div className="space-y-12">
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
  );
};
