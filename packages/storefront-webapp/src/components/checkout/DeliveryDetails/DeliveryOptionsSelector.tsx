import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useEffect, useRef } from "react";
import { useCheckout } from "@/hooks/useCheckout";
import { Address } from "../types";
import { useStoreContext } from "@/contexts/StoreContext";
import { isFeeWaived } from "@/lib/feeUtils";
import { getStoreConfigV2 } from "@/lib/storeConfig";
import {
  calculateDeliveryFee,
  DEFAULT_INTERNATIONAL_FEE,
  DEFAULT_OTHER_REGIONS_FEE,
  DEFAULT_WITHIN_ACCRA_FEE,
} from "../deliveryFees";

export function StoreSelector() {
  const { updateState, updateActionsState, checkoutState } = useCheckout();

  useEffect(() => {
    updateState({
      deliveryFee: null,
      deliveryOption: null,
    });
  }, []);

  return (
    <RadioGroup
      value={checkoutState.pickupLocation || undefined}
      onValueChange={(e) => {
        updateState({ pickupLocation: e });
        updateActionsState({ isEditingDeliveryDetails: false });
      }}
      defaultValue="comfortable"
    >
      <div className="flex items-center space-x-4 text-sm">
        <RadioGroupItem value="wigclub-hair-studio" id="r1" />
        <div className="space-y-2">
          <p className="font-medium">Wigclub Hair Studio</p>
          <p className="text-sm text-muted-foreground">
            2 Jungle Ave, East Legon, Accra
          </p>
        </div>
      </div>
    </RadioGroup>
  );
}

export function DeliveryOptionsSelector() {
  const { checkoutState, updateState } = useCheckout();

  const { store, formatter } = useStoreContext();
  const storeConfig = getStoreConfigV2(store);

  const { deliveryFees, waiveDeliveryFees } = storeConfig.commerce;

  const international = deliveryFees?.international || DEFAULT_INTERNATIONAL_FEE;
  const withinAccra = DEFAULT_WITHIN_ACCRA_FEE;
  const otherRegions = DEFAULT_OTHER_REGIONS_FEE;

  // Replace the waived fee checks with the shared utility function
  const shouldWaiveWithinAccraFee = isFeeWaived(
    waiveDeliveryFees,
    "within-accra"
  );
  const shouldWaiveOtherRegionsFee = isFeeWaived(
    waiveDeliveryFees,
    "outside-accra"
  );
  const shouldWaiveIntlFee = isFeeWaived(waiveDeliveryFees, "intl");

  const previousCountryRef = useRef(
    checkoutState.deliveryDetails?.country || undefined
  );

  const handleChange = (value: string) => {
    const base = { pickupLocation: null };

    if (value == "intl") {
      const { deliveryFee } = calculateDeliveryFee({
        deliveryMethod: "delivery",
        country: checkoutState.deliveryDetails?.country || "",
        region: null,
        waiveDeliveryFees,
        deliveryFees,
      });

      updateState({
        ...base,
        deliveryFee,
        deliveryOption: "intl",
      });
    } else if (value == "within-accra") {
      const { deliveryFee } = calculateDeliveryFee({
        deliveryMethod: "delivery",
        country: "GH",
        region: "GA",
        waiveDeliveryFees,
        deliveryFees,
      });

      updateState({
        ...base,
        deliveryFee,
        deliveryOption: "within-accra",
        deliveryDetails: {
          ...checkoutState.deliveryDetails,
          region: "GA",
        } as Address,
      });
    } else {
      const { deliveryFee } = calculateDeliveryFee({
        deliveryMethod: "delivery",
        country: "GH",
        region: null,
        waiveDeliveryFees,
        deliveryFees,
      });

      updateState({
        ...base,
        deliveryFee,
        deliveryOption: "outside-accra",
        deliveryDetails: {
          ...checkoutState.deliveryDetails,
          region: undefined,
        } as Address,
        paymentMethod: "online_payment",
        podPaymentMethod: null,
      });
    }
  };

  useEffect(() => {
    const previousCountry = previousCountryRef.current;
    const currentCountry = checkoutState.deliveryDetails?.country;

    if (previousCountry !== currentCountry) {
      previousCountryRef.current = currentCountry;

      if (currentCountry === "GH" && previousCountry !== "GH") {
        if (
          checkoutState.deliveryOption !== null ||
          checkoutState.deliveryFee !== null
        ) {
          updateState({
            deliveryFee: null,
            deliveryOption: null,
          });
        }
      } else if (currentCountry !== "GH" && currentCountry) {
        // Always force update for non-Ghana (international) destinations
        // to ensure the fee waiving settings are applied correctly
        const { deliveryFee } = calculateDeliveryFee({
          deliveryMethod: "delivery",
          country: currentCountry,
          region: null,
          waiveDeliveryFees,
          deliveryFees,
        });

        updateState({
          deliveryFee,
          deliveryOption: "intl",
        });
      }
    }
  }, [
    checkoutState.deliveryDetails,
    updateState,
    shouldWaiveIntlFee,
    deliveryFees,
  ]);

  useEffect(() => {
    // automatically select the within-accra delivery option if the accra option is selected
    if (
      checkoutState.deliveryOption == "outside-accra" &&
      checkoutState.deliveryDetails?.region == "GA"
    ) {
      const { deliveryFee } = calculateDeliveryFee({
        deliveryMethod: "delivery",
        country: "GH",
        region: "GA",
        waiveDeliveryFees,
        deliveryFees,
      });

      updateState({
        deliveryOption: "within-accra",
        deliveryFee,
      });
    }
  }, [checkoutState.deliveryDetails?.region]);

  return (
    <RadioGroup
      className="space-y-4 flex justify-center items-center w-full"
      value={checkoutState.deliveryOption || undefined}
      onValueChange={handleChange}
    >
      {checkoutState.isGhanaOrder && (
        <div className="w-full space-y-4">
          <div className="flex items-center space-x-4 text-sm">
            <RadioGroupItem value="within-accra" id="r1" />
            <div className="flex w-full lg:w-[50%] justify-between">
              <p>Delivery within Greater Accra</p>

              {shouldWaiveWithinAccraFee && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <p className="text-start line-through">
                    {formatter.format(withinAccra)}
                  </p>
                  <p className="text-start">Free</p>
                </div>
              )}

              {!shouldWaiveWithinAccraFee && (
                <p className="text-muted-foreground">
                  {formatter.format(withinAccra)}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-4 text-sm">
            <RadioGroupItem value="outside-accra" id="r2" />
            <div className="flex w-full lg:w-[50%] justify-between">
              <p>Delivery to other regions</p>

              {shouldWaiveOtherRegionsFee && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <p className="text-start line-through">
                    {formatter.format(otherRegions)}
                  </p>
                  <p className="text-start">Free</p>
                </div>
              )}

              {!shouldWaiveOtherRegionsFee && (
                <p className="text-muted-foreground">
                  {formatter.format(otherRegions)}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {!checkoutState.isGhanaOrder &&
        checkoutState.deliveryDetails?.country && (
          <div className="flex items-center space-x-4 text-sm w-full">
            <RadioGroupItem value="intl" id="r2" />
            <div className="flex w-full lg:w-[50%] justify-between">
              <p>Express shipping</p>

              {shouldWaiveIntlFee && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <p className="text-start line-through">
                    {formatter.format(international)}
                  </p>
                  <p className="text-start">Free</p>
                </div>
              )}

              {!shouldWaiveIntlFee && (
                <p className="text-muted-foreground">
                  {formatter.format(international)}
                </p>
              )}
            </div>
          </div>
        )}
    </RadioGroup>
  );
}
