import { useEffect, useRef } from "react";
import { CountrySelect } from "../ui/country-select";
import { GhostButton } from "../ui/ghost-button";
import { Separator } from "../ui/separator";
import { defaultRegion, useCheckout } from "./CheckoutProvider";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { z } from "zod";
import { DeliveryDetailsForm } from "./DeliveryDetails";
import { Bike, Store, StoreIcon, Truck } from "lucide-react";
import { Button } from "../ui/button";
import { capitalizeWords } from "@/lib/utils";
import { motion } from "framer-motion";
import { useStoreContext } from "@/contexts/StoreContext";

export const deliveryMethodSchema = z.object({
  deliveryMethod: z
    .enum(["pickup", "delivery"])
    .refine((value) => !!value, { message: "Delivery method is required" }),
  deliveryOption: z
    .enum(["within-accra", "outside-accra", "intl"])
    .refine((value) => !!value, { message: "Delivery option is required" }),
});

export const deliveryOptionSchema = z.object({
  deliveryOption: z
    .enum(["within-accra", "outside-accra", "intl"])
    .refine((value) => !!value, { message: "Delivery option is required" }),
});

export function StoreSelector() {
  const { updateState, updateActionsState, checkoutState } = useCheckout();

  useEffect(() => {
    updateState({
      deliveryFee: null,
      deliveryOption: null,
      billingDetails: null,
      billingCountry: defaultRegion,
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
      <div className="flex items-center space-x-4">
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

  const previousCountryRef = useRef(checkoutState.country);

  const handleChange = (value: string) => {
    const base = { pickupLocation: null };

    if (value == "intl") {
      updateState({
        ...base,
        deliveryFee: 800,
        deliveryOption: "intl",
        region_gh: null,
      });
    } else if (value == "within-accra") {
      updateState({
        ...base,
        deliveryFee: 30,
        deliveryOption: "within-accra",
        region_gh: "GA",
      });
    } else {
      updateState({
        ...base,
        deliveryFee: 70,
        deliveryOption: "outside-accra",
        region_gh: null,
      });
    }
  };

  const isOrderWithGhana = checkoutState.country == "GH";

  useEffect(() => {
    const previousCountry = previousCountryRef.current;
    const currentCountry = checkoutState.country;

    if (
      (currentCountry === "GH" && previousCountry !== "GH") || // Non-GH to GH
      (currentCountry !== "GH" && previousCountry === "GH") // GH to Non-GH
    ) {
      updateState({
        deliveryFee: null,
        deliveryOption: null,
      });
    }

    if (currentCountry !== previousCountry) {
      updateState({
        billingDetails: null,
        deliveryDetails: null,
      });
    }

    previousCountryRef.current = currentCountry; // Update ref to track current country
  }, [checkoutState.country, updateState]);

  useEffect(() => {
    // automatically select the within-accra delivery option if the accra option is selected
    if (
      checkoutState.deliveryOption == "outside-accra" &&
      checkoutState.region_gh == "GA"
    ) {
      updateState({ deliveryOption: "within-accra", deliveryFee: 30 });
    }
  }, [checkoutState.region_gh]);

  return (
    <RadioGroup
      className="space-y-4"
      value={checkoutState.deliveryOption || undefined}
      onValueChange={handleChange}
    >
      {isOrderWithGhana && (
        <>
          <div className="flex items-center space-x-4">
            <RadioGroupItem value="within-accra" id="r1" />
            <div className="flex w-full lg:w-[50%] justify-between">
              <p>Delivery within Accra</p>
              <p className="text-muted-foreground">GHS 30</p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <RadioGroupItem value="outside-accra" id="r2" />
            <div className="flex w-full lg:w-[50%] justify-between">
              <p>Delivery outside Accra</p>
              <p className="text-muted-foreground">GHS 70</p>
            </div>
          </div>
        </>
      )}

      {!isOrderWithGhana && (
        <div className="flex items-center space-x-4">
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

const EnteredDeliveryDetails = () => {
  const { checkoutState } = useCheckout();
  const { formatter } = useStoreContext();

  if (!checkoutState.deliveryDetails || !checkoutState.deliveryMethod)
    return null;

  const isUSAddress = checkoutState.country == "US";

  const isDelivery = checkoutState.deliveryMethod == "delivery";

  const isPickup = checkoutState.deliveryMethod == "pickup";

  const isLocalOrder = checkoutState.country == "GH";

  const shippingText = isLocalOrder
    ? `Flat rate delivery at ${formatter.format(checkoutState.deliveryFee || 0)}`
    : `Express international shipping at ${formatter.format(checkoutState.deliveryFee || 0)}`;

  return (
    <div className="space-y-16">
      <div className="pointer-events-none">
        <PickupOptions />
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { ease: "easeOut" } }}
        exit={{ opacity: 0 }}
      >
        {isDelivery && (
          <div className="space-y-4 text-sm">
            <p>{`${capitalizeWords(checkoutState.deliveryMethod)} address:`}</p>
            <div className="space-y-2">
              <p>{checkoutState.deliveryDetails.address}</p>
              {isUSAddress && (
                <p>{`${checkoutState.deliveryDetails.city}, ${checkoutState.deliveryDetails.state}, ${checkoutState.deliveryDetails.zip}`}</p>
              )}
              {!isUSAddress && <p>{`${checkoutState.deliveryDetails.city}`}</p>}
              {checkoutState.region_gh_name && (
                <p>{`${checkoutState.region_gh_name}`}</p>
              )}
              <p>{checkoutState.country}</p>
            </div>

            <p className="pt-8 text-muted-foreground">{shippingText}</p>
          </div>
        )}

        {isPickup && <StoreSelector />}
      </motion.div>
    </div>
  );
};

const PickupOptions = () => {
  const { checkoutState, updateState, updateActionsState, actionsState } =
    useCheckout();

  const isDelivery = checkoutState.deliveryMethod === "delivery";
  const isPickup = checkoutState.deliveryMethod === "pickup";

  const didEnterCustomerDetails = Boolean(checkoutState.customerDetails);

  return (
    <div className="flex gap-4 w-full lg:w-[40%]">
      <GhostButton
        onClick={() => {
          updateState({
            deliveryMethod: "delivery",
            deliveryFee: null,
            pickupLocation: null,
            region_gh: null,
            region_gh_name: null,
          });
        }}
        disabled={!didEnterCustomerDetails}
        selected={isDelivery}
      >
        <Truck className="w-4 h-4 mr-2" />
        Delivery
      </GhostButton>
      <GhostButton
        onClick={() => {
          updateState({ deliveryMethod: "pickup" });
        }}
        disabled={!didEnterCustomerDetails}
        selected={isPickup}
      >
        <Store className="w-4 h-4 mr-2" />
        Store pickup
      </GhostButton>
    </div>
  );
};

export const DeliverySection = () => {
  const { checkoutState, updateState, updateActionsState, actionsState } =
    useCheckout();

  const isDelivery = checkoutState.deliveryMethod === "delivery";
  const isPickup = checkoutState.deliveryMethod === "pickup";

  const didEnterCustomerDetails = Boolean(checkoutState.customerDetails);

  const onCountrySelect = (country: string) => {
    updateState({ country });
  };

  const showEditButton =
    !actionsState.isEditingDeliveryDetails &&
    Boolean(checkoutState.deliveryDetails);

  const isEditingAndHasNotSelectedPickupLocation =
    actionsState.isEditingDeliveryDetails &&
    checkoutState.deliveryMethod == "pickup" &&
    !checkoutState.pickupLocation;

  const isEditingAndHasNotSelectedShippingOption =
    actionsState.isEditingDeliveryDetails &&
    checkoutState.deliveryMethod == "delivery" &&
    !checkoutState.deliveryOption;

  const shouldDisableEditButton =
    isEditingAndHasNotSelectedPickupLocation ||
    isEditingAndHasNotSelectedShippingOption;

  return (
    <motion.div
      key={"delivery-wrapper"}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { ease: "easeOut", duration: 0.4 } }}
      className="space-y-8"
    >
      <div className="space-y-24">
        <div className="flex items-center">
          <p>Delivery / Pickup</p>
          {Boolean(checkoutState.deliveryDetails) && (
            <Button
              onClick={() => {
                updateActionsState({
                  isEditingDeliveryDetails:
                    !actionsState.isEditingDeliveryDetails,
                });
              }}
              disabled={shouldDisableEditButton}
              variant={"clear"}
              type="button"
              className="ml-auto"
            >
              <p className="underline">
                {actionsState.isEditingDeliveryDetails
                  ? "Cancel editing"
                  : "Edit"}
              </p>
            </Button>
          )}
        </div>
      </div>

      {/* Display entered delivery details when not editing */}
      {showEditButton && <EnteredDeliveryDetails />}

      {!showEditButton && didEnterCustomerDetails && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut", duration: 0.4 },
          }}
          className="space-y-16"
        >
          <PickupOptions />

          {isDelivery && (
            <motion.div
              key={"delivery-input"}
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                transition: { ease: "easeOut", duration: 0.4 },
              }}
              className="space-y-16"
            >
              <CountrySelect
                value={checkoutState.country || undefined}
                onSelect={onCountrySelect}
              />

              <div className="space-y-8">
                <p className="text-xs text-muted-foreground">
                  Delivery options
                </p>
                <DeliveryOptionsSelector />
              </div>
            </motion.div>
          )}

          {isPickup && <StoreSelector />}

          <DeliveryDetailsForm />
        </motion.div>
      )}
    </motion.div>
  );
};
