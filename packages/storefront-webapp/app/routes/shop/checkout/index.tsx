import { createFileRoute } from "@tanstack/react-router";
import {
  CheckoutProvider,
  useCheckout,
} from "@/components/checkout/CheckoutProvider";
import { CustomerDetailsForm } from "@/components/checkout/CustomerDetails";
import { DeliveryDetailsForm } from "@/components/checkout/DeliveryDetails";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { BillingDetailsForm } from "@/components/checkout/BillingDetails";
import BagSummary from "@/components/checkout/BagSummary";
import { DeliverySection } from "@/components/checkout/DeliverySection";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckedState } from "@radix-ui/react-checkbox";
import { useState } from "react";
import { Separator } from "@/components/ui/separator";
import { ArrowRight } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

export const Route = createFileRoute("/shop/checkout/")({
  component: () => <CheckoutWrapper />,
});

const Payment = () => {
  const { canPlaceOrder, actionsState, updateActionsState, checkoutState } =
    useCheckout();

  const [didAcceptStoreTerms, setDidAcceptStoreTerms] = useState(false);
  const [didAcceptCommsTerms, setDidAcceptCommsTerms] = useState(false);

  const onSubmit = async () => {
    const canProceedToPayment = canPlaceOrder();

    console.log(checkoutState);

    if (canProceedToPayment) {
      console.log("redirecting to payment...");
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

  // TODO: make this readable!
  const showPaymentHeader =
    (checkoutState.deliveryMethod === "pickup" &&
      !actionsState.isEditingDeliveryDetails) || // Pickup always shows payment section
    (checkoutState.customerDetails &&
      !actionsState.isEditingCustomerDetails &&
      checkoutState.deliveryDetails &&
      !actionsState.isEditingDeliveryDetails);

  if (!showPaymentHeader) {
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
    (checkoutState.didEnterDeliveryDetails ||
      checkoutState.didSelectPickupLocation) &&
    !actionsState.isEditingBillingDetails;

  console.log(checkoutState);

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

        {showPayment && (
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

      {showPayment && (
        <Button
          onClick={onSubmit}
          className="w-full"
          disabled={!didAcceptTerms}
        >
          Continue to payment
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      )}
    </motion.div>
  );
};

const Checkout = () => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 w-full min-h-screen">
      {/* Left Panel */}
      <AnimatePresence>
        <motion.div
          key={"left"}
          initial={{ opacity: 0, x: -4 }}
          animate={{
            opacity: 1,
            x: 0,
            transition: { duration: 0.2, ease: "easeOut" },
          }}
          className="grid order-2 pb-16 lg:order-1 lg:col-span-6 px-6 lg:pl-16"
        >
          <div className="py-8 space-y-12">
            <p className="text-lg">Checkout</p>
            <div className="space-y-32">
              <div className="lg:pr-24">
                <CustomerDetailsForm />
              </div>

              <div className="lg:pr-24 space-y-32">
                <DeliverySection />

                <Payment />
              </div>
            </div>
          </div>
        </motion.div>

        {/* <div className="order-1 lg:order-2 lg:col-span-6 bg-[#F6F6F6]" /> */}

        {/* Right Panel */}
        <motion.div
          key={"right"}
          initial={{ opacity: 0, x: 8 }}
          animate={{
            opacity: 1,
            x: 0,
            transition: { ease: "easeOut" },
          }}
          className="relative order-1 lg:order-2 lg:col-span-6 bg-[#F6F6F6]"
        >
          <div className="sticky top-0 pt-32 pb-24 flex items-start justify-center min-h-screen flex-grow">
            <BagSummary />
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

const CheckoutWrapper = () => {
  return (
    <CheckoutProvider>
      <Checkout />
    </CheckoutProvider>
  );
};
