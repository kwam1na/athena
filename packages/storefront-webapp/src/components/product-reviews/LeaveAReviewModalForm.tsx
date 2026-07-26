import React from "react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { LeaveReviewModalConfig } from "./leaveReviewModalConfig";
import { OnlineOrder } from "@athena/webapp";
import { Link } from "@tanstack/react-router";
import { StorefrontImage } from "@/components/ui/storefront-image";

interface LeaveAReviewModalFormProps {
  onClose: () => void;
  onSuccess?: () => void;
  orderToReview: OnlineOrder;
  config: LeaveReviewModalConfig;
}

export const LeaveAReviewModalForm: React.FC<LeaveAReviewModalFormProps> = ({
  onClose,
  onSuccess,
  orderToReview,
  config,
}) => {
  const itemToReview = orderToReview.items?.[0];

  return (
    <div className="flex flex-col items-center gap-8">
      <div className="space-y-8">
        <div className="flex flex-col items-center gap-8">
          <h2 className="font-light">{config.title}</h2>
          {config.subtitle && (
            <h3 className="text-5xl font-light">{config.subtitle}</h3>
          )}
        </div>
        <p className="mb-6 text-sm sm:text-base">{config.body}</p>
      </div>

      <div className="w-full space-y-8">
        <div>
          <div className="flex justify-center p-4 rounded-lg">
            <div className="flex gap-4 w-fit">
              <StorefrontImage
                alt={itemToReview?.productName || "Product to review"}
                aspectRatio="1 / 1"
                wrapperClassName="h-24 w-24 rounded md:h-40 md:w-40"
                src={itemToReview?.productImage}
              />

              <div className="flex flex-col gap-2 items-start">
                <p className="font-medium">{itemToReview?.productName}</p>
                <p className="text-start text-xs">{`Ordered on ${formatDate(orderToReview._creationTime)}`}</p>
              </div>
            </div>
          </div>
        </div>

        <div>
          <Link
            to="/shop/orders/$orderId/$orderItemId/review"
            params={{
              orderId: orderToReview._id,
              orderItemId: (itemToReview as any)._id,
            }}
            onClick={() => {
              // Mark the flow as completed before navigation
              if (onSuccess) {
                onSuccess();
              }
            }}
          >
            <Button type="button" className="w-full font-semibold md:w-3/5">
              {config.ctaText}
            </Button>
          </Link>
        </div>
      </div>

      <Button
        type="button"
        variant="clear"
        onClick={onClose}
        className="mt-4 text-white hover:text-white/80"
      >
        No thanks
      </Button>
    </div>
  );
};
