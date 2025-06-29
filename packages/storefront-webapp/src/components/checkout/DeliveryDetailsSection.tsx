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
import { useEffect, useRef, useState } from "react";
import { accraNeighborhoods } from "@/lib/ghana";
import { CheckoutFormSectionProps } from "./CustomerInfoSection";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import { US_STATES } from "@/lib/states";
import { useStoreContext } from "@/contexts/StoreContext";
import { isFeeWaived } from "@/lib/feeUtils";

export const CountryFields = ({ form }: CheckoutFormSectionProps) => {
  const { checkoutState, updateState } = useCheckout();
  return (
    <>
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
    </>
  );
};

const RegionFields = ({ form }: CheckoutFormSectionProps) => {
  const { checkoutState, updateState } = useCheckout();
  const { store } = useStoreContext();
  const { waiveDeliveryFees, deliveryFees } = store?.config || {};

  return (
    <>
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
                          neighborhood:
                            deliveryOption == "within-accra"
                              ? checkoutState?.deliveryDetails?.neighborhood
                              : "",
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
                        neighborhood:
                          deliveryOption == "within-accra"
                            ? checkoutState?.deliveryDetails?.neighborhood
                            : "",
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
    </>
  );
};

const StateFields = ({ form }: CheckoutFormSectionProps) => {
  const { checkoutState, updateState } = useCheckout();
  return (
    <>
      <div className="hidden md:block w-full">
        <FormField
          control={form.control}
          name="deliveryDetails.state"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-muted-foreground text-xs">
                State
              </FormLabel>
              <Select
                onValueChange={(e) => {
                  updateState({
                    deliveryDetails: {
                      ...checkoutState.deliveryDetails,
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
                    <SelectItem key={state.value} value={state.value}>
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
          name="deliveryDetails.state"
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
                      deliveryDetails: {
                        ...checkoutState.deliveryDetails,
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
    </>
  );
};

const AddressField = ({ form }: CheckoutFormSectionProps) => {
  const { checkoutState, updateState } = useCheckout();
  return (
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
  );
};

const GhanaAddressFields = ({ form }: CheckoutFormSectionProps) => {
  const { checkoutState, updateState } = useCheckout();
  return (
    <div className="flex flex-col md:flex-row gap-4">
      <div className="w-full md:w-[30%]">
        <FormField
          control={form.control}
          name="deliveryDetails.houseNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-muted-foreground text-xs">
                Apt/House number (Optional)
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  onChange={(e) => {
                    updateState({
                      deliveryDetails: {
                        ...checkoutState.deliveryDetails,
                        houseNumber: e.target.value,
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

      <div className="w-full md:w-[70%]">
        <FormField
          control={form.control}
          name="deliveryDetails.street"
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
                        street: e.target.value,
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
  );
};

const CityField = ({ form }: CheckoutFormSectionProps) => {
  const { checkoutState, updateState } = useCheckout();
  return (
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
  );
};

const GhanaAddressLocaleFields = ({
  form,
  isEnteringNewNeighborhood,
  setIsEnteringNewNeighborhood,
}: CheckoutFormSectionProps & {
  isEnteringNewNeighborhood: boolean;
  setIsEnteringNewNeighborhood: (s: boolean) => void;
}) => {
  const { checkoutState, updateState } = useCheckout();
  return (
    <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="hidden md:block w-full">
        <FormField
          control={form.control}
          name="deliveryDetails.neighborhood"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-muted-foreground text-xs">
                Neighborhood/Suburb
              </FormLabel>
              {checkoutState.deliveryOption === "within-accra" &&
              !isEnteringNewNeighborhood ? (
                <Select
                  onValueChange={(neighborhood) => {
                    updateState({
                      deliveryDetails: {
                        ...checkoutState.deliveryDetails,
                        neighborhood: neighborhood,
                      } as Address,
                    });

                    field.onChange(neighborhood);
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
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  {...field}
                  onChange={(e) => {
                    updateState({
                      deliveryDetails: {
                        ...checkoutState.deliveryDetails,
                        neighborhood: e.target.value,
                      } as Address,
                    });
                    field.onChange(e);
                  }}
                />
              )}

              {checkoutState.deliveryOption == "within-accra" && (
                <Button
                  type="button"
                  variant={"clear"}
                  onClick={() => {
                    setIsEnteringNewNeighborhood(!isEnteringNewNeighborhood);
                  }}
                  className="text-muted-foreground text-xs p-0"
                >
                  {isEnteringNewNeighborhood
                    ? "Choose from list"
                    : "Add suburb"}
                </Button>
              )}

              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />
      </div>

      <div className="block md:hidden w-full">
        <FormField
          control={form.control}
          name="deliveryDetails.neighborhood"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-muted-foreground text-xs">
                Neighborhood/Suburb
              </FormLabel>
              {checkoutState.deliveryOption === "within-accra" &&
              !isEnteringNewNeighborhood ? (
                <FormControl>
                  <select
                    className="block w-full px-3 py-8 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-primary focus:border-primary text-sm"
                    value={field.value}
                    onChange={(e) => {
                      updateState({
                        deliveryDetails: {
                          ...checkoutState.deliveryDetails,
                          neighborhood: e.target.value,
                        } as Address,
                      });
                      field.onChange(e.target.value);
                    }}
                  >
                    <option value="" disabled>
                      Select neighborhood
                    </option>
                    {accraNeighborhoods.map((n) => (
                      <option key={n.value} value={n.value}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                </FormControl>
              ) : (
                <FormControl>
                  <Input
                    {...field}
                    onChange={(e) => {
                      updateState({
                        deliveryDetails: {
                          ...checkoutState.deliveryDetails,
                          neighborhood: e.target.value,
                        } as Address,
                      });
                      field.onChange(e);
                    }}
                  />
                </FormControl>
              )}

              {checkoutState.deliveryOption == "within-accra" && (
                <Button
                  type="button"
                  variant={"clear"}
                  onClick={() => {
                    setIsEnteringNewNeighborhood(!isEnteringNewNeighborhood);
                  }}
                  className="text-muted-foreground text-xs p-0"
                >
                  {isEnteringNewNeighborhood ? "Choose from list" : "Add"}
                </Button>
              )}

              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />
      </div>

      <div className="w-full">
        <FormField
          control={form.control}
          name="deliveryDetails.landmark"
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
                        landmark: e.target.value,
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
  );
};

const USAddressFields = ({ form }: CheckoutFormSectionProps) => {
  const { checkoutState, updateState } = useCheckout();
  return (
    <>
      {/* <div className="w-full">
        <FormField
          control={form.control}
          name="deliveryDetails.state"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-muted-foreground text-xs">
                State
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  onChange={(e) => {
                    updateState({
                      deliveryDetails: {
                        ...checkoutState.deliveryDetails,
                        state: e.target.value,
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
      </div> */}

      <StateFields form={form} />

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
                <Input
                  {...field}
                  onChange={(e) => {
                    updateState({
                      deliveryDetails: {
                        ...checkoutState.deliveryDetails,
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
  );
};

const DeliveryInstructions = ({ form }: CheckoutFormSectionProps) => {
  const { updateState } = useCheckout();
  return (
    <div className="w-full">
      <FormField
        control={form.control}
        name="deliveryInstructions"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-muted-foreground text-xs">
              Delivery instructions (Optional)
            </FormLabel>
            <Textarea
              {...field}
              onChange={(e) => {
                updateState({
                  deliveryInstructions: e.target.value,
                });
                field.onChange(e);
              }}
            />
          </FormItem>
        )}
      />
    </div>
  );
};

export const DeliveryDetailsSection = ({ form }: CheckoutFormSectionProps) => {
  const { checkoutState, updateState } = useCheckout();

  const { deliveryDetails } = form.getValues();

  const { country, region } = deliveryDetails || {};

  const { store } = useStoreContext();

  const { deliveryFees, waiveDeliveryFees } = store?.config || {};

  const previousCountryRef = useRef(
    checkoutState.deliveryDetails?.country || undefined
  );

  const previousRegionRef = useRef(checkoutState.deliveryDetails?.region);

  const [isEnteringNewNeighborhood, setIsEnteringNewNeighborhood] =
    useState(false);

  const shouldWaiveIntlFee = isFeeWaived(waiveDeliveryFees, "intl");

  useEffect(() => {
    // effect to clear state and the form when the country changes

    const previousRegion = previousRegionRef.current;

    if (previousRegion && region && region !== previousRegion) {
      // clear the form
      form.setValue("deliveryDetails.landmark", "");
      form.setValue("deliveryDetails.houseNumber", "");
      form.setValue("deliveryDetails.street", "");

      // clear the state for delivery details
      updateState({
        deliveryDetails: {
          ...checkoutState.deliveryDetails,
          street: "",
          houseNumber: "",
          landmark: "",
        } as Address,
      });
    }

    previousRegionRef.current = region;
  }, [region, checkoutState]);

  useEffect(() => {
    // effect to clear state and the form when the country changes

    const previousCountry = previousCountryRef.current;

    if (previousCountry && country && country !== previousCountry) {
      // clear the form
      form.setValue("deliveryDetails.address", "");
      form.setValue("deliveryDetails.city", "");
      form.setValue("deliveryDetails.zip", "");
      form.setValue("deliveryDetails.state", "");
      form.setValue("deliveryDetails.region", "");

      // clear the state for delivery and billing details
      updateState({
        deliveryDetails: { country } as Address,
        billingDetails: null,
        paymentMethod: "online_payment",
        podPaymentMethod: null,
        deliveryOption: country === "GH" ? "within-accra" : "intl",
        deliveryFee:
          country === "GH"
            ? deliveryFees?.withinAccra || 30
            : shouldWaiveIntlFee
              ? 0
              : deliveryFees?.international || 800,
      });
    }

    previousCountryRef.current = country;
  }, [country, shouldWaiveIntlFee]);

  useEffect(() => {
    if (
      checkoutState.deliveryDetails?.region !== "GA" ||
      (checkoutState.deliveryDetails?.region == "GA" &&
        isEnteringNewNeighborhood)
    ) {
      form.setValue("deliveryDetails.neighborhood", "");
    }
  }, [checkoutState.deliveryDetails?.region, isEnteringNewNeighborhood]);

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
        <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
          {/* <CountryFields form={form} /> */}

          {checkoutState.isGhanaOrder && <RegionFields form={form} />}

          {!checkoutState.isGhanaOrder && <AddressField form={form} />}
        </div>

        {checkoutState.isGhanaOrder && <GhanaAddressFields form={form} />}

        <div className="flex flex-col xl:flex-row gap-8">
          {!checkoutState.isGhanaOrder && <CityField form={form} />}

          {checkoutState.isGhanaOrder && (
            <GhanaAddressLocaleFields
              form={form}
              isEnteringNewNeighborhood={isEnteringNewNeighborhood}
              setIsEnteringNewNeighborhood={setIsEnteringNewNeighborhood}
            />
          )}

          {checkoutState.isUSOrder && <USAddressFields form={form} />}
        </div>
      </div>

      {checkoutState.isGhanaOrder && <DeliveryInstructions form={form} />}

      {/* {checkoutState.deliveryDetails?.country && <DeliveryOptions />} */}
    </div>
  );
};
