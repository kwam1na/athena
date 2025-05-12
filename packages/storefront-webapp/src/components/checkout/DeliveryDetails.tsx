import { Address, useCheckout } from "./CheckoutProvider";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import { GHANA_REGIONS } from "@/lib/ghanaRegions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { ALL_COUNTRIES } from "@/lib/countries";
import { useEffect, useRef } from "react";
import {
  DeliveryInstructions,
  DeliveryOptions,
} from "./DeliveryDetails/DeliverySection";
import { accraNeighborhoods } from "@/lib/ghana";
import { Plus } from "lucide-react";
import { CheckoutFormSectionProps } from "./CustomerInfoSection";
import { useStoreContext } from "@/contexts/StoreContext";

export const DeliveryDetailsForm = ({ form }: CheckoutFormSectionProps) => {
  const { checkoutState, updateState } = useCheckout();
  const { store } = useStoreContext();
  const { waiveDeliveryFees, deliveryFees } = store?.config || {};

  // const onSubmit = (data: z.infer<typeof deliveryDetailsSchema>) => {
  //   console.log("on submit in delivery details ->", data);
  //   updateState({ deliveryDetails: data });
  //   updateActionsState({
  //     isEditingDeliveryDetails: false,
  //     didEnterDeliveryDetails: true,
  //   });
  // };

  // if (checkoutState.deliveryMethod !== "delivery") return null;

  const { deliveryDetails } = form.getValues();

  const { country } = deliveryDetails || {};

  const previousCountryRef = useRef(
    checkoutState.deliveryDetails?.country || undefined
  );

  useEffect(() => {
    // effect to clear state and the form when the country changes

    const previousCountry = previousCountryRef.current;

    if (country !== previousCountry) {
      // clear the form
      form.setValue("deliveryDetails.address", "");
      form.setValue("deliveryDetails.city", "");
      form.setValue("deliveryDetails.zip", "");
      form.setValue("deliveryDetails.region", "");
      form.setValue("deliveryDetails.country", "");

      // clear the state for delivery and billing details
      updateState({
        deliveryDetails: { country } as Address,
        billingDetails: null,
      });
    }

    previousCountryRef.current = country;
  }, [country]);

  useEffect(() => {
    const { deliveryDetails } = form.getValues();

    const { region } = deliveryDetails || {};

    if (checkoutState.deliveryOption == "outside-accra" && region == "GA") {
      form.setValue("deliveryDetails.region", "");
    }

    if (checkoutState.deliveryOption == "within-accra") {
      form.setValue("deliveryDetails.region", "GA");
    }
  }, [checkoutState.deliveryOption]);

  return (
    <div className="w-full space-y-16">
      <div className="flex flex-col space-y-8">
        <p className="text-xs text-muted-foreground">Delivery details</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="hidden md:block w-full">
            <FormField
              control={form.control}
              name="deliveryDetails.country"
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

          <div className="block md:hidden w-full">
            <FormField
              control={form.control}
              name="deliveryDetails.country"
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
                          deliveryDetails: {
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

          {checkoutState.isGhanaOrder && (
            <div className="flex items-center">
              <div className="block md:hidden w-full">
                <FormField
                  control={form.control}
                  name="deliveryDetails.region"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-muted-foreground text-xs">
                        Region
                      </FormLabel>
                      <FormControl>
                        <select
                          className="block w-full px-3 py-8 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary text-sm"
                          value={field.value}
                          onChange={(e) => {
                            const region = e.target.value;
                            const deliveryOption =
                              region == "GA" ? "within-accra" : "outside-accra";

                            // Handle both old boolean format and new object format for backward compatibility
                            const shouldWaiveRegionFee =
                              typeof waiveDeliveryFees === "boolean"
                                ? waiveDeliveryFees
                                : region == "GA"
                                  ? waiveDeliveryFees?.withinAccra ||
                                    waiveDeliveryFees?.all ||
                                    false
                                  : waiveDeliveryFees?.otherRegions ||
                                    waiveDeliveryFees?.all ||
                                    false;

                            const deliveryFee = shouldWaiveRegionFee
                              ? 0
                              : region == "GA"
                                ? deliveryFees?.withinAccra || 30
                                : deliveryFees?.otherRegions || 70;

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
                        >
                          <option value="" disabled>
                            Select region
                          </option>
                          {GHANA_REGIONS.map((region) => (
                            <option key={region.code} value={region.code}>
                              {region.name}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>

              <div className="hidden md:block w-full">
                <FormField
                  control={form.control}
                  name="deliveryDetails.region"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-muted-foreground text-xs">
                        Region
                      </FormLabel>
                      <Select
                        onValueChange={(region) => {
                          const deliveryOption =
                            region == "GA" ? "within-accra" : "outside-accra";

                          // Handle both old boolean format and new object format for backward compatibility
                          const shouldWaiveRegionFee =
                            typeof waiveDeliveryFees === "boolean"
                              ? waiveDeliveryFees
                              : region == "GA"
                                ? waiveDeliveryFees?.withinAccra ||
                                  waiveDeliveryFees?.all ||
                                  false
                                : waiveDeliveryFees?.otherRegions ||
                                  waiveDeliveryFees?.all ||
                                  false;

                          const deliveryFee = shouldWaiveRegionFee
                            ? 0
                            : region == "GA"
                              ? deliveryFees?.withinAccra || 30
                              : deliveryFees?.otherRegions || 70;

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
            </div>
          )}

          {!checkoutState.isGhanaOrder && (
            <div className="w-full">
              <FormField
                control={form.control}
                name="deliveryDetails.address"
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
          )}
        </div>

        {checkoutState.isGhanaOrder && (
          <div className="flex gap-2">
            <div className="w-[60%]">
              <FormField
                control={form.control}
                name="deliveryDetails.address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-muted-foreground text-xs">
                      Street name
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

            <div className="w-[40%]">
              <FormField
                control={form.control}
                name="deliveryDetails.address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-muted-foreground text-xs">
                      House/Apt Number
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
        )}

        <div className="flex flex-col xl:flex-row gap-8">
          {!checkoutState.isGhanaOrder && (
            <div className={`${checkoutState.isUSOrder ? "w-full" : "w-auto"}`}>
              <FormField
                control={form.control}
                name="deliveryDetails.city"
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
          )}

          {checkoutState.isGhanaOrder && (
            <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="w-full">
                <FormField
                  control={form.control}
                  name="deliveryDetails.country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-muted-foreground text-xs">
                        Landmark (Optional)
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

              <div className="w-full">
                <FormField
                  control={form.control}
                  name="deliveryDetails.country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-muted-foreground text-xs">
                        Neighborhood/Suburb
                      </FormLabel>
                      {checkoutState.deliveryOption === "within-accra" ? (
                        <Select
                          onValueChange={(region) => {
                            field.onChange(region);
                          }}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select neighborhood" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {accraNeighborhoods.map((n) => (
                              <SelectItem key={n.value} value={n.value}>
                                {n.label}
                              </SelectItem>
                            ))}
                            <SelectItem value="new-item">
                              <div className="flex items-center">
                                <Plus className="h-2.5 w-2.5 mr-2" />
                                <p className="text-sm">Enter neighborhood</p>
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
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
                      )}

                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          )}

          {checkoutState.isUSOrder && (
            <>
              <div className="w-full">
                <FormField
                  control={form.control}
                  name="deliveryDetails.state"
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
                  name="deliveryDetails.zip"
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

      {checkoutState.deliveryDetails?.country && (
        <DeliveryOptions form={form} />
      )}

      {checkoutState.isGhanaOrder && <DeliveryInstructions />}
    </div>
  );
};
