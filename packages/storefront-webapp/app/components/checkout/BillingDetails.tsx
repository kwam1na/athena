import React, { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Address, defaultRegion, useCheckout } from "./CheckoutProvider";
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
import { LoadingButton } from "../ui/loading-button";
import { motion } from "framer-motion";

export const billingDetailsSchema = z.object({
  address: z
    .string()
    .min(1, "Address is required")
    .refine(
      (value) => value.trim().length > 0,
      "Address name cannot be empty or whitespace"
    ),
  city: z
    .string()
    .min(1, "City is required")
    .refine(
      (value) => value.trim().length > 0,
      "City name cannot be empty or whitespace"
    ),
  state: z
    .string()
    .min(2, "Invalid state")
    .refine(
      (value) => value.trim().length > 0,
      "State name cannot be empty or whitespace"
    )
    .optional(),
  zip: z.coerce
    .string()
    .refine(
      (value) => /^\d{5}$/.test(value),
      "Zip code must be a 5-digit number"
    )
    .refine(
      (value) => value.trim().length > 0,
      "Zip name cannot be empty or whitespace"
    )
    .optional(),
});

const billingDetailsWithoutStateAndZipSchema = z.object({
  address: z
    .string()
    .min(1, "Address is required")
    .refine(
      (value) => value.trim().length > 0,
      "Address cannot be empty or whitespace"
    ),
  city: z
    .string()
    .min(1, "City is required")
    .refine(
      (value) => value.trim().length > 0,
      "City cannot be empty or whitespace"
    ),
});

const EnteredBillingAddressDetails = () => {
  const { checkoutState } = useCheckout();

  if (!checkoutState.billingDetails) return null;

  const isUSAddress = checkoutState.billingCountry == "US";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { ease: "easeOut" } }}
      exit={{ opacity: 0 }}
      className="space-y-4 text-sm"
    >
      <p>{`Billing address:`}</p>
      <div className="space-y-2">
        <p>{checkoutState.billingDetails.address}</p>
        {isUSAddress && (
          <p>{`${checkoutState.billingDetails.city}, ${checkoutState.billingDetails.state}, ${checkoutState.billingDetails.zip}`}</p>
        )}
        {!isUSAddress && <p>{`${checkoutState.billingDetails.city}`}</p>}
        <p>{checkoutState.billingCountry}</p>
      </div>
    </motion.div>
  );
};

export const BillingDetailsForm = () => {
  const { checkoutState, actionsState, updateActionsState, updateState } =
    useCheckout();

  const schema =
    checkoutState.billingCountry == "US"
      ? billingDetailsSchema
      : billingDetailsWithoutStateAndZipSchema;

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: checkoutState.billingDetails || {
      address: "",
      state: "",
      city: "",
      zip: "",
    },
  });

  const onSubmit = (data: z.infer<typeof billingDetailsSchema>) => {
    updateState({ billingDetails: data });
    updateActionsState({ isEditingBillingDetails: false });
  };

  const onCountrySelect = (country: string) => {
    updateState({ billingCountry: country, billingDetails: null });
  };

  // const defaultRegion = new Intl.Locale(navigator.language).region || "GH";

  const toggleSameAsDelivery = (checked: CheckedState) => {
    updateState({
      billingCountry: (checked as boolean)
        ? checkoutState.country
        : defaultRegion,
      billingDetails: (checked as boolean)
        ? {
            ...checkoutState.deliveryDetails!,
            billingAddressSameAsDelivery: true,
          }
        : null,
    });

    // if the form is in the edit state and the check box is checked, cancel the edit mode
    if (checked) {
      updateActionsState({ isEditingBillingDetails: false });
    }
  };

  const isOrderToUS = checkoutState.billingCountry == "US";

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="w-full space-y-12"
      >
        <div className="flex flex-col gap-8">
          <p className="text-xs text-muted-foreground">Billing details</p>

          {checkoutState.deliveryMethod == "delivery" && (
            <div className="w-full xl:w-auto pb-8 flex items-center gap-4">
              <Checkbox
                checked={Boolean(
                  checkoutState.billingDetails?.billingAddressSameAsDelivery
                )}
                onCheckedChange={(e) => toggleSameAsDelivery(e)}
                className="h-4 w-4 text-primary border-gray-300 focus:ring-primary"
              />
              <label htmlFor="same-as-delivery" className="text-sm">
                Same as delivery address
              </label>
            </div>
          )}

          {!checkoutState.billingDetails?.billingAddressSameAsDelivery &&
            !actionsState.isEditingBillingDetails && (
              <EnteredBillingAddressDetails />
            )}

          {(!checkoutState.billingDetails ||
            actionsState.isEditingBillingDetails) && (
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
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="flex flex-col xl:flex-row gap-4">
                <div className={`${isOrderToUS ? "w-full" : "w-auto"}`}>
                  <FormField
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
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>

                {isOrderToUS && (
                  <>
                    <div className="w-full">
                      <FormField
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
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="w-full">
                      <FormField
                        control={form.control}
                        name="zip"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-muted-foreground text-xs">
                              Zip Code
                            </FormLabel>
                            <FormControl>
                              <Input {...field} />
                            </FormControl>
                            <FormMessage className="text-xs" />
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

        {(actionsState.isEditingBillingDetails ||
          !checkoutState.billingDetails) && (
          <LoadingButton className="w-[50%]" isLoading={false} type="submit">
            {actionsState.isEditingBillingDetails ? "Save" : "Continue"}
          </LoadingButton>
        )}
      </form>
    </Form>
  );
};
