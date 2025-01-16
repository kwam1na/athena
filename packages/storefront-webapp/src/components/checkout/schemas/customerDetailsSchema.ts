import { z } from "zod";

const nameRegex = /^[a-zA-Zà-öø-ÿÀ-ÖØ-ß\-'\.\s]+$/;
const phoneNumberRegex =
  /^(\+?\d{1,4}[\s-]?)?(\(?\d{3}\)?[\s-]?)?\d{3}[\s-]?\d{4}$/;
export const customerDetailsSchema = z.object({
  firstName: z
    .string({
      required_error: "First name is required",
      invalid_type_error: "First name is required",
    })
    .min(1, "First name is required")
    .regex(nameRegex, "First name contains invalid characters")
    .refine(
      (value) => value.trim().length > 0,
      "First name cannot be empty or whitespace"
    ),
  lastName: z
    .string({
      required_error: "Last name is required",
      invalid_type_error: "Last name is required",
    })
    .min(1, "Last name is required")
    .regex(nameRegex, "Last name contains invalid characters")
    .refine(
      (value) => value.trim().length > 0,
      "Last name cannot be empty or whitespace"
    ),
  email: z
    .string({
      required_error: "Email is required",
      invalid_type_error: "Email is required",
    })
    .email("Invalid email")
    .refine(
      (value) => value.trim().length > 0,
      "Email cannot be empty or whitespace"
    ),
  phoneNumber: z
    .string({
      required_error: "Phone number is required",
      invalid_type_error: "Phone number is required",
    })
    .min(10, "Invalid phone number")
    .regex(phoneNumberRegex, "Invalid phone number")
    .refine(
      (value) => value.trim().length > 0,
      "Phone number cannot be empty or whitespace"
    ),
});
