import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuthActions } from "@convex-dev/auth/react";
import { set, z } from "zod";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useForm } from "@tanstack/react-form";
import { useForm as uF } from "react-hook-form";
import { zodValidator } from "@tanstack/zod-form-adapter";
import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useConvexAuth } from "@convex-dev/react-query";
import { api } from "@cvx/_generated/api";

export const Route = createFileRoute("/login/_layout/")({
  component: Login,
});

function Login() {
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");

  if (step === "signIn") {
    return <LoginForm setStep={setStep} />;
  }
  return <InputOTPForm email={step.email} />;
}

function LoginForm({
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
      <div className="mb-2 flex flex-col gap-2">
        <h3 className="text-center text-2xl font-medium text-primary">
          Continue to athena
        </h3>
        <p className="text-center text-base font-normal text-primary/60">
          Welcome back! Log in to continue.
        </p>
      </div>
      <form
        className="flex w-full flex-col items-start gap-1"
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
            <span className="mb-2 text-sm text-destructive dark:text-destructive-foreground">
              {form.state.fieldMeta.email?.errors.join(" ")}
            </span>
          )}
        </div>

        <Button type="submit" className="w-full">
          {isSubmitting ? <Loader2 className="animate-spin" /> : "Continue"}
        </Button>
      </form>
    </div>
  );
}

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { LoadingButton } from "~/src/components/ui/loading-button";
import { LOGGED_IN_USER_ID_KEY } from "~/src/lib/constants";

const FormSchema = z.object({
  pin: z.string().min(6, {
    message: "Your one-time verification code must be 6 characters.",
  }),
});

export function InputOTPForm({ email }: { email: string }) {
  const form = uF<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      pin: "",
    },
  });

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { signIn } = useAuthActions();

  const verifyCode = useMutation(api.inventory.auth.verifyCode);

  const navigate = useNavigate();

  // Automatically submit the form when 6 digits are entered
  const handlePinChange = (newValue: string) => {
    form.setValue("pin", newValue);

    if (newValue.length === 6) {
      form.handleSubmit(onSubmit)();
    }
  };

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    try {
      setIsSigningIn(true);
      setErrorMessage(null);

      const res = await verifyCode({ code: data.pin, email });

      if (res.success) {
        console.log(res.user);
        localStorage.setItem(LOGGED_IN_USER_ID_KEY, res.user._id);

        navigate({ to: "/" });
      }

      if (res.error) {
        setErrorMessage(res.message);
      }

      setIsSigningIn(false);
    } catch (e) {
      if ((e as Error).message.includes("Could not verify code")) {
        setErrorMessage("Invalid code entered");
      }
      setIsSigningIn(false);
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-96 flex-col items-center justify-center gap-6">
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="w-2/3 space-y-6"
        >
          <FormField
            control={form.control}
            name="pin"
            render={({ field }) => (
              <FormItem>
                <FormLabel>One-Time Password</FormLabel>
                <FormControl>
                  <InputOTP maxLength={6} {...field} onChange={handlePinChange}>
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </FormControl>
                <FormDescription>
                  {errorMessage
                    ? errorMessage
                    : `Enter the one-time code sent to ${email}`}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <LoadingButton isLoading={isSigningIn} type="submit">
            Continue
          </LoadingButton>
        </form>
      </Form>

      <div className="flex w-full flex-col">
        <p className="text-center text-sm font-normal text-primary/60">
          Did not receive the code?
        </p>
        <Button
          onClick={() => signIn("resend-otp", { email })}
          variant="ghost"
          className="w-full hover:bg-transparent"
        >
          Request New Code
        </Button>
      </div>
    </div>
  );
}
