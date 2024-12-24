import { GhostButton } from "../../ui/ghost-button";
import { Address, useCheckout } from "../CheckoutProvider";
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

// export const DeliveryDetails = () => {
//   const { checkoutState } = useCheckout();

//   const country = ALL_COUNTRIES.find(
//     (c) => c.code == checkoutState.deliveryDetails?.country
//   )?.name;

//   const region = GHANA_REGIONS.find(
//     (r) => r.code == checkoutState.deliveryDetails?.region
//   )?.name;

//   return (
//     <div className="space-y-2">
//       <p>{checkoutState.deliveryDetails?.address}</p>
//       {checkoutState.isUSOrder && (
//         <p>{`${checkoutState.deliveryDetails?.city}, ${checkoutState.deliveryDetails?.state}, ${checkoutState.deliveryDetails?.zip}`}</p>
//       )}
//       {!checkoutState.isUSOrder && (
//         <p>{`${checkoutState.deliveryDetails?.city}`}</p>
//       )}
//       {region && <p>{`${region}`}</p>}
//       <p>{country}</p>
//     </div>
//   );
// };

export const DeliveryDetails = ({ address }: { address: Address }) => {
  const country = ALL_COUNTRIES.find((c) => c.code == address.country)?.name;

  const region = GHANA_REGIONS.find((r) => r.code == address.region)?.name;

  const isUSOrder = address.country === "US";

  return (
    <div className="space-y-2 text-sm">
      {/* <p>{address.address}</p> */}
      {isUSOrder && (
        <p>{`${address.address}, ${address.city}, ${address.state}, ${address.zip}`}</p>
      )}
      {!isUSOrder && <p>{`${address.address}, ${address.city}`}</p>}
      {region && <p>{`${region}`}</p>}
      <p>{country}</p>
    </div>
  );
};

const EnteredDeliveryDetails = () => {
  const { checkoutState } = useCheckout();
  const { formatter } = useStoreContext();

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
        {checkoutState.isDeliveryOrder && checkoutState.deliveryDetails && (
          <div className="space-y-4 text-sm">
            <p>{`${capitalizeWords(checkoutState.deliveryMethod || "")} address:`}</p>
            <DeliveryDetails address={checkoutState.deliveryDetails} />

            {/* <p className="pt-8 text-muted-foreground">{shippingText}</p> */}
          </div>
        )}

        {checkoutState.isPickupOrder && <StoreSelector />}
      </motion.div>
    </div>
  );
};

const PickupOptions = () => {
  const { checkoutState, updateState } = useCheckout();

  const { formatter } = useStoreContext();

  const isDelivery = checkoutState.deliveryMethod === "delivery";
  const isPickup = checkoutState.deliveryMethod === "pickup";

  const didEnterCustomerDetails = Boolean(checkoutState.customerDetails);

  return (
    <div className="flex gap-4 w-full">
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
        className="h-[64px] w-[50%]"
      >
        <div className="w-full space-y-2">
          <div className="flex items-center">
            <Truck className="w-4 h-4 mr-2" />
            Delivery
          </div>

          {Boolean(checkoutState.deliveryFee) && (
            <p className="text-xs text-muted-foreground text-start w-full">
              {formatter.format(checkoutState.deliveryFee || 0)}
            </p>
          )}
        </div>
      </GhostButton>
      <GhostButton
        onClick={() => {
          updateState({ deliveryMethod: "pickup" });
        }}
        disabled={!didEnterCustomerDetails}
        selected={isPickup}
        className="h-[64px] w-[50%] justify-start"
      >
        <div className="w-full space-y-2">
          <div className="flex items-center">
            <Store className="w-4 h-4 mr-2" />
            Store pickup
          </div>

          {Boolean(checkoutState.isPickupOrder) && (
            <p className="text-xs text-muted-foreground text-start w-full">
              Free
            </p>
          )}
        </div>
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
