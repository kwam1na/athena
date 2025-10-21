import { useEffect } from "react";
import { useCheckout } from "@/hooks/useCheckout";
import { PaymentMethodType, PODPaymentMethod } from "./types";

import { motion } from "framer-motion";
import { CreditCard, Smartphone, Banknote, Info } from "lucide-react";
import { GhostButton } from "../ui/ghost-button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const PaymentMethodSection = () => {
  const { checkoutState, updateState } = useCheckout();

  // Ensure checkout state has a default payment method on mount
  useEffect(() => {
    if (!checkoutState.paymentMethod) {
      updateState({
        paymentMethod: "online_payment",
        podPaymentMethod: null,
      });
    }
  }, []);

  const handlePaymentMethodChange = (method: PaymentMethodType) => {
    console.log("PaymentMethodSection - Changing payment method to:", method);
    updateState({
      paymentMethod: method,
      podPaymentMethod:
        method === "payment_on_delivery"
          ? checkoutState.podPaymentMethod || "cash"
          : undefined,
    });
  };

  const handlePODMethodChange = (method: PODPaymentMethod) => {
    updateState({
      podPaymentMethod: method,
    });
  };

  const isDeliveryOrder = checkoutState.deliveryMethod === "delivery";

  const onlineTagline = checkoutState.isGhanaOrder
    ? "Secure mobile money or credit/debit card"
    : "Secure credit/debit card or mobile money";

  const onlineIcon = checkoutState.isGhanaOrder ? (
    <Smartphone className="w-5 h-5" />
  ) : (
    <CreditCard className="w-5 h-5" />
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.4 } }}
      className="space-y-6 sm:space-y-8"
    >
      <div className="space-y-4 sm:space-y-6">
        <p>Payment Method</p>

        <div className="space-y-4 sm:space-y-4">
          <GhostButton
            type="button"
            onClick={() => handlePaymentMethodChange("online_payment")}
            selected={checkoutState.paymentMethod === "online_payment"}
            className="w-full h-auto p-5 sm:p-6 text-left"
          >
            <div className="flex items-start space-x-4 w-full">
              <div className="flex-shrink-0 w-5 h-5 flex items-center justify-start">
                {onlineIcon}
              </div>
              <div className="flex-1 min-w-0 space-y-2 text-left">
                <p className="font-medium text-sm sm:text-base leading-tight text-left">
                  Pay online
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed text-left text-wrap">
                  {onlineTagline}
                </p>
              </div>
            </div>
          </GhostButton>

          {/* {isDeliveryOrder &&
            checkoutState.deliveryOption === "within-accra" && (
              <GhostButton
                type="button"
                onClick={() => handlePaymentMethodChange("payment_on_delivery")}
                selected={checkoutState.paymentMethod === "payment_on_delivery"}
                className="w-full h-auto p-5 sm:p-6 text-left"
              >
                <div className="flex items-start space-x-4 w-full">
                  <div className="flex-shrink-0 w-5 h-5 flex items-center justify-start">
                    <Banknote className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2 text-left">
                    <p className="font-medium text-sm sm:text-base leading-tight text-left">
                      Pay on delivery
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed text-left text-wrap">
                      Pay with cash or mobile money when your order arrives
                    </p>
                  </div>
                </div>
              </GhostButton>
            )} */}
        </div>

        {/* POD Payment Method Selection */}
        {/* {checkoutState.paymentMethod === "payment_on_delivery" &&
          checkoutState.deliveryOption === "within-accra" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-4 sm:space-y-6 mt-8 sm:mt-6 pt-8"
            >
              <p className="font-medium text-muted-foreground">
                How would you like to pay on delivery?
              </p>

              <div className="space-y-3">
                <GhostButton
                  type="button"
                  onClick={() => handlePODMethodChange("cash")}
                  selected={checkoutState.podPaymentMethod === "cash"}
                  className="w-full h-auto p-4 sm:p-5 text-left"
                >
                  <div className="flex items-start space-x-3 w-full">
                    <div className="flex-shrink-0 w-4 h-4 flex items-center justify-start">
                      <Banknote className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1.5 text-left">
                      <p className="text-sm sm:text-base font-medium leading-tight text-left">
                        Cash
                      </p>
                      <p className="text-sm text-muted-foreground leading-relaxed text-left">
                        Pay with cash to the delivery courier
                      </p>
                    </div>
                  </div>
                </GhostButton>

                <GhostButton
                  type="button"
                  onClick={() => handlePODMethodChange("mobile_money")}
                  selected={checkoutState.podPaymentMethod === "mobile_money"}
                  className="w-full h-auto p-4 sm:p-5 text-left"
                >
                  <div className="flex items-start space-x-3 w-full">
                    <div className="flex-shrink-0 w-4 h-4 flex items-center justify-start">
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1.5 text-left">
                      <p className="text-sm sm:text-base font-medium leading-tight text-left">
                        Mobile Money
                      </p>
                      <p className="text-sm text-muted-foreground leading-relaxed text-left">
                        Pay via MTN, Telecel, or AirtelTigo mobile money
                      </p>
                    </div>
                  </div>
                </GhostButton>
              </div>

              <Alert className="p-4 sm:p-5 mt-4 bg-accent5/40 border border-accent5/40">
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 w-4 h-4 flex items-center justify-start">
                    <Info className="h-3.5 w-3.5" />
                  </div>
                  <AlertDescription className="text-xs sm:text-sm leading-relaxed flex-1 text-left">
                    {checkoutState.podPaymentMethod === "cash"
                      ? "Please have the exact amount ready when the delivery arrives."
                      : "Our delivery courier will help you complete the mobile money payment when your order arrives."}
                  </AlertDescription>
                </div>
              </Alert>
            </motion.div>
          )} */}

        {/* Pickup Order Notice */}
        {/* {!isDeliveryOrder && (
          <Alert className="p-4 sm:p-5 w-fit">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 w-4 h-4 flex items-center justify-start">
                <Info className="h-4 w-4" />
              </div>
              <AlertDescription className="text-xs sm:text-sm leading-relaxed flex-1 text-left">
                Payment on delivery is only available for delivery orders.
              </AlertDescription>
            </div>
          </Alert>
        )} */}
      </div>
    </motion.div>
  );
};
