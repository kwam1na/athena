import { useCheckout } from "@/hooks/useCheckout";
import { Address } from "../types";
import {
  DeliveryOptionsSelector,
  StoreSelector,
} from "./DeliveryOptionsSelector";
import { CheckoutFormSectionProps } from "../CustomerInfoSection";
import { CountryFields } from "../DeliveryDetailsSection";
import { formatDeliveryAddress } from "../utils";

export const DeliveryDetails = ({ address }: { address: Address }) => {
  const { addressLine, country } = formatDeliveryAddress(address);

  return (
    <div className="space-y-2 text-sm">
      <p>{addressLine}</p>
      <p>{country}</p>
    </div>
  );
};

export const DeliveryOptions = ({ form }: CheckoutFormSectionProps) => {
  const { checkoutState } = useCheckout();
  return (
    <div className="space-y-8">
      <p className="text-xs text-muted-foreground">Delivery options</p>
      <CountryFields form={form} />
      {checkoutState.deliveryDetails?.country && <DeliveryOptionsSelector />}
    </div>
  );
};
