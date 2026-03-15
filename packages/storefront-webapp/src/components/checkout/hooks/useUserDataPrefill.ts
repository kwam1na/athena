import { useEffect } from "react";
import { isFeeWaived } from "@/lib/feeUtils";
import { CheckoutState, DeliveryOption } from "../types";

export function useUserDataPrefill(
  user: any,
  store: any,
  updateState: (updates: Partial<CheckoutState>) => void
): void {
  const { waiveDeliveryFees } = store?.config || {};

  useEffect(() => {
    if (user) {
      const { shippingAddress, billingAddress } = user;

      if (!shippingAddress || !billingAddress) return;

      const { address, city, zip, state, country, region } =
        shippingAddress || {};

      const {
        address: billingAddr,
        city: billingCity,
        zip: billingZip,
        state: billingState,
        country: billingCountry,
        region: billingRegion,
      } = billingAddress || {};

      const { email, firstName, lastName, phoneNumber } = user;

      const isGhanaAddress = country == "GH";
      const isGreaterAccraAddress = region == "GA";

      let deliveryOption: DeliveryOption = "intl";
      const shouldWaiveIntlFee = isFeeWaived(waiveDeliveryFees, "intl");
      let deliveryFee = shouldWaiveIntlFee
        ? 0
        : store?.config?.deliveryFees?.international || 800;

      if (isGhanaAddress) {
        deliveryOption = isGreaterAccraAddress
          ? "within-accra"
          : "outside-accra";

        const shouldWaiveRegionFee =
          typeof waiveDeliveryFees === "boolean"
            ? waiveDeliveryFees
            : isGreaterAccraAddress
              ? waiveDeliveryFees?.withinAccra ||
                waiveDeliveryFees?.all ||
                false
              : waiveDeliveryFees?.otherRegions ||
                waiveDeliveryFees?.all ||
                false;

        deliveryFee = shouldWaiveRegionFee
          ? 0
          : isGreaterAccraAddress
            ? 30
            : 70;
      }

      updateState({
        customerDetails: {
          email,
          firstName: firstName || "",
          lastName: lastName || "",
          phoneNumber: phoneNumber || "",
        },
        deliveryMethod: shippingAddress ? "delivery" : null,
        deliveryOption,
        deliveryFee,
        deliveryDetails: {
          address,
          city,
          zip,
          state,
          country,
          region,
        },
        billingDetails: {
          address: billingAddr,
          city: billingCity,
          zip: billingZip,
          state: billingState,
          country: billingCountry,
          region: billingRegion,
        },
      });
    }
  }, [user]);
}
