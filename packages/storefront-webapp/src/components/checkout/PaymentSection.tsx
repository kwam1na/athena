import { useState } from "react";
import { getCheckoutActionErrorMessage } from "@/api/checkoutSession";
import {
  CheckoutOrderSubmission,
  webOrderSchema,
} from "./schemas/webOrderSchema";
import { useCheckout } from "@/hooks/useCheckout";
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
import { CheckoutFormSectionProps } from "./CustomerInfoSection";
import { updateGuest } from "@/api/guest";
import OrderSummary from "./OrderDetails/OrderSummary";
import { PaymentMethodSection } from "./PaymentMethodSection";
import { useStorefrontObservability } from "@/hooks/useStorefrontObservability";
import { createPaymentSubmissionStartedEvent } from "@/lib/storefrontJourneyEvents";
import { emitStorefrontFailure } from "@/lib/storefrontFailureObservability";
import { CheckoutSessionError } from "@/api/checkoutSession";

export const PaymentSection = ({ form }: CheckoutFormSectionProps) => {
  const { activeSession, canPlaceOrder, checkoutState } = useCheckout();
  const { baseContext, track } = useStorefrontObservability();

  const { user } = useStoreContext();

  const { updateCheckoutSession } = useShoppingBag();

  const [isProceedingToPayment, setIsProceedingToPayment] = useState(false);
  const [didAcceptStoreTerms, setDidAcceptStoreTerms] = useState(false);
  const [didAcceptCommsTerms, setDidAcceptCommsTerms] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const reportCheckoutFailure = ({
    step,
    error,
    status = "failed",
    context,
    fallbackCategory,
  }: {
    step: "payment_submission" | "payment_post_processing";
    error: unknown;
    status?: "failed" | "blocked";
    context?: Record<string, unknown>;
    fallbackCategory?: "validation" | "unknown";
  }) => {
    void emitStorefrontFailure({
      route: baseContext.route,
      journey: "checkout",
      step,
      status,
      error,
      fallbackCategory,
      context: {
        checkoutSessionId: activeSession?._id,
        paymentMethod: checkoutState.paymentMethod,
        ...context,
      },
      track,
    }).catch(() => undefined);
  };

  const onSubmit = async () => {
    setErrorMessage("");
    const checkoutAction =
      checkoutState.paymentMethod === "payment_on_delivery"
        ? "create-pod-order"
        : "finalize-payment";

    try {
      const canProceedToPayment = await canPlaceOrder();
      const { data } = webOrderSchema.safeParse(checkoutState);

      if (!canProceedToPayment || !data || !activeSession._id) {
        const blockedReason = !canProceedToPayment
          ? "checkout_validation_failed"
          : "missing_checkout_context";
        const blockedMessage =
          blockedReason === "checkout_validation_failed"
            ? "We couldn't validate your checkout details. Please review your information and try again."
            : "We couldn't finalize your payment. Please try again.";

        reportCheckoutFailure({
          step: "payment_submission",
          status: "blocked",
          error: {
            code: blockedReason,
            message: blockedMessage,
          },
          fallbackCategory: "validation",
        });
        setErrorMessage(blockedMessage);
        return;
      }

      setIsProceedingToPayment(true);

      // Check if this is a payment on delivery order
      if (checkoutState.paymentMethod === "payment_on_delivery") {
        // Handle POD flow - run all operations with allSettled
        const results = await Promise.allSettled([
          processPODCheckoutSession({
            ...data,
            deliveryDetails: data.deliveryDetails ?? null,
            paymentMethod: checkoutState.paymentMethod,
            podPaymentMethod: checkoutState.podPaymentMethod,
          }),
          track(
            createPaymentSubmissionStartedEvent({
              checkoutSessionId: activeSession._id,
              paymentMethod: checkoutState.paymentMethod,
              podPaymentMethod: checkoutState.podPaymentMethod,
            }),
          ),
          user ? updateUserInformation() : updateUserInformation("guest"),
        ]);
        // Check the critical operation (order processing) result
        const podResult = results[0];
        if (podResult.status === "fulfilled") {
          const podResponse = podResult.value;
          if (podResponse?.success === true) {
            // Redirect to POD confirmation page
            window.open("/shop/checkout/pod-confirmation", "_self");
          } else {
            setErrorMessage(
              typeof podResponse?.message === "string"
                ? podResponse.message
                : "Failed to create payment on delivery order",
            );
          }
        } else {
          setErrorMessage("Failed to create payment on delivery order");
        }
        const operations = ["analytics_submission", "customer_profile_update"];
        results.slice(1).forEach((result, index) => {
          if (result.status === "rejected") {
            reportCheckoutFailure({
              step: "payment_post_processing",
              error: result.reason,
              context: {
                operation: operations[index],
              },
            });
          }
        });
      } else {
        // Original online payment flow - run all operations with allSettled
        const results = await Promise.allSettled([
          processCheckoutSession({
            ...data,
            deliveryDetails: data.deliveryDetails ?? null,
          }),
          track(
            createPaymentSubmissionStartedEvent({
              checkoutSessionId: activeSession._id,
              paymentMethod: checkoutState.paymentMethod,
            }),
          ),
          user ? updateUserInformation() : updateUserInformation("guest"),
        ]);

        // Check the critical operation (payment processing) result
        const paymentResult = results[0];
        if (paymentResult.status === "fulfilled") {
          const paymentResponse = paymentResult.value;
          if (typeof paymentResponse?.authorization_url === "string") {
            window.open(paymentResponse.authorization_url, "_self");
          } else if (paymentResponse?.success !== true) {
            setErrorMessage(
              typeof paymentResponse?.message === "string"
                ? paymentResponse.message
                : "Failed to finalize payment",
            );
          } else {
            throw new Error("No authorization URL received");
          }
        } else {
          setErrorMessage("Failed to finalize payment");
        }
        const operations = ["analytics_submission", "customer_profile_update"];
        results.slice(1).forEach((result, index) => {
          if (result.status === "rejected") {
            reportCheckoutFailure({
              step: "payment_post_processing",
              error: result.reason,
              context: {
                operation: operations[index],
              },
            });
          }
        });
      }
    } catch (error) {
      if (!(error instanceof CheckoutSessionError)) {
        reportCheckoutFailure({
          step: "payment_submission",
          error,
        });
      }
      setErrorMessage(getCheckoutActionErrorMessage(error, checkoutAction));
    } finally {
      setIsProceedingToPayment(false);
    }
  };

  const processCheckoutSession = async (orderData: CheckoutOrderSubmission) => {
    return await updateCheckoutSession({
      action: "finalize-payment",
      sessionId: activeSession._id,
      customerEmail: checkoutState.customerDetails?.email || "",
      orderDetails: orderData,
    });
  };

  const processPODCheckoutSession = async (
    orderData: CheckoutOrderSubmission,
  ) => {
    return await updateCheckoutSession({
      action: "create-pod-order",
      sessionId: activeSession._id,
      customerEmail: checkoutState.customerDetails?.email || "",
      orderDetails: orderData,
    });
  };

  const updateUserInformation = async (type: "user" | "guest" = "user") => {
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
      if (type === "user") {
        await updateUser({
          data: updateData,
        });
      } else {
        await updateGuest({
          data: updateData,
        });
      }
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
    checked: CheckedState,
  ) => {
    if (option == "store-terms") {
      setDidAcceptStoreTerms(checked as boolean);
    } else {
      setDidAcceptCommsTerms(checked as boolean);
    }
  };

  const didAcceptTerms = didAcceptStoreTerms && didAcceptCommsTerms;

  const showProceedSection = true;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.4 } }}
      className="w-full flex flex-col space-y-12"
    >
      <div className="space-y-12">
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
            <div className="block lg:hidden">
              <OrderSummary />
            </div>

            <Separator />

            {/* Payment Method Selection */}
            <PaymentMethodSection />

            <div className="space-y-8">
              <div className="w-full xl:w-auto flex items-center gap-4">
                <Checkbox
                  checked={didAcceptStoreTerms}
                  onCheckedChange={(e) => handleAcceptedTerms("store-terms", e)}
                  className="h-4 w-4 text-primary border-gray-300"
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
                  className="h-4 w-4 text-primary border-gray-300"
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
            {checkoutState.paymentMethod === "payment_on_delivery"
              ? "Place Order (Pay on delivery)"
              : "Proceed to Payment"}
            <ArrowRight className="w-4 h-4 ml-2 -me-1 ms-2 transition-transform group-hover:translate-x-0.5" />
          </LoadingButton>
        </motion.div>
      )}
    </motion.div>
  );
};
