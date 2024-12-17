import { CheckoutProvider } from "./CheckoutProvider";
import { AnimatePresence, motion } from "framer-motion";
import { CustomerDetailsForm } from "./CustomerDetails";
import { DeliverySection } from "./DeliveryDetails/DeliverySection";
import BagSummary from "./BagSummary";
import { PaymentSection } from "./PaymentSection";

const MainComponent = () => {
  if (typeof window !== undefined) {
    console.log(window?.serverData);
  }
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

                <PaymentSection />
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

export const Checkout = () => {
  return (
    <CheckoutProvider>
      <MainComponent />
    </CheckoutProvider>
  );
};
