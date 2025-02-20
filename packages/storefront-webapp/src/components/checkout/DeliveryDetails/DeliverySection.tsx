import { Address, useCheckout } from "../CheckoutProvider";
import { capitalizeWords } from "@/lib/utils";
import { motion } from "framer-motion";
import { ALL_COUNTRIES } from "@/lib/countries";
import { GHANA_REGIONS } from "@/lib/ghanaRegions";
import {
  DeliveryOptionsSelector,
  StoreSelector,
} from "./DeliveryOptionsSelector";
import { Textarea } from "@/components/ui/textarea";
import { PickupOptions } from "./PickupOptions";
import { accraNeighborhoods } from "@/lib/ghana";

export const DeliveryDetails = ({ address }: { address: Address }) => {
  const country = ALL_COUNTRIES.find((c) => c.code == address.country)?.name;

  const region = GHANA_REGIONS.find((r) => r.code == address.region)?.name;

  const neighborhood = accraNeighborhoods.find(
    (n) => n.value == address?.neighborhood
  )?.label;

  const isUSOrder = address.country === "US";

  const isGHOrder = address.country === "GH";

  const isROWOrder = !isUSOrder && !isGHOrder;

  return (
    <div className="space-y-2 text-sm">
      {isUSOrder && (
        <p>{`${address.address}, ${address.city}, ${address.state}, ${address.zip}`}</p>
      )}

      {isROWOrder && <p>{`${address.address}, ${address.city}`}</p>}

      {isGHOrder && (
        <p>{`${address?.houseNumber || ""} ${address?.street}, ${neighborhood}, ${region}`}</p>
      )}

      <p>{country}</p>
    </div>
  );
};

const EnteredDeliveryDetails = () => {
  const { checkoutState } = useCheckout();

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
        {checkoutState.isDeliveryOrder && checkoutState.deliveryDetails && (
          <div className="space-y-4 text-sm">
            <p>{`${capitalizeWords(checkoutState.deliveryMethod || "")} address:`}</p>
            <DeliveryDetails address={checkoutState.deliveryDetails} />
          </div>
        )}

        {checkoutState.isPickupOrder && <StoreSelector />}
      </motion.div>
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

export const DeliveryInstructions = () => {
  return (
    <div className="space-y-8">
      <Textarea placeholder="Add delivery instructions" />
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
          {/* {(didFillOutSection || actionsState.isEditingDeliveryDetails) && (
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
          )} */}
        </div>
      </div>

      {/* Display entered delivery details when not editing */}
      {/* {showEnteredDetails ? (
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
      )} */}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{
          opacity: 1,
          transition: { ease: "easeOut", duration: 0.4 },
        }}
        className="space-y-16"
      >
        <PickupOptions />

        {isPickup && <StoreSelector />}

        {/* <DeliveryDetailsForm /> */}

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
            {/* <DeliveryDetailsForm /> */}
          </motion.div>
        )}

        {isPickup && <StoreSelector />}
      </motion.div>
    </motion.div>
  );
};
