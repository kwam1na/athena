import { GhostButton } from "../../ui/ghost-button";
import { useCheckout } from "../CheckoutProvider";
import { DeliveryDetailsForm } from "../DeliveryDetails";
import { Store, Truck } from "lucide-react";
import { Button } from "../../ui/button";
import { capitalizeWords } from "@/lib/utils";
import { motion } from "framer-motion";
import { useStoreContext } from "@/contexts/StoreContext";
import { ALL_COUNTRIES } from "@/lib/countries";
import { GHANA_REGIONS } from "@/lib/ghanaRegions";
import {
  DeliveryOptionsSelector,
  StoreSelector,
} from "./DeliveryOptionsSelector";

const EnteredDeliveryDetails = () => {
  const { checkoutState } = useCheckout();
  const { formatter } = useStoreContext();

  const country = ALL_COUNTRIES.find(
    (c) => c.code == checkoutState.deliveryDetails?.country
  )?.name;

  const region = GHANA_REGIONS.find(
    (r) => r.code == checkoutState.deliveryDetails?.region
  )?.name;

  const shippingText = checkoutState.isGhanaOrder
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
        {checkoutState.isDeliveryOrder && (
          <div className="space-y-4 text-sm">
            <p>{`${capitalizeWords(checkoutState.deliveryMethod || "")} address:`}</p>
            <div className="space-y-2">
              <p>{checkoutState.deliveryDetails?.address}</p>
              {checkoutState.isUSOrder && (
                <p>{`${checkoutState.deliveryDetails?.city}, ${checkoutState.deliveryDetails?.state}, ${checkoutState.deliveryDetails?.zip}`}</p>
              )}
              {!checkoutState.isUSOrder && (
                <p>{`${checkoutState.deliveryDetails?.city}`}</p>
              )}
              {region && <p>{`${region}`}</p>}
              <p>{country}</p>
            </div>

            <p className="pt-8 text-muted-foreground">{shippingText}</p>
          </div>
        )}

        {checkoutState.isPickupOrder && <StoreSelector />}
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

export const DeliveryOptions = () => {
  return (
    <div className="space-y-8">
      <p className="text-xs text-muted-foreground">Delivery options</p>
      <DeliveryOptionsSelector />
    </div>
  );
};

export const DeliverySection = () => {
  const { checkoutState, updateActionsState, actionsState } = useCheckout();

  const isDelivery = checkoutState.deliveryMethod === "delivery";

  const isPickup = checkoutState.deliveryMethod === "pickup";

  const didEnterCustomerDetails = Boolean(checkoutState.customerDetails);

  const isEditingAndHasNotSelectedPickupLocation =
    actionsState.isEditingDeliveryDetails &&
    checkoutState.deliveryMethod == "pickup" &&
    !checkoutState.pickupLocation;

  const isEditingAndHasNotSelectedShippingOption =
    actionsState.isEditingDeliveryDetails &&
    checkoutState.deliveryMethod == "delivery" &&
    !checkoutState.deliveryOption;

  const isEditingAndHasNotEnteredAllDetails =
    actionsState.isEditingDeliveryDetails &&
    !checkoutState.didEnterDeliveryDetails &&
    checkoutState.deliveryMethod == "delivery";

  const shouldDisableEditButton =
    isEditingAndHasNotSelectedPickupLocation ||
    isEditingAndHasNotSelectedShippingOption ||
    isEditingAndHasNotEnteredAllDetails;

  const didFillOutSection =
    Boolean(
      checkoutState.didEnterDeliveryDetails && checkoutState.deliveryOption
    ) || checkoutState.didSelectPickupLocation;

  const isInitialEdit =
    didEnterCustomerDetails && !checkoutState.didEnterDeliveryDetails;

  const showInputForm = isInitialEdit || actionsState.isEditingDeliveryDetails;

  const showEnteredDetails =
    didFillOutSection && !actionsState.isEditingDeliveryDetails;

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
          {(didFillOutSection || actionsState.isEditingDeliveryDetails) && (
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
      {showEnteredDetails ? (
        <EnteredDeliveryDetails />
      ) : (
        showInputForm && (
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
                <DeliveryDetailsForm />
              </motion.div>
            )}

            {isPickup && <StoreSelector />}
          </motion.div>
        )
      )}
    </motion.div>
  );
};
