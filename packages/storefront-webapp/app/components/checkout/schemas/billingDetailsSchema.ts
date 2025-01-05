import { z } from "zod";

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

export const baseBillingDetailsSchema = z.object({
  address: z.string().optional(),
  billingAddressSameAsDelivery: z.boolean().optional(),
  street: z.string().optional(),
  houseNumber: z.string().optional(),
  neighborhood: z.string().optional(),
  region: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z
    .string({
      required_error: "Country is required",
      invalid_type_error: "Country is required",
    })
    .min(1, "Country is required")
    .refine(
      (value) => value.trim().length > 0,
      "Country cannot be empty or whitespace"
    ),
});
