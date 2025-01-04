import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALL_COUNTRIES } from "@/lib/countries";
import { GHANA_REGIONS } from "@/lib/ghanaRegions";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

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

export const DeliveryDetailsForm = ({
  defaultValues,
  onCancelClick,
  title,
  onSubmitClick,
}: {
  defaultValues?: z.infer<typeof deliveryDetailsSchema>;
  title: string;
  onCancelClick: () => void;
  onSubmitClick: (data: z.infer<typeof deliveryDetailsSchema>) => Promise<void>;
}) => {
  const form = useForm({
    resolver: zodResolver(deliveryDetailsSchema),
    defaultValues: defaultValues || {
      address: "",
      state: "",
      city: "",
      zip: "",
      region: "",
      country: "",
    },
  });

  const country = form.watch("country");

  const isUSOrder = country === "US";

  const isGhanaOrder = country === "GH";

  const previousCountryRef = useRef<string>();

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // effect to clear state and the form when the country changes

    const previousCountry = previousCountryRef.current;

    if (previousCountry && country !== previousCountry) {
      // clear the form
      form.setValue("address", "");
      form.setValue("city", "");
      form.setValue("state", "");
      form.setValue("zip", "");
      form.setValue("region", "");
    }

    previousCountryRef.current = country;
  }, [country]);

  const onSubmit = async (data: z.infer<typeof deliveryDetailsSchema>) => {
    try {
      setIsSubmitting(true);
      await onSubmitClick(data);
      onCancelClick();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="w-full space-y-16"
      >
        <div className="flex flex-col space-y-8">
          <p className="text-xs text-muted-foreground">{title}</p>
          <div className="flex flex-col gap-8">
            <div className="hidden md:block">
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

            <div className="block md:hidden">
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

            <div>
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

          <div className="flex flex-col gap-8">
            <div>
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

            {isGhanaOrder && (
              <div className="block md:hidden">
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

            {isGhanaOrder && (
              <div className="hidden md:block w-full">
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

            {isUSOrder && (
              <div className="flex gap-8">
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
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-4">
          <LoadingButton
            isLoading={isSubmitting}
            className="w-[50%]"
            type="submit"
          >
            Save
          </LoadingButton>

          <Button
            className="w-[50%]"
            type="button"
            onClick={onCancelClick}
            disabled={isSubmitting}
            variant={"ghost"}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
};
