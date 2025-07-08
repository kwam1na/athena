import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { submitOffer, type OfferRequest } from "@/api/offers";
import { validateEmail } from "@/lib/validations/email";
import { WelcomeBackModalConfig } from "./config/welcomeBackModalConfig";
import { Badge } from "../badge";

interface WelcomeBackModalFormProps {
  onClose: () => void;
  onSuccess: () => void;
  promoCodeId: string;
  config: WelcomeBackModalConfig;
}

export const WelcomeBackModalForm: React.FC<WelcomeBackModalFormProps> = ({
  onClose,
  onSuccess,
  promoCodeId,
  config,
}) => {
  const [email, setEmail] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

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
      promoCodeId,
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
    <div className="flex flex-col items-center gap-8">
      <div className="space-y-8">
        <div className="flex flex-col items-center gap-8">
          <Badge className="border-none text-accent2" variant="outline">
            Exclusive offer!
          </Badge>
          <h2 className="text-6xl font-light">{config.title}</h2>
          {config.subtitle && (
            <h3 className="text-5xl font-light">{config.subtitle}</h3>
          )}
        </div>
        <p className="mb-6 text-sm sm:text-base">{config.body}</p>
      </div>

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
            // Remove onBlur validation to prevent validation when clicking elsewhere on modal
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
        className="mt-4 text-white hover:underline cursor-pointer text-sm"
        disabled={mutation.isPending}
      >
        No thanks
      </button>
    </div>
  );
};
