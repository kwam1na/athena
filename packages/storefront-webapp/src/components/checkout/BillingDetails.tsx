import React, { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Address } from "./types";
import { useCheckout } from "@/hooks/useCheckout";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { CheckedState } from "@radix-ui/react-checkbox";
import { LoadingButton } from "../ui/loading-button";
import { motion } from "framer-motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { ALL_COUNTRIES } from "@/lib/countries";
import { useStoreContext } from "@/contexts/StoreContext";

export const billingDetailsSchema = z
  .object({
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
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z
      .string()
      .min(1, "Country is required")
      .refine(
        (value) => value.trim().length > 0,
        "Country cannot be empty or whitespace"
      ),
  })
  .superRefine((data, ctx) => {
    if (data.country === "US") {
      const { state, zip } = data;

      if (!state) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["state"],
          message: "State is required",
        });
      }

      if (state?.trim().length == 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["state"],
          message: "State cannot be empty or whitespace",
        });
      }

      if (!zip) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["zip"],
          message: "Zip code is required",
        });
      }

      if (zip?.trim().length == 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["zip"],
          message: "Zip code cannot be empty or whitespace",
        });
      }

      if (zip && !/^\d{5}$/.test(zip)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["zip"],
          message: "Zip code must be a 5-digit number",
        });
      }
    }
  });

const EnteredBillingAddressDetails = () => {
  const { checkoutState } = useCheckout();

  if (!checkoutState.billingDetails) return null;

  const isUSAddress = checkoutState.billingDetails.country == "US";

  const country = ALL_COUNTRIES.find(
    (c) => c.code == checkoutState.billingDetails?.country
  )?.name;

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
        <p>{country}</p>
      </div>
    </motion.div>
  );
};

export const BillingDetailsForm = () => {
  const { checkoutState, actionsState, updateActionsState, updateState } =
    useCheckout();

  const { user } = useStoreContext();

  const form = useForm({
    resolver: zodResolver(billingDetailsSchema),
    defaultValues: checkoutState.billingDetails || {
      address: "",
      state: "",
      city: "",
      zip: "",
      country: "",
    },
  });

  const onSubmit = (data: z.infer<typeof billingDetailsSchema>) => {
    updateState({ billingDetails: data });
    updateActionsState({ isEditingBillingDetails: false });
  };

  const toggleSameAsDelivery = (checked: CheckedState) => {
    updateState({
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

  const { country } = form.getValues();

  const clearForm = () => {
    form.setValue("address", "");
    form.setValue("city", "");
    form.setValue("state", "");
    form.setValue("zip", "");
  };

  const previousCountryRef = useRef(
    checkoutState.billingDetails?.country || undefined
  );

  useEffect(() => {
    // effect to clear state and the form when the country changes

    const previousCountry = previousCountryRef.current;

    if (previousCountry && country !== previousCountry) {
      clearForm();

      // clear the state for delivery and billing details
      updateState({
        billingDetails: { country } as Address,
      });
    }

    previousCountryRef.current = country;
  }, [country]);

  const handleUseBillingAddressOnFile = (checked: CheckedState) => {
    if (checked as Boolean) {
      updateState({
        billingDetails: user?.billingAddress,
      });

      const { address, city, state, zip, country } = user?.billingAddress || {};

      form.setValue("address", address);
      form.setValue("city", city);
      form.setValue("state", state);
      form.setValue("zip", zip);
      form.setValue("country", country || "");
    }
  };

  const isUSAddress = checkoutState.billingDetails?.country == "US";

  const showEnteredBillingDetails =
    checkoutState.didEnterBillingDetails &&
    !checkoutState.billingDetails?.billingAddressSameAsDelivery &&
    !actionsState.isEditingBillingDetails;

  const hasEnteredBillingDetails =
    checkoutState.billingDetails?.address &&
    checkoutState.billingDetails?.city &&
    checkoutState.billingDetails?.country;

  return (
    <Form {...form}>
      <div className="w-full space-y-12">
        <div className="flex flex-col gap-8">
          <div className="flex items-center">
            <p className="text-xs text-muted-foreground">Billing details</p>

            {!hasEnteredBillingDetails && user?.billingAddress && (
              <div className="ml-auto flex items-center gap-2">
                <Checkbox
                  className="h-4 w-4 text-primary border-gray-300 focus:ring-primary"
                  onCheckedChange={(e) => handleUseBillingAddressOnFile(e)}
                />
                <label htmlFor="same-as-delivery" className="text-sm">
                  Use billing address on file
                </label>
              </div>
            )}
          </div>

          {checkoutState.deliveryMethod == "delivery" && (
            <div className="w-full xl:w-auto pb-8 flex items-center gap-2">
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

          {showEnteredBillingDetails && <EnteredBillingAddressDetails />}

          {(!checkoutState.didEnterBillingDetails ||
            actionsState.isEditingBillingDetails) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                transition: { ease: "easeOut", duration: 0.4 },
              }}
              className="space-y-8"
            >
              <div className="flex flex-col xl:flex-row gap-8">
                <div className="hidden md:block w-full md:w-[40%]">
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-muted-foreground text-xs">
                          Country
                        </FormLabel>
                        <Select
                          onValueChange={(e) => {
                            updateState({
                              billingDetails: {
                                ...checkoutState.billingDetails,
                                country: e,
                              } as Address,
                            });
                            field.onChange(e);
                          }}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select country" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {ALL_COUNTRIES.map((country) => (
                              <SelectItem
                                key={country.code}
                                value={country.code}
                              >
                                {country.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="block md:hidden w-full">
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-muted-foreground text-xs">
                          Country
                        </FormLabel>
                        <FormControl>
                          <select
                            className="block w-full px-3 py-8 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary text-sm"
                            value={field.value}
                            onChange={(e) => {
                              const selectedValue = e.target.value;
                              updateState({
                                billingDetails: {
                                  ...checkoutState.deliveryDetails,
                                  country: selectedValue,
                                } as Address,
                              });
                              field.onChange(selectedValue);
                            }}
                          >
                            <option value="" disabled>
                              Select country
                            </option>
                            {ALL_COUNTRIES.map((country) => (
                              <option key={country.code} value={country.code}>
                                {country.name}
                              </option>
                            ))}
                          </select>
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
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
                <div className={`${isUSAddress ? "w-full" : "w-auto"}`}>
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

                {isUSAddress && (
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
            </motion.div>
          )}
        </div>
      </div>
    </Form>
  );
};
