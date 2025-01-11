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
import { useForm } from "react-hook-form";
import { useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "@tanstack/react-router";
import { api } from "~/convex/_generated/api";
import { z } from "zod";
import { Button } from "../../ui/button";

const FormSchema = z.object({
  pin: z.string().min(6, {
    message: "Your one-time verification code must be 6 characters.",
  }),
});

export function InputOTPForm({ email }: { email: string }) {
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      pin: "",
    },
  });

  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

      {/* <div className="flex w-full flex-col">
        <p className="text-center text-sm font-normal text-primary/60">
          Did not receive the code?
        </p>
        <Button
          variant="ghost"
          className="w-full hover:bg-transparent"
        >
          Request New Code
        </Button>
      </div> */}
    </div>
  );
}
