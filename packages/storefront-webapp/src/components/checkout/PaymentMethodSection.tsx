import { useEffect } from "react";
import { useCheckout } from "@/hooks/useCheckout";
import { PaymentMethodType } from "./types";
import { motion } from "framer-motion";
import { CreditCard, Smartphone } from "lucide-react";
import { GhostButton } from "../ui/ghost-button";

export const PaymentMethodSection = () => {
  const { checkoutState, updateState } = useCheckout();

  useEffect(() => {
    if (!checkoutState.paymentMethod) {
      updateState({
        paymentMethod: "online_payment",
        podPaymentMethod: null,
      });
    }
  }, []);

  const handlePaymentMethodChange = (method: PaymentMethodType) => {
    updateState({
      paymentMethod: method,
      podPaymentMethod:
        method === "payment_on_delivery"
          ? checkoutState.podPaymentMethod || "cash"
          : undefined,
    });
  };

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
        </div>
      </div>
    </motion.div>
  );
};
