import { useForm } from "@tanstack/react-form";
import { zodValidator } from "@tanstack/zod-form-adapter";
import { useAction } from "convex/react";
import { useState } from "react";
import { api } from "~/convex/_generated/api";
import { Input } from "../../ui/input";
import { LoadingButton } from "../../ui/loading-button";
import { z } from "zod";

export function LoginForm({
  setStep,
}: {
  setStep: (step: { email: string }) => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const verifyEmail = useAction(
    api.inventory.auth.sendVerificationCodeViaProvider
  );

  const form = useForm({
    validatorAdapter: zodValidator(),
    defaultValues: {
      email: "",
    },

    onSubmit: async ({ value }) => {
      setIsSubmitting(true);

      const res = await verifyEmail({ email: value.email });

      console.log("res", res);

      if (res.success) {
        setStep({ email: value.email });
      }

      setIsSubmitting(false);
    },
  });
  return (
    <div className="mx-auto flex h-full w-full max-w-96 flex-col items-center justify-center gap-6">
      <div className="mb-2 flex flex-col gap-4">
        <h3 className="text-center text-xl font-medium text-primary">
          Log in to athena
        </h3>
      </div>
      <form
        className="flex w-full flex-col items-start gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        <div className="flex w-full flex-col gap-1.5">
          <label htmlFor="email" className="sr-only">
            Email
          </label>
          <form.Field
            name="email"
            validators={{
              onSubmit: z
                .string()
                .max(256)
                .email("Email address is not valid."),
            }}
            children={(field) => (
              <Input
                placeholder="Email"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                className={`bg-transparent ${
                  field.state.meta?.errors.length > 0 &&
                  "border-destructive focus-visible:ring-destructive"
                }`}
              />
            )}
          />
        </div>

        <div className="flex flex-col">
          {form.state.fieldMeta.email?.errors.length > 0 && (
            <span className="mb-2 text-sm text-destructive">
              {form.state.fieldMeta.email?.errors.join(" ")}
            </span>
          )}
        </div>

        <LoadingButton
          isLoading={isSubmitting}
          type="submit"
          className="w-full"
        >
          Continue
        </LoadingButton>
      </form>
    </div>
  );
}
