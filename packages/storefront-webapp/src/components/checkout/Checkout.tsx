import { CheckoutProvider } from "./CheckoutProvider";
import { useCheckout } from "@/hooks/useCheckout";
import { AnimatePresence, motion } from "framer-motion";
import BagSummary from "./BagSummary";
import { useEffect } from "react";
import MobileBagSummary from "./MobileBagSummary";
import { CheckoutForm } from "./CheckoutForm";
import { TrustSignals } from "../communication/TrustSignals";
import { useNavigate } from "@tanstack/react-router";

const MainComponent = () => {
  const { activeSession } = useCheckout();
  const navigate = useNavigate();

  useEffect(() => {
    const origin = new URLSearchParams(window.location.search).get("origin");

    if (!activeSession) return;

    const needsVerification =
      activeSession.externalReference &&
      activeSession.hasCompletedPayment &&
      activeSession.placedOrderId &&
      origin === "paystack";

    const isIncomplete =
      activeSession.hasCompletedPayment &&
      activeSession.placedOrderId &&
      !activeSession.hasCompletedCheckoutSession &&
      origin === null;

    if (needsVerification) {
      navigate({
        to: `/shop/checkout/verify?reference=${activeSession.externalReference}`,
      });
    }

    if (isIncomplete) {
      navigate({
        to: `/shop/checkout/${activeSession._id}/incomplete`,
      });
    }
  }, [activeSession]);

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
          className="grid order-2 pb-16 lg:order-1 lg:col-span-6 px-6 lg:px-16"
        >
          <div className="py-8 space-y-12">
            <div className="space-y-4">
              <p>Checkout</p>

              <TrustSignals />
            </div>
            <div className="space-y-32">
              <div className="lg:pr-24">
                <CheckoutForm />
              </div>
            </div>
          </div>
        </motion.div>

        {/* <div className="order-1 lg:order-2 lg:col-span-6 bg-[#F6F6F6]" /> */}

        <motion.div
          key={"mobile-bag-summary"}
          initial={{ opacity: 0, y: -4 }}
          animate={{
            opacity: 1,
            y: 0,
            transition: { duration: 0.2, ease: "easeOut" },
          }}
          className="block md:hidden px-6 bg-accent5 border border-accent2/10"
        >
          <MobileBagSummary />
        </motion.div>

        {/* Right Panel */}
        <motion.div
          key={"right"}
          initial={{ opacity: 0, x: 8 }}
          animate={{
            opacity: 1,
            x: 0,
            transition: { ease: "easeOut" },
          }}
          className="hidden md:block relative order-1 lg:order-2 lg:col-span-6 bg-accent5"
        >
          <div className="sticky top-0 pt-32 pb-24 flex items-start justify-center min-h-screen flex-grow">
            <BagSummary />
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export const Checkout = () => {
  return (
    <CheckoutProvider>
      <MainComponent />
    </CheckoutProvider>
  );
};
