import { ALL_COUNTRIES } from "@/lib/countries";
import { useCheckout } from "./CheckoutProvider";
import { motion } from "framer-motion";
import { accraNeighborhoods, ghanaRegions } from "@/lib/ghana";

export const EnteredBillingAddressDetails = () => {
  const { checkoutState } = useCheckout();

  if (!checkoutState.billingDetails) return null;

  const country = ALL_COUNTRIES.find(
    (c) => c.code == checkoutState.billingDetails?.country
  )?.name;

  const region = ghanaRegions.find(
    (r) => r.code == checkoutState.billingDetails?.region
  )?.name;

  const neighborhood = accraNeighborhoods.find(
    (n) => n.value == checkoutState.billingDetails?.neighborhood
  )?.label;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { ease: "easeOut" } }}
      exit={{ opacity: 0 }}
      className="space-y-4 text-sm"
    >
      <p>{`Billing address:`}</p>
      <div className="space-y-2">
        <p>{checkoutState.billingDetails.address ?? ""}</p>
        {checkoutState.isUSOrder && (
          <p>{`${checkoutState.billingDetails.city}, ${checkoutState.billingDetails.state}, ${checkoutState.billingDetails.zip}`}</p>
        )}
        {checkoutState.isROWOrder && (
          <p>{`${checkoutState.billingDetails.city ?? ""}`}</p>
        )}

        {checkoutState.isGhanaOrder && (
          <p>{`${checkoutState.billingDetails.houseNumber || ""} ${checkoutState.billingDetails.street}, ${neighborhood}, ${region}`}</p>
        )}
        <p>{country}</p>
      </div>
    </motion.div>
  );
};
