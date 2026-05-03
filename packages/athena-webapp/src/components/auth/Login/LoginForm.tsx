import { useForm } from "@tanstack/react-form";
import { zodValidator } from "@tanstack/zod-form-adapter";
import { useAuthActions } from "@convex-dev/auth/react";
import { useState } from "react";
import { Input } from "../../ui/input";
import { LoadingButton } from "../../ui/loading-button";
import { ATHENA_EMAIL_OTP_PROVIDER_ID } from "../../../../shared/auth";
import { z } from "zod";
import { ArrowRight } from "lucide-react";

export function LoginForm({
  setStep,
}: {
  setStep: (step: { email: string }) => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { signIn } = useAuthActions();

  const form = useForm({
    validatorAdapter: zodValidator(),
    defaultValues: {
      email: "",
    },

    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      const normalizedEmail = value.email.trim().toLowerCase();

      try {
        await signIn(ATHENA_EMAIL_OTP_PROVIDER_ID, {
          email: normalizedEmail,
        });
        setStep({ email: normalizedEmail });
      } finally {
        setIsSubmitting(false);
      }
    },
  });
  return (
    <div className="flex w-full flex-col gap-layout-xl">
      <div>
        <h2 className="font-display text-2xl font-light uppercase tracking-[0.18em] text-foreground bg-background">
          Log in
        </h2>
      </div>
      <form
        className="relative flex w-full flex-col items-start gap-layout-md overflow-hidden rounded-lg border border-none bg-background p-layout-xs before:pointer-events-none before:absolute before:inset-0"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        <div className="relative z-10 flex w-full flex-col gap-layout-xs">
          <form.Field
            name="email"
            validators={{
              onSubmit: z
                .string()
                .max(256)
                .email("Email address is not valid"),
            }}
            children={(field) => (
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="Email"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                className={`h-control-standard border-border/80 bg-background shadow-[inset_0_1px_0_hsl(var(--background)/0.85)] ${field.state.meta?.errors.length > 0 &&
                  "border-destructive focus-visible:ring-destructive"
                  }`}
              />
            )}
          />
        </div>

        <div className="relative z-10 min-h-5 px-layout-xs">
          {form.state.fieldMeta.email?.errors.length > 0 && (
            <span className="text-sm text-destructive">
              {form.state.fieldMeta.email?.errors.join(" ")}
            </span>
          )}
        </div>

        <LoadingButton
          isLoading={isSubmitting}
          type="submit"
          className="group relative z-10 h-control-standard w-fit shadow-[0_16px_34px_-22px_hsl(var(--signal)/0.72)]"
        >
          Continue
          <ArrowRight className="h-4 w-4 transition-transform duration-standard ease-emphasized group-hover:translate-x-1 group-focus-visible:translate-x-1" />
        </LoadingButton>
      </form>
    </div>
  );
}
