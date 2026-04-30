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
import { useAuthActions } from "@convex-dev/auth/react";
import { ATHENA_EMAIL_OTP_PROVIDER_ID } from "../../../../shared/auth";
import { LoadingButton } from "~/src/components/ui/loading-button";
import { PENDING_ATHENA_AUTH_SYNC_KEY } from "~/src/lib/constants";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ArrowLeft, ArrowRight } from "lucide-react";

const REQUEST_NEW_CODE_DELAY_SECONDS = 90;

const FormSchema = z.object({
  pin: z.string().min(6, {
    message: "Your one-time verification code must be 6 characters.",
  }),
});

function formatRequestDelay(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function InputOTPForm({
  email,
  onBack,
  requestNewCodeDelaySeconds = REQUEST_NEW_CODE_DELAY_SECONDS,
}: {
  email: string;
  onBack: () => void;
  requestNewCodeDelaySeconds?: number;
}) {
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      pin: "",
    },
  });

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isRequestingNewCode, setIsRequestingNewCode] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requestDelaySeconds, setRequestDelaySeconds] = useState(
    requestNewCodeDelaySeconds,
  );
  const { signIn } = useAuthActions();

  useEffect(() => {
    setRequestDelaySeconds(requestNewCodeDelaySeconds);
  }, [email, requestNewCodeDelaySeconds]);

  useEffect(() => {
    if (requestDelaySeconds <= 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setRequestDelaySeconds((seconds) => Math.max(seconds - 1, 0));
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [requestDelaySeconds]);

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

      const result = await signIn(ATHENA_EMAIL_OTP_PROVIDER_ID, {
        code: data.pin,
        email: email.trim().toLowerCase(),
      });

      if (!result.signingIn) {
        setErrorMessage("Invalid code entered");
        setIsSigningIn(false);
        return;
      }

      sessionStorage.setItem(PENDING_ATHENA_AUTH_SYNC_KEY, "1");
      window.dispatchEvent(new Event("athena:pending-auth-sync"));
      return;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not verify code";

      setErrorMessage(
        message.includes("Could not verify code")
          ? "Invalid code entered"
          : message,
      );
      setIsSigningIn(false);
    }
  }

  async function handleRequestNewCode() {
    try {
      setIsRequestingNewCode(true);
      setErrorMessage(null);

      await signIn(ATHENA_EMAIL_OTP_PROVIDER_ID, {
        email: email.trim().toLowerCase(),
      });

      form.reset({ pin: "" });
      setRequestDelaySeconds(requestNewCodeDelaySeconds);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not request a new code";

      setErrorMessage(message);
    } finally {
      setIsRequestingNewCode(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-layout-lg">
      <div className="space-y-layout-sm">
        <h2 className="font-display text-2xl font-light uppercase tracking-[0.18em] text-foreground">
          Enter code
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Sent to {email}
        </p>
        <button
          type="button"
          className="group inline-flex items-center gap-layout-xs text-sm text-muted-foreground underline-offset-4 transition-colors duration-standard ease-standard hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={onBack}
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-standard ease-emphasized group-hover:-translate-x-1 group-focus-visible:-translate-x-1" />
          Change email
        </button>
      </div>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="w-full space-y-layout-lg"
        >
          <FormField
            control={form.control}
            name="pin"
            render={({ field }) => (
              <FormItem className="space-y-layout-sm">
                <FormLabel className="text-sm font-medium text-foreground">
                  One-time code
                </FormLabel>
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
                <FormDescription
                  className={errorMessage ? "text-danger" : undefined}
                >
                  {errorMessage ? errorMessage : ""}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <LoadingButton
            isLoading={isSigningIn}
            type="submit"
            className="group h-control-standard w-fit px-layout-lg"
          >
            Continue
            <ArrowRight className="h-4 w-4 transition-transform duration-standard ease-emphasized group-hover:translate-x-1 group-focus-visible:translate-x-1" />
          </LoadingButton>

          <div className="pt-layout-xs text-sm text-muted-foreground">
            {requestDelaySeconds > 0 ? (
              <p>
                Request a new code in {formatRequestDelay(requestDelaySeconds)}
              </p>
            ) : (
              <button
                type="button"
                className="text-signal underline-offset-4 transition-colors duration-standard ease-standard hover:text-signal/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                disabled={isRequestingNewCode}
                onClick={handleRequestNewCode}
              >
                {isRequestingNewCode
                  ? "Requesting new code..."
                  : "Request a new code"}
              </button>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}
