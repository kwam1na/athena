import { z } from "zod";

// Zod schema for email validation
export const emailSchema = z
  .string()
  .min(1, "Email is required")
  .email("Please enter a valid email address")
  .refine(
    (value) => value.trim().length > 0,
    "Email cannot be empty or whitespace"
  );

// Validate email with Zod
export const validateEmail = (
  email: string,
  setValidationError: (error: string | null) => void
): boolean => {
  try {
    emailSchema.parse(email);
    setValidationError(null);
    return true;
  } catch (error) {
    if (error instanceof z.ZodError) {
      setValidationError(error.errors[0].message);
    } else {
      setValidationError("Invalid email");
    }
    return false;
  }
};
