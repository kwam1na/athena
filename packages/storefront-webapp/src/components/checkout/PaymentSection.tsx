import { useState } from "react";
import { useCheckout, webOrderSchema } from "./CheckoutProvider";
import { CheckedState } from "@radix-ui/react-checkbox";
import { Separator } from "../ui/separator";
import { Checkbox } from "../ui/checkbox";
import { ArrowRight, InfoIcon } from "lucide-react";
import { motion } from "framer-motion";
import { LoadingButton } from "../ui/loading-button";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { Link } from "@tanstack/react-router";
import { updateUser } from "@/api/storeFrontUser";
import { useStoreContext } from "@/contexts/StoreContext";
import { BillingDetailsSection } from "./BillingDetailsSection";
import { CheckoutFormSectionProps } from "./CustomerInfoSection";
import { postAnalytics } from "@/api/analytics";

export const PaymentSection = ({ form }: CheckoutFormSectionProps) => {
  const { activeSession, canPlaceOrder, checkoutState } = useCheckout();

  const { user } = useStoreContext();

  const { updateCheckoutSession, bagSubtotal } = useShoppingBag();

  const [isProceedingToPayment, setIsProceedingToPayment] = useState(false);
  const [didAcceptStoreTerms, setDidAcceptStoreTerms] = useState(false);
  const [didAcceptCommsTerms, setDidAcceptCommsTerms] = useState(false);
  const [errorFinalizingPayment, setErrorFinalizingPayment] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");

  const onSubmit = async () => {
    setErrorFinalizingPayment(false);
    setErrorMessage("");

    try {
      const canProceedToPayment = await canPlaceOrder();
      const { data } = webOrderSchema.safeParse(checkoutState);

      const total = bagSubtotal * 100;

      if (!canProceedToPayment || !data || !activeSession._id) {
        throw new Error("Invalid order state");
      }

      setIsProceedingToPayment(true);

      // Process checkout and track analytics in parallel
      const [paymentResponse] = await Promise.all([
        processCheckoutSession(
          {
            ...data,
            deliveryDetails: data.deliveryDetails ?? null,
          },
          total
        ),
        postAnalytics({
          action: "finalize_checkout",
          data: {
            checkoutSessionId: activeSession._id,
          },
        }),
      ]);

      if (user)
        // Update user information if needed
        await updateUserInformation();

      // Handle payment redirect
      if (paymentResponse?.authorization_url) {
        window.open(paymentResponse.authorization_url, "_self");
      } else if (!paymentResponse?.success) {
        setErrorMessage(
          paymentResponse?.message || "Failed to finalize payment"
        );
      } else {
        throw new Error("No authorization URL received");
      }
    } catch (error) {
      console.error("Payment error:", error);
      setErrorFinalizingPayment(true);
    } finally {
      setIsProceedingToPayment(false);
    }
  };

  const processCheckoutSession = async (orderData: any, total: number) => {
    return await updateCheckoutSession({
      isFinalizingPayment: true,
      sessionId: activeSession._id,
      customerEmail: checkoutState.customerDetails?.email || "",
      amount: total,
      orderDetails: orderData,
    });
  };

  const updateUserInformation = async () => {
    const { customerDetails, deliveryDetails, billingDetails } = checkoutState;

    const updateData = {
      ...(!user?.email &&
        customerDetails?.email && { email: customerDetails.email }),
      ...(!user?.phoneNumber &&
        customerDetails?.phoneNumber && {
          phoneNumber: customerDetails.phoneNumber,
        }),
      ...(!user?.firstName &&
        customerDetails?.firstName && { firstName: customerDetails.firstName }),
      ...(!user?.lastName &&
        customerDetails?.lastName && { lastName: customerDetails.lastName }),
      ...(!user?.shippingAddress &&
        deliveryDetails && {
          shippingAddress: createAddressObject(deliveryDetails),
        }),
      ...(!user?.billingAddress &&
        billingDetails && {
          billingAddress: createAddressObject(billingDetails),
        }),
    };

    if (Object.keys(updateData).length > 0) {
      await updateUser({
        data: updateData,
      });
    }
  };

  const createAddressObject = (details: any) => ({
    address: details.address,
    city: details.city,
    zip: details.zip,
    state: details.state,
    country: details.country,
    region: details.region,
  });

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

  const showPayment = true;

  const showProceedSection = true;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.4 } }}
      className="w-full flex flex-col space-y-12"
    >
      <div className="space-y-12">
        {/* <motion.div
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
        </motion.div> */}

        {/* {showPayment && <BillingDetailsForm />} */}
        {/* {showPayment && <BillingDetailsSection form={form} />} */}

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
                <label
                  htmlFor="terms"
                  className="text-sm flex flex-wrap items-center gap-1"
                >
                  <div>I agree to the</div>
                  <Link
                    to="/policies/delivery-returns-exchanges"
                    className="underline"
                    target="_blank"
                  >
                    exchange, return and refund policies.
                  </Link>
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
                  emails and phone numbers added above.
                </label>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {checkoutState.failedFinalValidation && (
        <motion.p
          initial={{ opacity: 0, y: -2 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.3, ease: "easeInOut" },
          }}
          className="text-sm text-red-600 font-medium"
        >
          Please provide all the required information
        </motion.p>
      )}

      {errorFinalizingPayment && (
        <motion.p
          initial={{ opacity: 0, y: -2 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.3, ease: "easeInOut" },
          }}
          className="text-sm text-red-600 font-medium"
        >
          There was an error finalizing your payment. Please try again.
        </motion.p>
      )}

      {errorMessage && (
        <motion.p
          initial={{ opacity: 0, y: -2 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.3, ease: "easeInOut" },
          }}
          className="flex items-center text-sm font-medium"
        >
          <InfoIcon className="w-4 h-4 mr-2" />
          {errorMessage}
        </motion.p>
      )}

      {showProceedSection && (
        <motion.div layout>
          <LoadingButton
            isLoading={isProceedingToPayment}
            onClick={onSubmit}
            className="w-full group"
            disabled={!didAcceptTerms}
          >
            Proceed to payment
            <ArrowRight className="w-4 h-4 ml-2 -me-1 ms-2 transition-transform group-hover:translate-x-0.5" />
          </LoadingButton>
        </motion.div>
      )}
    </motion.div>
  );
};
