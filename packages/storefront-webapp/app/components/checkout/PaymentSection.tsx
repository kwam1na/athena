import { useState } from "react";
import { useCheckout } from "./CheckoutProvider";
import { CheckedState } from "@radix-ui/react-checkbox";
import { Button } from "../ui/button";
import { BillingDetailsForm } from "./BillingDetails";
import { Separator } from "../ui/separator";
import { Checkbox } from "../ui/checkbox";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { LoadingButton } from "../ui/loading-button";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useShoppingBag } from "@/hooks/useShoppingBag";

export const PaymentSection = () => {
  const {
    activeSession,
    canPlaceOrder,
    actionsState,
    updateActionsState,
    checkoutState,
  } = useCheckout();

  const { updateCheckoutSession } = useShoppingBag();

  const [didAcceptStoreTerms, setDidAcceptStoreTerms] = useState(false);
  const [didAcceptCommsTerms, setDidAcceptCommsTerms] = useState(false);

  const navigate = useNavigate();

  const onSubmit = async () => {
    console.log(activeSession);
    const canProceedToPayment = canPlaceOrder();

    // console.log(checkoutState);

    if (canProceedToPayment && activeSession._id) {
      await updateCheckoutSession({
        isFinalizingPayment: true,
        sessionId: activeSession._id,
      });

      console.log("redirecting to payment...");

      navigate({ to: "/shop/checkout/complete" });
    } else {
      console.log("somethings not right...");
    }
  };

  const handleAcceptedTerms = (
    option: "store-terms" | "comms-terms",
    checked: CheckedState
  ) => {
    if (option == "store-terms") {
      setDidAcceptStoreTerms(checked as boolean);
    } else {
      setDidAcceptCommsTerms(checked as boolean);
    }
  };

  const didAcceptTerms = didAcceptStoreTerms && didAcceptCommsTerms;

  const isEditingCustomerDetails =
    Boolean(checkoutState.customerDetails) &&
    actionsState.isEditingCustomerDetails;

  const isEditingDeliveryDetails =
    (Boolean(checkoutState.deliveryDetails) || checkoutState.isPickupOrder) &&
    actionsState.isEditingDeliveryDetails;

  const onlyShowHeader = isEditingCustomerDetails || isEditingDeliveryDetails;

  if (onlyShowHeader) {
    return (
      <motion.p
        initial={{ opacity: 0 }}
        animate={{
          opacity: 1,
          transition: { duration: 0.4 },
        }}
      >
        Payment
      </motion.p>
    );
  }

  const showPayment =
    checkoutState.didEnterDeliveryDetails ||
    checkoutState.didSelectPickupLocation;

  const showProceedSection =
    checkoutState.didEnterBillingDetails &&
    !actionsState.isEditingBillingDetails;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.4 } }}
      className="w-full flex flex-col space-y-12"
    >
      <div className="space-y-12">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.3, ease: "easeOut" },
          }}
          exit={{
            opacity: 0,
            transition: { duration: 0.3, ease: "easeOut" },
          }}
          className="flex items-center"
        >
          <p>Payment</p>
          {Boolean(
            !checkoutState.billingDetails?.billingAddressSameAsDelivery &&
              checkoutState.billingDetails?.address
          ) && (
            <Button
              onClick={() => {
                updateActionsState({
                  isEditingBillingDetails:
                    !actionsState.isEditingBillingDetails,
                });
              }}
              variant={"clear"}
              type="button"
              className="ml-auto"
            >
              <p className="underline">
                {actionsState.isEditingBillingDetails
                  ? "Cancel editing"
                  : "Edit"}
              </p>
            </Button>
          )}
        </motion.div>

        {showPayment && <BillingDetailsForm />}

        {showProceedSection && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              transition: { duration: 0.4, ease: "easeOut" },
            }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
            className="space-y-12"
          >
            <Separator />

            <div className="space-y-8">
              <div className="w-full xl:w-auto flex items-center gap-4">
                <Checkbox
                  checked={didAcceptStoreTerms}
                  onCheckedChange={(e) => handleAcceptedTerms("store-terms", e)}
                  className="h-4 w-4 text-primary border-gray-300 focus:ring-primary"
                />
                <label htmlFor="terms" className="text-sm">
                  I agree to the return and refund policy
                </label>
              </div>
              <div className="w-full xl:w-auto flex items-center gap-4">
                <Checkbox
                  checked={didAcceptCommsTerms}
                  onCheckedChange={(e) => handleAcceptedTerms("comms-terms", e)}
                  className="h-4 w-4 text-primary border-gray-300 focus:ring-primary"
                />
                <label htmlFor="terms" className="text-sm">
                  I agree to receive communications via email and/or SMS to any
                  emails and phone numbers added above
                </label>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {checkoutState.failedFinalValidation && (
        <p className="text-xs text-destructive">
          Please provide all the required information
        </p>
      )}

      {showProceedSection && (
        <LoadingButton
          isLoading={false}
          onClick={onSubmit}
          className="w-full"
          disabled={!didAcceptTerms}
        >
          Continue to payment
          <ArrowRight className="w-4 h-4 ml-2" />
        </LoadingButton>
      )}
    </motion.div>
  );
};
