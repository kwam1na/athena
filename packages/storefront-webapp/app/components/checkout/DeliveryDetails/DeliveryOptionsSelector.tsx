import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useEffect, useRef } from "react";
import { Address, useCheckout } from "../CheckoutProvider";

export function StoreSelector() {
  const { updateState, updateActionsState, checkoutState } = useCheckout();

  useEffect(() => {
    updateState({
      deliveryFee: null,
      deliveryOption: null,
      billingDetails: null,
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
          <p>Wigclub Hair Studio</p>
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

  const previousCountryRef = useRef(
    checkoutState.deliveryDetails?.country || undefined
  );

  const handleChange = (value: string) => {
    const base = { pickupLocation: null };

    if (value == "intl") {
      updateState({
        ...base,
        deliveryFee: 800,
        deliveryOption: "intl",
      });
    } else if (value == "within-accra") {
      updateState({
        ...base,
        deliveryFee: 30,
        deliveryOption: "within-accra",
        deliveryDetails: {
          ...checkoutState.deliveryDetails,
          region: "GA",
        } as Address,
      });
    } else {
      updateState({
        ...base,
        deliveryFee: 70,
        deliveryOption: "outside-accra",
        deliveryDetails: {
          ...checkoutState.deliveryDetails,
          region: undefined,
        } as Address,
      });
    }
  };

  useEffect(() => {
    const previousCountry = previousCountryRef.current;
    const currentCountry = checkoutState.deliveryDetails?.country;

    if (
      (currentCountry === "GH" && previousCountry !== "GH") || // Non-GH to GH
      (currentCountry !== "GH" && previousCountry === "GH") // GH to Non-GH
    ) {
      updateState({
        deliveryFee: null,
        deliveryOption: null,
      });
    }

    previousCountryRef.current = currentCountry; // Update ref to track current country
  }, [checkoutState.deliveryDetails, updateState]);

  useEffect(() => {
    // automatically select the within-accra delivery option if the accra option is selected
    if (
      checkoutState.deliveryOption == "outside-accra" &&
      checkoutState.deliveryDetails?.region == "GA"
    ) {
      updateState({ deliveryOption: "within-accra", deliveryFee: 30 });
    }
  }, [checkoutState.deliveryDetails?.region]);

  return (
    <RadioGroup
      className="space-y-4"
      value={checkoutState.deliveryOption || undefined}
      onValueChange={handleChange}
    >
      {checkoutState.isGhanaOrder && (
        <>
          <div className="flex items-center space-x-4 text-sm">
            <RadioGroupItem value="within-accra" id="r1" />
            <div className="flex w-full lg:w-[50%] justify-between">
              <p>Delivery within Accra</p>
              <p className="text-muted-foreground">GHS 30</p>
            </div>
          </div>

          <div className="flex items-center space-x-4 text-sm">
            <RadioGroupItem value="outside-accra" id="r2" />
            <div className="flex w-full lg:w-[50%] justify-between">
              <p>Delivery outside Accra</p>
              <p className="text-muted-foreground">GHS 70</p>
            </div>
          </div>
        </>
      )}

      {!checkoutState.isGhanaOrder && (
        <div className="flex items-center space-x-4 text-sm">
          <RadioGroupItem value="intl" id="r2" />
          <div className="flex w-full lg:w-[50%] justify-between">
            <p>Express shipping</p>
            <p className="text-muted-foreground">GHS 800</p>
          </div>
        </div>
      )}
    </RadioGroup>
  );
}
