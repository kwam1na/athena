import { updateBagOwner } from "@/api/bag";
import { updateOrdersOwner } from "@/api/onlineOrder";
import { updateSavedBagOwner } from "@/api/savedBag";
import { verifyUserAccount } from "@/api/auth";
import { AuthComponent } from "@/components/auth/Auth";
import { FadeIn } from "@/components/common/FadeIn";
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
import { LoadingButton } from "@/components/ui/loading-button";
import { useStoreContext } from "@/contexts/StoreContext";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { LOGGED_IN_USER_ID_KEY } from "@/lib/constants";
import { loginFn } from "@/server-actions/auth";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/start";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { set, z } from "zod";
import { awardPointsForGuestOrders } from "@/api/rewards";

export const FormSchema = z.object({
  code: z.string().min(6, {
    message: "Your one-time verification code must be 6 characters.",
  }),
});

export const Route = createFileRoute("/auth/verify")({
  component: InputOTPForm,
});

const WAIT_TIME = 120; // 2 minutes in seconds

function InputOTPForm() {
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      code: "",
    },
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [countdown, setCountdown] = useState<number>(WAIT_TIME); // 10 minutes in seconds
  const [showCountdown, setShowCountdown] = useState(true);

  const { email } = useSearch({ strict: false });
  const { store, userId } = useStoreContext();
  const { bag, savedBag } = useShoppingBag();

  const updateBagOwnerMutation = useMutation({
    mutationFn: updateBagOwner,
  });

  const updateSavedBagOwnerMutation = useMutation({
    mutationFn: updateSavedBagOwner,
  });

  const updateOrdersOwnerMutation = useMutation({
    mutationFn: updateOrdersOwner,
  });

  const awardPointsForGuestOrdersMutation = useMutation({
    mutationFn: awardPointsForGuestOrders,
  });

  // Initialize and handle countdown
  useEffect(() => {
    if (countdown > 0 && showCountdown) {
      const timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);

      return () => clearInterval(timer);
    } else if (countdown === 0) {
      setShowCountdown(false);
    }
  }, [countdown, showCountdown]);

  // Format countdown time
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  // Automatically submit the form when 6 digits are entered
  const handleCodeChange = (newValue: string) => {
    form.setValue("code", newValue);

    if (newValue.length === 6) {
      form.handleSubmit(onSubmit)();
    }
  };

  const resendVerificationCodeMutation = useMutation({
    mutationFn: verifyUserAccount,
    onSuccess: (res) => {
      if (res.error) {
        setErrorMessage(res.message);
      } else {
        setErrorMessage(null);
      }

      if (res.success) {
        toast.success("Verification code sent to your email.");
        form.setValue("code", "");
        setCountdown(WAIT_TIME);
        setShowCountdown(true);
      }
    },
    onError: (error) => {
      console.log("error", error);
      setErrorMessage(error.message);
    },
  });

  const verifyUserAccountMutation = useMutation({
    mutationFn: verifyUserAccount,
  });

  const onSubmit = async (data: z.infer<typeof FormSchema>) => {
    setIsVerifying(true);

    try {
      const res = await verifyUserAccountMutation.mutateAsync({
        email,
        code: data.code,
      });

      if (res.error) {
        setErrorMessage(res.message);
      } else {
        setErrorMessage(null);
      }

      if (res.success) {
        await Promise.all([
          await updateBagOwnerMutation.mutateAsync({
            currentOwnerId: userId || "",
            newOwnerId: res.user._id,
            bagId: bag?._id as string,
          }),

          await updateSavedBagOwnerMutation.mutateAsync({
            currentOwnerId: userId || "",
            newOwnerId: res.user._id,
            organizationId: store?.organizationId as string,
            storeId: store?._id as string,
            savedBagId: savedBag?._id as string,
          }),

          await updateOrdersOwnerMutation.mutateAsync({
            currentOwnerId: userId || "",
            newOwnerId: res.user._id,
          }),

          await awardPointsForGuestOrdersMutation.mutateAsync({
            guestId: userId || "",
            userId: res.user._id,
          }),
        ]);

        localStorage.setItem(LOGGED_IN_USER_ID_KEY, res.user._id);

        window.location.href = "/";
      }
    } catch (e) {
      console.error(e);
      setErrorMessage(
        (e as Error).message ??
          "There was an error verifying your account. Please try again."
      );
    } finally {
      setIsVerifying(false);
    }
  };

  const resendVerificationCode = async () => {
    if (!email) {
      setErrorMessage("Email is required to resend verification code");
      return;
    }

    resendVerificationCodeMutation.mutate({
      email,
    });
  };

  if (!store) return <div className="h-screen" />;

  return (
    <AuthComponent>
      <FadeIn className="container mx-auto max-w-[1024px] pb-56 py-8 px-6 xl:px-0">
        <div className="space-y-8">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-8 flex flex-col items-center pt-40"
            >
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem className="space-y-4 flex flex-col items-center">
                    <FormControl>
                      <InputOTP
                        maxLength={6}
                        {...field}
                        onChange={handleCodeChange}
                      >
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
                    <FormDescription className="text-center">
                      {errorMessage
                        ? errorMessage
                        : `Enter the one-time code sent to ${email ?? "your email address"}`}
                    </FormDescription>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              <LoadingButton
                className="w-[96px]"
                isLoading={isVerifying}
                type="submit"
              >
                Continue
              </LoadingButton>
            </form>
          </Form>

          <div className="flex w-full flex-col gap-4 items-center">
            {showCountdown ? (
              <p className="text-sm text-muted-foreground">
                Request a new code in {formatTime(countdown)}
              </p>
            ) : (
              <LoadingButton
                onClick={resendVerificationCode}
                isLoading={resendVerificationCodeMutation.isPending}
                variant="ghost"
              >
                <p className="text-sm">Request New Code</p>
              </LoadingButton>
            )}
            <Link
              className="flex items-center gap-2 text-muted-foreground hover:underline hover:cursor-pointer"
              to="/login"
            >
              <ArrowLeftIcon className="w-3.5 h-3.5" />
              <p className="text-sm">Back to Login</p>
            </Link>
          </div>
        </div>
      </FadeIn>
    </AuthComponent>
  );
}
