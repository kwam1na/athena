import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, currencyFormatter, formatDate } from "@/lib/utils";
import { submitOffer, type OfferRequest } from "@/api/offers";
import { validateEmail } from "@/lib/validations/email";
import { WelcomeBackModalConfig } from "./config/welcomeBackModalConfig";
import { Badge } from "../badge";
import { PromoCode } from "./types";
import { OnlineOrder } from "@athena/webapp";
import { ProductSkuCard } from "@/components/ProductCard";
import { Link } from "@tanstack/react-router";

interface LeaveAReviewModalFormProps {
  onClose: () => void;
  onSuccess?: () => void;
  orderToReview: OnlineOrder;
  config: WelcomeBackModalConfig;
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
              <img
                alt={`${itemToReview?.productName} image`}
                className="aspect-square w-24 h-24 md-w-40 md-h-40 object-cover rounded"
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
            <Button
              type="submit"
              className="w-full md:w-[60%] font-semibold py-2 sm:py-3 rounded"
              style={{ backgroundColor: "#ff6f91" }}
            >
              {config.ctaText}
            </Button>
          </Link>
        </div>
      </div>

      <button
        onClick={onClose}
        className="mt-4 text-white hover:underline cursor-pointer text-sm"
      >
        No thanks
      </button>
    </div>
  );
};
