import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Address, useCheckout } from "../CheckoutProvider";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../ui/form";
import { Input } from "../../ui/input";
import { LoadingButton } from "../../ui/loading-button";
import { GHANA_REGIONS } from "@/lib/ghanaRegions";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { ALL_COUNTRIES } from "@/lib/countries";
import { useEffect, useRef } from "react";
import { DeliveryOptions } from "./DeliverySection";
import { deliveryDetailsSchema } from "./schema";

export const DeliveryDetailsForm = () => {
  const { checkoutState, actionsState, updateActionsState, updateState } =
    useCheckout();

  const form = useForm({
    resolver: zodResolver(deliveryDetailsSchema),
    defaultValues: checkoutState.deliveryDetails || {
      address: "",
      state: "",
      city: "",
      zip: "",
      region: "",
    },
  });

  const onSubmit = (data: Address) => {
    updateState({ deliveryDetails: data });
    updateActionsState({
      isEditingDeliveryDetails: false,
      didEnterDeliveryDetails: true,
    });
  };

  if (checkoutState.deliveryMethod !== "delivery") return null;

  const { country } = form.getValues();

  const previousCountryRef = useRef(
    checkoutState.deliveryDetails?.country || undefined
  );

  useEffect(() => {
    // effect to clear state and the form when the country changes

    const previousCountry = previousCountryRef.current;

    if (country !== previousCountry) {
      // clear the form
      form.setValue("address", "");
      form.setValue("city", "");
      form.setValue("state", "");
      form.setValue("zip", "");

      // clear the state for delivery and billing details
      updateState({
        deliveryDetails: { country } as Address,
        billingDetails: null,
      });
    }

    previousCountryRef.current = country;
  }, [country]);

  useEffect(() => {
    const { region } = form.getValues();

    if (checkoutState.deliveryOption == "outside-accra" && region == "GA") {
      form.setValue("region", "");
    }

    if (checkoutState.deliveryOption == "within-accra") {
      form.setValue("region", "GA");
    }
  }, [checkoutState.deliveryOption]);

  const canShowContinueButton = Boolean(
    checkoutState.deliveryDetails && checkoutState.deliveryOption
  );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="w-full space-y-16"
      >
        <div className="flex flex-col space-y-8">
          <p className="text-xs text-muted-foreground">Delivery details</p>
          <div className="flex flex-col xl:flex-row gap-8">
            <div className="w-full xl:w-[40%]">
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
                          deliveryDetails: {
                            ...checkoutState.deliveryDetails,
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

            <div className="w-full xl:w-[60%]">
              <FormField
                control={form.control}
                name="address"
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
                            deliveryDetails: {
                              ...checkoutState.deliveryDetails,
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

          <div className="flex flex-col xl:flex-row gap-8">
            <div className={`${checkoutState.isUSOrder ? "w-full" : "w-auto"}`}>
              <FormField
                control={form.control}
                name="city"
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
                            deliveryDetails: {
                              ...checkoutState.deliveryDetails,
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

            {checkoutState.isGhanaOrder && (
              <div className="w-[40%]">
                <FormField
                  control={form.control}
                  name="region"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-muted-foreground text-xs">
                        Region
                      </FormLabel>
                      <Select
                        onValueChange={(region) => {
                          const deliveryOption =
                            region == "GA" ? "within-accra" : "outside-accra";

                          const deliveryFee = region == "GA" ? 30 : 70;

                          updateState({
                            deliveryDetails: {
                              ...checkoutState.deliveryDetails,
                              region,
                            } as Address,
                            deliveryFee,
                            deliveryOption,
                          });
                          field.onChange(region);
                        }}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select region" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {GHANA_REGIONS.map((region) => (
                            <SelectItem key={region.code} value={region.code}>
                              {region.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {checkoutState.isUSOrder && (
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
        </div>

        {checkoutState.deliveryDetails?.country && <DeliveryOptions />}

        {/* Show continue button only when editing */}
        {/* {(actionsState.isEditingDeliveryDetails ||
          !checkoutState.deliveryDetails) && (
          <LoadingButton className="w-[50%]" isLoading={false} type="submit">
            {actionsState.isEditingDeliveryDetails ? "Save" : "Continue"}
          </LoadingButton>
        )} */}

        {canShowContinueButton && (
          <LoadingButton className="w-[50%]" isLoading={false} type="submit">
            {actionsState.isEditingDeliveryDetails ? "Save" : "Continue"}
          </LoadingButton>
        )}
      </form>
    </Form>
  );
};
