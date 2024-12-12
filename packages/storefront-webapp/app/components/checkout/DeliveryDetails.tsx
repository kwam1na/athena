import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Address, useCheckout } from "./CheckoutProvider";
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
import { LoadingButton } from "../ui/loading-button";
import { GhanaRegionSelect } from "../ui/ghana-region-select";
import { GHANA_REGIONS } from "@/lib/ghanaRegions";

export const deliveryDetailsSchema = z.object({
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
  state: z
    .string()
    .min(2, "Invalid state")
    .refine(
      (value) => value.trim().length > 0,
      "State cannot be empty or whitespace"
    )
    .optional(),
  zip: z.coerce
    .string() // Coerce the input into a string first
    .refine(
      (value) => /^\d{5}$/.test(value),
      "Zip code must be a 5-digit number"
    )
    .refine(
      (value) => value.trim().length > 0,
      "Zip cannot be empty or whitespace"
    )
    .optional(),
});

const deliveryDetailsWithoutStateAndZipSchema = z.object({
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

export const DeliveryDetailsForm = () => {
  const { checkoutState, actionsState, updateActionsState, updateState } =
    useCheckout();

  const schema =
    checkoutState.country == "US"
      ? deliveryDetailsSchema
      : deliveryDetailsWithoutStateAndZipSchema;

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: checkoutState.deliveryDetails || {
      address: "",
      state: "",
      city: "",
      zip: "",
    },
  });

  const onSubmit = (data: z.infer<typeof deliveryDetailsSchema>) => {
    updateState({ deliveryDetails: data });
    updateActionsState({ isEditingDeliveryDetails: false });
  };

  const onCountrySelect = (country: string) => {
    updateState({ country });
  };

  const onRegionSelect = (region: string) => {
    updateState({
      region_gh: region,
      region_gh_name: GHANA_REGIONS.find((r) => r.code === region)?.name,
    });
  };

  const hasNotSelectedDeliveryMethod = !Boolean(
    checkoutState.deliveryMethod && checkoutState.deliveryOption
  );

  if (
    checkoutState.deliveryMethod !== "delivery" ||
    !checkoutState.deliveryOption
  )
    return null;

  const isOrderToUS = checkoutState.country == "US";

  const shouldDisableRegionSelect =
    checkoutState.region_gh == "GA" &&
    checkoutState.deliveryOption == "within-accra";

  const Select =
    checkoutState.country == "GH" ? (
      <GhanaRegionSelect
        disabled={shouldDisableRegionSelect}
        value={checkoutState.region_gh || undefined}
        onSelect={onRegionSelect}
      />
    ) : (
      <CountrySelect
        value={checkoutState.country || undefined}
        onSelect={onCountrySelect}
      />
    );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="w-full space-y-12"
      >
        <div className="flex flex-col space-y-8">
          <p className="text-xs text-muted-foreground">Delivery details</p>
          <div className="flex flex-col xl:flex-row gap-16">
            <div className="w-full xl:w-auto">{Select}</div>

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
                    <FormMessage className="text-xs" />
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
                    <FormMessage className="text-xs" />
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
                        <FormMessage className="text-xs" />
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

        {/* Show continue button only when editing */}
        {(actionsState.isEditingDeliveryDetails ||
          !checkoutState.deliveryDetails) && (
          <LoadingButton className="w-[50%]" isLoading={false} type="submit">
            {actionsState.isEditingDeliveryDetails ? "Save" : "Continue"}
          </LoadingButton>
        )}
      </form>
    </Form>
  );
};
