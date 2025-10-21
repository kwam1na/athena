import { useEffect, useRef } from "react";
import { useCheckout } from "@/hooks/useCheckout";
import { Checkbox } from "../ui/checkbox";
import { CheckedState } from "@radix-ui/react-checkbox";
import { motion } from "framer-motion";
import { useStoreContext } from "@/contexts/StoreContext";
import { CheckoutFormSectionProps } from "./CustomerInfoSection";
import { EnteredBillingAddressDetails } from "./EnteredBillingAddressDetails";

export const BillingDetailsSection = ({ form }: CheckoutFormSectionProps) => {
  const { checkoutState, updateActionsState, updateState } = useCheckout();

  const { user } = useStoreContext();

  // const { billingDetails } = form.getValues();
  // const { country } = billingDetails || {};

  const clearForm = ({ leaveCountry }: { leaveCountry?: boolean } = {}) => {
    // form.setValue("billingDetails.address", "");
    // form.setValue("billingDetails.city", "");
    // form.setValue("billingDetails.state", "");
    // form.setValue("billingDetails.zip", "");
    // if (!leaveCountry) form.setValue("billingDetails.country", "");
  };

  const previousCountryRef = useRef(
    checkoutState.billingDetails?.country || undefined
  );

  // useEffect(() => {
  //   // effect to clear state and the form when the country changes

  //   const previousCountry = previousCountryRef.current;

  //   if (previousCountry && country !== previousCountry) {
  //     clearForm({ leaveCountry: true });
  //     // clear the state for delivery and billing details
  //     updateState({
  //       billingDetails: { country } as Address,
  //     });
  //   }

  //   previousCountryRef.current = country;
  // }, [country]);

  useEffect(() => {
    if (!checkoutState.billingDetails) {
      clearForm();
    }
  }, [checkoutState.billingDetails]);

  const handleUseBillingAddressOnFile = (checked: CheckedState) => {
    if (checked as Boolean) {
      updateState({
        billingDetails: user?.billingAddress,
      });

      const { address, city, state, zip, country } = user?.billingAddress || {};

      // form.setValue("billingDetails.address", address);
      // form.setValue("billingDetails.city", city);
      // form.setValue("billingDetails.state", state);
      // form.setValue("billingDetails.zip", zip);
      // form.setValue("billingDetails.country", country || "");
    }
  };

  const toggleSameAsDelivery = (checked: CheckedState) => {
    // updateState({
    //   billingDetails: (checked as boolean)
    //     ? {
    //         ...checkoutState.deliveryDetails!,
    //         billingAddressSameAsDelivery: true,
    //       }
    //     : {
    //         address: billingDetails?.address || "",
    //         city: billingDetails?.city || "",
    //         state: billingDetails?.state || "",
    //         zip: billingDetails?.zip || "",
    //         country: billingDetails?.country || "",
    //         billingAddressSameAsDelivery: false,
    //       },
    // });

    // if the form is in the edit state and the check box is checked, cancel the edit mode
    if (checked) {
      updateActionsState({ isEditingBillingDetails: false });
    }
  };

  const isUSAddress = checkoutState.billingDetails?.country == "US";

  const hasEnteredBillingDetails =
    checkoutState.billingDetails?.address &&
    checkoutState.billingDetails?.city &&
    checkoutState.billingDetails?.country;

  return (
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
            disabled={checkoutState.didEnterDeliveryDetails == false}
            onCheckedChange={(e) => toggleSameAsDelivery(e)}
            className="h-4 w-4 text-primary border-gray-300 focus:ring-primary"
          />
          <label htmlFor="same-as-delivery" className="text-sm">
            Same as delivery address
          </label>
        </div>
      )}

      {checkoutState.billingDetails?.billingAddressSameAsDelivery ? (
        <EnteredBillingAddressDetails />
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { ease: "easeOut", duration: 0.4 },
          }}
          className="space-y-8"
        >
          {/* <div className="flex flex-col xl:flex-row gap-8">
            <div className="hidden md:block w-full md:w-[40%]">
              <FormField
                control={form.control}
                name="billingDetails.country"
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
                          <SelectItem key={country.code} value={country.code}>
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
                name="billingDetails.country"
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
                              ...checkoutState.billingDetails,
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
                name="billingDetails.address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-muted-foreground text-xs">
                      Address
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={(e) => {
                          updateState({
                            billingDetails: {
                              ...checkoutState.billingDetails,
                              address: e.target.value,
                            } as Address,
                          });
                          field.onChange(e);
                        }}
                      />
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
                name="billingDetails.city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-muted-foreground text-xs">
                      City
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={(e) => {
                          updateState({
                            billingDetails: {
                              ...checkoutState.billingDetails,
                              city: e.target.value,
                            } as Address,
                          });
                          field.onChange(e);
                        }}
                      />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />
            </div>

            {isUSAddress && (
              <>
                <div className="w-full">
                  <div className="hidden md:block w-full">
                    <FormField
                      control={form.control}
                      name="billingDetails.state"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-muted-foreground text-xs">
                            State
                          </FormLabel>
                          <Select
                            onValueChange={(e) => {
                              updateState({
                                billingDetails: {
                                  ...checkoutState.billingDetails,
                                  state: e,
                                } as Address,
                              });
                              field.onChange(e);
                            }}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select state" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {US_STATES.map((state) => (
                                <SelectItem
                                  key={state.value}
                                  value={state.value}
                                >
                                  {state.label}
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
                      name="billingDetails.state"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-muted-foreground text-xs">
                            State
                          </FormLabel>
                          <FormControl>
                            <select
                              className="block w-full px-3 py-8 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary text-sm"
                              value={field.value}
                              onChange={(e) => {
                                const selectedValue = e.target.value;
                                updateState({
                                  billingDetails: {
                                    ...checkoutState.billingDetails,
                                    state: selectedValue,
                                  } as Address,
                                });
                                field.onChange(selectedValue);
                              }}
                            >
                              <option value="" disabled>
                                Select state
                              </option>
                              {US_STATES.map((state) => (
                                <option key={state.value} value={state.value}>
                                  {state.label}
                                </option>
                              ))}
                            </select>
                          </FormControl>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="w-full">
                  <FormField
                    control={form.control}
                    name="billingDetails.zip"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-muted-foreground text-xs">
                          Zip Code
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onChange={(e) => {
                              updateState({
                                billingDetails: {
                                  ...checkoutState.billingDetails,
                                  zip: e.target.value,
                                } as Address,
                              });
                              field.onChange(e);
                            }}
                          />
                        </FormControl>
                        <FormMessage className="text-xs" />
                      </FormItem>
                    )}
                  />
                </div>
              </>
            )}
          </div> */}
        </motion.div>
      )}
    </div>
  );
};
