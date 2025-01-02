import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Address, useCheckout } from "./CheckoutProvider";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import { CountrySelect } from "../ui/country-select";
import { LoadingButton } from "../ui/loading-button";
import { GhanaRegionSelect } from "../ui/ghana-region-select";
import { GHANA_REGIONS } from "@/lib/ghanaRegions";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { ALL_COUNTRIES } from "@/lib/countries";
import { useEffect, useRef } from "react";
import { DeliveryOptions } from "./DeliveryDetails/DeliverySection";

export const deliveryDetailsSchema = z
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
    region: z.string().optional(),
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

    if (data.country == "GH") {
      const { region } = data;

      if (!region) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["region"],
          message: "Region is required",
        });
      }
    }
  });

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

  const onSubmit = (data: z.infer<typeof deliveryDetailsSchema>) => {
    console.log("on submit in delivery details ->", data);
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
      form.setValue("region", "");

      // clear the state for delivery and billing details
      updateState({
        deliveryDetails: { country } as Address,
        billingDetails: null,
      });
    }

    previousCountryRef.current = country;
  }, [country]);

  // console.log(checkoutState);

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
            <div className="hidden md:block w-full xl:w-[40%]">
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

            <div className="block md:hidden w-full xl:w-[40%]">
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
              <div className="block md:hidden w-full xl:w-[40%]">
                <FormField
                  control={form.control}
                  name="region"
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
            )}

            {checkoutState.isGhanaOrder && (
              <div className="w-full xl:w-[40%]">
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

export function SelectScrollable() {
  return (
    <Select>
      <SelectTrigger className="w-[280px]">
        <SelectValue placeholder="Select a timezone" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>North America</SelectLabel>
          <SelectItem value="est">Eastern Standard Time (EST)</SelectItem>
          <SelectItem value="cst">Central Standard Time (CST)</SelectItem>
          <SelectItem value="mst">Mountain Standard Time (MST)</SelectItem>
          <SelectItem value="pst">Pacific Standard Time (PST)</SelectItem>
          <SelectItem value="akst">Alaska Standard Time (AKST)</SelectItem>
          <SelectItem value="hst">Hawaii Standard Time (HST)</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Europe & Africa</SelectLabel>
          <SelectItem value="gmt">Greenwich Mean Time (GMT)</SelectItem>
          <SelectItem value="cet">Central European Time (CET)</SelectItem>
          <SelectItem value="eet">Eastern European Time (EET)</SelectItem>
          <SelectItem value="west">
            Western European Summer Time (WEST)
          </SelectItem>
          <SelectItem value="cat">Central Africa Time (CAT)</SelectItem>
          <SelectItem value="eat">East Africa Time (EAT)</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Asia</SelectLabel>
          <SelectItem value="msk">Moscow Time (MSK)</SelectItem>
          <SelectItem value="ist">India Standard Time (IST)</SelectItem>
          <SelectItem value="cst_china">China Standard Time (CST)</SelectItem>
          <SelectItem value="jst">Japan Standard Time (JST)</SelectItem>
          <SelectItem value="kst">Korea Standard Time (KST)</SelectItem>
          <SelectItem value="ist_indonesia">
            Indonesia Central Standard Time (WITA)
          </SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Australia & Pacific</SelectLabel>
          <SelectItem value="awst">
            Australian Western Standard Time (AWST)
          </SelectItem>
          <SelectItem value="acst">
            Australian Central Standard Time (ACST)
          </SelectItem>
          <SelectItem value="aest">
            Australian Eastern Standard Time (AEST)
          </SelectItem>
          <SelectItem value="nzst">New Zealand Standard Time (NZST)</SelectItem>
          <SelectItem value="fjt">Fiji Time (FJT)</SelectItem>
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>South America</SelectLabel>
          <SelectItem value="art">Argentina Time (ART)</SelectItem>
          <SelectItem value="bot">Bolivia Time (BOT)</SelectItem>
          <SelectItem value="brt">Brasilia Time (BRT)</SelectItem>
          <SelectItem value="clt">Chile Standard Time (CLT)</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
