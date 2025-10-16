import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { capitalizeFirstLetter, cn } from "@/lib/utils";
import { submitOffer, type OfferRequest } from "@/api/offers";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import { validateEmail } from "@/lib/validations/email";
import { WelcomeBackModalConfig } from "./config/welcomeBackModalConfig";
import { useStoreContext } from "@/contexts/StoreContext";
import { PromoCode } from "./types";

interface UpsellModalFormProps {
  onClose: () => void;
  onSuccess: () => void;
  promoCode: PromoCode;
  config: WelcomeBackModalConfig;
  upsell: any;
}

export const UpsellModalForm: React.FC<UpsellModalFormProps> = ({
  onClose,
  onSuccess,
  promoCode,
  config,
  upsell,
}) => {
  const [email, setEmail] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const { formatter } = useStoreContext();

  // Load promo code list to verify active status for the provided promo
  const promoCodeQueries = usePromoCodesQueries();
  const { data: promoCodes } = useQuery(promoCodeQueries.getAll());
  const isPromoActive = promoCodes?.find(
    (pc: any) => pc._id === promoCode.promoCodeId
  )?.active;

  // Setup the mutation using React Query
  const mutation = useMutation({
    mutationFn: (data: OfferRequest) => submitOffer(data),
    onSuccess: () => {
      onSuccess();
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Client-side validation
    if (!validateEmail(email, setValidationError)) {
      return;
    }

    // Submit email to the offers endpoint
    mutation.mutate({
      email,
      promoCodeId: promoCode.promoCodeId,
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    // Clear validation error as user types
    if (validationError) {
      setValidationError(null);
    }
  };

  return (
    <div className="flex flex-col items-center gap-12 pb-12">
      <div className="flex flex-col items-center gap-12">
        <h2 className="text-6xl lg:text-7xl font-light text-white leading-relaxed">
          Get <span className="text-accent2">{promoCode.displayText}</span> off{" "}
          <br />
          this {capitalizeFirstLetter(upsell.productName)}!
        </h2>

        <div className="flex items-center gap-8">
          <div className="space-y-2">
            <p className="text-xs sm:text-sm text-accent2/60">Orig. price</p>
            <p className="text-3xl line-through text-white font-medium">
              {formatter.format(upsell.price)}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs sm:text-sm text-accent2/60">You pay</p>
            <p className="text-3xl text-white font-medium">
              {formatter.format(
                isPromoActive
                  ? upsell.price - (upsell.price * promoCode.value) / 100
                  : upsell.price
              )}
            </p>
          </div>
        </div>
        {config.subtitle && (
          <h3 className="text-5xl font-light text-white">{config.subtitle}</h3>
        )}
      </div>

      <div className="space-y-8">
        <p className="mb-6 text-sm sm:text-base text-white">{config.body}</p>
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div>
            <Input
              type="email"
              value={email}
              onChange={handleInputChange}
              placeholder="Email address"
              required
              className={cn(
                "bg-white/10 backdrop-blur-sm border-none text-white placeholder:text-white/70 h-10 sm:h-12",
                (validationError || mutation.error) && "border-red-500 border-2"
              )}
              disabled={mutation.isPending}
            />
            {validationError && (
              <p className="text-red-300 text-sm mt-1">{validationError}</p>
            )}
            {!validationError && mutation.error && (
              <p className="text-red-300 text-sm mt-1">
                {mutation.error instanceof Error
                  ? mutation.error.message
                  : "Failed to submit email"}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full font-semibold py-2 sm:py-3 rounded"
            style={{ backgroundColor: "#ff6f91" }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Sending..." : config.ctaText}
          </Button>
        </form>

        <button
          onClick={onClose}
          className="mt-4 hover:underline cursor-pointer text-sm text-white"
          disabled={mutation.isPending}
        >
          No thanks
        </button>
      </div>
    </div>
  );
};
