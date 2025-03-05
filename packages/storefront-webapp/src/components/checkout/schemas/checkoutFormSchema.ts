import { z } from "zod";
import { customerDetailsSchema } from "./customerDetailsSchema";
import { baseDeliveryDetailsSchema } from "./deliveryDetailsSchema";
import { baseBillingDetailsSchema } from "./billingDetailsSchema";

export const checkoutFormSchema = z
  .object({
    deliveryMethod: z
      .enum(["pickup", "delivery"])
      .refine((value) => !!value, { message: "Delivery method is required" }),
    customerDetails: z.object({ ...customerDetailsSchema.shape }),
    deliveryDetails: z.object({ ...baseDeliveryDetailsSchema.shape }),
    // billingDetails: z.object({ ...baseBillingDetailsSchema.shape }),
  })
  .superRefine((data, ctx) => {
    const { deliveryMethod, deliveryDetails } = data;

    if (deliveryMethod == "delivery") {
      // if (!billingDetails) {
      //   ctx.addIssue({
      //     code: z.ZodIssueCode.custom,
      //     path: ["billingDetails"],
      //     message: "Billing details are required",
      //   });
      // }

      // const {
      //   address: billingAddress,
      //   city: billingCity,
      //   state: billingState,
      //   zip: billingZip,
      //   country: billingCountry,
      // } = billingDetails || {};

      // const isUSBillingAddress = billingCountry == "US";

      // if (!billingAddress) {
      //   ctx.addIssue({
      //     code: z.ZodIssueCode.custom,
      //     path: ["billingDetails", "address"],
      //     message: "Address is required",
      //   });
      // }

      // if (billingAddress?.trim().length == 0) {
      //   ctx.addIssue({
      //     code: z.ZodIssueCode.custom,
      //     path: ["billingDetails", "address"],
      //     message: "Address cannot be empty or whitespace",
      //   });
      // }

      // if (!billingCity) {
      //   ctx.addIssue({
      //     code: z.ZodIssueCode.custom,
      //     path: ["billingDetails", "city"],
      //     message: "City is required",
      //   });
      // }

      // if (billingCity?.trim().length == 0) {
      //   ctx.addIssue({
      //     code: z.ZodIssueCode.custom,
      //     path: ["billingDetails", "city"],
      //     message: "City cannot be empty or whitespace",
      //   });
      // }

      // if (!billingCountry) {
      //   ctx.addIssue({
      //     code: z.ZodIssueCode.custom,
      //     path: ["billingDetails", "country"],
      //     message: "Country is required",
      //   });
      // }

      // if (billingCountry?.trim().length == 0) {
      //   ctx.addIssue({
      //     code: z.ZodIssueCode.custom,
      //     path: ["billingDetails", "country"],
      //     message: "Country cannot be empty or whitespace",
      //   });
      // }

      // if (isUSBillingAddress) {
      //   if (!billingState) {
      //     ctx.addIssue({
      //       code: z.ZodIssueCode.custom,
      //       path: ["billingDetails", "state"],
      //       message: "State is required",
      //     });

      //     if (billingState?.trim().length == 0) {
      //       ctx.addIssue({
      //         code: z.ZodIssueCode.custom,
      //         path: ["billingDetails", "state"],
      //         message: "State cannot be empty or whitespace",
      //       });
      //     }
      //   }

      //   if (!billingZip) {
      //     ctx.addIssue({
      //       code: z.ZodIssueCode.custom,
      //       path: ["billingDetails", "zip"],
      //       message: "Zip is required",
      //     });
      //   }

      //   if (billingZip?.trim().length == 0) {
      //     ctx.addIssue({
      //       code: z.ZodIssueCode.custom,
      //       path: ["billingDetails", "zip"],
      //       message: "Zip code cannot be empty or whitespace",
      //     });
      //   }

      //   if (billingZip && !/^\d{5}$/.test(billingZip)) {
      //     ctx.addIssue({
      //       code: z.ZodIssueCode.custom,
      //       path: ["billingDetails", "zip"],
      //       message: "Zip code must be a 5-digit number",
      //     });
      //   }
      // }

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

      // validate the address fields for US and ROW orders
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

        // if (!houseNumber) {
        //   ctx.addIssue({
        //     code: z.ZodIssueCode.custom,
        //     path: ["deliveryDetails", "houseNumber"],
        //     message: "Apt/House number is required",
        //   });
        // }

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
