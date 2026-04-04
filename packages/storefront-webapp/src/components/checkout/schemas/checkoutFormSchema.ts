import { z } from "zod";
import { customerDetailsSchema } from "./customerDetailsSchema";
import { baseDeliveryDetailsSchema } from "./deliveryDetailsSchema";

export const checkoutFormSchema = z
  .object({
    deliveryInstructions: z.string(),
    deliveryMethod: z
      .enum(["pickup", "delivery"])
      .refine((value) => !!value, { message: "Delivery method is required" }),
    customerDetails: z.object({ ...customerDetailsSchema.shape }),
    deliveryDetails: z.object({ ...baseDeliveryDetailsSchema.shape }),
  })
  .superRefine((data, ctx) => {
    const { deliveryMethod, deliveryDetails } = data;

    if (deliveryMethod == "delivery") {
      if (!deliveryDetails) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deliveryDetails"],
          message: "Delivery details are required",
        });
      }

      const {
        address,
        city,
        street,
        neighborhood,
        state,
        zip,
        region,
        country,
      } = deliveryDetails || {};

      const isGhanaAddress = country == "GH";
      const isUSAddress = country == "US";

      if (!isGhanaAddress) {
        if (!address) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "address"],
            message: "Address is required",
          });
        }

        if (address?.trim().length == 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "address"],
            message: "Address cannot be empty or whitespace",
          });
        }

        if (!city) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "city"],
            message: "City is required",
          });
        }

        if (city?.trim().length == 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "city"],
            message: "City cannot be empty or whitespace",
          });
        }
      }

      if (!country) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deliveryDetails", "country"],
          message: "Country is required",
        });
      }

      if (isUSAddress) {
        if (!state) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "state"],
            message: "State is required",
          });
        }

        if (!zip) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "zip"],
            message: "Zip is required",
          });
        }

        if (zip?.trim().length == 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "zip"],
            message: "Zip code cannot be empty or whitespace",
          });
        }

        if (zip && !/^\d{5}$/.test(zip)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "zip"],
            message: "Zip code must be a 5-digit number",
          });
        }
      }

      if (isGhanaAddress) {
        if (!region) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "region"],
            message: "Region is required",
          });
        }

        if (!street) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "street"],
            message: "Street is required",
          });
        }

        if (!neighborhood) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["deliveryDetails", "neighborhood"],
            message: "Neighborhood is required",
          });
        }
      }
    }
  });

export type CheckoutFormData = z.infer<typeof checkoutFormSchema>;
