import React from "react";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useCheckout } from "./CheckoutProvider";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import { CountrySelect } from "../ui/country-select";
import { Checkbox } from "../ui/checkbox";
import { CheckedState } from "@radix-ui/react-checkbox";

const schema = z.object({
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().min(2, "Invalid state"),
  zip: z.coerce.number().min(5),
});

export const BillingDetailsForm = () => {
  const { checkoutState, updateState } = useCheckout();
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: checkoutState.billingDetails || {
      address: "",
      city: "",
      zip: undefined,
    },
  });

  const onSubmit = (data: z.infer<typeof schema>) => {
    updateState({ deliveryDetails: data });
  };

  const onCountrySelect = (country: string) => {
    updateState({ billingCountry: country });
  };

  const toggleSameAsDelivery = (checked: CheckedState) => {
    updateState({ billingAddressSameAsDelivery: checked as boolean });
  };

  const hasNotSelectedDeliveryMethod = !Boolean(
    checkoutState.deliveryMethod && checkoutState.deliveryOption
  );

  const hasNotEnteredDeliveryDetails = !Boolean(checkoutState.deliveryDetails);

  if (
    checkoutState.deliveryMethod !== "delivery" ||
    !checkoutState.deliveryOption
  )
    return null;

  const isOrderToUS = checkoutState.billingCountry == "US";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="w-full space-y-6">
        <div className="flex flex-col gap-8">
          <p>Billing details</p>

          <div className="w-full xl:w-auto pb-8 flex items-center gap-4">
            <Checkbox
              disabled={hasNotEnteredDeliveryDetails}
              checked={checkoutState.billingAddressSameAsDelivery}
              onCheckedChange={(e) => toggleSameAsDelivery(e)}
              className="h-4 w-4 text-primary border-gray-300 focus:ring-primary"
            />
            <label htmlFor="same-as-delivery" className="text-sm">
              Same as delivery address
            </label>
          </div>

          {!checkoutState.billingAddressSameAsDelivery && (
            <>
              <div className="flex flex-col xl:flex-row gap-16">
                <div className="w-full xl:w-auto">
                  <CountrySelect
                    onSelect={onCountrySelect}
                    value={checkoutState.billingCountry || undefined}
                  />
                </div>

                <div className="w-full xl:w-[70%]">
                  <FormField
                    disabled={hasNotSelectedDeliveryMethod}
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-muted-foreground text-xs">
                          Address
                        </FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="flex flex-col xl:flex-row gap-4">
                <div className={`${isOrderToUS ? "w-full" : "w-auto"}`}>
                  <FormField
                    disabled={hasNotSelectedDeliveryMethod}
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-muted-foreground text-xs">
                          City
                        </FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {isOrderToUS && (
                  <>
                    <div className="w-full">
                      <FormField
                        disabled={hasNotSelectedDeliveryMethod}
                        control={form.control}
                        name="state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-muted-foreground text-xs">
                              State
                            </FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="w-full">
                      <FormField
                        disabled={hasNotSelectedDeliveryMethod}
                        control={form.control}
                        name="zip"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-muted-foreground text-xs">
                              Zip Code
                            </FormLabel>
                            <FormControl>
                              <Input type="number" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </form>
    </Form>
  );
};
