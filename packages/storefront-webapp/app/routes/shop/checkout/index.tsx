import { GhostButton } from "@/components/ui/ghost-button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ALL_COUNTRIES } from "@/lib/countries";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import placeholder from "@/assets/placeholder.png";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ProductSku } from "@athena/webapp-2";
import { getProductName } from "@/lib/productUtils";
import { useStoreContext } from "@/contexts/StoreContext";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import {
  CheckoutProvider,
  useCheckout,
} from "@/components/checkout/CheckoutProvider";
import { CustomerDetailsForm } from "@/components/checkout/CustomerDetails";
import { DeliveryDetailsForm } from "@/components/checkout/DeliveryDetails";
import { CountrySelect } from "@/components/ui/country-select";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { BillingDetailsForm } from "@/components/checkout/BillingDetails";

export function StoreSelector() {
  const { updateState } = useCheckout();

  useEffect(() => {
    updateState({ deliveryFee: null, deliveryOption: null });
  }, []);

  return (
    <RadioGroup value="default" defaultValue="comfortable">
      <div className="flex items-center space-x-4">
        <RadioGroupItem value="default" id="r1" />
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
    if (value == "intl") {
      updateState({ deliveryFee: 800, deliveryOption: "intl" });
    } else if (value == "within-accra") {
      updateState({ deliveryFee: 30, deliveryOption: "within-accra" });
    } else {
      updateState({ deliveryFee: 70, deliveryOption: "outside-accra" });
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
      updateState({ deliveryFee: null, deliveryOption: null });
    }

    previousCountryRef.current = currentCountry; // Update ref to track current country
  }, [checkoutState.country, updateState]);

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
            <div className="flex w-[50%] justify-between">
              <p>Delivery within Accra</p>
              <p className="text-muted-foreground">GHS 30</p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <RadioGroupItem value="outside-accra" id="r2" />
            <div className="flex w-[50%] justify-between">
              <p>Delivery outside Accra</p>
              <p className="text-muted-foreground">GHS 70</p>
            </div>
          </div>
        </>
      )}

      {!isOrderWithGhana && (
        <div className="flex items-center space-x-4">
          <RadioGroupItem value="intl" id="r2" />
          <div className="flex w-[50%] justify-between">
            <p>Express shipping</p>
            <p className="text-muted-foreground">GHS 800</p>
          </div>
        </div>
      )}
    </RadioGroup>
  );
}

export const Route = createFileRoute("/shop/checkout/")({
  component: () => <Checkout />,
});

const Delivery = () => {
  const { checkoutState, updateState } = useCheckout();

  const isDelivery = checkoutState.deliveryMethod == "delivery";
  const isPickup = checkoutState.deliveryMethod == "pickup";

  const onCountrySelect = (country: string) => {
    updateState({ country });
  };

  return (
    <div className="space-y-8">
      <p>Delivery / Pickup</p>

      <div className="space-y-12">
        <div className="flex gap-4 w-[40%]">
          <GhostButton
            onClick={() => {
              updateState({ deliveryMethod: "delivery" });
            }}
            selected={isDelivery}
            className="w-[50%]"
          >
            Delivery
          </GhostButton>
          <GhostButton
            onClick={() => {
              updateState({ deliveryMethod: "pickup" });
            }}
            selected={isPickup}
            className="w-[50%]"
          >
            Store pickup
          </GhostButton>
        </div>

        {isDelivery && (
          <>
            <CountrySelect
              defaultValue={checkoutState.country || undefined}
              value={checkoutState.country || undefined}
              onSelect={onCountrySelect}
            />

            <div className="pr-24">
              <Separator />
            </div>

            <DeliveryOptionsSelector />
          </>
        )}

        {isPickup && <StoreSelector />}
      </div>
    </div>
  );
};

function SummaryItem({
  item,
  formatter,
}: {
  item: ProductSku;
  formatter: Intl.NumberFormat;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-4">
        <div className="h-12 w-12 rounded-lg overflow-hidden">
          <img
            src={item.productImage || placeholder}
            alt={item.productName || "product image"}
            className="aspect-square object-cover rounded-lg"
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm">{getProductName(item)}</p>
          <p className="text-sm text-muted-foreground">
            {formatter.format(item.price * item.quantity)}
          </p>
        </div>
      </div>
      <p className="text-muted-foreground">{`x${item.quantity}`}</p>
    </div>
  );
}

function Summary() {
  const { formatter } = useStoreContext();
  const { bag, bagSubtotal } = useShoppingBag();
  const { checkoutState } = useCheckout();

  const total = checkoutState.deliveryFee + bagSubtotal;

  return (
    <div className="py-6 bg-white shadow-sm w-[30vw] space-y-12">
      {/* Order Summary */}
      <div className="flex items-center px-6 w-full">
        <p>Order summary</p>
        <div className="ml-auto">
          <Link to="/shop/bag">
            <Button variant={"clear"}>
              <p>Update</p>
            </Button>
          </Link>
        </div>
      </div>

      {/* Items */}
      <div className="px-8 space-y-8 my-4 w-full">
        {bag?.items.map((item: ProductSku, index: number) => (
          <SummaryItem formatter={formatter} item={item} key={index} />
        ))}
      </div>

      {/* Promo Code */}
      <div className="px-8 space-y-2">
        <p className="text-sm font-medium">Promo code</p>
        <div>
          <Input type="text" placeholder="Enter promo code" />
        </div>
      </div>

      <Separator className="bg-[#F6F6F6]" />

      {/* Summary */}
      <div className="px-8 space-y-8 pt-4 mt-4">
        <div className="flex justify-between">
          <p className="text-sm">Subtotal</p>
          <p className="text-sm">{formatter.format(bagSubtotal)}</p>
        </div>
        {checkoutState.deliveryFee && (
          <div className="flex justify-between">
            <p className="text-sm">Shipping</p>
            <p className="text-sm">
              {formatter.format(checkoutState.deliveryFee)}
            </p>
          </div>
        )}
        <div className="flex justify-between font-semibold">
          <p className="text-lg">Total</p>
          <p className="text-lg">{formatter.format(total)}</p>
        </div>
      </div>
    </div>
  );
}

const Checkout = () => {
  return (
    <CheckoutProvider>
      <div className="grid grid-cols-12 w-full min-h-screen">
        {/* Left Panel */}
        <div className="grid col-span-6 pl-16">
          <div className="py-8 space-y-12">
            <p className="text-lg">Checkout</p>
            <div className="space-y-32">
              <div className="pr-24">
                <CustomerDetailsForm />
              </div>

              <div className="pr-24 space-y-32">
                <Delivery />
                <DeliveryDetailsForm />
                <BillingDetailsForm />
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div className="relative col-span-6 bg-[#F6F6F6]">
          <div className="sticky top-0 pt-32 pb-40 flex items-start justify-center min-h-screen flex-grow">
            <Summary />
          </div>
        </div>
      </div>
    </CheckoutProvider>
  );
};
